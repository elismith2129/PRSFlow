'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import type { Booking } from '@/lib/supabase'
import { opsToday, dayPartLabel } from '@/lib/time'
import { RunnerNotesChannel } from '@/components/runner/RunnerNotesChannel'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useReloadOnReturn } from '@/hooks/useReloadOnReturn'
import { dbResult } from '@/lib/db'
import { SessionCardBody, sessionFillClass, initials } from '@/components/calendar/SessionCard'
import { Hint, useHints, setHintsEnabled } from '@/components/ui/Hint'



const STUDIO_META: Record<string, { label: string; abbr: string }> = {
  paramount: { label: 'Paramount', abbr: 'PRS' },
  ameraycan: { label: 'Ameraycan', abbr: 'ARS' },
  encore: { label: 'Encore', abbr: 'ERS' },
  track: { label: 'Track', abbr: 'TRS' },
}
const STUDIO_ORDER = ['paramount', 'ameraycan', 'encore', 'track'] as const

// `today` is the runner's own question — "have I turned in yet?" — derived from
// today's studio_time_rows statuses. The WO's open/completed lifecycle is the
// OFFICE's state and only shows here once completed (Eli, 2026-08-16).
type WOStatus = { id: string; status: string; today?: 'none' | 'submitted' | 'approved' } | null

// Studio tasks (spec §15b): left by the office on a STUDIO, checked off by
// whoever is on shift. Never assigned to a person — runners rotate.
type StudioTask = {
  id: string
  studio: string
  task: string
  created_by_name: string | null
  created_at: string
  done_at: string | null
}

