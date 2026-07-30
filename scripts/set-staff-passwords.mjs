// Provisions PIN login for staff. Safe to re-run any time (also the way to
// rotate passwords).
//
// For every staff_pins row it will:
//   1. CREATE the Supabase Auth account if the linked profile has none, and
//      write auth_user_id back onto user_profiles. An orphan auth user with the
//      same email (created by hand, never linked) is adopted rather than
//      duplicated — creating a second one would fail on the unique email anyway.
//   2. Set a fresh random password on that auth account.
//   3. Store the same password on staff_pins.supabase_password, which is what
//      /api/auth/pin signs in with via signInWithPassword().
//
// The password is 24 random bytes as base64url (32 chars) — NOT derived from the
// PIN, and never shown to the user. The PIN is the only thing staff type.
//
// Step 1 used to be missing: the script SKIPPED any profile without an
// auth_user_id, which is precisely the state the shared runner account was left
// in — so the runner PIN could never work, and re-running this never fixed it.
//
// Run AFTER applying 20260708120000_staff_pins_supabase_password.sql.
//
// Usage:
//   node --env-file=.env.local scripts/set-staff-passwords.mjs   (Node 20.6+)
// Or:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/set-staff-passwords.mjs

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 32-char URL-safe secret from 24 random bytes.
function generatePassword() {
  return randomBytes(24).toString('base64url');
}

// Find an auth user by email. supabase-js v2's admin API has no getUserByEmail,
// so page through listUsers — the staff list is tiny, and this only runs when a
// profile is unlinked. Matching is case-insensitive because Auth lowercases
// emails on create and a profile row may not have.
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
    if (users.length < 200) return null; // last page
  }
  return null;
}

async function main() {
  // Every PIN row with its linked profile (id + email + auth account).
  const { data: rows, error } = await supabase
    .from('staff_pins')
    .select('id, user_profile_id, user_profiles!inner(id, email, auth_user_id)');
  if (error) {
    console.error('Failed to read staff_pins:', error.message);
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const profile = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
    const email = profile?.email;
    let authUserId = profile?.auth_user_id;

    // A profile with no email can't have an auth account — genuinely skippable.
    if (!email) {
      console.log(`SKIP  ${row.user_profile_id} — profile has no email`);
      skipped++;
      continue;
    }

    // ── 1) Ensure an auth account exists and is linked. ──
    if (!authUserId) {
      const existing = await findAuthUserByEmail(email);
      if (existing) {
        authUserId = existing.id;
        console.log(`LINK  ${email} — adopted existing auth user`);
      } else {
        const { data: created, error: createErr } = await supabase.auth.admin.createUser({
          email,
          password: generatePassword(),
          email_confirm: true, // no inbox for a shared account; skip verification
        });
        if (createErr || !created?.user) {
          console.error(`FAIL  ${email} — createUser: ${createErr?.message ?? 'no user returned'}`);
          process.exit(1);
        }
        authUserId = created.user.id;
        console.log(`NEW   ${email} — auth user created`);
      }

      const { error: linkErr } = await supabase
        .from('user_profiles')
        .update({ auth_user_id: authUserId })
        .eq('id', profile.id);
      if (linkErr) {
        console.error(`FAIL  ${email} — link auth_user_id: ${linkErr.message}`);
        process.exit(1);
      }
    }

    const password = generatePassword();

    // 1) Set the password on the Supabase Auth account.
    const { error: authErr } = await supabase.auth.admin.updateUserById(authUserId, { password });
    if (authErr) {
      console.error(`FAIL  ${email} — updateUserById: ${authErr.message}`);
      process.exit(1);
    }

    // 2) Store it on staff_pins so the PIN route can sign in with it.
    const { error: upErr } = await supabase
      .from('staff_pins')
      .update({ supabase_password: password, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (upErr) {
      console.error(`FAIL  ${email} — staff_pins update: ${upErr.message}`);
      process.exit(1);
    }

    console.log(`OK    ${email}`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
}

main();
