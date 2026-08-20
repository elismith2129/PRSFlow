// Creates the individual runner accounts (retiring the shared runner login).
// Safe to re-run any time — re-running ROTATES passwords for everyone listed.
//
// For each runner below it will:
//   1. CREATE the Supabase Auth account (email confirmed, no email sent), or
//      ADOPT an existing auth user with the same email rather than duplicating.
//   2. Set a fresh runner-friendly password (Word-Word-## — they type these on
//      phones; a 32-char blob would guarantee lockouts and screenshots).
//   3. Upsert the user_profiles row (email is the conflict key): display_name,
//      initials, role 'runner', auth_user_id.
//   4. Print ONE credentials table at the end. NOTHING IS EMAILED — Eli hands
//      credentials out himself (ruling 2026-08-17: create, don't send).
//
// PIN login is currently disabled; runners sign in with email + password at
// the normal login page. (staff_pins is deliberately untouched here.)
//
// Phones are NOT stored — user_profiles has no phone column; the numbers stay
// in the office roster.
//
// Usage:
//   node --env-file=.env.local scripts/create-runners.mjs        (Node 20.6+)
// Or:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-runners.mjs

import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';

// ── The roster (Eli, 2026-08-17). Names/initials/emails exactly as given. ────
const RUNNERS = [
  { name: 'Logan Boyd',       initials: 'LB', email: 'loganboyd355@gmail.com' },
  { name: 'Tristan Telischuk', initials: 'TT', email: 'tristan.telischuk@gmail.com' },
  { name: 'Jesus Guzman',     initials: 'JG', email: 'jguzma126@gmail.com' },
  { name: 'Sam Jauregui',     initials: 'SJ', email: 'sjauregui11301@gmail.com' },
  { name: 'Kovan Eskerie',    initials: 'KE', email: 'kovaneskerie@gmail.com' },
  { name: 'Elie Elrichani',   initials: 'EE', email: 'elie.wav04@gmail.com' },
  { name: 'Terren Lee',       initials: 'TL', email: 'cras.tgallegos@gmail.com' },
  { name: 'Lori Beth',        initials: 'LS', email: 'loribeth417@gmail.com' },
  { name: 'Hunter Tedeschi',  initials: 'HT', email: 'huntertedeschi12@gmail.com' },
  { name: 'Ezra Miller',      initials: 'EZ', email: 'cras.emiller1@gmail.com' },
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Readable password: Word-Word-## (e.g. "Vocal-Tape-47"). ~30 bits over this
// list — fine for a studio app with no public signup and owner-held resets.
const WORDS = [
  'Vocal', 'Tape', 'Drum', 'Fader', 'Mixer', 'Track', 'Chord', 'Tempo',
  'Verse', 'Bridge', 'Punch', 'Layer', 'Stereo', 'Mono', 'Reverb', 'Delay',
  'Snare', 'Kick', 'Bass', 'Treble', 'Studio', 'Booth', 'Take', 'Master',
];
function generatePassword() {
  const a = WORDS[randomInt(WORDS.length)];
  let b = WORDS[randomInt(WORDS.length)];
  while (b === a) b = WORDS[randomInt(WORDS.length)];
  return `${a}-${b}-${String(randomInt(10, 100))}`;
}

// supabase-js v2 admin API has no getUserByEmail — page through listUsers.
async function findAuthUserByEmail(email) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error(`Failed to list auth users: ${error.message}`);
      process.exit(1);
    }
    const users = data?.users ?? [];
    const hit = users.find(u => (u.email ?? '').trim().toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

const results = [];

for (const r of RUNNERS) {
  const email = r.email.trim().toLowerCase();
  const password = generatePassword();

  // 1+2 · auth account: adopt-or-create, then set the fresh password.
  let authUser = await findAuthUserByEmail(email);
  if (authUser) {
    const { error } = await supabase.auth.admin.updateUserById(authUser.id, { password });
    if (error) { console.error(`${r.name}: password update failed — ${error.message}`); continue; }
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no confirmation email — nothing is sent
    });
    if (error) { console.error(`${r.name}: auth create failed — ${error.message}`); continue; }
    authUser = data.user;
  }

  // 3 · profile row, keyed on email (unique). Role 'runner' exists in the live
  // DB's role set (added July 2, 2026) even though the original migration file
  // predates it.
  const { error: profErr } = await supabase.from('user_profiles').upsert(
    {
      email,
      display_name: r.name,
      initials: r.initials,
      role: 'runner',
      auth_user_id: authUser.id,
    },
    { onConflict: 'email' },
  );
  if (profErr) { console.error(`${r.name}: profile upsert failed — ${profErr.message}`); continue; }

  results.push({ Name: r.name, Initials: r.initials, Email: email, Password: password });
}

console.log('\nDone. Hand these out yourself — nothing was emailed.\n');
console.table(results);
console.log('\nRe-running this script rotates every password above.');
