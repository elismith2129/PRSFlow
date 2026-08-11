// Daily backup of the WHOLE app — every table AND every uploaded file.
//
// Runs in Node.js (NOT the browser) — no Next.js / React imports. Invoked by
// .github/workflows/daily-backup.yml on a daily cron, or manually.
//
// Talks to the Supabase REST (PostgREST) and Storage APIs directly with fetch()
// rather than @supabase/supabase-js — the JS client initializes a realtime
// WebSocket client, which fails under Node 20 ("Node.js 20 detected without
// native WebSocket support") unless the `ws` package is present. Plain fetch
// avoids that entirely.
//
// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN 2026-08-11 (Eli: "let's do backup for the whole app"). TWO holes:
//
//   1. TABLES WAS A HARDCODED LIST OF 17. The database has ~32. Everything added
//      since the list was written — checklists, mic_checkins, expense_rows,
//      client_contacts, contact_log, equipment_condition_rows, the myday_* set,
//      app_errors, and more — was silently never backed up. The list was never
//      wrong on the day it was written; it just stopped being right and nothing
//      said so.
//
//   2. STORAGE WAS NEVER BACKED UP AT ALL. Client ID scans, runner photos, flag
//      photos, task attachments, expense receipts, WO signatures: no copy
//      anywhere. The database ALSO has Supabase PITR behind it, so the protected
//      thing had two copies and the unprotected thing had none.
//
// THE FIX FOR BOTH IS THE SAME IDEA: **discover, never enumerate.** Tables come
// from the PostgREST OpenAPI root; buckets come from the Storage API. A table or
// bucket added next year is backed up the next morning without anyone
// remembering this file exists. A hardcoded list is a promise to maintain
// something nobody will maintain.
//
// HOW EACH HALF IS STORED, and why they differ:
//   · TABLES → one dated JSON per run, as before. Small, and you want history:
//     a row deleted last week should still be recoverable from an older dump.
//   · FILES  → an INCREMENTAL MIRROR, not a daily copy. Uploaded files are
//     effectively immutable (a photo is added, never edited), so re-uploading
//     every object every night would multiply Drive traffic by 365 for no gain.
//     Instead there is one persistent mirror folder per bucket and only objects
//     not already there get uploaded. A file deleted in Supabase STAYS in the
//     mirror — that is a backup working correctly, not a bug.
//
// Required environment variables:
//   NEXT_PUBLIC_SUPABASE_URL        — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY       — service-role key. REQUIRED: after the RLS
//                                     hardening the anon key has no read access,
//                                     and it cannot read private buckets either.
//   GOOGLE_SERVICE_ACCOUNT_JSON     — full service-account JSON (parsed at runtime)
//
// Local run:
//   node --env-file=.env.local scripts/backup.mjs   (Node 20.6+)

import { google } from 'googleapis';
import { Readable } from 'node:stream';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DRIVE_FOLDER_ID = '1SjhWdOP9_Rf3GDkNXU3sRk8CU8bgXk-Q';

/** Name of the persistent file-mirror folder created inside DRIVE_FOLDER_ID. */
const MIRROR_FOLDER_NAME = 'prsflo-files';

const PAGE_SIZE = 1000;

/**
 * Tables the backup deliberately SKIPS.
 *
 * `staff_pins` holds bcrypt hashes and the generated Supabase passwords for the
 * PIN login. Copying credentials into a Drive folder — even a restricted one —
 * widens the blast radius of that folder for no recovery benefit: PINs can be
 * reissued in minutes by re-running scripts/set-staff-passwords.mjs.
 *
 * Everything else is backed up. Add to this list only for a reason as concrete
 * as that one, and write the reason down.
 */
const SKIP_TABLES = new Set(['staff_pins']);

/** Objects larger than this are skipped with a warning rather than blowing the
 *  Actions runner's memory (each file is buffered whole before upload). */
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
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

const BASE = SUPABASE_URL.replace(/\/+$/, '');
const REST_URL = BASE + '/rest/v1/';
const STORAGE_URL = BASE + '/storage/v1/';
const AUTH_HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};
const REST_HEADERS = { ...AUTH_HEADERS, 'Content-Type': 'application/json' };

