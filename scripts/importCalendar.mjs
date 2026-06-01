// Run once only. Delete after import is confirmed.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/importCalendar.mjs
// Or with a .env.local loader:
//   node --env-file=.env.local scripts/importCalendar.mjs   (Node 20.6+)

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Minimal XML parser (no dependencies — parses RSS/codemine feed structure)
// ---------------------------------------------------------------------------
function getTagText(xml, tag) {
  // Returns first text content of <tag> or <ns:tag>, strips CDATA wrappers
  const re = new RegExp(`<(?:[^:>]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() || null;
}

function getTagAttr(xml, tag, attr) {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}\\s([^>]*)>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  const attrRe = new RegExp(`${attr}="([^"]*)"`, 'i');
  const am = m[1].match(attrRe);
  return am ? am[1] : null;
}

function getAllTagTexts(xml, tag) {
  const results = [];
  const re = new RegExp(`<(?:[^:>]+:)?${tag}(\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] ?? '';
    const text = m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    results.push({ attrs, text });
  }
  return results;
}

function splitItems(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    items.push(m[1]);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Rate code decoder  (cipher: WALKTHEDOG = 1234567890)
// ---------------------------------------------------------------------------
const CIPHER = { W: '1', A: '2', L: '3', K: '4', T: '5', H: '6', E: '7', D: '8', O: '9', G: '0' };

function decodeRateCode(raw) {
  if (!raw) return { rate_code: null, rate_amount: null, invoice_number: null };

  let rateCodeRaw = raw;
  let invoice_number = null;

  const hashIdx = raw.indexOf(' #');
  if (hashIdx !== -1) {
    rateCodeRaw = raw.slice(0, hashIdx).trim();
    invoice_number = raw.slice(hashIdx + 2).trim() || null;
  }

  const digits = rateCodeRaw
    .toUpperCase()
    .split('')
    .filter(ch => CIPHER[ch] !== undefined)
    .map(ch => CIPHER[ch])
    .join('');

  const num = digits.length ? parseFloat(digits) : NaN;
  return {
    rate_code: rateCodeRaw || null,
    rate_amount: isNaN(num) ? null : num,
    invoice_number,
  };
}

// ---------------------------------------------------------------------------
// Studio name → DB name mapping
// ---------------------------------------------------------------------------
const STUDIO_NAME_MAP = {
  'Paramount Studio A': 'Studio A (Paramount)',
  'Paramount Studio B': 'Studio B (Paramount)',
  'Paramount Studio C': 'Studio C (Paramount)',
  'Paramount Studio X': 'Studio X (Paramount)',
  'Paramount Studio E': 'Studio E (Paramount)',
  'Ameraycan A':        'Studio A (Ameraycan)',
  'Ameraycan B':        'Studio B (Ameraycan)',
  'Encore A':           'Studio A (Encore)',
  'Encore B':           'Studio B (Encore)',
  'Track South':        'South (Track)',
  'Track North':        'North (Track)',
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // 1. Download XML from Supabase Storage using service role key
  console.log('Downloading paramount_import_2024.xml from Storage…');
  const { data: fileData, error: storageErr } = await supabase.storage
    .from('imports')
    .download('paramount_import_2024.xml');

  if (storageErr || !fileData) {
    console.error('Failed to download file:', storageErr?.message ?? 'No data returned');
    process.exit(1);
  }

  const xmlText = await fileData.text();
  console.log(`Downloaded ${(xmlText.length / 1024).toFixed(1)} KB`);

  // 2. Split into <item> blocks
  const rawItems = splitItems(xmlText);
  if (!rawItems.length) {
    console.error('No <item> elements found in XML.');
    process.exit(1);
  }
  console.log(`Found ${rawItems.length} events in XML`);

  // 3. Fetch studios for id lookup
  const { data: studiosData, error: studiosErr } = await supabase
    .from('studios')
    .select('id, name');

  if (studiosErr) {
    console.error('Failed to fetch studios:', studiosErr.message);
    process.exit(1);
  }

  const studioByName = Object.fromEntries((studiosData ?? []).map(s => [s.name, s.id]));

  // 4. Transform events
  const records = [];
  const failedStudio = [];
  const failedRate = [];

  for (const item of rawItems) {
    const title     = getTagText(item, 'title');
    const startDate = getTagText(item, 'codemine_event_cmcal_event_date');
    const startTime = getTagText(item, 'codemine_event_cmcal_event_start_time');
    const endDate   = getTagText(item, 'codemine_event_cmcal_event_end_date');
    const endTime   = getTagText(item, 'codemine_event_cmcal_event_end_time');
    const engineer  = getTagText(item, 'engineers');
    const sessionHrs = getTagText(item, 'in-out');
    const rateRaw   = getTagText(item, 'rate_code');
    const notes     = getTagText(item, 'notes');

    // Find category with domain="cmcal-event-studio"
    let studioLabel = null;
    const categories = getAllTagTexts(item, 'category');
    for (const { attrs, text } of categories) {
      if (attrs.includes('cmcal-event-studio')) {
        studioLabel = text;
        break;
      }
    }

    const mappedName = studioLabel ? (STUDIO_NAME_MAP[studioLabel] ?? null) : null;
    const studioId   = mappedName ? (studioByName[mappedName] ?? null) : null;

    if (!studioId) {
      failedStudio.push({ title, date: startDate, studioLabel });
    }

    const { rate_code, rate_amount, invoice_number } = decodeRateCode(rateRaw);

    if (rateRaw && rate_amount === null) {
      failedRate.push({ title, rate_code: rateRaw });
    }

    records.push({
      client_name:    title ?? null,
      start_date:     startDate ?? null,
      from_time:      startTime ?? null,
      end_date:       endDate ?? null,
      to_time:        endTime ?? null,
      studio_id:      studioId,
      engineer:       engineer ?? null,
      session_hours:  sessionHrs ?? null,
      rate_code:      rate_code ?? null,
      rate_amount:    rate_amount,
      invoice_number: invoice_number ?? null,
      session_notes:  notes ?? null,
      booking_status: 'confirmed',
    });
  }

  // 5. Upsert in batches of 100
  const BATCH = 100;
  let imported = 0;
  const errors = [];

  console.log(`Upserting ${records.length} records in batches of ${BATCH}…`);

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const { error: upsertErr } = await supabase
      .from('bookings')
      .upsert(batch, { onConflict: 'id' });

    if (upsertErr) {
      errors.push({ batchStart: i, message: upsertErr.message });
      console.error(`  Batch ${i}–${i + batch.length - 1} FAILED: ${upsertErr.message}`);
    } else {
      imported += batch.length;
      console.log(`  Batch ${i}–${i + batch.length - 1} OK`);
    }
  }

  // 6. Summary
  console.log('\n=== Import Summary ===');
  console.log(`Total events processed : ${records.length}`);
  console.log(`Successfully imported  : ${imported}`);

  if (failedStudio.length) {
    console.log(`\nNo studio match (${failedStudio.length}):`);
    for (const f of failedStudio) {
      console.log(`  - "${f.title}" on ${f.date}  (raw: "${f.studioLabel}")`);
    }
  }

  if (failedRate.length) {
    console.log(`\nRate code decode failed (${failedRate.length}):`);
    for (const f of failedRate) {
      console.log(`  - "${f.title}"  (raw rate_code: "${f.rate_code}")`);
    }
  }

  if (errors.length) {
    console.log(`\nDB errors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  - Batch at ${e.batchStart}: ${e.message}`);
    }
  }

  if (!failedStudio.length && !failedRate.length && !errors.length) {
    console.log('All records imported cleanly.');
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
