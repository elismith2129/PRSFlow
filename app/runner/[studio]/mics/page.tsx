'use client'
// THE SHEET, 2026-08-25 (Option A from docs/design-refs/mic-inventory-options.html,
// Eli's pick after the Aug 24 runner test pass). The paper form's advantage —
// a zoomed-out birdseye — digitized:
//   · Per-studio tabs (home studio first, then ARS/ERS/TRK/Floating/Odds) —
//     the old home/"other studio mics" lump is gone; check-ins still write
//     under THIS studio's key, tabs are navigation only.
//   · Birdseye GRID of compact cells (auto-fill columns — ~2 on a phone, 4+
//     on the iPad the runners actually use). TAP = HERE (the 95% case);
//     tapping a marked cell opens a Room / Missing / Clear popover.
//   · Pinned chrome: tabs + search + missing-streak alert live in the sticky
//     header (Isaac's always-visible search).
//   · Per-tab progress counts ("62/86") so "did I miss one?" is a glance.
//   · LAST-NIGHT REFERENCE per cell — display only, NEVER pre-filled: eyes on
//     every mic every night is a business rule (pre-filling masks theft).
//   · Jump-to-top bug fixed: v1 defined row components INSIDE the page
//     component, so every tap made new component types and React rebuilt the
//     whole subtree. All rendering is now inline JSX / hoisted constants.
// Unchanged from the previous page: the four save/submit upserts, lib/draft
// persistence, the dirtyRef realtime guard, profile-derived initials.
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { opsToday } from '@/lib/time'
import { useReloadOnReturn } from '@/hooks/useReloadOnReturn'
import { draftKey, readDraft, writeDraft, clearDraft } from '@/lib/draft'
import { useUserProfile } from '@/hooks/useUserProfile'
import { profileInitials } from '@/lib/format'
import { SectionNotes } from '@/components/runner/SectionNotes'

const STUDIO_META: Record<string, { label: string }> = {
  paramount: { label: 'Paramount' },
  ameraycan: { label: 'Ameraycan' },
  encore:    { label: 'Encore' },
  track:     { label: 'Track' },
}

const STUDIO_ROOMS: Record<string, string[]> = {
  paramount: ['Studio A', 'Studio B', 'Studio C', 'Studio E', 'Studio X'],
  ameraycan: ['Studio A', 'Studio B'],
  encore:    ['Studio A', 'Studio B'],
  track:     ['Studio North', 'Studio South'],
}

const STUDIO_SHORT: Record<string, string> = {
  paramount: 'PRS', ameraycan: 'ARS', encore: 'ERS', track: 'TRK',
}
const STUDIO_KEYS = ['paramount', 'ameraycan', 'encore', 'track']

type Mic = {
  id: string
  name: string
  home_studio: string
  category: string
  sort_order: number
  // Per-item counted quantity (Genelecs: "we usually write (2)") — the cell
  // gains a qty box while staying in its section. Migration 20260828120000.
  has_qty?: boolean
}

type CheckinState = {
  status: 'not_checked' | 'here' | 'room' | 'missing'
  room: string
}

// Latest PRIOR checkin (any studio, before today) — the display-only reference.
type Prior = { status: 'here' | 'room' | 'missing'; room: string | null; date: string; missingSince?: string }

// "2026-08-24" → "8/24"
const fmtD = (iso: string) => `${parseInt(iso.slice(5, 7))}/${parseInt(iso.slice(8, 10))}`

