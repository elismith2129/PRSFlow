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

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { getLocalToday, opsToday } from '@/lib/time'
import { formatCurrency } from '@/lib/format'
import { fmtTaskTime } from '@/lib/tasks'
import { RichNoteEditor, RichNoteView, noteIsEmpty } from '@/components/shared/RichNote'
import {
  fetchDuties, fetchEntries, buildDutyViews, progressLabel, backlogScopeLabel,
  completeDuty, uncompleteDuty, setDutyCaptured,
  fetchBalancesQueue, fetchHoldsQueue, fetchBookedQueue,
  fetchQueueSteps, setQueueStep, fetchStaffGrid,
  fetchNoteLog, addNotePost, updateNotePost, deleteNotePost,
  fetchNoteDraft, saveNoteDraft, clearNoteDraft,
  fetchBillingBrief, shortDayLabel, QUEUE_STEPS,
  type MyDayRole, type MyDayDuty, type MyDayEntry, type DutyView,
  type BalanceItem, type QueueBookingItem, type BillingBrief,
  type MyDayNotePost,
} from '@/lib/myday'

type ViewAs = MyDayRole

/** The billing duty card is named for the function, never the person
    (Eli, 2026-08-31). Mirrors the dashboard's constant of the same name. */
const BILLING_CARD_LABEL = 'Billing Ops'