// ---------------------------------------------------------------------------
// TABLE DISCOVERY
//
// PostgREST serves an OpenAPI description at the API root listing every table
// and view it exposes. Reading it means the backup covers the schema as it
// actually is, not as somebody remembered it in June.
// ---------------------------------------------------------------------------
async function discoverTables() {
  const res = await fetch(REST_URL, { headers: REST_HEADERS });
  if (!res.ok) {
    throw new Error(`Table discovery failed: HTTP ${res.status} ${await res.text()}`);
  }
  const spec = await res.json();

  // PostgREST 9/10/11 shapes differ: older exposes `definitions`, newer
  // `components.schemas`. `paths` is the reliable fallback in both.
  let names = [];
  if (spec.definitions) names = Object.keys(spec.definitions);
  else if (spec.components?.schemas) names = Object.keys(spec.components.schemas);
  if (names.length === 0 && spec.paths) {
    names = Object.keys(spec.paths)
      .filter(p => /^\/[^/{]+$/.test(p))
      .map(p => p.slice(1));
  }

  return names
    .filter(n => n && !n.startsWith('(') && !SKIP_TABLES.has(n))
    .sort();
}

// ---------------------------------------------------------------------------
// Fetch one page of a table.
//
// `withDeletedFilter` adds `deleted_at=is.null`. Returns { missingDeletedAt }
// when PostgREST rejects it because the table has no such column.
// ---------------------------------------------------------------------------
async function fetchPage(table, offset, withDeletedFilter) {
  const params = new URLSearchParams();
  params.set('select', '*');
  if (withDeletedFilter) params.set('deleted_at', 'is.null');
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));

  const res = await fetch(`${REST_URL}${table}?${params.toString()}`, { headers: REST_HEADERS });

  if (!res.ok) {
    const body = await res.text();
    // 42703 = undefined_column; the table has no deleted_at column.
    if (withDeletedFilter && (/42703/.test(body) || /deleted_at/i.test(body))) {
      return { missingDeletedAt: true };
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${body}`);
  }
  return { rows: await res.json() };
}

async function fetchTable(table) {
  const rows = [];
  let offset = 0;
  let withDeletedFilter = true;

  while (true) {
    const page = await fetchPage(table, offset, withDeletedFilter);
    if (page.missingDeletedAt) { withDeletedFilter = false; continue; }
    rows.push(...page.rows);
    if (page.rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------

async function listBuckets() {
  const res = await fetch(`${STORAGE_URL}bucket`, { headers: REST_HEADERS });
  if (!res.ok) throw new Error(`Bucket list failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).map(b => b.name);
}

/**
 * Every object in a bucket, walking sub-folders.
 *
 * The Storage list endpoint is directory-shaped, not recursive: an entry with a
 * null `id` is a folder, not a file. So this recurses, and paginates each level
 * — a bucket with thousands of runner photos would otherwise silently return
 * only the first page.
 */
