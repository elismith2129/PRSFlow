// Daily backup of all key Supabase tables to Google Drive.
//
// Runs in Node.js (NOT the browser) — no Next.js / React imports. Invoked by
// .github/workflows/daily-backup.yml on a daily cron, or manually.
//
// Talks to the Supabase REST (PostgREST) API directly with fetch() rather than
// @supabase/supabase-js — the JS client initializes a realtime WebSocket client,
// which fails under Node 20 ("Node.js 20 detected without native WebSocket
// support") unless the `ws` package is present. Plain fetch avoids that entirely.
//
// Required environment variables:
//   NEXT_PUBLIC_SUPABASE_URL        — Supabase project URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY   — Supabase anon key (RLS is off, full read access)
//   GOOGLE_SERVICE_ACCOUNT_JSON     — full service-account JSON (parsed at runtime)
//
// Local run:
//   node --env-file=.env.local scripts/backup.mjs   (Node 20.6+)

import { google } from 'googleapis';
import { Readable } from 'node:stream';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DRIVE_FOLDER_ID = '1y4O31OCCNNAc9FJvEr2S5mBFtAo45JWG';

const TABLES = [
  'bookings',
  'work_orders',
  'clients',
  'leads',
  'dashboard_tasks',
  'user_profiles',
  'flags',
  'mic_inventory_quantities',
  'srs_log',
  'engineers',
  'daily_ops_submissions',
];

const PAGE_SIZE = 1000;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}
if (!GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
} catch (err) {
  console.error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON:', err.message);
  process.exit(1);
}

// PostgREST base URL + auth headers (anon key as both apikey and bearer token).
const REST_URL = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/';
const REST_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// Fetch one page of a table from the REST API.
//
// `withDeletedFilter` adds `deleted_at=is.null` to exclude soft-deleted rows.
// Returns { rows } on success, or { missingDeletedAt: true } when PostgREST
// rejects the query because the table has no `deleted_at` column (so the caller
// can retry without the filter).
// ---------------------------------------------------------------------------
async function fetchPage(table, offset, withDeletedFilter) {
  const params = new URLSearchParams();
  params.set('select', '*');
  if (withDeletedFilter) params.set('deleted_at', 'is.null');
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));

  const res = await fetch(`${REST_URL}${table}?${params.toString()}`, {
    headers: REST_HEADERS,
  });

  if (!res.ok) {
    const body = await res.text();
    // 42703 = undefined_column; the table has no deleted_at column.
    if (withDeletedFilter && (/42703/.test(body) || /deleted_at/i.test(body))) {
      return { missingDeletedAt: true };
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${body}`);
  }

  const rows = await res.json();
  return { rows };
}

// ---------------------------------------------------------------------------
// Fetch one table fully, paginated, excluding soft-deleted rows.
//
// Not every table has a `deleted_at` column. We attempt with the
// `deleted_at=is.null` filter first; if PostgREST reports the column does not
// exist, we transparently retry without the filter.
// ---------------------------------------------------------------------------
async function fetchTable(table) {
  const rows = [];
  let offset = 0;
  let withDeletedFilter = true;

  while (true) {
    const page = await fetchPage(table, offset, withDeletedFilter);

    if (page.missingDeletedAt) {
      // This table has no deleted_at column — back up every row instead.
      withDeletedFilter = false;
      continue;
    }

    rows.push(...page.rows);
    if (page.rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Upload the combined backup JSON to Google Drive.
// ---------------------------------------------------------------------------
async function uploadToDrive(fileName, jsonString) {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [DRIVE_FOLDER_ID],
    },
    media: {
      mimeType: 'application/json',
      body: Readable.from(jsonString),
    },
    fields: 'id, name',
    supportsAllDrives: true,
  });

  return res.data;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.slice(0, 10); // YYYY-MM-DD (UTC)
  const fileName = `prsflow-backup-${dateStr}.json`;

  console.log(`Starting PRSFlow backup ${fileName} (${timestamp})`);

  const tables = {};
  const errors = [];

  for (const table of TABLES) {
    try {
      const rows = await fetchTable(table);
      tables[table] = rows;
      console.log(`✓ ${table}: ${rows.length} rows`);
    } catch (err) {
      // One table failing must not abort the whole backup — note it and continue.
      tables[table] = [];
      errors.push({ table, error: err.message });
      console.error(`✗ ${table}: ${err.message}`);
    }
  }

  const backup = { timestamp, tables };
  if (errors.length > 0) backup.errors = errors;

  const jsonString = JSON.stringify(backup, null, 2);

  try {
    const uploaded = await uploadToDrive(fileName, jsonString);
    console.log(`✓ Uploaded ${uploaded.name} to Drive (id: ${uploaded.id})`);
  } catch (err) {
    // Upload failure is fatal — exit non-zero so GitHub Actions marks the run failed.
    const status = err.code ?? err.status ?? err.response?.status;
    const is404 = status === 404 || /not\s*found/i.test(err.message || '');
    if (is404) {
      // A 404 on the parent folder almost always means the service account can't
      // see it — it must be shared (Editor) with the service account's email.
      const saEmail = serviceAccount.client_email || '(client_email missing from GOOGLE_SERVICE_ACCOUNT_JSON)';
      console.error(`✗ Drive upload failed: folder ${DRIVE_FOLDER_ID} not found (404).`);
      console.error(`  Check that the Drive folder is shared with the service account email (Editor access): ${saEmail}`);
    } else {
      console.error(`✗ Drive upload failed: ${err.message}`);
    }
    process.exit(1);
  }

  if (errors.length > 0) {
    console.log(`Backup complete with ${errors.length} table error(s): ${errors.map(e => e.table).join(', ')}`);
  } else {
    console.log('Backup complete — all tables backed up successfully.');
  }
}

main().catch((err) => {
  console.error('Backup failed with an unexpected error:', err);
  process.exit(1);
});