export default function StudioDailyOpsPage() {
  const router = useRouter()
  const hintsOn = useHints()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio, abbr: '?' }

  const [bookings, setBookings] = useState<Booking[]>([])
  const [woMap, setWoMap] = useState<Record<string, WOStatus>>({})
  const [loading, setLoading] = useState(true)
  const [submittedCategories, setSubmittedCategories] = useState<Set<string>>(new Set())
  const [tasks, setTasks] = useState<StudioTask[]>([])

  // THE OPERATIONAL DAY, not the calendar's (2026-08-28): rolls at 8:50 AM,
  // so after midnight the night's sessions/WOs stay on the hub for money
  // math and hour edits, and submissions file under the night they belong to.
  const today = opsToday()
  const { profile: hubProfile } = useUserProfile()

  // The quiet register (punch / guide / manual / report-a-bug) MOVED to the
  // /runner landing (Eli, 2026-09-02): those things are studio-agnostic, and
  // runners float — the studio hub keeps only what belongs to THIS studio.
  // The one-landing remembered-studio bounce died in the same ruling (see
  // app/runner/page.tsx), so this page no longer writes
  // 'prsflo-runner-studio'.

  const load = useCallback(async () => {
    // ── Today ──────────────────────────────────────────────────────────────
    const { data: bData } = await supabase
      .from('bookings')
      .select('*')
      .lte('start_date', today)
      .gte('end_date', today)
      .eq('status', 'confirmed')
      .order('from_time', { ascending: true })

    const filtered = (bData ?? []).filter((b: Booking) => {
      const loc = (b.location ?? '').toLowerCase()
      return loc.includes(studio) || loc.includes(meta.abbr.toLowerCase())
    })
    setBookings(filtered)

    if (filtered.length > 0) {
      // ── Resolving a booking card → its work order ────────────────────────
      // Since the July 2026 rebuild the WO is the source of truth and `bookings`
      // rows are PROJECTION CARDS it writes on save — one per consecutive
      // same-room run, ALL carrying `work_order_id`. But `work_orders.booking_id`
      // points at only ONE of them (the original).
      //
      // So the old lookup — "which WO has booking_id = this card?" — resolved
      // for the original card and silently failed for every other one, sending
      // the runner to /wo/new and the dead-end "Work order not yet created"
      // screen. Any multi-day or multi-room session hit it.
      //
      // Read the card's OWN forward link first; keep the reverse link as a
      // fallback for pre-rebuild rows whose work_order_id was never populated.
      const bookingIds = filtered.map((b: Booking) => b.id)
      const woIds = Array.from(
        new Set(filtered.map((b: Booking) => b.work_order_id).filter(Boolean)),
      ) as string[]

      const [byWoId, byBookingId] = await Promise.all([
        woIds.length
          ? supabase.from('work_orders').select('id, status').in('id', woIds)
          : Promise.resolve({ data: [] as { id: string; status: string }[] }),
        supabase
          .from('work_orders')
          .select('id, booking_id, status, created_at')
          .in('booking_id', bookingIds)
          .order('created_at', { ascending: true }),
      ])

      const woById: Record<string, WOStatus> = {}
      for (const wo of byWoId.data ?? []) woById[wo.id] = { id: wo.id, status: wo.status }

      const legacyByBooking: Record<string, WOStatus> = {}
      for (const wo of byBookingId.data ?? []) {
        // First-wins (earliest created): deterministic if legacy duplicate WOs
        // exist, and the same row the WO page adopts when the card is tapped.
        if (wo.booking_id && !legacyByBooking[wo.booking_id]) {
          legacyByBooking[wo.booking_id] = { id: wo.id, status: wo.status }
        }
      }

      const map: Record<string, WOStatus> = {}
      for (const b of filtered) {
        const found = (b.work_order_id ? woById[b.work_order_id] : undefined)
          ?? legacyByBooking[b.id]
        if (found) map[b.id] = found
      }

      // Today's submit state per WO (the pill): all approved → approved, all
      // sent (submitted or approved) → submitted, anything else → none.
      const allWoIds = Array.from(new Set(Object.values(map).map(w => w!.id)))
      if (allWoIds.length > 0) {
        const { data: stStatus } = await supabase
          .from('studio_time_rows')
          .select('work_order_id, status')
          .eq('date', today)
          .in('work_order_id', allWoIds)
        const byWo: Record<string, string[]> = {}
        for (const r of stStatus ?? []) {
          (byWo[r.work_order_id] = byWo[r.work_order_id] ?? []).push(r.status ?? 'in_progress')
        }
        for (const key of Object.keys(map)) {
          const sts = byWo[map[key]!.id] ?? []
          map[key]!.today = sts.length > 0 && sts.every(s => s === 'approved') ? 'approved'
            : sts.length > 0 && sts.every(s => s === 'submitted' || s === 'approved') ? 'submitted'
            : 'none'
        }
      }
      setWoMap(map)
    } else {
      setWoMap({})
    }

    setLoading(false)

    const [{ data: checklistData }, { data: opsData }] = await Promise.all([
      supabase
        .from('checklists')
        .select('type, completed_at')
        .eq('studio', studio)
        .eq('date', today),
      supabase
        .from('daily_ops_submissions')
        .select('category, submitted_at')
        .eq('studio', studio)
        .eq('date', today),
    ])
    const submitted = new Set([
      ...(checklistData ?? [])
        .filter((s: { type: string; completed_at: string | null }) => s.completed_at !== null)
        .map((s: { type: string }) => s.type),
      ...(opsData ?? [])
        .filter((s: { category: string; submitted_at: string | null }) => s.submitted_at !== null)
        .map((s: { category: string }) => s.category),
    ])
    setSubmittedCategories(submitted)

    // ── Studio tasks (§15b) — open ones + anything checked off today ────────
    const { data: taskData } = await supabase
      .from('studio_tasks')
      .select('*')
      .eq('studio', studio)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    const visibleTasks = ((taskData ?? []) as StudioTask[]).filter(
      t => !t.done_at || t.done_at.slice(0, 10) === today,
    )
    // Open tasks first, done-today sink to the bottom of the section.
    visibleTasks.sort((a, b) => Number(!!a.done_at) - Number(!!b.done_at))
    setTasks(visibleTasks)

    // (The shift-note count fetch left with its tile, 2026-09-01 — the runner
    // notes channel at the bottom of the page owns its own data now.)
  }, [studio, today, meta.abbr]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load
  useEffect(() => { load() }, [load])

  // iOS suspends the realtime socket while the phone is locked/backgrounded and
  // missed events are never replayed — re-fetch on return so a session added or
  // confirmed while the phone was asleep appears without a manual refresh.
  useReloadOnReturn(load)

  // Real-time: studio tasks — the office can drop a task mid-shift and the
  // opener's phone updates without a refresh (hard rule: fetch pairs w/ channel).
  useEffect(() => {
    const channel = supabase
      .channel(`runner-tasks-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_tasks' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studio, load])

  // Check a task off (or un-check a same-shift mistake). Optimistic, verified.
  async function toggleTask(t: StudioTask) {
    const nextDone = t.done_at ? null : new Date().toISOString()
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done_at: nextDone } : x))
    const { error } = await supabase
      .from('studio_tasks')
      .update({ done_at: nextDone })
      .eq('id', t.id)
    if (!dbResult('Saving task', error)) load()
  }

  // Real-time: re-run load on any booking change. (shift_note_docs left this
  // channel with its tile, 2026-09-01 — RunnerNotesChannel subscribes to the
  // posts table itself.)
  useEffect(() => {
    const channel = supabase
      .channel(`runner-bookings-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studio, load])

  // Real-time: re-run load when a WO for today is updated (e.g. admin approves)
  useEffect(() => {
    console.log(`[RT] Subscribing to work_orders on /runner/${studio}, filter: session_date=eq.${today}`)
    const channel = supabase
      .channel(`runner-wos-${studio}-${today}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'work_orders',
        filter: `session_date=eq.${today}`,
      }, (payload) => {
        console.log(`[RT] Real-time event received on /runner/${studio}, work_orders:`, payload)
        load()
      })
      // The pill derives from today's row statuses — a runner Submit or an
      // office approval must flip it live (same table drives the WO's dots).
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_time_rows' }, () => { load() })
      .subscribe((status, err) => {
        console.log(`[RT] work_orders subscription status on /runner/${studio}:`, status, err ?? '')
      })
    return () => {
      console.log(`[RT] Unsubscribing from work_orders on /runner/${studio}`)
      supabase.removeChannel(channel)
    }
  }, [studio, today, load])


  // ── Presentation ───────────────────────────────────────────────────────────
  // SOFT SKIN PORT, 2026-08-13 (spec §15, option A "Day card"). Everything above
  // this line — the queries, the booking→WO resolution, both realtime channels —
  // is UNTOUCHED. This half was the old skin: legacy --bg/--surface tokens, 1px
  // borders everywhere (Law 1), DM Serif Display and Syne (both retired, §4),
  // per-studio colour, and emoji tiles.
  //
  // Phone-first: every tap target clears 44px, nothing scrolls sideways.

  /** The work order's state, as a status pill. Same three cases as before. */
  // The pill answers the RUNNER's question — "have I turned in today?" — not
  // the office's. It used to show the WO lifecycle ('open'/'completed'), and
  // "OPEN" meant nothing to a runner (Eli, 2026-08-16). Completed still wins:
  // once the office closes the WO into billing, that outranks tonight's state.
  function woPill(wo: WOStatus) {
    if (!wo) return <span className="c-pill" style={dimPill}>No WO</span>
    if (wo.status === 'completed') {
      return <span className="c-pill c-fill-booked">Completed</span>
    }
    if (wo.today === 'approved') return <span className="c-pill c-fill-booked">Approved</span>
    if (wo.today === 'submitted') return <span className="c-pill c-fill-warm">Submitted</span>
    return <span className="c-pill" style={dimPill}>Not submitted</span>
  }

  const dimPill: React.CSSProperties = {
    background: 'var(--c-wash2)', color: 'var(--c-fg)', opacity: 0.7,
  }

  // A card surface. Flat + soft shadow (§7c) — no carving, no borders.
  const surface: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))',
    boxShadow: 'var(--c-softsh)',
    borderRadius: 18,
    padding: '13px 14px',
  }

  const TILES = [
    { label: 'Opening checklist', route: `/runner/${studio}/checklist/opening`, category: 'opening' },
    { label: 'Closing checklist', route: `/runner/${studio}/checklist/closing`, category: 'closing' },
    { label: 'Mic inventory', route: `/runner/${studio}/mics`, category: 'mic_inventory' },
    { label: 'Petty cash', route: `/runner/${studio}/petty-cash`, category: 'petty_cash' },
    { label: 'Stock list', route: `/runner/${studio}/stock`, category: 'stock' },
    // Shift notes left the tiles 2026-09-01 — the runner notes CHANNEL lives
    // inline at the bottom of this page now (view + write in one place,
    // RunnerNotesChannel), so a tile to a second surface would be the exact
    // two-buttons problem Eli asked to remove.
  ]

  return (
    <div style={{
      minHeight: '100dvh',
      maxWidth: '100vw',
      overflowX: 'hidden',
      background: 'var(--c-bg)',
      color: 'var(--c-fg)',
      paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '14px 16px 10px',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--c-bg)',
      }}>
        <button
          onClick={() => router.push('/runner')}
          aria-label="Back to studio list"
          className="c-control c-raised"
          style={{
            width: 38, height: 38, borderRadius: 99, flexShrink: 0,
            background: 'var(--c-wash)', color: 'var(--c-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, cursor: 'pointer',
          }}
        >←</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="c-arch" style={{ fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {meta.label}
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            {/* Whose session this tablet is — visible on every hub visit, so a
                wrong identity gets noticed before anything is filed under it. */}
            {hubProfile?.display_name ? ` · ${hubProfile.display_name}` : ''}
          </div>
        </div>
        {/* Studio switcher (one-landing merge): floating runners move studios
            in one tap, no picker round-trip. Switching re-remembers. */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {STUDIO_ORDER.map(k => {
            const on = k === studio
            return (
              <button
                key={k}
                onClick={() => { if (!on) router.push(`/runner/${k}`) }}
                aria-label={STUDIO_META[k].label}
                style={{
                  minWidth: 34, minHeight: 30, borderRadius: 99,
                  padding: '0 7px',
                  background: on ? 'var(--c-wash2)' : 'transparent',
                  color: 'var(--c-fg)', opacity: on ? 1 : 0.45,
                  border: 'none', font: 'inherit',
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.04em',
                  cursor: on ? 'default' : 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {STUDIO_META[k].abbr}
              </button>
            )
          })}
          {/* Helpful-hints toggle (Eli, 2026-08-17) — runners get the same
              coach marks as the office; this is their on/off. */}
          <button
            onClick={() => setHintsEnabled(!hintsOn)}
            aria-label="Toggle helpful hints"
            style={{
              minWidth: 30, minHeight: 30, borderRadius: 99, padding: '0 5px',
              background: hintsOn ? 'var(--c-wash2)' : 'transparent',
              opacity: hintsOn ? 1 : 0.4, border: 'none', font: 'inherit',
              fontSize: 13, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >💡</button>
        </div>
      </div>

      <div style={{ padding: '4px 14px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Studio tasks (§15b — option A · Sections) ───────────────────── */}
        {/* Above sessions: the opener's first question walking in is "anything
            waiting for me". A studio with no OPEN tasks skips the section. */}
        {/* Slimmed 2026-08-14 (Eli: "too big and there may be multiple") —
            tighter paddings, single-line rows, meta inline after the task. */}
        {tasks.some(t => !t.done_at) && (
          <div style={{ ...surface, padding: '8px 12px' }}>
            <div className="c-label" style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 7 }}>
              From the office
              <span className="c-pill c-fill-warm">{tasks.filter(t => !t.done_at).length}</span>
            </div>
            {tasks.map((t, i) => (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0',
                boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
              }}>
                <button
                  onClick={() => toggleTask(t)}
                  aria-label={t.done_at ? 'Mark not done' : 'Mark done'}
                  style={{
                    width: 22, height: 22, borderRadius: 99, flexShrink: 0,
                    background: t.done_at ? 'var(--c-st-booked)' : 'var(--c-wash2)',
                    color: t.done_at ? 'var(--c-chip-ink)' : 'var(--c-fg)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, cursor: 'pointer', border: 'none', font: 'inherit',
                  }}
                >{t.done_at ? '✓' : ''}</button>
                <div style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{
                    fontSize: 12.5, fontWeight: 700,
                    opacity: t.done_at ? 0.4 : 1,
                    textDecoration: t.done_at ? 'line-through' : undefined,
                  }}>{t.task}</span>
                  <span style={{ fontSize: 10.5, opacity: 0.45, marginLeft: 7 }}>
                    {t.done_at
                      ? `done ${new Date(t.done_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                      : t.created_by_name ?? ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Today's sessions ────────────────────────────────────────────── */}
        <div>
          <div className="c-label" style={{ marginBottom: 9 }}>
            Today{!loading && ` · ${bookings.length} ${bookings.length === 1 ? 'session' : 'sessions'}`}
            <Hint tip="Tap a session card to open its work order — times, staff, equipment, and payments all go there. You can keep fixing your day until the office approves it." />
          </div>

          {loading ? (
            <div style={{ ...surface, textAlign: 'center', opacity: 0.5, fontSize: 13, padding: 28 }}>
              Loading…
            </div>
          ) : bookings.length === 0 ? (
            <div style={{ ...surface, textAlign: 'center', opacity: 0.5, fontSize: 13, padding: 28 }}>
              No sessions today
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {bookings.map(b => {
                const wo = woMap[b.id] ?? null
                return (
                  <div key={b.id}>
                    {/* The ROOM is still the hero — a runner's first question on
                        any card is "which one". It sits above the chip, with the
                        WO state pill; the chip itself is the ONE shared session
                        card (spec §10b), so colour coding and info match the
                        calendar exactly — just bigger (`large`). */}
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 5, padding: '0 2px' }}>
                      <div className="c-arch" style={{ fontSize: 17, letterSpacing: '-0.02em', lineHeight: 1.1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.studio || '—'}
                      </div>
                      {woPill(wo)}
                    </div>
                    <div
                      onClick={() => {
                        if (wo) router.push(`/runner/${studio}/wo/${wo.id}`)
                        else router.push(`/runner/${studio}/wo/new?booking_id=${b.id}`)
                      }}
                      className={`c-ev c-control c-raised-chip ${sessionFillClass(b.status)}`}
                      style={{
                        // GRID, not flex-column (fix 2026-08-16): .c-evbody uses
                        // height: 100%, which resolves to AUTO against a flex
                        // parent whose height comes from min-height — so the body
                        // sat a few px short of the chip and the chip's green
                        // showed as a sliver UNDER the red COD strip. A grid
                        // item stretches to the track by default, so the body
                        // fills the chip and the COD strip IS the bottom edge.
                        padding: 0, overflow: 'hidden', cursor: 'pointer',
                        display: 'grid',
                        minHeight: 84, WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      <SessionCardBody
                        booking={b}
                        height={90}
                        large
                        eng={initials(b.engineer_name)}
                        asst={initials(b.assistant_name)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── This morning / Today / Tonight — the studio runs 24/7 (Eli,
            2026-08-15), so the label tracks the clock via dayPartLabel. */}
        <div>
          <div className="c-label" style={{ marginBottom: 9 }}>{dayPartLabel()}
            <Hint tip="Everything here saves as you tap — no save button. Found a problem? Use needs-attention with a note and photo; that reports it to the office automatically. Submitted-with-a-problem always beats never-submitted." />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            {TILES.map(t => {
              const done = submittedCategories.has(t.category)
              const statusText = done ? 'Submitted' : 'Not started'
              return (
                <button
                  key={t.route}
                  onClick={() => router.push(t.route)}
                  style={{
                    ...surface,
                    minHeight: 72,
                    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                    textAlign: 'left', cursor: 'pointer', color: 'var(--c-fg)',
                    border: 'none', font: 'inherit',
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t.label}</span>
                  {/* Status is the only colour on this surface (§5) — done is
                      booked-green, everything else is just quiet text. */}
                  <span style={{
                    fontSize: 10, marginTop: 4,
                    color: done ? 'var(--c-st-booked)' : 'var(--c-fg)',
                    opacity: done ? 1 : 0.45,
                    fontWeight: done ? 700 : 400,
                  }}>
                    {statusText}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Runner notes — the channel (Eli, 2026-09-01, option A of
            runner-notes-options.html). View + write in ONE place: every note
            ever, pure submit order, composer underneath. Replaced the Shift
            notes tile + page. */}
        <div>
          <div className="c-label" style={{ marginBottom: 9 }}>
            Runner notes
            <Hint tip="One running channel for this studio — like the old Slack. Every note ever posted lives here, newest first. Type, pick your shift, add a photo if it helps, Send. Your typing and photos are kept even if the app closes before you send." />
          </div>
          <RunnerNotesChannel studio={studio} />
        </div>

        {/* The quiet register (punch / guide / manual / report-a-bug) lives on
            the /runner landing now (2026-09-02) — studio-agnostic things left
            this studio's page. */}

      </div>
    </div>
  )
}
