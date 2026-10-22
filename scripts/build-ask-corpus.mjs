#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Builds the corpus Ask Flo answers from (docs/ASK-FLO-BRIEF.md, 2026-10-22).
//
//   node scripts/build-ask-corpus.mjs      → lib/server/askCorpus.generated.ts
//
// FROM THE SAME SOURCES THE GUIDES ARE BUILT FROM, so the bubble can never say
// something the guide doesn't:
//   · docs/sop-build/content.py          Billing SOP (walks + panes)   → /sop/billing#<chapter>
//   · docs/sop-build/content_runner.py   Runner guide                  → /runner/sop#<chapter>
//   · public/sop.html                    STATUS_DATA + the step arrays → /sop
//   · public/sop.html → VERSIONS         staff-facing release notes    → /sop (Version History)
//                                        (the `dev` arrays are STRIPPED — developer voice)
//
// NOT in: CLAUDE.md, CHANGELOG, PROJECT_LOG, the design spec. Developer docs,
// full of superseded rulings; feeding them in is how it would start telling
// Lori about RLS policies.
//
// The Python modules are read by python3 (the guide build already needs it);
// the sop.html arrays are evaluated in a Node vm. The generated file is
// COMMITTED — Vercel has no python3 and a cold deploy must still answer.
// Run this after editing any of the four sources; selftest warns when the
// generated file is older than its sources.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'lib/server/askCorpus.generated.ts')

// ── helpers ──────────────────────────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', middot: '·', rarr: '→', larr: '←', check: '✓', times: '×' }
function text(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(+e.slice(1)) : (ENT[e.toLowerCase()] ?? m))
    .replace(/\s+/g, ' ').trim()
}

// ── 1 + 2: the two walkthrough guides, via python3 ───────────────────────────
function loadChapters(moduleName) {
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'docs/sop-build'))})
m = __import__(${JSON.stringify(moduleName)})
meta = getattr(m, 'META', {})
print(json.dumps({'meta': {'title': meta.get('title', '')}, 'chapters': m.CHAPTERS}, default=str))
`
  return JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }))
}

function stepLine(step) {
  // Billing: (keys, title, body[, state]) → list. Runner: S() → dict k/h/b/w/s.
  if (Array.isArray(step)) {
    const [, title, body] = step
    return `- ${text(title)}: ${text(body)}`
  }
  const why = step.w ? ` (Why: ${text(step.w)})` : ''
  return `- ${text(step.h)}: ${text(step.b)}${why}`
}

function renderGuide(key, title, href, chapters, cites) {
  const out = [`# GUIDE: ${title}`]
  for (const c of chapters) {
    const id = `${key}:${c.id}`
    const label = `${title.replace(/ SOP| guide/i, '')} guide · ${c.nav}`
    cites[id] = { label, href: `${href}#${c.id}` }
    out.push(`\n## [${id}] Chapter ${c.n} · ${text(c.nav)} — ${text(c.h1)}`)
    if (c.lede) out.push(text(c.lede))
    for (const b of c.blocks ?? []) {
      if (b.kind === 'walk') {
        out.push(`### ${text(b.title)}`)
        if (b.lede) out.push(text(b.lede))
        for (const s of b.steps ?? []) out.push(stepLine(s))
      } else if (b.kind === 'pane') {
        out.push(`### ${text(b.title)}`)
        out.push(text(b.html))
      } else if (b.kind === 'rhythm') {
        out.push(`### Rhythm`)
        for (const [when, items] of b.rows ?? []) out.push(`- ${text(when)}: ${items.map(text).join('; ')}`)
      } else if (b.kind === 'help' || b.kind === 'words') {
        out.push(`### ${text(b.title)}`)
        for (const [a, t] of b.rows ?? []) out.push(`- ${text(a)}: ${text(t)}`)
      }
    }
  }
  return out.join('\n')
}

// ── 3 + 4: the main guide's data + the release notes, from sop.html ──────────
function loadSopData() {
  const html = readFileSync(path.join(ROOT, 'public/sop.html'), 'utf-8')
  // One script: from the first data const to the first function after the
  // release notes. The consts are plain object/array literals (no helpers), so
  // a sandboxed vm can evaluate them as-is.
  const start = html.indexOf('const STATUS_DATA=')
  const end = html.indexOf('\nfunction ', html.indexOf('const VERSIONS=['))
  if (start < 0 || end < 0) throw new Error('sop.html: could not find the data consts')
  const chunk = html.slice(start, end)
  const ctx = vm.runInNewContext(`${chunk}\n;({ STATUS_DATA, CRM_STEPS, CLIENT_STEPS, PETTY_STEPS, VERSIONS })`, {}, { timeout: 2000 })
  return ctx
}

