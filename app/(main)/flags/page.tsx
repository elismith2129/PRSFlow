'use client'

// ─────────────────────────────────────────────────────────────────────────────
// /flags — FLAGS, one page (2026-09-15). Flags + Tasks merged.
// Mock: docs/design-refs/flags-options.html (round 3). Migration 20260915140000.
//
// A flag is anything that needs doing; a task is a flag someone typed. Its
// KIND decides its DEPARTMENT the moment it exists — no grabbing, no
// unassigned pile, no acknowledge ("if it's tech, it becomes tech").
//     Facility · Gear (mics are gear)  → Tech    (Sierra, Tom)
//     Clients & billing · Office       → Admin   (owner, manager, billing, asst)
// Tech sees the Tech list only. Admin sees both — beside each other, paged,
// one designed height (round 5, 2026-09-16), the detail card that same height.
// Age is the only red: open past 72h is hot on every list it appears on.
// Done asks for vendor + cost on Tech flags only.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DashboardTaskComment, FlagKind, FlagStudio } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useFlagsVersion } from '@/hooks/useFlagsVersion'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SignedImage } from '@/components/shared/SignedImage'
import { toast } from '@/components/ui/Toaster'
import {
  Flag, KINDS, KIND_LABEL, KIND_COLOR, STUDIOS, DEPT_LABEL, RosterRow,
  departmentOf, studioCode, myDepartment, isAdminRole, isHot, ageLabel, sourceLine,
  fetchRoster, fetchOpenFlags, fetchDoneFlags, fetchFlagComments,
  uploadFlagPhoto, addFlag, assignFlag, rekindFlag, setFlagDue, doneFlag, reopenFlag, dismissFlag, removeFlag, addFlagComment,
} from '@/lib/flags'

// ── tiny style vocabulary (the memos page's) ─────────────────────────────────
const kLabel: React.CSSProperties = { fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }
const chip = (on: boolean): React.CSSProperties => ({
  padding: '4px 11px', borderRadius: 99, fontSize: 10.5, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
  background: on ? 'var(--c-fg)' : 'var(--c-wash)', color: on ? 'var(--c-bg)' : 'var(--c-fg-2)',
})
const count: React.CSSProperties = { fontFamily: "'DM Mono', monospace", fontWeight: 500, marginLeft: 5, opacity: 0.7 }
const meta: React.CSSProperties = { fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg-3)' }
const mono: React.CSSProperties = { fontFamily: "'DM Mono', monospace" }

function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return withTime
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function initialsOf(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/).filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 3)
}

type Scope = 'all' | 'mine' | 'assigned'

