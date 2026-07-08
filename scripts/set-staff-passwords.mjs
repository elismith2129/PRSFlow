// Run once (and re-run any time to rotate). Sets a fresh random Supabase Auth
// password on every staff member that has a PIN + an auth account, and stores
// that same password on staff_pins.supabase_password so the PIN login route
// can sign in with it via signInWithPassword(). The password is 24 random bytes
// as base64url (32 chars) — NOT derived from the PIN.
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
    const authUserId = profile?.auth_user_id;

    // No auth account yet (e.g. the shared runner) — nothing to sign in as.
    if (!authUserId) {
      console.log(`SKIP  ${email ?? row.user_profile_id} — no auth_user_id`);
      skipped++;
      continue;
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
