// Deals FRESH, UNIQUE 4-digit PINs to every active person (staff + runners)
// and prints the handout table. Re-running rotates every PIN.
//
// WHY EVERYONE AT ONCE (2026-08-20): verify_staff_pin matches the typed PIN
// against ALL rows and returns the first hit — two people with the same PIN
// would silently log in as each other. Uniqueness can only be guaranteed
// inside one run (hashes can't be compared afterwards), and since PIN login
// has been switched off, nobody has a PIN habit to break.
//
// For every active user_profiles row it will:
//   1. Ensure the Supabase Auth account exists (adopt by email or create),
//      writing auth_user_id back onto the profile — same adopt-first logic as
//      set-staff-passwords.mjs / create-runners.mjs.
//   2. Set a fresh random 32-char password on the auth account and store it in
//      staff_pins.supabase_password (what /api/auth/pin signs in with — never
//      shown to anyone; the PIN is the only thing people type).
//   3. Upsert staff_pins with a bcrypt(cost 8) hash of a unique random SIX-digit
//      PIN — cost 8 per the July 8 perf ruling. Six digits (Eli, 2026-08-20):
//      1,000,000 combinations vs 10,000 — the escalating-lockout route plus a
//      1-in-~55,000 hit rate makes online guessing a non-starter. MUST match
//      PIN_LENGTH in app/(auth)/login/page.tsx.
//
// PINs avoid the guessable set (repeats, straights, and common patterns).
//
// Usage (Node 20.6+; bcryptjs must be installed — npm i -D bcryptjs):
//   node --env-file=.env.local scripts/set-pins.mjs
//
// AFTER RUNNING: hand PINs out in person. Nothing is emailed. Re-run any time
// someone's PIN leaks — but that rotates EVERYONE, so re-print the table.

import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run with --env-file=.env.local)')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Six-digit banned set: all-one-digit repeats, straights, and the patterns
// people actually pick.
const BANNED = new Set([
  '000000','111111','222222','333333','444444','555555','666666','777777','888888','999999',
  '123456','654321','012345','543210','123123','456456','789789','121212','696969','112233',
  '111222','101010','159753','357951','258025','098765',
])

function generatePassword() {
  return randomBytes(24).toString('base64url')
}

async function findAuthUserByEmail(email) {
  const target = email.trim().toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) { console.error(`listUsers failed: ${error.message}`); process.exit(1) }
    const users = data?.users ?? []
    const hit = users.find(u => (u.email ?? '').trim().toLowerCase() === target)
    if (hit) return hit
    if (users.length < 200) return null
  }
  return null
}

const { data: profiles, error: pErr } = await supabase
  .from('user_profiles')
  .select('id, email, display_name, role, auth_user_id')
  .is('deleted_at', null)
  .order('role')
if (pErr) { console.error(pErr.message); process.exit(1) }
if (!profiles?.length) { console.error('No active profiles found.'); process.exit(1) }

// Deal unique PINs up front so uniqueness is guaranteed within the run.
const dealt = new Set()
function dealPin() {
  for (;;) {
    const pin = String(randomInt(0, 1000000)).padStart(6, '0')
    if (BANNED.has(pin) || dealt.has(pin)) continue
    dealt.add(pin)
    return pin
  }
}

const rows = []
for (const p of profiles) {
  if (!p.email) { console.log(`— ${p.display_name}: no email on profile, skipped`); continue }

  // 1 · ensure the auth account
  let authId = p.auth_user_id
  if (!authId) {
    const existing = await findAuthUserByEmail(p.email)
    if (existing) authId = existing.id
    else {
      const { data: created, error } = await supabase.auth.admin.createUser({
        email: p.email, email_confirm: true, password: generatePassword(),
      })
      if (error) { console.error(`create auth for ${p.email}: ${error.message}`); continue }
      authId = created.user.id
    }
    const { error: linkErr } = await supabase.from('user_profiles')
      .update({ auth_user_id: authId }).eq('id', p.id)
    if (linkErr) { console.error(`link ${p.email}: ${linkErr.message}`); continue }
  }

  // 2 · fresh password on the account + stored for the PIN route
  const password = generatePassword()
  const { error: pwErr } = await supabase.auth.admin.updateUserById(authId, { password })
  if (pwErr) { console.error(`password for ${p.email}: ${pwErr.message}`); continue }

  // 3 · the PIN
  const pin = dealPin()
  // $2a$, NOT bcryptjs's default $2b$ (launch-night bug, 2026-08-20):
  // pgcrypto's crypt() silently no-matches $2b$ hashes — every PIN read as
  // "incorrect". For all-ASCII input (digits) the two formats are
  // byte-identical, so forcing the $2a$ prefix on the salt is a pure
  // compatibility rename. The live rows were fixed the same way in SQL.
  const salt = bcrypt.genSaltSync(8).replace('$2b$', '$2a$')
  const pin_hash = bcrypt.hashSync(pin, salt)
  const { error: upErr } = await supabase.from('staff_pins').upsert({
    user_profile_id: p.id, pin_hash, supabase_password: password,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_profile_id' })
  if (upErr) { console.error(`staff_pins for ${p.email}: ${upErr.message}`); continue }

  rows.push({ name: p.display_name ?? p.email, role: p.role, pin })
}

console.log('\n─── PIN HANDOUT — print, hand out in person, then destroy ───')
console.log('Name'.padEnd(24) + 'Role'.padEnd(14) + 'PIN')
for (const r of rows) console.log(String(r.name).padEnd(24) + String(r.role).padEnd(14) + r.pin)
console.log(`\n${rows.length} PINs set. Everyone's old passwords were rotated — the PIN pad is now the way in.`)