export default function FlagsPage() {
  const { profile } = useUserProfile()
  const isMobile = useIsMobile()
  const version = useFlagsVersion()
  const admin = isAdminRole(profile?.role)
  const dept = myDepartment(profile?.role)

  // ── data ───────────────────────────────────────────────────────────────────
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [open, setOpen] = useState<Flag[]>([])
  const [done, setDone] = useState<Flag[]>([])
  const [loading, setLoading] = useState(true)
  const nameOf = useCallback((id: string | null) => roster.find(r => r.id === id)?.display_name ?? '', [roster])

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const [o, d] = await Promise.all([fetchOpenFlags(), fetchDoneFlags(since)])
    setOpen(o); setDone(d); setLoading(false)
  }, [])
  useEffect(() => { fetchRoster().then(setRoster) }, [])
  useEffect(() => { if (profile) load() }, [profile, load, version])

  // ── filters ────────────────────────────────────────────────────────────────
  const [scope, setScope] = useState<Scope>('all')
  const [kindF, setKindF] = useState<FlagKind | null>(null)
  const [studioF, setStudioF] = useState<FlagStudio | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [search, setSearch] = useState('')

  // Tech seats land on Mine by default — remembered per person, one tap.
  useEffect(() => {
    if (!profile) return
    try {
      const saved = localStorage.getItem(`flags-scope-${profile.id}`) as Scope | null
      if (saved === 'all' || saved === 'mine' || saved === 'assigned') setScope(saved)
    } catch {}
  }, [profile])
  function pickScope(s: Scope) {
    setScope(s)
    try { if (profile) localStorage.setItem(`flags-scope-${profile.id}`, s) } catch {}
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const pass = (f: Flag) => {
      if (scope === 'mine' && f.assigned_to !== profile?.id) return false
      if (scope === 'assigned' && f.assigned_by !== profile?.id) return false
      if (kindF && f.kind !== kindF) return false
      if (studioF && f.studio !== studioF) return false
      if (q && !(`${f.text} ${f.source_label ?? ''} ${f.created_by_name ?? ''}`.toLowerCase().includes(q))) return false
      return true
    }
    return { open: open.filter(pass), done: done.filter(pass) }
  }, [open, done, scope, kindF, studioF, search, profile?.id])

  const hotCount = open.filter(f => isHot(f)).length
  const doneToday = done.filter(f => f.completed_at && Date.now() - new Date(f.completed_at).getTime() < 86_400_000).length

  // ── detail ─────────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(() => open.find(f => f.id === selectedId) ?? done.find(f => f.id === selectedId) ?? null, [open, done, selectedId])
  // Deep link from the dashboard's Your List: /flags?item=<id>.
  useEffect(() => {
    try {
      const want = new URLSearchParams(window.location.search).get('item')
      if (want) setSelectedId(want)
    } catch {}
  }, [])

  // ── composer ───────────────────────────────────────────────────────────────
  const [composing, setComposing] = useState(false)
  const [text, setText] = useState('')
  const [kind, setKind] = useState<FlagKind>(dept === 'tech' ? 'facility' : 'office')
  const [studio, setStudio] = useState<FlagStudio | null>(null)
  const [assignTo, setAssignTo] = useState<string>('')
  const [due, setDue] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)
  const kindsIcanAdd = dept === 'tech' ? KINDS.filter(k => k.department === 'tech') : KINDS
  // The profile resolves after first render; a tech's default kind is Facility.
  useEffect(() => { setKind(dept === 'tech' ? 'facility' : 'office') }, [dept])

  function resetCompose() { setText(''); setStudio(null); setAssignTo(''); setDue(''); setPhoto(null); if (photoRef.current) photoRef.current.value = '' }
  async function submitFlag() {
    if (!profile || !text.trim() || saving) return
    setSaving(true)
    const path = photo ? await uploadFlagPhoto(photo) : null
    if (photo && !path) { setSaving(false); return }
    // No name unless Admin picked one — the department is the owner.
    const assignedTo = assignTo || null
    const f = await addFlag({ text, kind, studio, assignedTo, dueDate: due || null, photoPath: path, by: profile })
    setSaving(false)
    if (f) {
      toast(`Flag added · ${DEPT_LABEL[departmentOf(kind)]}${assignedTo ? ` · ${nameOf(assignedTo) || 'assigned'}` : ''}`)
      resetCompose(); setComposing(false)
      await load()
    }
  }

  // ── grouping ───────────────────────────────────────────────────────────────
  // Admin: two columns beside each other, Admin | Tech. Tech: one column.
  // Oldest first inside. FIXED GEOMETRY (the dashboard's law, 2026-09-16 —
  // Eli: "admin list gets long, tech gets shoved to the bottom… one long
  // thing on one side and a bunch of empty space"): every column is one
  // designed height — PAGE rows of ROW_H — with a pager, and the detail
  // card beside them is that same height. The CRM's list ⇄ profile pattern.
  const columns: { key: string; title: string; rows: Flag[] }[] = admin
    ? [
        { key: 'admin', title: 'Admin', rows: filtered.open.filter(f => (f.department ?? departmentOf(f.kind ?? 'office')) === 'admin') },
        { key: 'tech',  title: 'Tech',  rows: filtered.open.filter(f => (f.department ?? departmentOf(f.kind ?? 'office')) === 'tech') },
      ]
    : [{ key: 'tech', title: 'Tech', rows: filtered.open }]

  const detail = selected && (
    <FlagDetail f={selected} admin={admin} roster={roster} nameOf={nameOf} profile={profile} onChanged={load} onClose={() => setSelectedId(null)} />
  )

  // Desktop grid: columns + (detail when open). Tech alone: list | detail.
  const gridCols = isMobile
    ? '1fr'
    : selected
      ? (admin ? 'minmax(0,1fr) minmax(0,1fr) minmax(300px,1.05fr)' : 'minmax(0,1.2fr) minmax(300px,1fr)')
      : (admin ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)')

  return (
    <div style={{ maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="c-panel" style={{ background: 'var(--c-srf)', boxShadow: 'var(--c-softsh)', borderRadius: 16, padding: '14px 18px', minWidth: 0 }}>
        {/* ── header ── */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <SectionHeader title="Flags" />
            <span style={meta}>
              <b style={{ color: 'var(--c-fg)' }}>{open.length}</b> open
              {hotCount > 0 && <> · <b style={{ color: 'var(--c-st-hot)' }}>{hotCount}</b> over 72h</>}
              {doneToday > 0 && <> · {doneToday} done today</>}
            </span>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search flags…" className="c-input c-inset2" style={{ fontSize: 11.5, width: isMobile ? '100%' : 200 }} />
        </div>

        {/* ── composer: one line, opens inline ── */}
        {!composing ? (
          <button type="button" onClick={() => setComposing(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--c-wash)', borderRadius: 12, padding: '9px 12px', marginBottom: 10, border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ width: 22, height: 22, borderRadius: 99, background: 'var(--c-fg)', color: 'var(--c-bg)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, lineHeight: 1 }}>+</span>
            <span style={{ flex: 1, color: 'var(--c-fg-3)', fontSize: 12.5, fontFamily: 'Inter' }}>Add a flag…</span>
          </button>
        ) : (
          <div style={{ background: 'var(--c-wash)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
            <input autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitFlag() } if (e.key === 'Escape') { resetCompose(); setComposing(false) } }}
              placeholder="What needs doing, in one line" className="c-input c-inset2" style={{ fontSize: 13, fontWeight: 600 }} />
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={kLabel}>Kind · goes to {DEPT_LABEL[departmentOf(kind)]}</span>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {kindsIcanAdd.map(k => <button key={k.key} type="button" onClick={() => setKind(k.key)} style={chip(kind === k.key)}>{k.label}</button>)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={kLabel}>Studio</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  {STUDIOS.map(s => <button key={s.key} type="button" onClick={() => setStudio(studio === s.key ? null : s.key)} style={chip(studio === s.key)}>{s.code}</button>)}
                </div>
              </div>
              {admin && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={kLabel}>Assign to</span>
                  <select value={assignTo} onChange={e => setAssignTo(e.target.value)} className="c-input c-inset2" style={{ fontSize: 11.5 }}>
                    <option value="">{DEPT_LABEL[departmentOf(kind)]} (nobody in particular)</option>
                    {roster.map(r => <option key={r.id} value={r.id}>{r.display_name}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={kLabel}>Due</span>
                <input type="date" value={due} onChange={e => setDue(e.target.value)} className="c-input c-inset2" style={{ fontSize: 11.5 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={kLabel}>Photo</span>
                <label className="c-control c-soft c-raised-chip" style={{ cursor: 'pointer', fontSize: 10.5 }}>
                  {photo ? photo.name.slice(0, 18) : 'Attach'}
                  <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setPhoto(e.target.files?.[0] ?? null)} />
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" disabled={!text.trim() || saving} onClick={submitFlag} style={{ fontSize: 11.5, opacity: text.trim() ? 1 : 0.45 }}>{saving ? 'Adding…' : 'Add flag'}</button>
              <button type="button" onClick={() => { resetCompose(); setComposing(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-3)', textDecoration: 'underline' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── chips ── */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={chip(scope === 'all')} onClick={() => pickScope('all')}>All<span style={count}>{open.length}</span></button>
          <button type="button" style={chip(scope === 'mine')} onClick={() => pickScope('mine')}>Mine<span style={count}>{open.filter(f => f.assigned_to === profile?.id).length}</span></button>
          {admin && <button type="button" style={chip(scope === 'assigned')} onClick={() => pickScope('assigned')}>I assigned<span style={count}>{open.filter(f => f.assigned_by === profile?.id).length}</span></button>}
          <span style={{ width: 1, height: 14, background: 'var(--c-wash2)', margin: '0 4px' }} />
          {(dept === 'tech' ? KINDS.filter(k => k.department === 'tech') : KINDS).map(k => (
            <button key={k.key} type="button" style={chip(kindF === k.key)} onClick={() => setKindF(kindF === k.key ? null : k.key)}>{k.label}<span style={count}>{open.filter(f => f.kind === k.key).length}</span></button>
          ))}
          <span style={{ width: 1, height: 14, background: 'var(--c-wash2)', margin: '0 4px' }} />
          {STUDIOS.map(s => <button key={s.key} type="button" style={chip(studioF === s.key)} onClick={() => setStudioF(studioF === s.key ? null : s.key)}>{s.code}</button>)}
        </div>
      </div>

      {/* ── the columns (+ detail) — one designed height ── */}
      <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 14, alignItems: 'start' }}>
        {columns.map(col => (
          <FlagColumn key={col.key} title={col.title} rows={col.rows} loading={loading} selectedId={selectedId} nameOf={nameOf}
            isMobile={isMobile}
            onOpen={id => setSelectedId(id)}
            onDone={async f => {
              // Tech flags collect vendor + cost on the card; everything else is done on the tap.
              if ((f.department ?? departmentOf(f.kind ?? 'office')) === 'tech') { setSelectedId(f.id); return }
              if (await doneFlag(f.id, { note: null, vendor: null, cost: null })) { toast('Done'); load() }
            }} />
        ))}
        {selected && !isMobile && (
          <div className="c-panel" style={{ background: 'var(--c-srf)', boxShadow: 'var(--c-softsh)', borderRadius: 16, padding: '14px 16px', height: COL_H, overflowY: 'auto', minWidth: 0, boxSizing: 'border-box' }}>
            {detail}
          </div>
        )}
      </div>

      {/* ── done this week ── */}
      {!loading && (
        <div className="c-panel" style={{ background: 'var(--c-srf)', boxShadow: 'var(--c-softsh)', borderRadius: 16, padding: '12px 18px' }}>
          <button type="button" onClick={() => setShowDone(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={kLabel}>Done this week</span><span style={meta}>{filtered.done.length} {showDone ? '▾' : '▸'}</span>
          </button>
          {showDone && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
              {filtered.done.length === 0 && <div style={meta}>Nothing done this week.</div>}
              {filtered.done.map(f => <FlagRow key={f.id} f={f} selected={f.id === selectedId} nameOf={nameOf} onOpen={() => setSelectedId(f.id)} onDone={async () => { if (await reopenFlag(f.id)) load() }} />)}
            </div>
          )}
        </div>
      )}

      {/* ── mobile: detail as a bottom sheet ── */}
      {selected && isMobile && (
        <div onClick={() => setSelectedId(null)} style={{ position: 'fixed', inset: 0, zIndex: 10030, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '92vh', overflowY: 'auto', background: 'var(--c-srf)', borderRadius: '20px 20px 0 0', padding: '16px 16px 24px' }}>
            {detail}
          </div>
        </div>
      )}
    </div>
  )
}

// ── a column: PAGE rows of ROW_H, a pager, one designed height ──────────────
const PAGE = 8
const ROW_H = 52
const ROW_GAP = 5
const COL_HEAD = 34
const COL_FOOT = 30
const COL_PAD = 12
/** Column height = head + rows + pager. The detail card matches it exactly. */
const COL_H = COL_PAD * 2 + COL_HEAD + PAGE * ROW_H + (PAGE - 1) * ROW_GAP + COL_FOOT

function FlagColumn({ title, rows, loading, selectedId, nameOf, isMobile, onOpen, onDone }: {
  title: string; rows: Flag[]; loading: boolean; selectedId: string | null
  nameOf: (id: string | null) => string; isMobile: boolean
  onOpen: (id: string) => void; onDone: (f: Flag) => void
}) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const safe = Math.min(page, pages)
  useEffect(() => { if (page > pages) setPage(pages) }, [page, pages])
  // Follow the selected flag onto its page (deep link, or a row that moved).
  useEffect(() => {
    if (!selectedId) return
    const i = rows.findIndex(r => r.id === selectedId)
    if (i >= 0) setPage(Math.floor(i / PAGE) + 1)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps
  const start = (safe - 1) * PAGE
  const slice = rows.slice(start, start + PAGE)
  const hot = rows.filter(f => isHot(f)).length
  return (
    <div className="c-panel" style={{ background: 'var(--c-srf)', boxShadow: 'var(--c-softsh)', borderRadius: 16, padding: COL_PAD, height: isMobile ? 'auto' : COL_H, display: 'flex', flexDirection: 'column', minWidth: 0, boxSizing: 'border-box' }}>
      <div style={{ height: COL_HEAD, display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 4px' }}>
        <span style={{ fontFamily: "'Bebas Neue', 'Archivo Black', sans-serif", fontSize: 20, letterSpacing: '0.04em', color: 'var(--c-fg)' }}>{title}</span>
        <span style={meta}>{rows.length} open{hot > 0 && <> · <b style={{ color: 'var(--c-st-hot)' }}>{hot} over 72h</b></>}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: ROW_GAP, flex: 1, minHeight: 0 }}>
        {loading ? <div style={{ ...meta, padding: '6px 4px' }}>Loading…</div>
          : rows.length === 0 ? <div style={{ ...meta, padding: '6px 4px' }}>Nothing open.</div>
          : slice.map(f => <FlagRow key={f.id} f={f} selected={f.id === selectedId} nameOf={nameOf} onOpen={() => onOpen(f.id)} onDone={() => onDone(f)} />)}
      </div>
      <div style={{ height: COL_FOOT, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
        <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safe <= 1} style={{ background: 'none', border: 'none', cursor: safe <= 1 ? 'default' : 'pointer', fontFamily: 'Inter', fontSize: 10, color: safe <= 1 ? 'var(--c-fg-3)' : 'var(--c-fg-2)', padding: '2px 4px' }}>← Prev</button>
        <span style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>{rows.length === 0 ? '—' : `${start + 1}–${Math.min(start + PAGE, rows.length)} of ${rows.length}`}</span>
        <button type="button" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={safe >= pages} style={{ background: 'none', border: 'none', cursor: safe >= pages ? 'default' : 'pointer', fontFamily: 'Inter', fontSize: 10, color: safe >= pages ? 'var(--c-fg-3)' : 'var(--c-fg-2)', padding: '2px 4px' }}>Next →</button>
      </div>
    </div>
  )
}

// ── a row ────────────────────────────────────────────────────────────────────
function FlagRow({ f, selected, nameOf, onOpen, onDone }: { f: Flag; selected: boolean; nameOf: (id: string | null) => string; onOpen: () => void; onDone: () => void }) {
  const kind = f.kind ?? 'office'
  const hot = isHot(f)
  const who = f.assigned_to ? nameOf(f.assigned_to) : ''
  const src = sourceLine(f, nameOf)
  return (
    <div onClick={onOpen} style={{ display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', gap: 10, alignItems: 'center', background: 'var(--c-bg)', borderRadius: 12, padding: '0 12px', height: ROW_H, boxSizing: 'border-box', cursor: 'pointer', outline: selected ? '1.5px solid var(--c-fg)' : 'none', opacity: f.completed ? 0.55 : 1 }}>
      <i style={{ width: 8, height: 8, borderRadius: 99, background: KIND_COLOR[kind] }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontFamily: 'Inter', fontWeight: 600, lineHeight: 1.3, color: 'var(--c-fg)', textDecoration: f.completed ? 'line-through' : 'none', textDecorationColor: 'var(--c-fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.text}</div>
        <div style={{ ...meta, marginTop: 2, display: 'flex', gap: 6, alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {f.studio && <span style={{ ...mono, fontWeight: 600, color: 'var(--c-fg-2)', letterSpacing: '0.04em' }}>{studioCode(f.studio)}</span>}
          {src && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{src}</span>}
          {f.due_date && !f.completed && <span>· due {fmtDate(f.due_date)}</span>}
          {f.completed && <span>· done {fmtDate(f.completed_at)}{f.done_cost != null ? ` · $${Number(f.done_cost).toFixed(0)}` : ''}{f.done_vendor ? ` · ${f.done_vendor}` : ''}</span>}
          {f.photo_url && <span style={{ display: 'inline-block', width: 14, height: 11, borderRadius: 3, background: 'var(--c-wash2)' }} />}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifySelf: 'end' }}>
        {!f.completed && <span style={{ ...mono, fontSize: 10.5, color: hot ? 'var(--c-st-hot)' : 'var(--c-fg-3)', fontWeight: hot ? 600 : 400 }}>{ageLabel(f.created_at)}</span>}
        <span style={{ fontSize: 10.5, fontFamily: 'Inter', fontWeight: who ? 600 : 500, color: who ? 'var(--c-fg-2)' : 'var(--c-fg-3)', whiteSpace: 'nowrap' }}>{who || DEPT_LABEL[f.department ?? departmentOf(kind)]}</span>
        <button type="button" aria-label={f.completed ? 'Reopen' : 'Done'} onClick={e => { e.stopPropagation(); onDone() }} title={f.completed ? 'Reopen' : 'Done'}
          style={{ width: 18, height: 18, borderRadius: 99, border: `1.5px solid ${f.completed ? 'var(--c-st-booked)' : 'var(--c-fg-3)'}`, background: f.completed ? 'var(--c-st-booked)' : 'transparent', cursor: 'pointer', padding: 0 }} />
      </div>
    </div>
  )
}

// ── the detail ───────────────────────────────────────────────────────────────
function FlagDetail({ f, admin, roster, nameOf, profile, onChanged, onClose }: {
  f: Flag; admin: boolean; roster: RosterRow[]; nameOf: (id: string | null) => string
  profile: { id: string; display_name: string; email: string } | null
  onChanged: () => Promise<void> | void; onClose: () => void
}) {
  const kind = f.kind ?? 'office'
  const isTech = (f.department ?? departmentOf(kind)) === 'tech'
  const [comments, setComments] = useState<DashboardTaskComment[]>([])
  const [note, setNote] = useState('')
  const [notePhoto, setNotePhoto] = useState<File | null>(null)
  const noteRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [doneNote, setDoneNote] = useState('')
  const [vendor, setVendor] = useState('')
  const [cost, setCost] = useState('')
  const [dismissing, setDismissing] = useState(false)
  const version = useFlagsVersion()

  useEffect(() => { fetchFlagComments(f.id).then(setComments) }, [f.id, version])

  async function sendNote() {
    if (!profile || busy || (!note.trim() && !notePhoto)) return
    setBusy(true)
    const path = notePhoto ? await uploadFlagPhoto(notePhoto) : null
    if (notePhoto && !path) { setBusy(false); return }
    if (await addFlagComment(f.id, note, path, profile.display_name)) {
      setNote(''); setNotePhoto(null); if (noteRef.current) noteRef.current.value = ''
      setComments(await fetchFlagComments(f.id))
    }
    setBusy(false)
  }
  async function markDone() {
    if (busy) return
    setBusy(true)
    const c = cost.trim() ? Number(cost.replace(/[^0-9.]/g, '')) : null
    const ok = await doneFlag(f.id, { note: doneNote.trim() || null, vendor: vendor.trim() || null, cost: c != null && !Number.isNaN(c) ? c : null })
    setBusy(false)
    if (ok) { toast('Done'); await onChanged(); onClose() }
  }
  async function notReal() {
    if (busy) return
    if (!dismissing) { setDismissing(true); return }
    setBusy(true)
    const ok = await dismissFlag(f.id, doneNote)
    setBusy(false)
    if (ok) { toast('Closed — not a real issue'); await onChanged(); onClose() }
  }

  const raised = f.source === 'runner_flag' ? `Flagged by ${f.created_by_name || 'a runner'} on the checklist`
    : f.source === 'wo_flag' ? `Raised on the work order${f.source_label ? ` · ${f.source_label}` : ''}`
    : `Added by ${f.assigned_by ? nameOf(f.assigned_by) || f.created_by_name || 'staff' : f.created_by_name || 'staff'}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <span style={kLabel}>
          <i style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: KIND_COLOR[kind], marginRight: 6, verticalAlign: 1 }} />
          {KIND_LABEL[kind]}{f.studio ? ` · ${studioCode(f.studio)}` : ''} · {f.assigned_to ? nameOf(f.assigned_to) : DEPT_LABEL[f.department ?? departmentOf(kind)]}
          {!f.completed && <> · <span style={{ color: isHot(f) ? 'var(--c-st-hot)' : undefined }}>{ageLabel(f.created_at)}</span></>}
        </span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-fg-3)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
      </div>
      <div style={{ fontSize: 14.5, fontFamily: 'Inter', fontWeight: 700, lineHeight: 1.3, color: 'var(--c-fg)' }}>{f.text}</div>
      <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-2)', lineHeight: 1.6 }}>
        {raised}, {fmtDate(f.created_at, true)}.
        {f.due_date && !f.completed && <> Due <b style={{ color: 'var(--c-fg)' }}>{fmtDate(f.due_date)}</b>.</>}
        {f.completed && <> Done {fmtDate(f.completed_at, true)}{f.done_vendor ? ` · ${f.done_vendor}` : ''}{f.done_cost != null ? ` · $${Number(f.done_cost).toFixed(2)}` : ''}{f.completed_note ? ` — ${f.completed_note}` : ''}.</>}
      </div>
      {f.photo_url && <SignedImage path={f.photo_url} link style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 10, display: 'block' }} />}

      {/* Admin moves: assign, kind, due, remove */}
      {admin && !f.completed && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 140 }}>
            <span style={kLabel}>Assigned to</span>
            <select value={f.assigned_to ?? ''} onChange={async e => { if (await assignFlag(f.id, e.target.value || null)) onChanged() }} className="c-input c-inset2" style={{ fontSize: 11.5 }}>
              <option value="">{DEPT_LABEL[f.department ?? departmentOf(kind)]} (nobody in particular)</option>
              {roster.map(r => <option key={r.id} value={r.id}>{r.display_name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 140 }}>
            <span style={kLabel}>Kind</span>
            <select value={kind} onChange={async e => { if (await rekindFlag(f.id, e.target.value as FlagKind)) { toast(`Moved to ${DEPT_LABEL[departmentOf(e.target.value as FlagKind)]}`); onChanged() } }} className="c-input c-inset2" style={{ fontSize: 11.5 }}>
              {KINDS.map(k => <option key={k.key} value={k.key}>{k.label} → {DEPT_LABEL[k.department]}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={kLabel}>Due</span>
            <input type="date" value={f.due_date ?? ''} onChange={async e => { if (await setFlagDue(f.id, e.target.value || null)) onChanged() }} className="c-input c-inset2" style={{ fontSize: 11.5 }} />
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <span style={kLabel}>Notes</span>
        {comments.length === 0 && <div style={{ ...meta, padding: '6px 0' }}>No notes yet.</div>}
        {comments.map(c => (
          <div key={c.id} style={{ fontSize: 11.5, fontFamily: 'Inter', lineHeight: 1.5, padding: '7px 0', borderTop: '1px solid var(--c-wash)', color: 'var(--c-fg-2)' }}>
            <span style={{ ...mono, fontSize: 10, color: 'var(--c-fg-3)', marginRight: 6 }}>{initialsOf(c.created_by_name)} · {fmtDate(c.created_at)}</span>
            {c.text}
            {c.photo_url && <SignedImage path={c.photo_url} link style={{ display: 'block', marginTop: 6, maxWidth: 220, maxHeight: 160, borderRadius: 8 }} />}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendNote() } }} placeholder="Add a note…" className="c-input c-inset2" style={{ fontSize: 11.5, flex: 1 }} />
          <label className="c-control c-soft c-raised-chip" style={{ cursor: 'pointer', fontSize: 10, whiteSpace: 'nowrap' }}>
            {notePhoto ? '1 photo' : 'Photo'}
            <input ref={noteRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setNotePhoto(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="c-control c-soft c-raised-chip" disabled={busy || (!note.trim() && !notePhoto)} onClick={sendNote} style={{ fontSize: 10 }}>Send</button>
        </div>
      </div>

      {/* Done */}
      {!f.completed ? (
        <div style={{ background: 'var(--c-wash)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={kLabel}>Done</span>
          <input value={doneNote} onChange={e => setDoneNote(e.target.value)} placeholder={isTech ? 'What was done' : 'Note (optional)'} className="c-input c-inset2" style={{ fontSize: 11.5 }} />
          {isTech && (
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor / who fixed it" className="c-input c-inset2" style={{ fontSize: 11.5, flex: 1 }} />
              <input value={cost} onChange={e => setCost(e.target.value)} placeholder="$ cost" inputMode="decimal" className="c-input c-inset2" style={{ fontSize: 11.5, width: 90, ...mono }} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" disabled={busy} onClick={markDone} style={{ fontSize: 11 }}>Mark done</button>
            <button type="button" onClick={notReal} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10.5, fontFamily: 'Inter', color: dismissing ? 'var(--c-st-hot)' : 'var(--c-fg-3)', textDecoration: 'underline' }}>
              {dismissing ? 'Tap again to close it as not a real issue' : 'Not a real issue'}
            </button>
            {admin && <button type="button" onClick={async () => { if (confirm('Remove this flag? It leaves every list.')) { if (await removeFlag(f.id)) { await onChanged(); onClose() } } }} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg-3)' }}>Remove</button>}
          </div>
        </div>
      ) : (
        <button type="button" className="c-control c-soft c-raised-chip" onClick={async () => { if (await reopenFlag(f.id)) { await onChanged() } }} style={{ alignSelf: 'flex-start', fontSize: 10.5 }}>Reopen</button>
      )}
    </div>
  )
}
