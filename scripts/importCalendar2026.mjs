// ---------------------------------------------------------------------------
// 2026 WordPress calendar import (Eli, 2026-08-26).
//
// Source: imports-scratch/paramountrecordinggroup.WordPress.2026-08-26.xml
// (WXR 1.2, Tools → Export → Calendar Events; gitignored — real client data).
//
// Replaces scripts/importCalendar.mjs, whose parser expected flat tags that a
// real WXR export does not contain (it would have found zero dates) and whose
// output targeted the pre-rebuild schema (studio_id / booking_status / a
// studios table). This one parses <wp:postmeta> key/value pairs and writes the
// CURRENT bookings schema (location + studio, status, staff fields).
//
// Usage (from repo root):
//   node --env-file=.env.local scripts/importCalendar2026.mjs            ← DRY RUN (default)
//   node --env-file=.env.local scripts/importCalendar2026.mjs --live     ← snapshot, wipe, import
//
// DRY RUN: parses, maps, prints the report, writes
//   imports-scratch/import_preview.json for review. Touches nothing.
//
// LIVE: requires migration 20260826150000_bookings_imported_at.sql to have
//   been run first. Then, in order:
//   1. Snapshots bookings + every dependent table to
//      imports-scratch/snapshot_<timestamp>.json (recovery copy).
//   2. Deletes ALL existing bookings and their dependents (Eli, 2026-08-26:
//      everything in bookings is test data, approved for deletion).
//   3. Inserts the imported rows in batches of 100, imported_at stamped.
//
// Status mapping (Eli's color legend, 2026-08-26):
//   #123052 dark blue   → confirmed        (plus the near-blue variants)
//   #000000 black       → open_hours       (staff/open hours)
//   #6c572c brown       → tentative
//   #557c93 slate       → tour if the title says Tour, else confirmed
//   #698083 grey-green  → tech
//   WP drafts and trash are skipped entirely ("can ditch drafts").
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';

const LIVE = process.argv.includes('--live');
const XML_PATH = 'imports-scratch/paramountrecordinggroup.WordPress.2026-08-26.xml';
const YEAR = '2026';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run with --env-file=.env.local)');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// WXR parsing
// ---------------------------------------------------------------------------
const cd = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

