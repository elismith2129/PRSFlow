'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /my-day — the operational workspace (docs/design-refs/my-day-final.html).
//
// Ported from the approved Workbench mock per the port protocol: values come
// from the reference file, not from prose. Mock polarity is inverted (mock dark
// = data-theme="dark"; app dark = the ABSENCE of the attribute), so tokens are
// used directly and no [data-theme] rules are written here.
//
// THE SPLIT — do not blur it:
//   · Dashboard card = the areas to hit + checkboxes. Short. Ships separately.
//   · THIS PAGE      = detail. Duties by cadence, live queues, shift notes, and
//                      (manager only) a read-only billing peek.
//
// RULINGS honoured here (all 2026-08-10):
//   · Plain checkboxes. No roll-up from sub-steps, no auto-completion, no
//     override. sub_items render as grey reference text so a multi-step duty
//     isn't a black box, but there is ONE tick, not five.
//   · Day-scoped duties show only on their day — Friday's work must not clutter
//     Monday's list. The day-before nudge lives in the Flo briefing instead.
//   · Overdue stays IN PLACE and just says so. No band at the top: relocating a
//     late item tells you something is late and then makes you hunt for it.
//   · Indicator vs checkbox — if PRSFlo can determine it, it's a light; only
//     what it can't know is a pill. See QUEUE_STEPS in lib/myday.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { getLocalToday } from '@/lib/time'
import { formatCurrency } from '@/lib/format'
import { fmtTaskTime } from '@/lib/tasks'
import {
  fetchDuties, fetchEntries, buildDutyViews, progressLabel, backlogScopeLabel,
  completeDuty, uncompleteDuty, setDutyCaptured,
  fetchBalancesQueue, fetchHoldsQueue, fetchBookedQueue,
  fetchQueueSteps, setQueueStep, fetchStaffGrid,
  fetchNoteEntries, fetchNoteLog, addNoteEntry, deleteNoteEntry,
  fetchBillingBrief, shortDayLabel, QUEUE_STEPS,
  type MyDayRole, type MyDayDuty, type MyDayEntry, type DutyView,
  type BalanceItem, type QueueBookingItem, type BillingBrief,
  type MyDayNoteEntry, type NoteKind,
} from '@/lib/myday'

type ViewAs = MyDayRole

