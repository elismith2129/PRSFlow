// ─────────────────────────────────────────────────────────────────────────────
// PRSFlo self-test — "make sure nothing's broken, security issues etc."
// (Eli, 2026-08-17). Run by Claude before every hand-off line, and by anyone
// any time:
//
//   node scripts/selftest.mjs           # tsc + static rule checks (~1 min)
//   node scripts/selftest.mjs --build   # + full production build (slower)
//
// Exit 0 = no failures (warnings allowed). Exit 1 = at least one FAIL.
//
// FAILURES are high-confidence broken/dangerous states:
//   · TypeScript errors (tsc --noEmit)
//   · SUPABASE_SERVICE_ROLE_KEY referenced in a file marked 'use client'
//     (the key would ship to every browser). Server components/API routes
//     may use it — that's what they're for.
//   · A .env* file tracked by git (secrets in history).
//   · public/sop.html VERSIONS array no longer parses (breaks the staff
//     release-notes page silently).
//   · --build: next build fails.
//
// WARNINGS are the project's codified landmines, reported as counts so a
// session can spot a DELTA (new debt) without the script crying wolf over
// known legacy:
//   · .maybeSingle() — banned since Aug 10 (returned null over 299 duplicate
//     WOs instead of erroring); legacy uses exist. New ones are the problem.
//   · bookings.engineer_rate reads — dead column (see CHANGELOG v1.9.1).
//   · Hardcoded lime #c8f04e — the accent is retired (spec §4).
//   · dangerouslySetInnerHTML — two known legit uses (theme pre-paint,
//     login); a third deserves eyes.
//   · Files that WRITE via supabase (.insert/.update/.delete/.upsert) but
//     never import dbResult — the #1 audited defect class (silent writes).
//     Heuristic: API routes are excluded (server-side error handling).
//
// Deliberately NOT here: DB end-state checks (pg_policies, column existence)
// — those need the SQL editor and stay Eli's, per the verify-the-end-state
// rule. This script covers what a sandbox can honestly verify.
// ─────────────────────────────────────────────────────────────────────────────

import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const doBuild = args.includes('--build')

const fails = []
const warns = []
const oks = []

// ── Collect source files (app/, components/, lib/, hooks/) ──────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}
const files = ['app', 'components', 'lib', 'hooks'].flatMap(d => {
  try { return walk(d) } catch { return [] }
})
const sources = files.map(f => ({ path: f, text: readFileSync(f, 'utf8') }))

// ── 1 · TypeScript ───────────────────────────────────────────────────────────
process.stdout.write('tsc --noEmit … ')
const tsc = spawnSync('npx', ['tsc', '--noEmit'], { encoding: 'utf8', timeout: 240000 })
if (tsc.status === 0) { console.log('clean'); oks.push('TypeScript compiles clean') }
else {
  console.log('ERRORS')
  fails.push(`tsc reported errors:\n${(tsc.stdout || tsc.stderr || '').split('\n').slice(0, 12).join('\n')}`)
}