export default function MyDayPage() {
  const { profile, loading: profileLoading } = useUserProfile()
  const isMobile = useIsMobile()
  const today = getLocalToday()
  // NOTES ARE STAMPED WITH THE OPERATIONAL DAY, not the calendar day (Eli,
  // 2026-09-01: "isaac leaves 1a from the day before, posts notes… but isaac's
  // will show at the top. notes need to be chronological regardless of time of
  // day"). A closer's 1 AM post is ABOUT the shift that just ended; stamped
  // with getLocalToday it filed under the NEW day and — with within-day
  // submit-order — sat above notes for a shift that hadn't happened yet. The
  // 8:50 boundary files it under the night it describes; within a day posts
  // stay in submit order, so the log reads chronologically.
  const noteDay = opsToday()
  // DUTY TICKS KEY ON THE OPERATIONAL DAY TOO (2026-09-02 — office bug:
  // "navigating away cleared all their checkboxes, not the notes"). The Sep 1
  // comment here deliberately kept duties on the calendar day; that carve-out
  // is superseded by the same session's law ("no constraints or logic based
  // on 12a"): `today` re-derives on every render, so a manager working past
  // midnight — or returning to the tab after it — watched every duty tick
  // silently re-key to the new date and read as cleared. Now the duty day
  // rolls at 8:50 AM like everything operational. `today` (calendar) still
  // drives the billing brief and the booking-date queues — those really are
  // calendar semantics.
  const dutyDay = opsToday()

  const isEli = profile?.email === 'eli@paramountrecording.com'
  const isOwner = isEli || profile?.role === 'owner'

  // Asst managers are here for the SHIFT NOTES only (ruling 2026-08-24: "all
  // admin has access to read and write and submit" the notes). They have no
  // duties or queues — rendering those panels empty would imply they do — so
  // they get a notes-only view of the page. Their entries post onto the
  // manager card.
  const notesOnly = profile?.role === 'asst_manager'

  // Everyone lands on their own card. The switch appears for anyone who can work
  // more than one: the owner (oversees both) and the MANAGER, added 2026-08-31
  // (Eli: Fernando gets the same toggle "the way I do"). HR-SPEC §5.6 is why that
  // is safe — any manager can work another's card when someone is out, and
  // `completed_by` records who actually did it. Billing sees one card and
  // therefore no toggle: a segmented control with one option is furniture.
  const ownRole: ViewAs =
    profile?.role === 'billing' ? 'billing' : 'manager'
  const canSwitchCards = isOwner || profile?.role === 'manager'
  const [viewAs, setViewAs] = useState<ViewAs>('manager')
  const role: ViewAs = canSwitchCards ? viewAs : ownRole

  // The profile lands async; billing users must not sit on the manager card for
  // a frame. Once only — a later profile refresh shouldn't yank the view back.
  const landed = useRef(false)
  useEffect(() => {
    if (!profile || landed.current) return
    landed.current = true
    setViewAs(ownRole)
  }, [profile, ownRole])

  const [duties, setDuties] = useState<MyDayDuty[]>([])
  const [entries, setEntries] = useState<MyDayEntry[]>([])
  const [balances, setBalances] = useState<BalanceItem[]>([])
  const [holds, setHolds] = useState<QueueBookingItem[]>([])
  const [booked, setBooked] = useState<QueueBookingItem[]>([])
  const [brief, setBrief] = useState<BillingBrief | null>(null)
  const [noteLog, setNoteLog] = useState<MyDayNotePost[]>([])
  const [drafts, setDrafts] = useState({ session: '', studio: '' })
  const [posting, setPosting] = useState(false)
  // A post being re-opened by its author — the composer becomes its editor
  // and Submit updates instead of inserting.
  const [editingPost, setEditingPost] = useState<MyDayNotePost | null>(null)
  const [names, setNames] = useState<Partial<Record<MyDayRole, string>>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // ── The draft that never clears (Eli, 2026-08-31) ─────────────────────────
  // "They need to be able to compile through the day. Meaning they need to
  // never clear out." What's typed here is autosaved to myday_note_drafts
  // (one row per author), so leaving for the calendar, switching tabs on a
  // phone, or picking the iPad up later all find the same text waiting.
  // Submit still posts; only a successful post empties the boxes.
  const [draftReady, setDraftReady] = useState(false)
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // A post id restored from the draft, waiting for the log to arrive so it can
  // become `editingPost` again — otherwise a resumed edit would post a second
  // copy instead of updating the original.
  const [pendingEditId, setPendingEditId] = useState<string | null>(null)

  // Refs so the debounced save reads what is on screen NOW, not what was on
  // screen when the timer was set.
  const draftsRef = useRef(drafts)
  const editingRef = useRef<MyDayNotePost | null>(editingPost)
  const savedRef = useRef({ session: '', studio: '', editingId: null as string | null })
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { draftsRef.current = drafts }, [drafts])
  useEffect(() => { editingRef.current = editingPost }, [editingPost])

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    // Notes first — they're the whole page for an asst manager. One fetch:
    // the log INCLUDES today, and today's posts render only there.
    setNoteLog(await fetchNoteLog(noteDay))
    if (notesOnly) { setLoading(false); return }

    const roleDuties = await fetchDuties(role)
    const [ent, grid] = await Promise.all([
      fetchEntries(roleDuties.map(d => d.id), '2000-01-01' < dutyDay ? shift(dutyDay, -400) : dutyDay, dutyDay),
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
  }, [role, today, dutyDay, noteDay, notesOnly])

  useEffect(() => { load() }, [load])

  // Realtime — standing rule: every fetch pairs with a subscription. One channel
  // for the whole surface; four would just be four round-trips to one reload.
  useEffect(() => {
    const ch = supabase
      .channel('myday-workspace')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_entries' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_duties' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_queue_steps' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_note_posts' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  // ── Draft: hydrate ─────────────────────────────────────────────────────────
  // Runs once per author. Until it finishes, `draftReady` keeps the autosave
  // effect quiet — otherwise the empty initial state would race the fetch and
  // overwrite a real draft with nothing.
  useEffect(() => {
    let cancelled = false
    if (!profile?.id) return
    ;(async () => {
      const d = await fetchNoteDraft(profile.id)
      if (cancelled) return
      if (d) {
        setDrafts({ session: d.session_notes, studio: d.studio_notes })
        savedRef.current = {
          session: d.session_notes, studio: d.studio_notes, editingId: d.editing_post_id,
        }
        if (d.editing_post_id) setPendingEditId(d.editing_post_id)
        if (d.session_notes || d.studio_notes) setDraftState('saved')
      }
      setDraftReady(true)
    })()
    return () => { cancelled = true }
  }, [profile?.id])

  // Resume an interrupted edit once the log is in hand. A post that has since
  // been deleted just drops the flag — the text stays, and Submit makes it a
  // new post rather than failing against a row that is gone.
  useEffect(() => {
    if (!pendingEditId || editingPost) return
    const post = noteLog.find(p => p.id === pendingEditId)
    if (post) setEditingPost(post)
    else if (noteLog.length) setPendingEditId(null)
  }, [pendingEditId, noteLog, editingPost])

  // ── Draft: autosave ────────────────────────────────────────────────────────
  const flushDraft = useCallback(async () => {
    if (!profile?.id) return
    const next = {
      session: draftsRef.current.session,
      studio: draftsRef.current.studio,
      editingId: editingRef.current?.id ?? null,
    }
    const prev = savedRef.current
    if (next.session === prev.session && next.studio === prev.studio && next.editingId === prev.editingId) {
      dirtyRef.current = false
      return
    }
    setDraftState('saving')
    const ok = await saveNoteDraft({
      authorId: profile.id,
      sessionNotes: next.session,
      studioNotes: next.studio,
      editingPostId: next.editingId,
    })
    // The toast is suppressed for autosave (it would fire mid-sentence), so the
    // composer says it instead — a surface may only claim what it knows.
    if (ok) { savedRef.current = next; dirtyRef.current = false; setDraftState('saved') }
    else setDraftState('error')
  }, [profile?.id])

  useEffect(() => {
    if (!draftReady || !profile?.id) return
    const editingId = editingPost?.id ?? null
    const prev = savedRef.current
    if (drafts.session === prev.session && drafts.studio === prev.studio && editingId === prev.editingId) return
    dirtyRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { flushDraft() }, 800)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [drafts, editingPost, draftReady, profile?.id, flushDraft])

  // Leaving the page, backgrounding the app, or closing the tab flushes
  // whatever the debounce still owes. This is the "switch screens and tabs"
  // half of the ask — the timer alone loses the last few seconds of typing.
  useEffect(() => {
    const flushIfDirty = () => { if (dirtyRef.current) flushDraft() }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushIfDirty() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flushIfDirty)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flushIfDirty)
      if (timerRef.current) clearTimeout(timerRef.current)
      flushIfDirty()
    }
  }, [flushDraft])

  // Realtime on the author's own row — this is what carries the note between
  // their desk and their iPad. Remote text is applied ONLY when nothing local
  // is waiting to save, so the other device can never overwrite live typing.
  useEffect(() => {
    if (!profile?.id) return
    const ch = supabase
      .channel(`myday-note-draft-${profile.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'myday_note_drafts',
        filter: `author_id=eq.${profile.id}`,
      }, payload => {
        if (dirtyRef.current) return
        const row = payload.new as { session_notes?: string; studio_notes?: string; editing_post_id?: string | null } | null
        if (!row || payload.eventType === 'DELETE') return
        const session = row.session_notes ?? ''
        const studio = row.studio_notes ?? ''
        const editingId = row.editing_post_id ?? null
        const prev = savedRef.current
        if (session === prev.session && studio === prev.studio && editingId === prev.editingId) return
        savedRef.current = { session, studio, editingId }
        setDrafts({ session, studio })
        setPendingEditId(editingId)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [profile?.id])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function toggleDuty(v: DutyView) {
    if (busy) return
    setBusy(v.duty.id)
    if (v.done) await uncompleteDuty(v.duty.id, dutyDay)
    else await completeDuty({
      duty: v.duty, date: dutyDay, completedBy: profile?.id ?? null,
      captured: v.entry?.captured, subState: v.entry?.sub_state, entries,
    })
    await load()
    setBusy(null)
  }

  async function saveCapture(v: DutyView, key: string, raw: string) {
    const next = { ...(v.entry?.captured ?? {}) }
    if (raw.trim() === '') delete next[key]
    else next[key] = Number(raw)
    await setDutyCaptured(v.duty.id, dutyDay, next)
    await load()
  }

  async function toggleStep(item: QueueBookingItem, step: string) {
    await setQueueStep({
      refType: 'booked', refId: item.bookingId, step,
      checked: !item.steps[step], checkedBy: profile?.id ?? null,
    })
    await load()
  }

  // ONE submit per post (ruling 2026-08-24 v2, simplified v3 same day): both
  // boxes go out together as a single signed post, like sending the
  // manager-notes email. No autosave — two managers work the same day and the
  // old shared-box upsert meant whoever's debounce fired last silently
  // overwrote the other. No opener/closer tag either: "the time submitted
  // really dictates what it is."
  async function postNotes() {
    if (!profile?.id || posting) return
    if (noteIsEmpty(drafts.session) && noteIsEmpty(drafts.studio)) return
    setPosting(true)
    const ok = editingPost
      ? await updateNotePost({ id: editingPost.id, sessionNotes: drafts.session, studioNotes: drafts.studio })
      : await addNotePost({ role, date: noteDay, sessionNotes: drafts.session, studioNotes: drafts.studio, createdBy: profile.id })
    if (ok) {
      // The draft has become a post — the paper goes blank, on every device.
      // Order matters: cancel the pending autosave first, or its debounce
      // fires after the delete and resurrects the text we just posted.
      if (timerRef.current) clearTimeout(timerRef.current)
      dirtyRef.current = false
      savedRef.current = { session: '', studio: '', editingId: null }
      setDrafts({ session: '', studio: '' })
      setEditingPost(null)
      setPendingEditId(null)
      setDraftState('idle')
      await clearNoteDraft(profile.id)
    }
    await load()
    setPosting(false)
  }

  // Reopen your own post in the composer — submitting is signing, not sealing
  // (Eli 2026-08-24: staff couldn't finish notes they'd submitted midday).
  function startEditPost(post: MyDayNotePost) {
    setEditingPost(post)
    setDrafts({ session: post.session_notes, studio: post.studio_notes })
  }

  function cancelEditPost() {
    setEditingPost(null)
    setPendingEditId(null)
    setDrafts({ session: '', studio: '' })
    // The autosave effect picks this up and empties the stored draft too —
    // cancelling an edit must not leave the post's text sitting in the
    // composer on the next screen.
  }

  async function removePost(post: MyDayNotePost) {
    if (!window.confirm('Delete these shift notes?')) return
    if (editingPost?.id === post.id) cancelEditPost()
    await deleteNotePost(post.id)
    await load()
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const views = buildDutyViews(duties, entries, dutyDay).filter(v => v.isShown)
  const byCadence = (c: MyDayDuty['cadence']) => views.filter(v => v.duty.cadence === c)

  if (profileLoading) return null

  // The BILLING card is named for its function, not its holder (Eli,
  // 2026-08-31) — "Billing Ops" everywhere the card is named, so the card
  // survives whoever holds it. The manager card keeps the person's name.
  // On your own card the header still addresses you by name.
  const whoLabel = notesOnly
    ? (profile?.display_name ?? 'Assistant Manager')
    : role === 'billing'
      ? (role === ownRole ? (profile?.display_name ?? BILLING_CARD_LABEL) : BILLING_CARD_LABEL)
      : (names[role] ?? 'Studio Manager')
  const roleTitle = notesOnly
    ? 'Assistant Manager'
    : (role === 'manager' ? 'Studio Manager' : BILLING_CARD_LABEL)

  const canDeletePost = (p: MyDayNotePost) =>
    !!profile?.id && (p.created_by === profile.id || isOwner)
  // Edit is the AUTHOR's alone (RLS agrees) — an owner can delete a stray
  // post but shouldn't be rewording someone else's signed notes.
  const canEditPost = (p: MyDayNotePost) => !!profile?.id && p.created_by === profile.id

  const notesPanel = (
    <ShiftNotesPanel
      drafts={drafts}
      setDraft={(k, v) => setDrafts(d => ({ ...d, [k]: v }))}
      onPost={postNotes}
      posting={posting}
      editing={editingPost}
      onCancelEdit={cancelEditPost}
      isMobile={isMobile}
      draftState={draftState}
    />
  )

  const logPanel = (
    <NotesLogPanel
      log={noteLog}
      today={noteDay}
      canEdit={canEditPost}
      onEdit={startEditPost}
      canDelete={canDeletePost}
      onDelete={removePost}
      editingId={editingPost?.id ?? null}
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
          {logPanel}
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
            {whoLabel === roleTitle ? whoLabel : `${whoLabel} · ${roleTitle}`}
          </span>
          <h1 className="c-arch" style={{ fontSize: isMobile ? 20 : 26, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            My Day
          </h1>
        </div>
        <div style={{ flex: 1 }} />
        {canSwitchCards && !isMobile && (
          <span className="c-seg" style={{ flexShrink: 0 }}>
            <button className={role === 'manager' ? 'c-on' : ''} onClick={() => setViewAs('manager')}>
              {names.manager ?? 'Manager'}
            </button>
            <button className={role === 'billing' ? 'c-on' : ''} onClick={() => setViewAs('billing')}>
              {BILLING_CARD_LABEL}
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
            <span className="c-ct">{progressLabel(buildDutyViews(duties, entries, dutyDay))}</span>
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
                    today={dutyDay}
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
          submitted note from every role, grouped by day, newest first —
          INCLUDING today's (they render here and only here; a second copy
          above the composer read as duplication and confused staff). */}
      <div style={{ marginTop: 12 }}>
        {logPanel}
      </div>
    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** One shift-notes POST — header says whose it is (Opening/Closing shift ·
    author · time), then the sections it actually has. An empty box isn't
    rendered. */
function NotePostBlock({ p, tagRole, onEdit, onDelete, isEditing }: {
  p: MyDayNotePost
  /** Show which card it was posted from (always on in the log). */
  tagRole?: boolean
  onEdit?: () => void
  onDelete?: () => void
  /** This post is open in the composer right now. */
  isEditing?: boolean
}) {
  const who = p.author?.display_name || p.author?.initials || 'Staff'
  // No opener/closer tag (v3 ruling) — the submit time is the story.
  return (
    <div className="c-mdnote" style={isEditing ? { opacity: 0.45 } : undefined}>
      <div className="c-mdnote-meta" style={{ marginTop: 0, marginBottom: 6 }}>
        <span>
          <b className="c-mdnote-shift">{who}</b>
          {tagRole ? ` · ${p.role === 'billing' ? BILLING_CARD_LABEL : 'Manager'}` : ''}
          {' · '}{fmtTaskTime(p.created_at)}
          {isEditing && <b className="c-mdnote-shift"> · Editing above</b>}
        </span>
        {onEdit && !isEditing && (
          <button className="c-x" onClick={onEdit} title="Edit your shift notes" style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Edit</button>
        )}
        {onDelete && (
          <button className="c-x" onClick={onDelete} title="Delete shift notes" style={{ marginLeft: onEdit && !isEditing ? 0 : 'auto', fontSize: 13 }}>×</button>
        )}
      </div>
      {!noteIsEmpty(p.session_notes) && (
        <div style={{ marginBottom: !noteIsEmpty(p.studio_notes) ? 8 : 0 }}>
          <span className="c-label" style={{ display: 'block', marginBottom: 2 }}>Session notes</span>
          <RichNoteView className="c-mdnote-body" html={p.session_notes} />
        </div>
      )}
      {!noteIsEmpty(p.studio_notes) && (
        <div>
          <span className="c-label" style={{ display: 'block', marginBottom: 2 }}>Studio notes</span>
          <RichNoteView className="c-mdnote-body" html={p.studio_notes} />
        </div>
      )}
    </div>
  )
}

/** The composer alone: two boxes splitting the card equally, ONE submit for
    both (ruling 2026-08-24 v2, simplified v3 the same day — type, submit,
    done; no opener/closer toggle, the timestamp tells the story). Submitted
    posts render ONLY in the log below — a copy up here read as duplication.
    Editing a post from the log loads it into these boxes; Submit updates. */
function ShiftNotesPanel({
  drafts, setDraft, onPost, posting, editing, onCancelEdit, isMobile, draftState,
}: {
  drafts: { session: string; studio: string }
  setDraft: (k: 'session' | 'studio', v: string) => void
  onPost: () => void
  posting: boolean
  editing: MyDayNotePost | null
  onCancelEdit: () => void
  isMobile: boolean
  /** Autosave status of the unsubmitted draft — see the draft block on the page. */
  draftState: 'idle' | 'saving' | 'saved' | 'error'
}) {
  const empty = noteIsEmpty(drafts.session) && noteIsEmpty(drafts.studio)
  // The lozenge tells the truth about the draft, because the autosave toast is
  // suppressed (dbResult `silent`) — if this said nothing, a failed save would
  // be invisible, which is the whole defect class the project bans.
  const draftNote =
    draftState === 'error' ? 'not saved — check your connection'
    : draftState === 'saving' ? 'saving…'
    : draftState === 'saved' ? 'kept — safe to leave this page'
    : null
  return (
    <div className="c-panel">
      <div className="c-lozenge">
        <b>Shift notes</b>
        {/* One span — the lozenge is a two-item flex (space-between), so a
            third child would strand the middle one. */}
        <span className="c-ct" style={draftState === 'error' ? { color: 'var(--c-st-hot)', opacity: 1 } : undefined}>
          {editing ? 'editing your post' : 'posts appear in the log below'}
          {draftNote ? ` · ${draftNote}` : ''}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <span className="c-label" style={{ display: 'block', marginBottom: 5 }}>Session notes</span>
          <RichNoteEditor
            value={drafts.session}
            onChange={html => setDraft('session', html)}
            placeholder="Anything the next shift needs to know…"
            minHeight={150}
            startWithBullets
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <span className="c-label" style={{ display: 'block', marginBottom: 5 }}>Studio notes</span>
          <RichNoteEditor
            value={drafts.studio}
            onChange={html => setDraft('studio', html)}
            placeholder="Rooms, gear, maintenance…"
            minHeight={150}
            startWithBullets
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: isMobile ? 'wrap' : undefined }}>
        <span style={{ flex: 1, fontSize: 10.5, opacity: 0.45, textAlign: 'right' }}>
          {editing
            ? 'Submit saves your changes to the posted notes.'
            : 'Submits both boxes as one post, signed with your name.'}
        </span>
        {editing && (
          <button className="c-x" onClick={onCancelEdit} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>Cancel</button>
        )}
        <button
          className="c-btn"
          onClick={onPost}
          disabled={posting || empty}
          style={{ opacity: empty ? 0.45 : 1, cursor: empty ? 'default' : 'pointer', flexShrink: 0 }}
        >{posting ? 'Saving…' : editing ? 'Update shift notes' : 'Submit shift notes'}</button>
      </div>
    </div>
  )
}

/** Every post, newest day first, TODAY INCLUDED — the one place submitted
    notes live. Authors can reopen their own (Edit → composer above). */
function NotesLogPanel({ log, today, canEdit, onEdit, canDelete, onDelete, editingId }: {
  log: MyDayNotePost[]
  today: string
  canEdit: (p: MyDayNotePost) => boolean
  onEdit: (p: MyDayNotePost) => void
  canDelete: (p: MyDayNotePost) => boolean
  onDelete: (p: MyDayNotePost) => void
  editingId: string | null
}) {
  // Group by date, preserving the query's order (date desc, created_at asc).
  const days: { date: string; items: MyDayNotePost[] }[] = []
  for (const p of log) {
    const last = days[days.length - 1]
    if (last && last.date === p.date) last.items.push(p)
    else days.push({ date: p.date, items: [p] })
  }
  return (
    <div className="c-panel">
      <div className="c-lozenge"><b>Notes log</b><span className="c-ct">last 30 days</span></div>
      {days.length === 0 && (
        <div className="c-qrow">
          <span className="c-who" style={{ opacity: 0.5 }}>No notes yet — submitted posts appear here.</span>
        </div>
      )}
      {days.map(d => (
        <div key={d.date} style={{ marginBottom: 4 }}>
          <span className="c-label" style={{ display: 'block', padding: '8px 6px 3px' }}>
            {d.date === today ? 'Today' : shortDayLabel(d.date)}
          </span>
          {d.items.map(p => (
            <NotePostBlock
              key={p.id}
              p={p}
              tagRole
              isEditing={editingId === p.id}
              onEdit={canEdit(p) ? () => onEdit(p) : undefined}
              onDelete={canDelete(p) ? () => onDelete(p) : undefined}
            />
          ))}
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
