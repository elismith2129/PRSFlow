// Daily backup of all key Supabase tables to Google Drive.
//
// Runs in Node.js (NOT the browser) — no Next.js / React imports. Invoked by
// .github/workflows/daily-backup.yml on a daily cron, or manually.
//
// Required environment variables:
//   NEXT_PUBLIC_SUPABASE_URL        — Supabase project URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY   — Supabase anon key (RLS is off, full read access)
//   GOOGLE_SERVICE_ACCOUNT_JSON     — full service-account JSON (parsed at runtime)
//
// Local run:
//   node --env-file=.env.local scripts/backup.mjs   (Node 20.6+)

import { createClient } from '@supabase/supabase-js';
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
  'mic_inventory',
  'srs_referrals',
  'engineers',
  'daily_ops_log',
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

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// Fetch one table, paginated, excluding soft-deleted rows.
//
// Not every table has a `deleted_at` column. We attempt the query with the
// `deleted_at IS NULL` filter first; if PostgREST reports the column does not
// exist (code 42703), we transparently retry that page without the filter.
// ---------------------------------------------------------------------------
async function fetchTable(table) {
  const rows = [];
  let from = 0;
  let useDeletedFilter = true;

  while (true) {
    let query = supabase.from(table).select('*').range(from, from + PAGE_SIZE - 1);
    if (useDeletedFilter) query = query.is('deleted_at', null);

    const { data, error } = await query;

    if (error) {
      const missingDeletedAt =
        error.code === '42703' || /deleted_at/i.test(error.message || '');
      if (useDeletedFilter && missingDeletedAt) {
        // This table has no deleted_at column — back up every row instead.
        useDeletedFilter = false;
        continue;
      }
      throw new Error(error.message || JSON.stringify(error));
    }

    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
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
    console.error(`✗ Drive upload failed: ${err.message}`);
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