async function listObjects(bucket, prefix = '', depth = 0) {
  if (depth > 12) return []; // paranoia against a pathological tree
  const out = [];
  let offset = 0;

  while (true) {
    const res = await fetch(`${STORAGE_URL}object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      headers: REST_HEADERS,
      body: JSON.stringify({
        prefix,
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    });
    if (!res.ok) throw new Error(`List ${bucket}/${prefix} failed: HTTP ${res.status} ${await res.text()}`);

    const items = await res.json();
    for (const item of items) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null || item.id === undefined) {
        out.push(...await listObjects(bucket, path, depth + 1)); // folder
      } else {
        out.push({ path, size: item.metadata?.size ?? null, mimeType: item.metadata?.mimetype ?? 'application/octet-stream' });
      }
    }

    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

async function downloadObject(bucket, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${STORAGE_URL}object/${encodeURIComponent(bucket)}/${encoded}`, {
    headers: AUTH_HEADERS,
  });
  if (!res.ok) throw new Error(`Download ${bucket}/${path} failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Storage path → a single flat Drive filename.
 *
 * Deliberately flat rather than mirroring the folder tree in Drive: rebuilding a
 * nested tree costs a find-or-create round-trip per folder per run, and Drive
 * has no unique constraint on folder names, so a race or a retry quietly
 * produces duplicate folders. The original path stays fully recoverable from the
 * name, which is all a backup needs.
 */
function flatName(objectPath) {
  return objectPath.replace(/\//g, '__');
}

// ---------------------------------------------------------------------------
// DRIVE
// ---------------------------------------------------------------------------

function driveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

async function findOrCreateFolder(drive, name, parentId) {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
  ].join(' and ');

  const found = await drive.files.list({
    q, fields: 'files(id, name)', pageSize: 1,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  if (found.data.files?.length) return found.data.files[0].id;

  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return created.data.id;
}

/** Filenames already in a Drive folder — the "have I got this one" index. */
async function listExistingNames(drive, folderId) {
  const names = new Set();
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(name)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files ?? []) names.add(f.name);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return names;
}

async function uploadFile(drive, { name, parentId, mimeType, body }) {
  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: { name, parents: [parentId] },
    media: { mimeType, body: Readable.from(body) },
    fields: 'id, name',
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

  console.log(`Starting PRSFlo backup ${fileName} (${timestamp})`);

  const errors = [];

  // ── 1. Tables ────────────────────────────────────────────────────────────
  let tableNames = [];
  try {
    tableNames = await discoverTables();
    console.log(`Discovered ${tableNames.length} tables`);
  } catch (err) {
    // Fatal: without discovery we would silently back up nothing, which is far
    // worse than failing loudly.
    console.error(`✗ Could not discover tables: ${err.message}`);
    process.exit(1);
  }

  const tables = {};
  for (const table of tableNames) {
    try {
      const rows = await fetchTable(table);
      tables[table] = rows;
      console.log(`✓ ${table}: ${rows.length} rows`);
    } catch (err) {
      tables[table] = [];
      errors.push({ kind: 'table', name: table, error: err.message });
      console.error(`✗ ${table}: ${err.message}`);
    }
  }

  // ── 2. Storage manifest ──────────────────────────────────────────────────
  // Recorded in the JSON as well as mirrored, so a restore can verify that
  // every object the database references actually made it to Drive.
  const storage = {};
  let buckets = [];
  try {
    buckets = await listBuckets();
    console.log(`Discovered ${buckets.length} storage buckets: ${buckets.join(', ') || '(none)'}`);
  } catch (err) {
    errors.push({ kind: 'storage', name: '(bucket list)', error: err.message });
    console.error(`✗ Bucket list: ${err.message}`);
  }

  for (const bucket of buckets) {
    try {
      const objects = await listObjects(bucket);
      storage[bucket] = objects;
      console.log(`✓ ${bucket}: ${objects.length} objects`);
    } catch (err) {
      storage[bucket] = [];
      errors.push({ kind: 'storage', name: bucket, error: err.message });
      console.error(`✗ ${bucket}: ${err.message}`);
    }
  }

  // ── 3. Upload the table dump ─────────────────────────────────────────────
  const drive = driveClient();
  const backup = { timestamp, tables, storage };
  if (errors.length > 0) backup.errors = errors;

  try {
    const uploaded = await uploadFile(drive, {
      name: fileName,
      parentId: DRIVE_FOLDER_ID,
      mimeType: 'application/json',
      body: JSON.stringify(backup, null, 2),
    });
    console.log(`✓ Uploaded ${uploaded.name} to Drive (id: ${uploaded.id})`);
  } catch (err) {
    const status = err.code ?? err.status ?? err.response?.status;
    const is404 = status === 404 || /not\s*found/i.test(err.message || '');
    if (is404) {
      const saEmail = serviceAccount.client_email || '(client_email missing from GOOGLE_SERVICE_ACCOUNT_JSON)';
      console.error(`✗ Drive upload failed: folder ${DRIVE_FOLDER_ID} not found (404).`);
      console.error(`  Share the Drive folder with the service account email (Editor): ${saEmail}`);
    } else {
      console.error(`✗ Drive upload failed: ${err.message}`);
    }
    process.exit(1);
  }

  // ── 4. Mirror the files, incrementally ───────────────────────────────────
  let copied = 0, skipped = 0, failed = 0;
  if (buckets.length > 0) {
    try {
      const mirrorId = await findOrCreateFolder(drive, MIRROR_FOLDER_NAME, DRIVE_FOLDER_ID);

      for (const bucket of buckets) {
        const objects = storage[bucket] ?? [];
        if (objects.length === 0) continue;

        const bucketFolderId = await findOrCreateFolder(drive, bucket, mirrorId);
        const have = await listExistingNames(drive, bucketFolderId);

        for (const obj of objects) {
          const name = flatName(obj.path);
          if (have.has(name)) { skipped++; continue; }
          if (obj.size && obj.size > MAX_FILE_BYTES) {
            failed++;
            errors.push({ kind: 'file', name: `${bucket}/${obj.path}`, error: `skipped — ${obj.size} bytes exceeds the ${MAX_FILE_BYTES} byte limit` });
            console.error(`✗ ${bucket}/${obj.path}: too large (${obj.size} bytes)`);
            continue;
          }
          try {
            const body = await downloadObject(bucket, obj.path);
            await uploadFile(drive, { name, parentId: bucketFolderId, mimeType: obj.mimeType, body });
            copied++;
          } catch (err) {
            failed++;
            errors.push({ kind: 'file', name: `${bucket}/${obj.path}`, error: err.message });
            console.error(`✗ ${bucket}/${obj.path}: ${err.message}`);
          }
        }
        console.log(`✓ ${bucket}: mirrored (${copied} new so far, ${skipped} already present)`);
      }
    } catch (err) {
      failed++;
      errors.push({ kind: 'file', name: '(mirror)', error: err.message });
      console.error(`✗ File mirror failed: ${err.message}`);
    }
  }

  // ── 5. Verdict ───────────────────────────────────────────────────────────
  const totalObjects = Object.values(storage).reduce((s, o) => s + o.length, 0);
  console.log(
    `Files: ${copied} newly copied, ${skipped} already in the mirror, ${failed} failed ` +
    `(${totalObjects} objects across ${buckets.length} buckets).`
  );

  if (errors.length > 0) {
    console.error(`Backup finished with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  · [${e.kind}] ${e.name}: ${e.error}`);
    // Exit non-zero so the Actions run goes red. A backup that half-worked and
    // reported success is worse than one that failed — you would only find out
    // on the day you needed it.
    process.exit(1);
  }

  console.log(`Backup complete — ${tableNames.length} tables and ${totalObjects} files.`);
}

main().catch((err) => {
  console.error('Backup failed with an unexpected error:', err);
  process.exit(1);
});