function parseItems(xml) {
  const out = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  const metaRe = /<wp:postmeta>\s*<wp:meta_key><!\[CDATA\[(.*?)\]\]><\/wp:meta_key>\s*<wp:meta_value><!\[CDATA\[([\s\S]*?)\]\]><\/wp:meta_value>\s*<\/wp:postmeta>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const it = m[1];
    const meta = {};
    let mm;
    while ((mm = metaRe.exec(it)) !== null) {
      if (!mm[1].startsWith('_') && !(mm[1] in meta)) meta[mm[1]] = mm[2].trim();
    }
    const title = cd((it.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]);
    const wpStatus = cd((it.match(/<wp:status>([\s\S]*?)<\/wp:status>/) || [, ''])[1]);
    const cat = it.match(/<category domain="cmcal-event-studio"[^>]*>([\s\S]*?)<\/category>/);
    out.push({ title, wpStatus, studioLabel: cat ? cd(cat[1]) : null, meta });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mapping tables
// ---------------------------------------------------------------------------
// WP studio category → { location (venue), studio (room) } per lib/studios.ts
const STUDIO_MAP = {
  'Paramount Studio A': { location: 'Paramount', studio: 'Studio A' },
  'Paramount Studio B': { location: 'Paramount', studio: 'Studio B' },
  'Paramount Studio C': { location: 'Paramount', studio: 'Studio C' },
  'Paramount Studio E': { location: 'Paramount', studio: 'Studio E' },
  'Paramount Studio X': { location: 'Paramount', studio: 'Studio X' },
  'Ameraycan A':        { location: 'Ameraycan', studio: 'Studio A' },
  'Ameraycan B':        { location: 'Ameraycan', studio: 'Studio B' },
  'Encore A':           { location: 'Encore',    studio: 'Studio A' },
  'Encore B':           { location: 'Encore',    studio: 'Studio B' },
  'Track South':        { location: 'Track',     studio: 'South' },
  'Track North':        { location: 'Track',     studio: 'North' },
};

// WALKTHEDOG rate cipher (same as the retired importCalendar.mjs)
const CIPHER = { W: '1', A: '2', L: '3', K: '4', T: '5', H: '6', E: '7', D: '8', O: '9', G: '0' };

function decodeRate(raw) {
  if (!raw) return { rate: null, invoice: null, failed: false };
  let codePart = raw;
  let invoice = null;
  const hashIdx = raw.indexOf('#');
  if (hashIdx !== -1) {
    codePart = raw.slice(0, hashIdx).trim();
    invoice = raw.slice(hashIdx + 1).trim() || null;
  }
  const digits = codePart.toUpperCase().split('').filter(c => CIPHER[c] !== undefined).map(c => CIPHER[c]).join('');
  if (!digits) return { rate: null, invoice, failed: codePart.length > 0 };
  return { rate: digits, invoice, failed: false };
}

// Status from background color (Eli's legend). Unknown colors → confirmed,
// counted in the report so nothing maps silently.
const BLUE_VARIANTS = new Set(['#123052', '#1b3a5a', '#234362', '#2b4d6a', '#3c607b']);
function mapStatus(bg, title, unknownColors) {
  const c = (bg || '').toLowerCase();
  if (BLUE_VARIANTS.has(c)) return 'confirmed';
  if (c === '#000000') return 'open_hours';
  if (c === '#6c572c') return 'tentative';
  if (c === '#557c93') return /tour/i.test(title) ? 'tour' : 'confirmed';
  if (c === '#698083') return 'tech';
  if (c) unknownColors[c] = (unknownColors[c] || 0) + 1;
  return 'confirmed';
}

const BLOCK_STATUSES = new Set(['tour', 'tech', 'open_hours']);

// "05:00 PM" → "5:00 PM" (the app's TimeInput format). Unparseable → null.
function normTime(t) {
  if (!t) return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  return `${parseInt(m[1], 10)}:${m[2]} ${m[3].toUpperCase()}`;
}

// Fallback: in-out strings like "2p-2a", "12p-6p", "9:30p-3a" → [from, to]
function parseInOut(s) {
  if (!s) return [null, null];
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])m?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*([ap])m?$/i);
  if (!m) return [null, null];
  const mk = (h, min, ap) => `${parseInt(h, 10)}:${min || '00'} ${ap.toUpperCase() === 'A' ? 'AM' : 'PM'}`;
  return [mk(m[1], m[2], m[3]), mk(m[4], m[5], m[6])];
}

// "1st-LZ 2nd-WS" / "2nd-JC" / "N/A" → { engineer, assistant }
function parseEngineers(s) {
  if (!s) return { engineer: null, assistant: null };
  const eng = s.match(/1st\s*-\s*([A-Za-z]{1,12})/i);
  const asst = s.match(/2nd\s*-\s*([A-Za-z]{1,12})/i);
  return { engineer: eng ? eng[1].toUpperCase() : null, assistant: asst ? asst[1].toUpperCase() : null };
}

// ---------------------------------------------------------------------------
// Build records
// ---------------------------------------------------------------------------
const xml = readFileSync(XML_PATH, 'utf-8');
const items = parseItems(xml);

const importedAt = new Date().toISOString();
const records = [];
const report = {
  totalItems: items.length,
  skippedDraft: 0, skippedTrash: 0, skippedNoDate: 0, skippedWrongYear: 0,
  unmappedStudio: [], unparsedTimes: 0, failedRates: [], unknownColors: {},
  byStatus: {}, multiDay: 0, past: 0, future: 0,
};

const today = new Date().toISOString().slice(0, 10);