function renderAppGuide(d, cites) {
  const out = ['# GUIDE: App guide — CRM, Clients, Petty cash, and what each lead status means']
  cites['app:statuses'] = { label: 'App guide · Lead statuses', href: '/sop' }
  out.push('\n## [app:statuses] Lead statuses — what each one means and the rule for it')
  for (const [k, v] of Object.entries(d.STATUS_DATA)) out.push(`- ${text(v.label)} (${k}): ${text(v.title)} ${text(v.body)} Rule: ${text(v.rule)}`)
  const sections = [['app:crm', 'CRM', d.CRM_STEPS], ['app:clients', 'Clients', d.CLIENT_STEPS], ['app:petty', 'Petty cash', d.PETTY_STEPS]]
  for (const [id, name, steps] of sections) {
    cites[id] = { label: `App guide · ${name}`, href: '/sop' }
    out.push(`\n## [${id}] ${name}`)
    for (const s of steps ?? []) {
      const bits = [`- ${text(s.title)}${s.tag ? ` (${text(s.tag)})` : ''}: ${text(s.desc)}`]
      if (s.tip) bits.push(`Tip: ${text(s.tip)}`)
      if (s.dos?.length) bits.push(`Do: ${s.dos.map(text).join('; ')}`)
      if (s.donts?.length) bits.push(`Don't: ${s.donts.map(text).join('; ')}`)
      out.push(bits.join(' '))
    }
  }
  return out.join('\n')
}

function renderVersions(versions, cites) {
  const out = ["# WHAT'S NEW — staff release notes, newest first (open: /sop → Version History)"]
  for (const v of versions) {
    const id = `new:${v.ver}`
    cites[id] = { label: `What's new · ${v.ver}`, href: '/sop' }
    out.push(`\n## [${id}] ${v.ver} — ${v.date} — ${text(v.headline)}`)
    if (v.desc) out.push(text(v.desc))
    for (const c of v.changes ?? []) out.push(`- ${text(c)}`)
    if (v.affects) out.push(`What this means for you: ${text(v.affects)}`)
    // v.dev is deliberately NOT included.
  }
  return out.join('\n')
}

// ── build ────────────────────────────────────────────────────────────────────
const cites = {}
const billing = loadChapters('content')
const runner = loadChapters('content_runner')
const sop = loadSopData()

const parts = [
  renderGuide('billing', 'Billing SOP (the office: work orders, invoices, payments)', '/sop/billing', billing.chapters, cites),
  renderGuide('runner', 'Runner App Guide (the phone app runners use at night)', '/runner/sop', runner.chapters, cites),
  renderAppGuide(sop, cites),
  renderVersions(sop.VERSIONS, cites),
]
const corpus = parts.join('\n\n')
// RUNNERS GET THE RUNNER GUIDE ONLY (2026-10-22). A runner on a phone at
// night should not be told about invoices, approvals or the owner's queue —
// the Billing SOP is not their job and the main guide is the office's. The
// release notes are left out too: they are written for the office. If a
// runner-facing note ever matters, the runner guide's own step is the place.
const corpusRunner = parts[1]

const sources = ['docs/sop-build/content.py', 'docs/sop-build/content_runner.py', 'public/sop.html']
const newest = Math.max(...sources.map(f => statSync(path.join(ROOT, f)).mtimeMs))

const ts = `// GENERATED by scripts/build-ask-corpus.mjs — do not edit. Rebuild after
// changing docs/sop-build/content*.py or public/sop.html.
// Built ${new Date().toISOString()} · ${corpus.length.toLocaleString()} chars · ${Object.keys(cites).length} citable sections.
export const ASK_CORPUS_BUILT_AT = ${JSON.stringify(new Date().toISOString())}
export const ASK_CORPUS_SOURCES_MTIME = ${Math.round(newest)}
export const ASK_CITES: Record<string, { label: string; href: string }> = ${JSON.stringify(cites, null, 2)}
export const ASK_CORPUS = ${JSON.stringify(corpus)}
export const ASK_CORPUS_RUNNER = ${JSON.stringify(corpusRunner)}
`
writeFileSync(OUT, ts)
console.log(`askCorpus: ${corpus.length.toLocaleString()} chars (~${Math.round(corpus.length / 4).toLocaleString()} tokens), ${Object.keys(cites).length} sections; runner-only ${corpusRunner.length.toLocaleString()} chars → ${path.relative(ROOT, OUT)}`)