export default function MicsPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta  = STUDIO_META[studio] ?? { label: studio }
  // Operational day (8:50 AM roll, 2026-08-28) — a 1 AM mic check belongs to
  // the night in progress, and the last-seen refs read prior NIGHTS.
  const today = opsToday()
  const rooms = STUDIO_ROOMS[studio] ?? []

  const [mics, setMics]             = useState<Mic[]>([])
  const [loading, setLoading]       = useState(true)
  const [checkins, setCheckins]     = useState<Record<string, CheckinState>>({})
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [prior, setPrior]           = useState<Record<string, Prior>>({})
  const [initials, setInitials]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showInitialsHint, setShowInitialsHint] = useState(false)
  const [tab, setTab]               = useState<string>(studio)
  const [query, setQuery]           = useState('')
  // The one open Room/Missing popover: which mic + fixed-position coords
  // (measured from the tapped cell so it can never be clipped by the grid).
  const [pop, setPop]               = useState<{ micId: string; left: number; top: number } | null>(null)
  // True once the runner edits anything; blocks the realtime refetch so a live update
  // never clobbers unsaved status/room/qty. Reset to false whenever we load fresh data.
  const dirtyRef = useRef(false)
  const { profile } = useUserProfile()

  // Runners have their own logins now (Eli, 2026-08-25) — initials come from
  // the profile, nobody types them. The input stays as a fallback for the
  // shared runner account, and a draft-restored value is never overwritten.
  useEffect(() => {
    if (!initials && profile && profile.email !== 'runner@paramountrecording.com') {
      const derived = profile.initials || profileInitials(profile.display_name)
      if (derived) setInitials(derived)
    }
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('mics')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
    setMics(data ?? [])

    const dAgo = (n: number) => {
      const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - n)
      return d.toISOString().slice(0, 10)
    }
    const [{ data: savedCheckins }, { data: savedQtys }, { data: recent }, { data: missRows }] = await Promise.all([
      supabase.from('mic_checkins').select('*').eq('studio', studio).eq('date', today),
      supabase.from('mic_inventory_quantities').select('*').eq('studio', studio).eq('date', today),
      // Last-night reference: latest prior checkin per mic, ANY studio. A
      // 4-day window keeps this well under PostgREST's 1,000-row cap
      // (~270 checkin rows land per night across all studios).
      supabase.from('mic_checkins').select('mic_id, date, status, room')
        .lt('date', today).gte('date', dAgo(4))
        .order('date', { ascending: false }).limit(1000),
      // Missing streaks reach further back — missing rows are few.
      supabase.from('mic_checkins').select('mic_id, date, status')
        .eq('status', 'missing').lt('date', today).gte('date', dAgo(21))
        .order('date', { ascending: false }).limit(1000),
    ])

    const restoredCheckins: Record<string, CheckinState> = {}
    for (const c of savedCheckins ?? []) {
      restoredCheckins[c.mic_id] = { status: c.status, room: c.room ?? '' }
    }
    const restoredQtys: Record<string, number> = {}
    for (const q of savedQtys ?? []) {
      restoredQtys[q.mic_id] = q.quantity
    }

    // Reduce the reference window to latest-per-mic; a mic whose latest prior
    // status is missing gets its streak start from the missing-rows query.
    const pr: Record<string, Prior> = {}
    for (const c of recent ?? []) {
      if (pr[c.mic_id]) continue
      pr[c.mic_id] = { status: c.status, room: c.room ?? null, date: c.date }
    }
    for (const [id, p] of Object.entries(pr)) {
      if (p.status !== 'missing') continue
      let since = p.date
      for (const m of (missRows ?? []).filter(r => r.mic_id === id)) {
        if (m.date <= since) since = m.date
        else break
      }
      p.missingSince = since
    }
    setPrior(pr)
    dirtyRef.current = false

    // Unsaved draft from a previous visit (lib/draft): the runner's un-saved
    // taps win over what the server has, and the page counts as dirty so
    // realtime doesn't clobber them. Cleared on successful save/submit.
    const draft = readDraft<{ checkins: Record<string, CheckinState>; quantities: Record<string, number>; initials: string }>(
      draftKey('mics', studio, today))
    if (draft) {
      Object.assign(restoredCheckins, draft.checkins ?? {})
      Object.assign(restoredQtys, draft.quantities ?? {})
      if (draft.initials) setInitials(draft.initials)
      // Dirty ONLY when the draft holds actual taps (Lori Beth's bug,
      // 2026-09-02): a draft carrying nothing but typed initials used to pin
      // the page dirty, which silenced the realtime channel and the
      // reload-on-return — so another runner's submission never appeared
      // until a full force-close remounted the page. Initials aren't per-mic
      // data and load() never touches them, so they can't be clobbered.
      dirtyRef.current =
        Object.keys(draft.checkins ?? {}).length > 0 || Object.keys(draft.quantities ?? {}).length > 0
    }

    setCheckins(restoredCheckins)
    setQuantities(restoredQtys)
    setLoading(false)
  }, [studio, today])

  // Mirror un-saved taps to the draft as they happen.
  useEffect(() => {
    if (loading || !dirtyRef.current) return
    writeDraft(draftKey('mics', studio, today), { checkins, quantities, initials })
  }, [checkins, quantities, initials, loading, studio, today])

  useEffect(() => { load() }, [load])
  // ALWAYS reload on return — no dirty guard here (Lori Beth's bug,
  // 2026-09-02). On an installed PWA, "closing the app" usually only suspends
  // the page, so returning is the moment another device's submission should
  // appear. Reloading can't clobber in-progress taps because load() itself
  // overlays the draft (mirrored on every tap) on top of the server rows —
  // the merge is the protection, not the skip. The realtime channel below
  // keeps its guard: it fires mid-tap, where the draft-mirror race is real.
  useReloadOnReturn(load)

  // Real-time: another device's mic check-ins/quantities refetch live when clean;
  // skipped while this runner is mid-edit so their local entries are never clobbered.
  useEffect(() => {
    const channel = supabase
      .channel(`runner-mics-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mic_checkins' }, () => { if (!dirtyRef.current) load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mic_inventory_quantities' }, () => { if (!dirtyRef.current) load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studio, load])

  // Popover closes on any scroll or outside tap — it's fixed-position, so it
  // would otherwise detach from its cell.
  useEffect(() => {
    if (!pop) return
    const close = () => setPop(null)
    document.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [pop])

  function mark(micId: string, status: CheckinState['status'], room = '') {
    dirtyRef.current = true
    setCheckins(prev => ({ ...prev, [micId]: { status, room } }))
  }

  function onCellTap(mic: Mic, e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation()
    if (pop?.micId === mic.id) { setPop(null); return }
    const st = checkins[mic.id]?.status ?? 'not_checked'
    if (st === 'not_checked') { mark(mic.id, 'here'); setPop(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    setPop({
      micId: mic.id,
      left: Math.min(Math.max(8, r.left), window.innerWidth - 244),
      top: r.bottom + 4,
    })
  }

  // Typed quantity (ARS tester, Aug 28: "Other DI" and phones run high —
  // tapping + fourteen times is silly). Digits only; column is an integer.
  function setQty(micId: string, raw: string) {
    dirtyRef.current = true
    const n = parseInt(raw.replace(/\D/g, ''), 10)
    setQuantities(prev => ({ ...prev, [micId]: Number.isFinite(n) ? Math.max(0, n) : 0 }))
  }

  async function handleSave() {
    const checkinRows = Object.entries(checkins)
      .filter(([, s]) => s.status !== 'not_checked')
      .map(([mic_id, s]) => ({ studio, date: today, mic_id, status: s.status, room: s.room || null }))
    const qtyRows = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([mic_id, qty]) => ({ studio, date: today, mic_id, quantity: qty }))
    await Promise.all([
      checkinRows.length ? supabase.from('mic_checkins').upsert(checkinRows, { onConflict: 'mic_id,studio,date' }) : Promise.resolve(),
      qtyRows.length ? supabase.from('mic_inventory_quantities').upsert(qtyRows, { onConflict: 'mic_id,studio,date' }) : Promise.resolve(),
    ])
    clearDraft(draftKey('mics', studio, today))
    dirtyRef.current = false
    router.push(`/runner/${studio}`)
  }

  async function handleSubmit() {
    if (!initials.trim() || submitting) return
    setSubmitting(true)
    const now = new Date().toISOString()

    // 1. mic_checkins — only touched rows
    const checkinRows = Object.entries(checkins)
      .filter(([, v]) => v.status !== 'not_checked')
      .map(([mic_id, v]) => ({ mic_id, studio, date: today, status: v.status, room: v.room || null }))
    if (checkinRows.length > 0) {
      await supabase.from('mic_checkins').upsert(checkinRows, { onConflict: 'mic_id,studio,date' })
    }

    // 2. mic_inventory_quantities — only qty > 0
    const qtyRows = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([mic_id, quantity]) => ({ mic_id, studio, date: today, quantity }))
    if (qtyRows.length > 0) {
      await supabase.from('mic_inventory_quantities').upsert(qtyRows, { onConflict: 'mic_id,studio,date' })
    }

    // 3. mic_inventory_submissions
    await supabase.from('mic_inventory_submissions').upsert(
      { studio, date: today, submitted_at: now, submitted_by: initials.trim() },
      { onConflict: 'studio,date' }
    )

    // 4. daily_ops_submissions
    await supabase.from('daily_ops_submissions').upsert(
      { studio, date: today, category: 'mic_inventory', submitted_at: now, staff_name: initials.trim() },
      { onConflict: 'studio,date,category' }
    )

    clearDraft(draftKey('mics', studio, today))
    dirtyRef.current = false
    setSubmitting(false)
    router.push(`/runner/${studio}`)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--c-bg)', color: 'var(--c-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  // ── Tabs: home studio first, then the rest, then Floating / Odds ──────────
  const tabDefs: { key: string; label: string; kind: 'mic' | 'qty' }[] = [
    ...[studio, ...STUDIO_KEYS.filter(s => s !== studio)].map(s => ({
      key: s, label: STUDIO_SHORT[s] ?? s, kind: 'mic' as const,
    })),
    { key: 'floating', label: 'Floating', kind: 'mic' },
    { key: 'odds', label: 'Odds', kind: 'qty' },
  ]
  const listFor = (key: string): Mic[] =>
    key === 'floating' ? mics.filter(m => m.category === 'floating_gear')
    : key === 'odds'   ? mics.filter(m => m.category === 'odds_ends')
    : mics.filter(m => m.home_studio === key && m.category === 'mic')
  const doneCount = (key: string) => key === 'odds'
    ? listFor(key).filter(m => (quantities[m.id] ?? 0) > 0).length
    : listFor(key).filter(m => (checkins[m.id]?.status ?? 'not_checked') !== 'not_checked').length

  const activeDef = tabDefs.find(t => t.key === tab) ?? tabDefs[0]
  const q = query.trim().toLowerCase()
  const activeList = listFor(activeDef.key).filter(m => !q || m.name.toLowerCase().includes(q))

  // Missing-streak alert: every mic whose latest prior checkin is missing.
  const missingMics = mics.filter(m => prior[m.id]?.status === 'missing')

  const refLine = (m: Mic): { text: string; bad: boolean } | null => {
    const p = prior[m.id]
    if (!p) return null
    if (p.status === 'missing') return { text: `missing since ${fmtD(p.missingSince ?? p.date)}`, bad: true }
    if (p.status === 'room') return { text: `last: ${(p.room ?? '').replace('Studio ', 'Rm ')} · ${fmtD(p.date)}`, bad: false }
    return { text: `last: HERE · ${fmtD(p.date)}`, bad: false }
  }

  const cellColors = (st: CheckinState['status']): React.CSSProperties =>
    st === 'here'    ? { background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)' }
    : st === 'room'    ? { background: 'var(--c-st-cold)', color: 'var(--c-chip-ink)' }
    : st === 'missing' ? { background: 'var(--c-st-hot)', color: 'var(--c-hot-text)' }
    : { background: 'var(--c-wash)', color: 'var(--c-fg)' }

  const popMic = pop ? mics.find(m => m.id === pop.micId) : null

  return (
    <div style={{
      minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden',
      background: 'var(--c-bg)', color: 'var(--c-fg)', paddingBottom: 130,
    }}>

      {/* ── Sticky chrome: title + tabs + search + alert ──────────────────── */}
      <div style={{
        padding: '14px 16px 10px', position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--c-bg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 10 }}>
          <button
            onClick={() => router.push(`/runner/${studio}`)}
            aria-label="Back"
            className="c-control c-raised"
            style={{
              width: 38, height: 38, borderRadius: 99, flexShrink: 0,
              background: 'var(--c-wash)', color: 'var(--c-fg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, cursor: 'pointer',
            }}
          >←</button>
          <div>
            <div className="c-arch" style={{ fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Mic inventory</div>
            <div style={{ fontSize: 11.5, opacity: 0.5 }}>{meta.label} · {today}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
          {tabDefs.map(t => {
            const on = t.key === tab
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setPop(null) }}
                style={{
                  border: 'none', font: 'inherit', cursor: 'pointer',
                  background: on ? 'var(--c-wash2)' : 'var(--c-wash)', color: 'var(--c-fg)',
                  borderRadius: 99, padding: '7px 12px', minHeight: 32,
                  fontSize: 10.5, fontWeight: 800, letterSpacing: '0.03em',
                  opacity: on ? 1 : 0.6,
                  boxShadow: on ? 'inset 0 0 0 1.5px rgba(217,214,205,0.25)' : undefined,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {t.label}
                <span className="c-mono" style={{ fontWeight: 400, opacity: 0.6, marginLeft: 5, fontSize: 9.5 }}>
                  {doneCount(t.key)}/{listFor(t.key).length}
                </span>
              </button>
            )
          })}
        </div>

        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search mics…"
          style={{
            width: '100%', boxSizing: 'border-box', background: 'var(--c-wash)',
            border: 'none', borderRadius: 10, padding: '9px 12px',
            color: 'var(--c-fg)', font: 'inherit', fontSize: 12.5, outline: 'none',
          }}
        />

        {missingMics.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
            background: 'color-mix(in srgb, var(--c-st-hot) 13%, transparent)',
            borderRadius: 10, padding: '7px 11px', fontSize: 10.5, fontWeight: 600,
            color: 'var(--c-st-hot)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--c-st-hot)', flexShrink: 0 }} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {missingMics.slice(0, 2).map(m => `${m.name} — since ${fmtD(prior[m.id].missingSince ?? prior[m.id].date)}`).join(' · ')}
              {missingMics.length > 2 ? ` · +${missingMics.length - 2} more` : ''}
            </span>
          </div>
        )}
      </div>

      {/* ── The sheet ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '2px 14px' }}>
        {activeDef.kind === 'qty' ? (
          activeList.map(m => {
            const qty = quantities[m.id] ?? 0
            return (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', gap: 8, background: 'var(--c-wash)', borderRadius: 9, marginBottom: 3,
              }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0 }}>{m.name}</span>
                <input
                  value={qty === 0 ? '' : String(qty)}
                  onChange={e => setQty(m.id, e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="c-mono"
                  style={{
                    width: 56, minHeight: 34, textAlign: 'center', flexShrink: 0,
                    background: 'var(--c-wash2)', border: 'none', borderRadius: 9,
                    color: 'var(--c-fg)', font: 'inherit', fontSize: 13, fontWeight: 700, outline: 'none',
                  }}
                />
              </div>
            )
          })
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 5 }}>
            {activeList.map(m => {
              const st = checkins[m.id]?.status ?? 'not_checked'
              const room = checkins[m.id]?.room ?? ''
              const ref = refLine(m)
              return (
                // A div, not a <button>: has_qty cells carry an <input>, and
                // interactive content inside a button is invalid HTML.
                <div
                  key={m.id}
                  role="button"
                  onClick={e => onCellTap(m, e)}
                  style={{
                    position: 'relative', font: 'inherit', textAlign: 'left',
                    cursor: 'pointer', borderRadius: 9, padding: '7px 9px 6px', minHeight: 46,
                    WebkitTapHighlightColor: 'transparent', userSelect: 'none',
                    ...cellColors(st),
                  }}
                >
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: st !== 'not_checked' ? 34 : 0 }}>
                    {m.name}
                  </span>
                  {st !== 'not_checked' && (
                    <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 8, fontWeight: 800, letterSpacing: '0.05em' }}>
                      {st === 'here' ? 'HERE' : st === 'room' ? room.replace('Studio ', 'RM ').toUpperCase() : 'MISS'}
                    </span>
                  )}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span style={{
                      flex: 1, minWidth: 0, fontSize: 8.5,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      opacity: st !== 'not_checked' ? 0.55 : ref?.bad ? 1 : 0.4,
                      color: st === 'not_checked' && ref?.bad ? 'var(--c-st-hot)' : undefined,
                      fontWeight: st === 'not_checked' && ref?.bad ? 700 : 400,
                    }}>
                      {ref?.text ?? ' '}
                    </span>
                    {m.has_qty && (
                      // Counted item (Genelecs): qty box in the cell; the cell
                      // around it still taps for HERE/ROOM/MISS.
                      <input
                        value={(quantities[m.id] ?? 0) === 0 ? '' : String(quantities[m.id])}
                        onChange={e => setQty(m.id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="qty"
                        inputMode="numeric"
                        className="c-mono"
                        style={{
                          width: 38, minHeight: 24, textAlign: 'center', flexShrink: 0,
                          background: 'rgba(0,0,0,0.14)', border: 'none', borderRadius: 7,
                          color: 'inherit', font: 'inherit', fontSize: 11, fontWeight: 700, outline: 'none',
                        }}
                      />
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {activeList.length === 0 && (
          <div style={{ padding: '18px 4px', fontSize: 12.5, opacity: 0.5 }}>
            {q ? 'No mics match.' : 'Nothing here.'}
          </div>
        )}

        {/* General notes for the whole inventory (ARS tester, Aug 28). */}
        <div style={{ marginTop: 10 }}>
          <SectionNotes studio={studio} date={today} section="mics" label="Inventory notes" />
        </div>
      </div>

      {/* ── Room / Missing popover (fixed — measured from the tapped cell) ── */}
      {pop && popMic && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: pop.left, top: pop.top, zIndex: 50, width: 236,
            background: 'var(--c-srf, var(--c-bg))', borderRadius: 12,
            boxShadow: 'var(--c-softsh), 0 10px 30px rgba(0,0,0,0.35)',
            padding: 8, display: 'flex', gap: 5, flexWrap: 'wrap',
          }}
        >
          {rooms.map(r => (
            <button
              key={r}
              onClick={() => { mark(pop.micId, 'room', r); setPop(null) }}
              style={{
                border: 'none', font: 'inherit', cursor: 'pointer', borderRadius: 99,
                padding: '7px 11px', minHeight: 32, fontSize: 10.5, fontWeight: 800,
                background: 'var(--c-st-cold)', color: 'var(--c-chip-ink)',
              }}
            >
              {r.replace('Studio ', 'Rm ')}
            </button>
          ))}
          <button
            onClick={() => { mark(pop.micId, 'missing'); setPop(null) }}
            style={{
              border: 'none', font: 'inherit', cursor: 'pointer', borderRadius: 99,
              padding: '7px 11px', minHeight: 32, fontSize: 10.5, fontWeight: 800,
              background: 'var(--c-st-hot)', color: 'var(--c-hot-text)',
            }}
          >
            MISSING
          </button>
          <button
            onClick={() => { mark(pop.micId, 'not_checked'); setPop(null) }}
            style={{
              border: 'none', font: 'inherit', cursor: 'pointer', borderRadius: 99,
              padding: '7px 11px', minHeight: 32, fontSize: 10.5, fontWeight: 700,
              background: 'var(--c-wash2)', color: 'var(--c-fg)',
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Fixed footer ──────────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '12px 14px calc(16px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(to top, var(--c-bg) 68%, transparent)',
        display: 'flex', gap: 9, alignItems: 'center',
      }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <input
            value={initials}
            onChange={e => { dirtyRef.current = true; setInitials(e.target.value.toUpperCase()); if (e.target.value.trim()) setShowInitialsHint(false) }}
            placeholder="Initials"
            maxLength={4}
            className="c-mono"
            style={{
              width: 70, minHeight: 48, padding: '10px 8px',
              background: 'var(--c-wash)', border: 'none', borderRadius: 12,
              color: 'var(--c-fg)', fontSize: 13, textAlign: 'center', outline: 'none',
              boxShadow: 'var(--c-softsh)',
            }}
          />
          {showInitialsHint && (
            <div style={{ position: 'absolute', top: '100%', left: 0, fontSize: 9.5, color: 'var(--c-st-hot)', fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap' }}>
              Required to submit
            </div>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={submitting}
          style={{
            flex: '0 0 26%', minHeight: 48, borderRadius: 14,
            background: 'var(--c-wash)', color: 'var(--c-fg)', opacity: 0.8,
            border: 'none', font: 'inherit', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', boxShadow: 'var(--c-ctlsh, var(--c-softsh))',
          }}
        >
          Save
        </button>
        <button
          onClick={() => { if (!initials.trim()) { setShowInitialsHint(true); return } handleSubmit() }}
          disabled={submitting}
          className="c-control c-raised"
          style={{
            flex: 1, minHeight: 48, borderRadius: 14,
            background: 'var(--c-wash2)', color: 'var(--c-fg)',
            border: 'none', font: 'inherit', fontSize: 13, fontWeight: 800,
            cursor: initials.trim() ? 'pointer' : 'default',
            opacity: initials.trim() ? 1 : 0.55,
            boxShadow: 'var(--c-softsh)',
          }}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>

    </div>
  )
}