for (const it of items) {
  if (it.wpStatus === 'draft') { report.skippedDraft++; continue; }
  if (it.wpStatus === 'trash') { report.skippedTrash++; continue; }

  const date = it.meta['codemine_event_cmcal_event_date'] || null;
  if (!date) { report.skippedNoDate++; continue; }
  if (!date.startsWith(YEAR)) { report.skippedWrongYear++; continue; }

  const mapped = it.studioLabel ? STUDIO_MAP[it.studioLabel] : null;
  if (!mapped) {
    report.unmappedStudio.push({ title: it.title, date, raw: it.studioLabel });
    continue;
  }

  const status = mapStatus(it.meta['background_color'], it.title, report.unknownColors);
  const isBlock = BLOCK_STATUSES.has(status);

  // Times: the front desk typed the real hours into the free-text `in-out`
  // field ("2p-2a"); the structured cmcal start/end times are mostly junk
  // (94% of 2026 sessions would be "under an hour", and the starts disagree
  // with in-out on 894 events). So in-out wins; cmcal times are the fallback.
  let [from, to] = parseInOut(it.meta['in-out']);
  if (!from) from = normTime(it.meta['codemine_event_cmcal_event_start_time']);
  if (!to) to = normTime(it.meta['codemine_event_cmcal_event_end_time']);
  if (!from && !to) report.unparsedTimes++;

  const endDate = it.meta['codemine_event_cmcal_event_end_date'] || date;
  if (endDate !== date) report.multiDay++;

  const { rate, invoice, failed } = decodeRate(it.meta['rate_code']);
  if (failed) report.failedRates.push({ title: it.title, date, raw: it.meta['rate_code'] });

  const { engineer, assistant } = parseEngineers(it.meta['engineers']);

  // Title → identity. "Label/Artist" (first slash splits) for billing
  // sessions; a plain name is a COD client. Blocks keep the whole title as
  // client_name — that's the field the block editor reads.
  let label = null, artist = null, client_name = null, payment_type = 'COD';
  if (!isBlock && it.title.includes('/')) {
    const idx = it.title.indexOf('/');
    label = it.title.slice(0, idx).trim();
    artist = it.title.slice(idx + 1).trim();
    payment_type = 'billing';
  } else {
    client_name = it.title.trim() || null;
  }

  report.byStatus[status] = (report.byStatus[status] || 0) + 1;
  if (date < today) report.past++; else report.future++;

  records.push({
    status,
    session_type: 'recording',
    payment_type,
    location: mapped.location,
    studio: mapped.studio,
    start_date: date,
    end_date: endDate,
    from_time: from,
    to_time: to,
    // The WP rate code was the flat day rate — day rate is always a flat
    // charge (standing rule), so it lands in rate_daily with rate_type 'day'.
    rate_daily: rate,
    rate_type: rate ? 'day' : null,
    invoice_num: invoice,
    client_name,
    artist,
    label,
    engineer_name: engineer,
    engineer_status: engineer ? 'confirmed' : 'not_needed',
    assistant_name: assistant,
    assistant_status: assistant ? 'confirmed' : 'not_needed',
    staff_mode: engineer ? 'engineer' : (assistant ? 'assistant' : 'none'),
    notes: it.meta['notes'] || null,
    imported_at: importedAt,
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log('=== 2026 WordPress import —', LIVE ? 'LIVE' : 'DRY RUN', '===');
console.log(`XML items: ${report.totalItems}`);
console.log(`Skipped: ${report.skippedDraft} drafts, ${report.skippedTrash} trash, ${report.skippedNoDate} no date, ${report.skippedWrongYear} not ${YEAR}`);
console.log(`Importable records: ${records.length}  (${report.past} past · ${report.future} today/future)`);
console.log('By status:', report.byStatus);
console.log(`Multi-day sessions: ${report.multiDay}`);
console.log(`Events with no parseable times: ${report.unparsedTimes}`);
if (report.unmappedStudio.length) {
  console.log(`\nUNMAPPED STUDIO — will NOT import (${report.unmappedStudio.length}):`);
  report.unmappedStudio.forEach(f => console.log(`  - "${f.title}" ${f.date} (raw: "${f.raw}")`));
}
if (report.failedRates.length) {
  console.log(`\nUndecodable rate codes — imported with blank rate (${report.failedRates.length}):`);
  report.failedRates.slice(0, 20).forEach(f => console.log(`  - "${f.title}" ${f.date} (raw: "${f.raw}")`));
  if (report.failedRates.length > 20) console.log(`  … and ${report.failedRates.length - 20} more`);
}
if (Object.keys(report.unknownColors).length) {
  console.log('\nUnknown colors mapped to confirmed:', report.unknownColors);
}

if (!LIVE) {
  writeFileSync('imports-scratch/import_preview.json', JSON.stringify(records, null, 1));
  console.log(`\nDry run only — wrote ${records.length} mapped records to imports-scratch/import_preview.json for review.`);
  console.log('Nothing was written to the database. Re-run with --live to import.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// LIVE: verify migration ran, snapshot, wipe, import
// ---------------------------------------------------------------------------
const probe = await supabase.from('bookings').select('imported_at').limit(1);
if (probe.error && /imported_at/.test(probe.error.message)) {
  console.error('\nABORT: bookings.imported_at does not exist. Run migration 20260826150000_bookings_imported_at.sql in the Supabase SQL editor first.');
  process.exit(1);
}

// Children first, parents last. myday_queue_steps cascades from bookings but
// is snapshotted anyway. wo_expenses cascades from work_orders — same.
const TABLES = [
  'studio_time_rows', 'rental_rows', 'payment_rows', 'equipment_condition_rows',
  'wo_expenses', 'myday_queue_steps', 'work_orders', 'bookings',
];

console.log('\nSnapshotting current data…');
const snapshot = {};
for (const t of TABLES) {
  const rows = [];
  for (let fromIdx = 0; ; fromIdx += 1000) {
    const { data, error } = await supabase.from(t).select('*').range(fromIdx, fromIdx + 999);
    if (error) {
      if (/does not exist/i.test(error.message)) { console.log(`  ${t}: table missing, skipped`); break; }
      console.error(`ABORT: snapshot of ${t} failed: ${error.message}`);
      process.exit(1);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  snapshot[t] = rows;
  console.log(`  ${t}: ${rows.length} rows`);
}
const snapFile = `imports-scratch/snapshot_${importedAt.replace(/[:.]/g, '-')}.json`;
writeFileSync(snapFile, JSON.stringify(snapshot, null, 1));
console.log(`Snapshot saved: ${snapFile}`);

console.log('\nDeleting existing data (test data, approved 2026-08-26)…');
for (const t of TABLES) {
  if (!(t in snapshot)) continue;
  const { error } = await supabase.from(t).delete().not('id', 'is', null);
  if (error) {
    console.error(`ABORT: delete from ${t} failed: ${error.message}`);
    console.error('Nothing has been imported. Restore from the snapshot if any deletes went through.');
    process.exit(1);
  }
  console.log(`  ${t}: cleared`);
}

console.log(`\nInserting ${records.length} imported bookings…`);
let inserted = 0;
for (let i = 0; i < records.length; i += 100) {
  const batch = records.slice(i, i + 100);
  const { error } = await supabase.from('bookings').insert(batch);
  if (error) {
    console.error(`Batch ${i}–${i + batch.length - 1} FAILED: ${error.message}`);
    console.error(`Imported so far: ${inserted}. Snapshot: ${snapFile}`);
    process.exit(1);
  }
  inserted += batch.length;
}
console.log(`Done. Imported ${inserted} bookings, stamped imported_at=${importedAt}.`);
console.log('Past sessions are read-only history; today/future sessions promote on first open+save.');
