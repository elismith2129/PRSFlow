// Sets a KNOWN password on one staff member's Supabase Auth account, without
// sending any email.
//
// WHY THIS EXISTS
// Supabase's built-in email sender is a testing convenience with a hard cap of
// a couple of messages an hour. On the night of 29 July 2026, with PIN login
// being torn down after a brute-force attempt, that cap was reached while a
// manager was sitting at the desk with no way into the app: his PIN was about
// to be revoked, his Supabase password was one of the random 32-character
// strings scripts/set-staff-passwords.mjs generates (which nobody knows), and
// the reset email wouldn't send.
//
// This is the manual override for that situation. It is NOT the normal way to
// onboard someone — the normal way is a password-reset email, which requires
// custom SMTP so it isn't rate limited (see the note at the bottom).
//
// HOW TO USE IT
//   node --env-file=.env.local scripts/set-one-password.mjs someone@example.com 'TempPassphrase'
//
// Then say the password to them out loud — do NOT send it in the same channel
// they'd receive a reset link in, and do not paste it into chat. They sign in
// with email + password and change it themselves at /reset-password, which is
// authenticated, so the temporary one stops mattering as soon as they do.
//
// DELIBERATELY DOES NOT touch staff_pins.supabase_password. That column exists
// so /api/auth/pin can mint a session from a PIN, and it holds a random secret
// the user never sees. Writing a human-chosen password there would mean a
// password the user knows is also the thing standing behind their PIN, and
// would be silently overwritten the next time set-staff-passwords.mjs runs.
// This script changes the Auth account only.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env.local scripts/set-one-password.mjs <email> <password>');
  process.exit(1);
}

const [emailArg, passwordArg] = process.argv.slice(2);

if (!emailArg || !passwordArg) {
  console.error('Usage: node --env-file=.env.local scripts/set-one-password.mjs <email> <password>');
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();

// macOS substitutes typed quotes with typographic ones (' ' " "), and bash does
// NOT treat those as quoting characters — it passes them through as literal
// text. So `set-one-password.mjs someone@x.com 'hunter2'` silently sets the
// password to 'hunter2' WITH the quote marks in it, and the person is then told
// a password that cannot work. That happened on the first real use of this
// script, at midnight, with someone locked out and waiting.
//
// Refuse rather than strip: a password nobody can retype is not worth guessing
// the intent of, and a silent fix would hide the same mistake next time.
const SMART_QUOTES = /[‘’“”]/;
if (SMART_QUOTES.test(passwordArg)) {
  console.error('That password contains curly quotes (‘ ’ “ ”), which your shell passed through as');
  console.error('literal characters rather than treating as quotes. The password would have been');
  console.error('set to something nobody could retype.');
  console.error('');
  console.error('Retype it using straight quotes, or drop the quotes entirely if there are no spaces:');
  console.error('  node --env-file=.env.local scripts/set-one-password.mjs someone@example.com threerandomwords');
  process.exit(1);
}

// Supabase's own minimum is 6; 12 is the floor for something spoken aloud and
// typed on a phone, where people reach for short and obvious.
if (passwordArg.length < 12) {
  console.error(`Password is ${passwordArg.length} characters — use at least 12.`);
  console.error('Three unrelated words is easier to say over the phone than a short scramble.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// supabase-js v2's admin API has no getUserByEmail, so page through listUsers.
// The staff list is tiny. Case-insensitive because Auth lowercases emails on
// create and a user_profiles row may not have.
async function findAuthUserByEmail(target) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

const authUser = await findAuthUserByEmail(email);

if (!authUser) {
  console.error(`No Supabase Auth account found for ${email}.`);
  console.error('Check the address on their user_profiles row — it is the lookup key.');
  process.exit(1);
}

const { error: updateError } = await supabase.auth.admin.updateUserById(authUser.id, {
  password: passwordArg,
});

if (updateError) {
  console.error(`Could not set the password: ${updateError.message}`);
  process.exit(1);
}

// Confirm which human this actually was — a typo'd address that happens to
// match another account would otherwise change the wrong person's password.
const { data: profile } = await supabase
  .from('user_profiles')
  .select('display_name, role')
  .eq('auth_user_id', authUser.id)
  .maybeSingle();

console.log('');
console.log(`  Password set for ${profile?.display_name ?? '(no profile row)'} <${email}>`);
console.log(`  Role: ${profile?.role ?? 'unknown'}`);
console.log('');
console.log('  Tell them the password verbally, not in writing.');
console.log('  They sign in with email + password, then change it at /reset-password.');
console.log('');

// TOMORROW, NOT TONIGHT: point Supabase Auth at real SMTP so reset emails stop
// being rate limited — Resend is already set up for the CRM campaign feature
// (RESEND_API_KEY, sending as studio@paramountrecording.com). Supabase →
// Project Settings → Auth → SMTP. Without it, inviting the whole team means
// hitting this cap again at the third person.