export default function MyDayPage() {
  const { profile, loading: profileLoading } = useUserProfile()
  const isMobile = useIsMobile()
  const today = getLocalToday()

  const isEli = profile?.email === 'eli@paramountrecording.com'
  const isOwner = isEli || profile?.role === 'owner'

  // Asst managers are here for the SHIFT NOTES only (ruling 2026-08-24: "all
  // admin has access to read and write and submit" the notes). They have no
  // duties or queues — rendering those panels empty would imply they do — so
  // they get a notes-only view of the page. Their entries post onto the
  // manager card.
  const notesOnly = profile?.role === 'asst_manager'

  // Fernando and Aaron land on their own card and get no switch. Eli oversees
  // both, so he gets one — same control the dashboard has.
  const ownRole: ViewAs =
    profile?.role === 'billing' ? 'billing' : 'manager'
  const [viewAs, setViewAs] = useState<ViewAs>('manager')
  const role: ViewAs = isOwner ? viewAs : ownRole

  const [duties, setDuties] = useState<MyDayDuty[]>([])
  const [entries, setEntries] = useState<MyDayEntry[]>([])
  const [balances, setBalances] = useState<BalanceItem[]>([])
  const [holds, setHolds] = useState<QueueBookingItem[]>([])
  const [booked, setBooked] = useState<QueueBookingItem[]>([])
  const [brief, setBrief] = useState<BillingBrief | null>(null)
  const [todayNotes, setTodayNotes] = useState<MyDayNoteEntry[]>([])
  const [noteLog, setNoteLog] = useState<MyDayNoteEntry[]>([])
  const [drafts, setDrafts] = useState<Record<NoteKind, string>>({ session: '', studio: '' })
  const [posting, setPosting] = useState<NoteKind | null>(null)
  const [names, setNames] = useState<Partial<Record<MyDayRole, string>>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    // Notes first — they're the whole page for an asst manager.
    const [tn, lg] = await Promise.all([fetchNoteEntries(today), fetchNoteLog(today)])
    setTodayNotes(tn)
    setNoteLog(lg)
    if (notesOnly) { setLoading(false); return }

    const roleDuties = await fetchDuties(role)
    const [ent, grid] = await Promise.all([
      fetchEntries(roleDuties.map(d => d.id), '2000-01-01' < today ? shift(today, -400) : today, today),
      fetchStaffGrid(1),
    ])
    setDuties(roleDuties)
    setEntries(ent)
    setNames({
      manager: grid.find(g => g.role === 'manager')?.who,
      billing: grid.find(g => g.role === 'billing')?.who,
    })

    // Queues differ by role — each person gets the ones they act on, not all of
    // them. Manager: holds + booked pipeline. Billing: money + holds.
    const [h, bk] = await Promise.all([fetchHoldsQueue(), fetchBookedQueue()])
    setHolds(h)
    setBooked(bk)

    if (role === 'billing') {
      // No needs-a-work-order pane. Work orders are created automatically at
      // booking-save, so in normal operation this is ALWAYS empty — a pane that
      // is permanently zero is furniture, and Aaron would learn to skip past
      // that whole column. When it isn't empty something has broken (a failed
      // create), and a broken thing belongs in the briefing where it gets
      // noticed, not in a list nobody reads. composeBriefing already raises it.
      setBalances(await fetchBalancesQueue())
      setBrief(null)
    } else {
      setBrief(await fetchBillingBrief(today))
      setBalances([])
    }

    setLoading(false)
  }, [role, today, notesOnly])

  useEffect(() => { load() }, [load])

  // Realtime — standing rule: every fetch pairs with a subscription. One channel
  // for the whole surface; four would just be four round-trips to one reload.
  useEffect(() => {
    const ch = supabase
      .channel('myday-workspace')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_entries' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_duties' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_queue_steps' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_note_entries' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function toggleDuty(v: DutyView) {
    if (busy) return
    setBusy(v.duty.id)
    if (v.done) await uncompleteDuty(v.duty.id, today)
    else await completeDuty({
      duty: v.duty, date: today, completedBy: profile?.id ?? null,
      captured: v.entry?.captured, subState: v.entry?.sub_state, entries,
    })
    await load()
    setBusy(null)
  }

  async function saveCapture(v: DutyView, key: string, raw: string) {
    const next = { ...(v.entry?.captured ?? {}) }
    if (raw.trim() === '') delete next[key]
    else next[key] = Number(raw)
    await setDutyCaptured(v.duty.id, today, next)
    await load()
  }

  async function toggleStep(item: QueueBookingItem, step: string) {
    await setQueueStep({
      refType: 'booked', refId: item.bookingId, step,
      checked: !item.steps[step], checkedBy: profile?.id ?? null,
    })
    await load()
  }

  // Notes are an explicit SUBMIT, not a debounced autosave (ruling 2026-08-24).
  // Two managers work the same day — opener and closer — and the old shared-box
  // upsert meant whoever's debounce fired last silently overwrote the other.
  // An appended entry has no clobber window, and the submit is the act of
  // signing the note, like sending the email it replaces.
  async function postNote(kind: NoteKind) {
    if (!profile?.id || posting) return
    const body = drafts[kind].trim()
    if (!body) return
    setPosting(kind)
    const ok = await addNoteEntry({ role, date: today, kind, body, createdBy: profile.id })
    if (ok) setDrafts(d => ({ ...d, [kind]: '' }))
    await load()
    setPosting(null)
  }

  async function removeNote(entry: MyDayNoteEntry) {
    if (!window.confirm('Delete this note?')) return
    await deleteNoteEntry(entry.id)
    await load()
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const views = buildDutyViews(duties, entries, today).filter(v => v.isShown)
  const byCadence = (c: MyDayDuty['cadence']) => views.filter(v => v.duty.cadence === c)

  if (profileLoading) return null

  const whoLabel = notesOnly
    ? (profile?.display_name ?? 'Assistant Manager')
    : (names[role] ?? (role === 'manager' ? 'Studio Manager' : 'Billing'))
  const roleTitle = notesOnly
    ? 'Assistant Manager'
    : (role === 'manager' ? 'Studio Manager' : 'Billing Coordinator')

  const canDeleteNote = (e: MyDayNoteEntry) =>
    !!profile?.id && (e.created_by === profile.id || isOwner)

  const notesPanel = (
    <ShiftNotesPanel
      todayNotes={todayNotes}
      viewRole={role}
      drafts={drafts}
      setDraft={(k, v) => setDrafts(d => ({ ...d, [k]: v }))}
      onPost={postNote}
      posting={posting}
      canDelete={canDeleteNote}
      onDelete={removeNote}
      isMobile={isMobile}
    />
  )

  // Asst manager: notes are the whole page (see `notesOnly` above).
  if (notesOnly) {
    return (
      <div className="c-root">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '2px 4px 14px' }}>
          <div>
            <span className="c-label" style={{ display: 'block', marginBottom: 3 }}>
              {whoLabel} · {roleTitle}
            </span>
            <h1 className="c-arch" style={{ fontSize: isMobile ? 20 : 26, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
              My Day
            </h1>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {notesPanel}
          <NotesLogPanel log={noteLog} />
        </div>
      </div>
    )
  }

  return (
    <div className="c-root">
      {/* HEADER — greeting label over the Archivo title, then the role switch
          (Eli only) and the datechip. Same anatomy as the dashboard (§14b). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '2px 4px 14px', flexWrap: isMobile ? 'wrap' : undefined }}>
        <div>
          <span className="c-label" style={{ display: 'block', marginBottom: 3 }}>
            {whoLabel} · {role === 'manager' ? 'Studio Manager' : 'Billing Coordinator'}
          </span>
          <h1 className="c-arch" style={{ fontSize: isMobile ? 20 : 26, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            My Day
          </h1>
        </div>
        <div style={{ flex: 1 }} />
        {isOwner && !isMobile && (
          <span className="c-seg" style={{ flexShrink: 0 }}>
            <button className={role === 'manager' ? 'c-on' : ''} onClick={() => setViewAs('manager')}>
              {names.manager ?? 'Manager'}
            </button>
            <button className={role === 'billing' ? 'c-on' : ''} onClick={() => setViewAs('billing')}>
              {names.billing ?? 'Billing'}
            </button>
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.25fr 1fr', gap: 12, alignItems: 'start' }}>

        {/* ── LEFT COLUMN: duties, then shift notes underneath ─────────────
            One wrapper so both stay in the same grid cell. Without it the notes
            pane became a THIRD grid child and jumped to the right column. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── DUTIES ──────────────────────────────────────────────────────── */}
        <div className="c-panel">
          <div className="c-lozenge">
            <b>Duties</b>
            <span className="c-ct">{progressLabel(buildDutyViews(duties, entries, today))}</span>
          </div>

          {loading && <div className="c-myday-item"><span className="c-myday-tx" style={{ opacity: 0.5 }}>Loading…</span></div>}

          {!loading && views.length === 0 && (
            <div className="c-myday-item"><span className="c-myday-tx" style={{ opacity: 0.5 }}>Nothing due today.</span></div>
          )}

          {([['daily', 'Today'], ['weekly', 'This week'], ['monthly', 'This month']] as const).map(([cadence, heading]) => {
            const group = byCadence(cadence)
            if (group.length === 0) return null
            return (
              <div key={cadence}>
                <span className="c-label" style={{ display: 'block', padding: '10px 10px 3px' }}>{heading}</span>
                {group.map(v => (
                  <DutyRow
                    key={v.duty.id}
                    v={v}
                    entries={entries}
                    today={today}
                    busy={busy === v.duty.id}
                    onToggle={() => toggleDuty(v)}
                    onCapture={(k, raw) => saveCapture(v, k, raw)}
                  />
                ))}
              </div>
            )
          })}
        </div>

        {/* SHIFT NOTES sit under the duties, not in the right-hand stack
            (Eli, 2026-08-11) — they are part of working your own day, so they
            belong with the list you are working, not with the queues.
            Per-person ENTRIES since 2026-08-24 — see ShiftNotesPanel. */}
        {notesPanel}

        </div>{/* /left column */}

        {/* ── RIGHT STACK ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Manager only: a READ-ONLY peek at billing. Eli oversees the billing
              period but must not be buried in billing work — four numbers, no
              actions. Billing doesn't get this: for them it isn't a summary. */}
          {role === 'manager' && brief && (
            <div className="c-panel">
              <div className="c-lozenge"><b>Billing — this period</b><span className="c-ct">{brief.periodLabel}</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                <Stat n={formatCurrency(String(brief.balancesOutstanding))} k="Balances outstanding" />
                <Stat n={formatCurrency(String(brief.paymentsReceived))} k="Payments received *" />
                <Stat n={brief.codOutstanding ?? '—'} k="COD outstanding" />
                <Stat n={brief.pastDue31 ?? '—'} k="Over 31 days" />
              </div>
              {/* Not a disclaimer for its own sake: a number that silently
                  excludes QuickBooks-only payments would be trusted as a total. */}
              <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 8, padding: '0 3px', lineHeight: 1.5 }}>
                * Payments recorded in PRSFlo only — anything zeroed straight into QuickBooks isn&apos;t counted yet.
              </div>
            </div>
          )}

          {role === 'billing' && (
            <div className="c-panel">
              <div className="c-lozenge">
                <b>Balances</b>
                <span className="c-ct">{formatCurrency(String(balances.reduce((s, b) => s + b.balance, 0)))}</span>
              </div>
              {balances.length === 0 && <div className="c-qrow"><span className="c-who" style={{ opacity: 0.5 }}>Nothing outstanding.</span></div>}
              {balances.slice(0, 8).map(b => (
                <div key={b.workOrderId} className="c-qrow">
                  <span className="c-who">{b.invoiceNumber ? `${b.invoiceNumber} · ` : ''}{b.client}</span>
                  <span className="font-mono" style={{ opacity: 0.6, fontSize: 11 }}>{formatCurrency(String(b.balance))}</span>
                </div>
              ))}
            </div>
          )}

          {/* HOLDS — a bare list, deliberately. "It's all happening in text and
              email. No need to create more work." A checkbox nobody maintains
              goes stale and then lies. */}
          <div className="c-panel">
            <div className="c-lozenge"><b>Holds</b><span className="c-ct">{holds.length}</span></div>
            {holds.length === 0 && <div className="c-qrow"><span className="c-who" style={{ opacity: 0.5 }}>No holds.</span></div>}
            {holds.slice(0, 8).map(h => (
              <div key={h.bookingId} className="c-qrow">
                <span className="c-who">{shortDayLabel(h.date)} · {h.studio} · {h.artist || h.client}</span>
              </div>
            ))}
          </div>

          {role === 'manager' && (
            <div className="c-panel">
              <div className="c-lozenge"><b>Booked pipeline</b><span className="c-ct">{booked.length}</span></div>
              {booked.length === 0 && <div className="c-qrow"><span className="c-who" style={{ opacity: 0.5 }}>Nothing new.</span></div>}
              {booked.slice(0, 8).map(b => (
                <div key={b.bookingId} className="c-qrow">
                  <span className="c-who">{shortDayLabel(b.date)} · {b.studio} · {b.artist || b.client}</span>
                  {/* Derived light — cannot be pressed, cannot be faked. */}
                  <Light on={b.staffed} label="Staff" />
                  {QUEUE_STEPS.booked.map(step => (
                    <button
                      key={step}
                      onClick={() => toggleStep(b, step)}
                      className={`c-mdstep${b.steps[step] ? ' c-on' : ''}`}
                    >{step}</button>
                  ))}
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* NOTES LOG — full width, below everything. The referenceable history
          the "manager notes" email chain used to be (ruling 2026-08-24): every
          submitted note from every role, grouped by day, newest first. */}
      <div style={{ marginTop: 12 }}>
        <NotesLogPanel log={noteLog} />
      </div>
    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** One submitted shift note — body, then author · role · time. */
function NoteBlock({ e, tagRole, onDelete }: {
  e: MyDayNoteEntry
  /** Show which card it was posted from (always on in the log). */
  tagRole?: boolean
  onDelete?: () => void
}) {
  const who = e.author?.display_name || e.author?.initials || 'Staff'
  return (
    <div className="c-mdnote">
      <div className="c-mdnote-body">{e.body}</div>
      <div className="c-mdnote-meta">
        <span>
          {who}
          {tagRole ? ` · ${e.role === 'billing' ? 'Billing' : 'Manager'} · ${e.kind === 'session' ? 'Session' : 'Studio'}` : ''}
          {' · '}{fmtTaskTime(e.created_at)}
        </span>
        {onDelete && (
          <button className="c-x" onClick={onDelete} title="Delete note" style={{ marginLeft: 'auto', fontSize: 13 }}>×</button>
        )}
      </div>
    </div>
  )
}

/** Session + Studio side by side, each: today's entries, then a compose box.
    Explicit Submit — no autosave (see postNote for why). The two composers
    split the panel equally (Eli 2026-08-24: "just fill the space equally"). */
function ShiftNotesPanel({
  todayNotes, viewRole, drafts, setDraft, onPost, posting, canDelete, onDelete, isMobile,
}: {
  todayNotes: MyDayNoteEntry[]
  viewRole: MyDayRole
  drafts: Record<NoteKind, string>
  setDraft: (k: NoteKind, v: string) => void
  onPost: (k: NoteKind) => void
  posting: NoteKind | null
  canDelete: (e: MyDayNoteEntry) => boolean
  onDelete: (e: MyDayNoteEntry) => void
  isMobile: boolean
}) {
  const KINDS: { kind: NoteKind; label: string; ph: string }[] = [
    { kind: 'session', label: 'Session notes', ph: 'Anything the next shift needs to know…' },
    { kind: 'studio', label: 'Studio notes', ph: 'Rooms, gear, maintenance…' },
  ]
  return (
    <div className="c-panel">
      <div className="c-lozenge">
        <b>Shift notes</b>
        <span className="c-ct">{todayNotes.length} today</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, alignItems: 'stretch' }}>
        {KINDS.map(({ kind, label, ph }) => {
          const entries = todayNotes.filter(e => e.kind === kind)
          const empty = drafts[kind].trim() === ''
          return (
            <div key={kind} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span className="c-label" style={{ display: 'block', marginBottom: 5 }}>{label}</span>
              {entries.map(e => (
                <NoteBlock
                  key={e.id}
                  e={e}
                  tagRole={e.role !== viewRole}
                  onDelete={canDelete(e) ? () => onDelete(e) : undefined}
                />
              ))}
              <textarea
                value={drafts[kind]}
                onChange={ev => setDraft(kind, ev.target.value)}
                placeholder={ph}
                className="c-mdnotes"
                style={{ minHeight: 150, flex: 1 }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  className="c-btn"
                  onClick={() => onPost(kind)}
                  disabled={posting === kind || empty}
                  style={{ opacity: empty ? 0.45 : 1, cursor: empty ? 'default' : 'pointer' }}
                >{posting === kind ? 'Submitting…' : 'Submit'}</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Past days' notes, both roles, newest day first — read-only reference. */
function NotesLogPanel({ log }: { log: MyDayNoteEntry[] }) {
  // Group by date, preserving the query's order (date desc, created_at asc).
  const days: { date: string; items: MyDayNoteEntry[] }[] = []
  for (const e of log) {
    const last = days[days.length - 1]
    if (last && last.date === e.date) last.items.push(e)
    else days.push({ date: e.date, items: [e] })
  }
  return (
    <div className="c-panel">
      <div className="c-lozenge"><b>Notes log</b><span className="c-ct">last 30 days</span></div>
      {days.length === 0 && (
        <div className="c-qrow">
          <span className="c-who" style={{ opacity: 0.5 }}>No notes yet — today&apos;s entries appear here tomorrow.</span>
        </div>
      )}
      {days.map(d => (
        <div key={d.date} style={{ marginBottom: 4 }}>
          <span className="c-label" style={{ display: 'block', padding: '8px 6px 3px' }}>{shortDayLabel(d.date)}</span>
          {d.items.map(e => <NoteBlock key={e.id} e={e} tagRole />)}
        </div>
      ))}
    </div>
  )
}

function Stat({ n, k }: { n: string | number; k: string }) {
  return (
    <div className="c-mdstat">
      <div className="c-arch" style={{ fontSize: 19, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: 10, opacity: 0.55, marginTop: 1 }}>{k}</div>
    </div>
  )
}

/** A derived indicator. No pill, no cursor — nothing to press, nothing to fake. */
function Light({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`c-mdind${on ? ' c-on' : ''}`}>
      <i /># {label}
    </span>
  )
}

function DutyRow({
  v, entries, today, busy, onToggle, onCapture,
}: {
  v: DutyView
  entries: MyDayEntry[]
  today: string
  busy: boolean
  onToggle: () => void
  onCapture: (key: string, raw: string) => void
}) {
  const scope = v.backlogDays > 0 ? backlogScopeLabel(v.duty, entries, today) : null
  const late = v.overdueSince !== null

  return (
    <div
      className={`c-myday-item${v.done ? ' c-done' : ''}${late ? ' c-late' : ''}`}
      onClick={onToggle}
      style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}
    >
      <span className="c-myday-bx" />
      <span className="c-myday-tx">
        {v.duty.label}
        {/* Sub-steps are REFERENCE TEXT, not ticks — one checkbox, not five
            (the no-logic ruling). Showing them keeps a multi-step duty from
            being a black box without building the roll-up. */}
        {v.duty.sub_items.length > 0 && !v.done && (
          <div className="c-myday-sub">{v.duty.sub_items.map(s => s.label).join(' · ')}</div>
        )}
        {late && <span className="c-mdscope"> · was due {shortDayLabel(v.overdueSince!)}</span>}
        {scope && <span className="c-mdscope"> · {scope}</span>}
      </span>

      {/* Captured numbers appear once ticked — asking for a count before the
          work is done is asking for a guess. */}
      {v.done && v.duty.captures.map(f => (
        <input
          key={f.key}
          type="number"
          defaultValue={v.entry?.captured?.[f.key] ?? ''}
          placeholder={f.label}
          title={f.label}
          onClick={e => e.stopPropagation()}
          onBlur={e => onCapture(f.key, e.target.value)}
          className="c-tin c-tin-show c-tin-mono"
          style={{ width: 62, fontSize: 10 }}
        />
      ))}

      {late && (
        <span className="c-mdlate">
          {v.overdueDays} day{v.overdueDays === 1 ? '' : 's'} late · ASAP
        </span>
      )}
      {!v.isDue && !v.done && !late && <span className="c-myday-due">Not due today</span>}
    </div>
  )
}

/** Local date shift — mirrors lib/time's noon anchoring to dodge TZ drift. */
function shift(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