// ── 2 · Service-role key must never be in client code ────────────────────────
// The directive is a line of its own at the top — matching the substring
// anywhere also matched comments SAYING "no 'use client'" (false positives
// on day one, including the deliberately-server register view).
const isClientFile = t => /^\s*['"]use client['"];?\s*$/m.test(t)
const keyLeaks = sources.filter(s =>
  s.text.includes('SUPABASE_SERVICE_ROLE_KEY') && isClientFile(s.text),
)
if (keyLeaks.length) fails.push(`SERVICE ROLE KEY IN CLIENT CODE (ships to browsers!): ${keyLeaks.map(s => s.path).join(', ')}`)
else oks.push('Service-role key only in server files')

// ── 3 · No env files tracked by git ─────────────────────────────────────────
try {
  const tracked = execSync('git --no-optional-locks ls-files ".env*"', { encoding: 'utf8' }).trim()
  const bad = tracked.split('\n').filter(f => f && !f.endsWith('.example'))
  if (bad.length) fails.push(`env file(s) TRACKED BY GIT: ${bad.join(', ')}`)
  else oks.push('No secrets files tracked by git')
} catch { warns.push('Could not check git-tracked env files') }

// ── 4 · SOP VERSIONS must parse ──────────────────────────────────────────────
try {
  const sop = readFileSync('public/sop.html', 'utf8')
  const m = sop.match(/const VERSIONS=\[([\s\S]*?)\n\];/)
  if (!m) throw new Error('VERSIONS array not found')
  const arr = (0, eval)('[' + m[1] + ']')
  if (!Array.isArray(arr) || arr.length === 0 || !arr[0].ver) throw new Error('parsed but malformed')
  oks.push(`SOP VERSIONS parses (${arr.length} entries, newest ${arr[0].ver})`)
} catch (e) {
  fails.push(`public/sop.html VERSIONS does not parse: ${e.message}`)
}

// ── 5 · Landmine counters (warn on presence; watch the DELTA) ───────────────
function countAcross(re, exclude = () => false) {
  let n = 0
  const where = new Set()
  for (const s of sources) {
    if (exclude(s.path)) continue
    const hits = (s.text.match(re) || []).length
    if (hits) { n += hits; where.add(s.path) }
  }
  return { n, where: [...where] }
}

const maybeSingle = countAcross(/\.maybeSingle\(/g)
if (maybeSingle.n) warns.push(`.maybeSingle() ×${maybeSingle.n} in ${maybeSingle.where.length} files (banned for NEW code — Aug 10 rule; baseline was 25 on 2026-08-17)`)

const engRate = countAcross(/\bbooking\??\.engineer_rate|\bb\??\.engineer_rate/g)
if (engRate.n) warns.push(`bookings.engineer_rate reads ×${engRate.n} (dead column — legacy create path only; baseline 2 on 2026-08-17): ${engRate.where.join(', ')}`)

const lime = countAcross(/#c8f04e/gi, p => p.includes('global-error'))
if (lime.n) warns.push(`hardcoded #c8f04e ×${lime.n} (retired accent) in: ${lime.where.join(', ')}`)
else oks.push('No retired-accent literals outside the error fallback')

const dsi = countAcross(/dangerouslySetInnerHTML/g)
if (dsi.n > 2) warns.push(`dangerouslySetInnerHTML ×${dsi.n} (baseline 2: theme pre-paint + login) — review the new one(s): ${dsi.where.join(', ')}`)
else oks.push('dangerouslySetInnerHTML at known baseline')

const silentWriters = sources.filter(s =>
  !s.path.startsWith(join('app', 'api')) &&
  /\.(insert|update|delete|upsert)\(/.test(s.text) &&
  s.text.includes('supabase') &&
  !s.text.includes('dbResult'),
).map(s => s.path)
if (silentWriters.length) warns.push(`files with supabase WRITES but no dbResult import ×${silentWriters.length} (silent-write risk; baseline 2026-08-17 ≈ legacy pages): ${silentWriters.slice(0, 8).join(', ')}${silentWriters.length > 8 ? ' …' : ''}`)

// ── 6 · Optional production build ────────────────────────────────────────────
if (doBuild) {
  process.stdout.write('next build … ')
  const build = spawnSync('npx', ['next', 'build'], { encoding: 'utf8', timeout: 480000 })
  if (build.status === 0) { console.log('ok'); oks.push('Production build succeeds') }
  else {
    console.log('FAILED')
    fails.push(`next build failed:\n${(build.stdout || build.stderr || '').split('\n').slice(-15).join('\n')}`)
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log('\n══ SELF-TEST ═══════════════════════════════════')
for (const o of oks) console.log('  ✓', o)
for (const w of warns) console.log('  ⚠', w)
for (const f of fails) console.log('  ✗', f)
console.log(`\n${fails.length === 0 ? 'PASS' : 'FAIL'} — ${oks.length} ok · ${warns.length} warnings · ${fails.length} failures`)
process.exit(fails.length === 0 ? 0 : 1)
