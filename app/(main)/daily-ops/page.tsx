'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /daily-ops — two tabs in the page title, the billing hub's way (spec §17):
//
//   DAILY OPS   one night, four studio cards.
//   FLAGS       components/flags/FlagsView — the old /flags page, moved here
//               unchanged (Eli, 2026-10-05: "we keep adding things to the rail
//               and things get more complicated and get hidden"). A tech sees
//               this tab only.
//
// THE REWORK (Eli, 2026-10-05; mock docs/design-refs/daily-ops-cards-options.html).
// The page used to be a long "Needs you" queue on the left and the four cards
// on the right — and every row of the queue was a red dot on a card, said
// twice. "This is a massive amount of info and some redundant." So:
//
//   · THE QUEUE IS GONE. The cards are the page. A red row on a card is the
//     thing you tap once you have dealt with it — a plain check, no note
//     ("just a simple check, not details"). The check is a daily_ops_reviews
//     row, the same table the queue wrote, so nothing was migrated.
//   · STUDIO TASKS LIVE IN THEIR STUDIO'S CARD ("tasks should be by studio and
//     included in the card"), added from the + in that card.
//   · A MISSED WORK ORDER IS A RED BADGE at the top of that card's lane:
//     "WO not submitted", the room and client, the runner's initials, a check.
//     No session missed → no badge → no space held for it ("I don't foresee
//     this being a huge issue moving forward, just the transition").
//   · EVERY CARD IS ONE FIXED SIZE (CLAUDE.md → Locked Design Conventions).
//     The duties are six rows, always. The ONLY things that vary are the
//     badges and the tasks, and those scroll inside the lane. An empty lane is
//     the same size as a full one. Do not let anything grow a card.
//
// The date pages by ‹ › or swipe, and that paging IS the look-back: last
// Tuesday's card still shows what was missed that night and who checked it.
//
// NOT here: punches (HR), tonight's live status (the dashboard).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, Booking } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useFlagsVersion } from '@/hooks/useFlagsVersion'
import { dbResult } from '@/lib/db'
import { profileInitials } from '@/lib/format'
import { fetchOpenFlags } from '@/lib/flags'
import { fetchNightMissedWorkOrders, type MissedWorkOrder } from '@/lib/unsubmitted'
import { Hint } from '@/components/ui/Hint'
import { RichNoteView, noteText } from '@/components/shared/RichNote'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import { FlagsView } from '@/components/flags/FlagsView'
import {
  isDormantStudio, DutyState, StudioNight, loadNight, markReviewed,
  opsDate, prettyDate, unmarkReviewed,
} from '@/lib/dailyOps'

type StudioTask = {
  id: string
  studio: string
  task: string
  created_by_name: string | null
  created_at: string
  done_at: string | null
  /** Initials of whoever checked it off — runner on the hub, or the office here. */
  done_by: string | null
  assigned_to_name: string | null
  due_time: string | null
}

const DUTY_COLOR: Record<string, string> = {
  done: 'var(--c-st-booked)',
  flagged: 'var(--c-st-warm)',
  missing: 'var(--c-st-hot)',
  // Today only — the day is still running, so "hasn't come in yet" is neutral,
  // not a failure. Red belongs to a day that is over and still has a hole.
  pending: 'var(--c-wash2, var(--c-wash))',
  // Not staffed at all — same neutral dot, different reason.
  dormant: 'var(--c-wash2, var(--c-wash))',
}

// ── THE CARD'S GEOMETRY — fixed, on purpose (see the header). ───────────────
// The duties column is 2 × (20 label + 3 × 26 rows) + 8 between = 204, always.
// Desktop: 16 top padding + head 28 + body (6 + 214 + 10) + foot 38 = 312 — the
// lane sits beside the duties, takes the body's full 214 and scrolls.
// Phone: the lane drops under the duties at its own fixed 176:
// 16 + 28 + (6 + 204 + 12 + 176 + 10) + 38 = 490.
// Change a number here and re-add the sum; nothing else sets a card's size.
const ROW_H = 26
const GROUP_H = 20
const CARD_H = 312
const LANE_H_MOBILE = 176
const CARD_H_MOBILE = 490

/** A name → what fits in a 28px chip. Typed initials pass through. */
function shortName(name: string | null | undefined): string {
  const n = (name ?? '').trim()
  if (!n) return ''
  if (n.length <= 3) return n.toUpperCase()
  return /\s/.test(n) ? profileInitials(n) : n.slice(0, 2).toUpperCase()
}

const ellipsis: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const groupLabel: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
  height: GROUP_H, fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-fg-3)',
}

export default function DailyOpsPage() {
  const { profile, loading: profileLoading } = useUserProfile()
  const isMobile = useIsMobile()
  // A tech has the Flags tab and nothing else here: the cards are runner
  // accountability, which is the office's business (Eli, 2026-10-05).
  const isTech = profile?.role === 'tech'

  const [tab, setTab] = useState<'ops' | 'flags'>('ops')
  // ?tab=flags on mount — the /flags stub, the dashboard's list and Flo's chip
  // all arrive that way. window.location, not useSearchParams (the house
  // pattern: no Suspense boundary to forget).
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get('tab') === 'flags') setTab('flags') } catch {}
  }, [])
  const shown: 'ops' | 'flags' = isTech ? 'flags' : tab
  function pickTab(t: 'ops' | 'flags') {
    setTab(t)
    try { window.history.replaceState(null, '', t === 'flags' ? '/daily-ops?tab=flags' : '/daily-ops') } catch {}
  }

  // The count beside "Flags" — a fact about the word, not a badge. RLS scopes
  // it (a tech counts Tech flags); useFlagsVersion is the shared channel, so
  // this opens no second subscription beside FlagsView's.
  const flagsVersion = useFlagsVersion()
  const [flagCount, setFlagCount] = useState<number | null>(null)
  useEffect(() => {
    if (!profile) return
    let live = true
    fetchOpenFlags().then(f => { if (live) setFlagCount(f.length) })
    return () => { live = false }
  }, [profile, flagsVersion])

  if (profileLoading) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="c-btitle" style={{ fontSize: isMobile ? 20 : 26, padding: '2px 4px 0' }}>
        {!isTech && (
          <button
            className={`c-arch${shown === 'ops' ? ' c-on' : ''}`}
            onClick={() => pickTab('ops')}
            aria-current={shown === 'ops' ? 'page' : undefined}
          >
            Daily Ops
          </button>
        )}
        <button
          className={`c-arch${shown === 'flags' ? ' c-on' : ''}`}
          onClick={() => pickTab('flags')}
          aria-current={shown === 'flags' ? 'page' : undefined}
        >
          Flags
          {flagCount ? <span className="c-btitlen">{flagCount}</span> : null}
        </button>
      </div>

      {shown === 'flags'
        ? <FlagsView />
        : (
          <OpsNight
            me={profile?.display_name || profile?.initials || 'Office'}
            myInitials={profile?.initials || profileInitials(profile?.display_name) || 'Office'}
            isMobile={isMobile}
          />
        )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// The Daily Ops tab — one night, four fixed cards.
// ═════════════════════════════════════════════════════════════════════════════
function OpsNight({ me, myInitials, isMobile }: { me: string; myInitials: string; isMobile: boolean }) {
  const [offset, setOffset] = useState(1)         // 1 = yesterday
  const date = opsDate(offset)
  const isToday = offset === 0

  const [studios, setStudios] = useState<StudioNight[]>([])
  const [tasks, setTasks] = useState<StudioTask[]>([])
  const [missed, setMissed] = useState<MissedWorkOrder[]>([])
  /** daily_ops_reviews for this date: item_key → who. The 'wo:<booking>' keys are read here. */
  const [reviews, setReviews] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [logOpen, setLogOpen] = useState<StudioNight | null>(null)
  const [editBooking, setEditBooking] = useState<Booking | null>(null)
  // The one open "add a task" line — a studio key, or null.
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // Swipe start point for day paging (touch only; buttons on desktop).
  const [touchX, setTouchX] = useState<number | null>(null)

  const load = useCallback(async () => {
    const [night, { data: taskData }, wos] = await Promise.all([
      loadNight(date),
      supabase.from('studio_tasks').select('*').is('deleted_at', null).order('created_at'),
      // Today is a day in progress — a session still running is not a miss.
      isToday ? Promise.resolve([] as MissedWorkOrder[]) : fetchNightMissedWorkOrders(date),
    ])
    setStudios(night.studios)
    setReviews(night.reviews)
    setMissed(wos)
    // Open tasks, plus anything checked off since this day (the old rule).
    const visible = ((taskData ?? []) as StudioTask[]).filter(t => !t.done_at || t.done_at.slice(0, 10) >= date)
    visible.sort((a, b) => Number(!!a.done_at) - Number(!!b.done_at))
    setTasks(visible)
    setLoading(false)
  }, [date, isToday])

  useEffect(() => { setLoading(true); load() }, [load])

  // Realtime — ONE channel for the page, debounced: a work order being edited
  // somewhere else fires a burst of row events, and each load is a dozen reads.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const soon = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => { load() }, 350)
    }
    const channel = supabase
      .channel('daily-ops-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_ops_reviews' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_ops_submissions' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_tasks' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runner_note_posts' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runner_section_notes' }, soon)
      // The badges: a late submit, a Complete WO or a new booking changes them.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_time_rows' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, soon)
      .subscribe()
    return () => {
      if (timer.current) clearTimeout(timer.current)
      supabase.removeChannel(channel)
    }
  }, [load])

  // ── The checks. One row in daily_ops_reviews each; shared by every office seat.
  async function toggleDuty(d: DutyState) {
    if (!d.reviewKey) return
    const key = d.reviewKey
    const was = !!d.reviewed
    setStudios(prev => prev.map(s => ({
      ...s,
      shifts: s.shifts.map(sh => ({
        ...sh,
        duties: sh.duties.map(x => x.reviewKey === key ? { ...x, reviewed: !was, reviewedBy: was ? null : me } : x),
      })),
    })))
    const { error } = was ? await unmarkReviewed(date, key) : await markReviewed(date, key, me)
    if (!dbResult('Saving check', error)) load()
  }

  const woKey = (o: MissedWorkOrder) => `wo:${o.bookingId}`
  async function toggleWo(o: MissedWorkOrder) {
    const key = woKey(o)
    const was = key in reviews
    setReviews(prev => {
      const next = { ...prev }
      if (was) delete next[key]; else next[key] = me
      return next
    })
    const { error } = was ? await unmarkReviewed(date, key) : await markReviewed(date, key, me)
    if (!dbResult('Saving check', error)) load()
  }
  async function openWo(o: MissedWorkOrder) {
    const { data, error } = await supabase.from('bookings').select('*').eq('id', o.bookingId).limit(1)
    if (error) { dbResult('Opening work order', error); return }
    const b = data?.[0] as Booking | undefined
    if (b) setEditBooking(b)
  }

  // ── Tasks — by studio, in that studio's card.
  async function toggleTask(t: StudioTask) {
    const nextDone = t.done_at ? null : new Date().toISOString()
    const nextBy = nextDone ? myInitials : null
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done_at: nextDone, done_by: nextBy } : x))
    const { error } = await supabase.from('studio_tasks').update({ done_at: nextDone, done_by: nextBy }).eq('id', t.id)
    if (!dbResult('Saving task', error)) load()
  }
  async function addTask(studio: string) {
    const text = draft.trim()
    if (!text) { setAddingFor(null); return }
    const { error } = await supabase.from('studio_tasks').insert({ studio, task: text, created_by_name: me })
    if (!dbResult('Adding task', error)) return
    setDraft('')
    load()
  }

  // Forward stops at TODAY (offset 0): the page defaults to the finished day,
  // but the office also wants to watch the current one come in (2026-08-31).
  const goEarlier = () => setOffset(o => o + 1)
  const goLater = () => setOffset(o => Math.max(0, o - 1))

  const card: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 18,
    padding: '16px 18px 0', boxSizing: 'border-box', minWidth: 0,
    height: isMobile ? CARD_H_MOBILE : CARD_H,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  }
  const wash: React.CSSProperties = {
    background: 'var(--c-wash)', border: 'none', borderRadius: 10,
    padding: '9px 12px', color: 'var(--c-fg)', font: 'inherit', fontSize: 12.5, outline: 'none',
  }

  return (
    <>
      <div
        onTouchStart={e => setTouchX(e.touches[0].clientX)}
        onTouchEnd={e => {
          if (touchX === null) return
          const dx = e.changedTouches[0].clientX - touchX
          setTouchX(null)
          // Swipe right → earlier day, swipe left → later (clamped at today).
          if (dx > 50) goEarlier()
          else if (dx < -50) goLater()
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 4px 12px' }}>
          <div style={{ minWidth: 0 }}>
            {/* "Yesterday", not "Last night" — the studios run 24/7
                (terminology ruling, Eli 2026-08-17: day, never night). */}
            <span style={{ fontSize: 16, fontWeight: 700 }}>
              {isToday ? 'Today' : offset === 1 ? 'Yesterday' : prettyDate(date)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--c-fg-3)', marginLeft: 10 }}>
              {offset <= 1 ? prettyDate(date) : ''}{isToday ? ' · still coming in' : ''}
            </span>
            <Hint tip="One card per studio. Left: what the opener and closer owed — green came in, red never did. Right: that studio's tasks, and a red badge for any session whose work order the runner never submitted. Tap a red row or a badge's check once you've dealt with it. ‹ › pages back through earlier days." />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button onClick={goEarlier} aria-label="Earlier day"
              style={{ ...wash, cursor: 'pointer', fontWeight: 700, padding: '7px 14px' }}>‹</button>
            <button onClick={goLater} disabled={isToday} aria-label="Later day"
              style={{ ...wash, cursor: isToday ? 'default' : 'pointer', fontWeight: 700, opacity: isToday ? 0.4 : 1, padding: '7px 14px' }}>›</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          {studios.map(s => {
            // A studio nobody is rostered to (Track — long-term lease, Eli
            // 2026-08-31). The card stays at full size and recedes; anything
            // submitted there still shows. Remove it from DORMANT_STUDIOS and
            // it is a normal studio again.
            const dormant = isDormantStudio(s.studio)
            const sMissed = missed.filter(o => o.slug === s.studio)
            const sTasks = tasks.filter(t => t.studio === s.studio)
            const adding = addingFor === s.studio
            const empty = sMissed.length === 0 && sTasks.length === 0
            return (
              <div key={s.studio} style={dormant ? { ...card, opacity: 0.45 } : card}>
                {/* head — 28 */}
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, height: 28, flexShrink: 0 }}>
                  <span className="c-arch" style={{ fontSize: 17, letterSpacing: '-0.02em' }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--c-fg-3)', minWidth: 0, ...ellipsis }}>
                    {dormant ? 'Long-term lease · not staffed' : s.who}
                  </span>
                </div>

                {/* body — duties | lane (stacked on a phone) */}
                <div style={{
                  flex: 1, minHeight: 0, padding: '6px 0 10px',
                  display: isMobile ? 'flex' : 'grid', flexDirection: 'column',
                  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: isMobile ? 12 : 22,
                }}>
                  {/* OPENER / CLOSER (Eli, 2026-09-01: "breaking it up allows
                      us to distinguish who did it"). Six rows, always. */}
                  <div style={{ flexShrink: 0, minWidth: 0 }}>
                    {s.shifts.map(sh => (
                      <div key={sh.key} style={{ marginTop: sh.key === 'closer' ? 8 : 0 }}>
                        <div style={groupLabel}>
                          <span>{sh.label}</span>
                          <span style={{ letterSpacing: '0.04em', opacity: sh.who === '—' ? 0.6 : 1, minWidth: 0, ...ellipsis }}>{sh.who}</span>
                        </div>
                        {sh.duties.map(d => <DutyRow key={`${sh.key}:${d.key}`} d={d} onToggle={toggleDuty} />)}
                      </div>
                    ))}
                  </div>

                  {/* THE LANE — the only part of a card that varies. It has a
                      fixed box and scrolls inside it; nothing here can grow
                      the card. */}
                  <div style={{
                    minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column',
                    height: isMobile ? LANE_H_MOBILE : undefined, flexShrink: 0,
                    boxShadow: isMobile ? '0 -1px 0 var(--c-wash)' : '-1px 0 0 var(--c-wash)',
                    padding: isMobile ? '8px 0 0' : '0 0 0 20px',
                  }}>
                    <div style={{ ...groupLabel, flexShrink: 0 }}>
                      {adding ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={e => setDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') addTask(s.studio)
                            if (e.key === 'Escape') { setDraft(''); setAddingFor(null) }
                          }}
                          onBlur={() => { if (!draft.trim()) setAddingFor(null) }}
                          placeholder={`Task for ${s.label}… Enter to add`}
                          style={{
                            flex: 1, minWidth: 0, height: GROUP_H, boxSizing: 'border-box', background: 'var(--c-wash)', border: 'none',
                            borderRadius: 6, padding: '0 8px', color: 'var(--c-fg)', font: 'inherit', fontSize: 11.5, fontWeight: 500,
                            letterSpacing: 0, textTransform: 'none', outline: 'none',
                          }}
                        />
                      ) : <span>Tasks</span>}
                      {!dormant && (
                        <button
                          // mousedown, not click: the input's blur fires first and
                          // would close the line before a click could toggle it.
                          onMouseDown={e => { e.preventDefault(); setDraft(''); setAddingFor(adding ? null : s.studio) }}
                          aria-label={adding ? 'Close' : `Add a task for ${s.label}`}
                          title={adding ? 'Close' : `Leave a task for whoever opens ${s.label}`}
                          style={{
                            width: 18, height: 18, borderRadius: 99, flexShrink: 0, border: 'none', cursor: 'pointer', font: 'inherit',
                            background: 'var(--c-wash2)', color: 'var(--c-fg-2)', fontSize: 13, lineHeight: '18px', padding: 0,
                            letterSpacing: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >{adding ? '×' : '+'}</button>
                      )}
                    </div>
                    <div style={{
                      flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 14, marginTop: 2,
                      scrollbarWidth: 'thin',
                      // A soft bottom edge, so a list that runs on reads as "more below".
                      WebkitMaskImage: 'linear-gradient(#000 calc(100% - 16px), transparent)',
                      maskImage: 'linear-gradient(#000 calc(100% - 16px), transparent)',
                    }}>
                      {sMissed.map(o => (
                        <WoBadge
                          key={`${o.bookingId}-${o.date}`}
                          o={o}
                          handledBy={woKey(o) in reviews ? (reviews[woKey(o)] ?? '') : null}
                          onOpen={() => openWo(o)}
                          onToggle={() => toggleWo(o)}
                        />
                      ))}
                      {sTasks.map(t => <TaskRow key={t.id} t={t} onToggle={() => toggleTask(t)} />)}
                      {empty && (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, color: 'var(--c-fg-3)', opacity: 0.6 }}>
                          {loading ? '' : dormant ? 'Not staffed' : 'No tasks'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* foot — 38: the day's shift notes, one line */}
                <div
                  onClick={s.entries.length > 0 ? () => setLogOpen(s) : undefined}
                  style={{
                    height: 38, flexShrink: 0, margin: '0 -18px', padding: '0 18px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    boxShadow: '0 -1px 0 var(--c-wash)', fontSize: 11.5, color: 'var(--c-fg-3)',
                    cursor: s.entries.length > 0 ? 'pointer' : undefined,
                  }}
                >
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    Notes{s.entries.length > 0 ? ` · ${s.entries.length}` : ''}
                  </span>
                  {s.entries.length > 0 ? (
                    <>
                      <span style={{ flex: 1, minWidth: 0, color: 'var(--c-fg-2)', ...ellipsis }}>
                        {s.entries[0].author_name}: {noteText(s.entries[0].text)}
                      </span>
                      <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>View →</span>
                    </>
                  ) : (
                    <span style={{ flex: 1, minWidth: 0, fontStyle: 'italic', opacity: 0.7 }}>No shift notes</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Shift-notes popup — the full day */}
      {logOpen && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setLogOpen(null) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10001,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div style={{
            width: 'min(560px, 92vw)', maxHeight: '80vh', overflowY: 'auto',
            background: 'var(--c-srf, var(--c-bg))', color: 'var(--c-fg)',
            borderRadius: 20, boxShadow: 'var(--c-softsh)', padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="c-arch" style={{ fontSize: 17 }}>{logOpen.label} · shift notes</span>
              <span style={{ fontSize: 11.5, opacity: 0.5 }}>{prettyDate(date)}</span>
            </div>
            {logOpen.entries.map((e, i) => (
              <div key={e.id} style={{ padding: '10px 0', boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined }}>
                <div className="c-mono" style={{ fontSize: 10.5, fontWeight: 800, opacity: 0.5, marginBottom: 4 }}>
                  {e.author_name.toUpperCase()}{e.role ? ` · ${e.role.toUpperCase()}` : ''} · {new Date(e.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
                <RichNoteView html={e.text} style={{ fontSize: 12.5, lineHeight: 1.6 }} />
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setLogOpen(null)} style={{ ...wash, background: 'var(--c-wash2)', fontWeight: 700, cursor: 'pointer', padding: '9px 18px' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* A badge opens its work order right here — the same popup the
          dashboard and the calendar use. */}
      {editBooking && (
        <WorkOrderPopup
          booking={editBooking}
          onClose={() => { setEditBooking(null); load() }}
          onSaved={() => { load() }}
        />
      )}
    </>
  )
}

// ── a duty: dot · label · detail. A MISSING one is the row you tap. ──────────
function DutyRow({ d, onToggle }: { d: DutyState; onToggle: (d: DutyState) => void }) {
  const missing = d.state === 'missing'
  const handled = missing && !!d.reviewed
  const tappable = missing && !!d.reviewKey
  return (
    <div
      onClick={tappable ? () => onToggle(d) : undefined}
      title={handled
        ? `Handled${d.reviewedBy ? ` · ${d.reviewedBy}` : ''} — tap to undo`
        : tappable ? 'Tap once you have dealt with it' : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 9, height: ROW_H, fontSize: 12.5, cursor: tappable ? 'pointer' : undefined }}
    >
      {handled ? (
        // Handled: the dot itself becomes the check — no extra control on the row.
        <span style={{
          width: 13, height: 13, margin: '0 -3px', borderRadius: 99, flexShrink: 0, boxSizing: 'border-box',
          boxShadow: 'inset 0 0 0 1.5px var(--c-fg-3)', color: 'var(--c-fg-3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800,
        }}>✓</span>
      ) : (
        <span style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0, background: DUTY_COLOR[d.state] ?? 'var(--c-wash2)' }} />
      )}
      <span style={{ flexShrink: 0, fontWeight: missing && !handled ? 700 : 500, color: handled ? 'var(--c-fg-3)' : undefined }}>{d.label}</span>
      <span style={{
        flex: 1, minWidth: 0, textAlign: 'right', fontSize: 10.5, ...ellipsis,
        color: missing && !handled ? 'var(--c-st-hot)' : 'var(--c-fg-3)',
      }}>{d.detail}</span>
    </div>
  )
}

// ── "WO not submitted" — the wording is Eli's, 2026-10-05; don't shorten it. ─
function WoBadge({ o, handledBy, onOpen, onToggle }: {
  o: MissedWorkOrder
  /** null = open; a string (possibly empty) = checked, by that name. */
  handledBy: string | null
  onOpen: () => void
  onToggle: () => void
}) {
  const handled = handledBy !== null
  const whoTip = o.whoSource === 'saved'
    ? `${o.who} was the last runner to save this work order that day`
    : o.whoSource === 'closer'
      ? `${o.who} filed the closing checklist that day — no runner saved this work order`
      : 'No runner opened this work order and nobody filed a closing checklist'
  return (
    <div
      onClick={onOpen}
      title={`${o.woNumber ? `${o.woNumber} · ` : ''}Tap to open the work order${o.covered ? ' · the office has since completed or reviewed it' : ''}`}
      style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', columnGap: 8, alignItems: 'center',
        height: 42, boxSizing: 'border-box', marginBottom: 5, borderRadius: 10, padding: '0 7px 0 11px', cursor: 'pointer',
        background: handled ? 'var(--c-wash)' : 'var(--c-st-hot)',
        color: handled ? 'var(--c-fg-3)' : 'var(--c-hot-text)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, lineHeight: 1.25, ...ellipsis }}>WO not submitted</div>
        <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.25, opacity: 0.85, ...ellipsis }}>{o.room} · {o.client}</div>
      </div>
      <span
        className="c-mono"
        title={whoTip}
        style={{
          minWidth: 28, height: 22, boxSizing: 'border-box', padding: '0 7px', borderRadius: 99, fontSize: 10.5, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: handled ? 'var(--c-wash2)' : 'rgba(0,0,0,0.2)',
        }}
      >{shortName(o.who) || '?'}</span>
      <button
        onClick={e => { e.stopPropagation(); onToggle() }}
        aria-label={handled ? 'Mark not handled' : 'Mark handled'}
        title={handled ? `Handled${handledBy ? ` · ${handledBy}` : ''} — tap to undo` : 'Tap once you have dealt with it'}
        style={{
          width: 22, height: 22, borderRadius: 99, border: 'none', cursor: 'pointer', font: 'inherit', padding: 0,
          fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: handled ? 'var(--c-st-booked)' : 'rgba(0,0,0,0.2)',
          color: handled ? 'var(--c-chip-ink)' : 'transparent',
        }}
      >✓</button>
    </div>
  )
}

// ── a studio task: the runner checks it on the hub, the office can here. ─────
function TaskRow({ t, onToggle }: { t: StudioTask; onToggle: () => void }) {
  const done = !!t.done_at
  const meta = [t.created_by_name ? `from ${t.created_by_name}` : null, t.assigned_to_name ? `for ${t.assigned_to_name}` : null].filter(Boolean).join(' · ')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: ROW_H, fontSize: 12.5 }}>
      <button
        onClick={onToggle}
        aria-label={done ? 'Mark not done' : 'Mark done'}
        style={{
          width: 17, height: 17, borderRadius: 99, flexShrink: 0, border: 'none', cursor: 'pointer', font: 'inherit', padding: 0,
          fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: done ? 'var(--c-st-booked)' : 'transparent',
          boxShadow: done ? undefined : 'inset 0 0 0 1.5px var(--c-fg-3)',
          color: done ? 'var(--c-chip-ink)' : 'transparent',
        }}
      >✓</button>
      <span
        title={meta ? `${t.task} — ${meta}` : t.task}
        style={{ flex: 1, minWidth: 0, ...ellipsis, opacity: done ? 0.45 : 1, textDecoration: done ? 'line-through' : undefined }}
      >{t.task}</span>
      {done ? (
        <span className="c-mono" style={{ fontSize: 9.5, color: 'var(--c-fg-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {[t.done_by, new Date(t.done_at!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })].filter(Boolean).join(' ')}
        </span>
      ) : t.due_time ? (
        <span className="c-mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-st-warm)', flexShrink: 0 }}>{t.due_time}</span>
      ) : null}
    </div>
  )
}
