'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /shift-notes — the notes channel, promoted to its own page (2026-09-06,
// the dashboard∪my-day merge). Ruling: "shift notes shouldn't show in a small
// box — it's something we want to read in a large box." A reading surface and
// a glance surface want different geometry; the dashboard glances, this reads.
//
// Everything behavioral is MOVED VERBATIM from /my-day (now a redirect stub):
//   · ONE submit per post — both boxes go out as a single signed post.
//   · The draft that never clears (myday_note_drafts, one row per author):
//     debounced autosave + flush on hide/unmount, cancel-timer-before-delete,
//     cross-device sync on the author's own row.
//   · Notes are stamped with the OPERATIONAL day (opsToday) — a closer's 1 AM
//     post files under the night it describes.
//   · Edit is the author's alone; owners can delete a stray post.
//   · Asst managers post onto the manager card (2026-08-24: "all admin has
//     access to read and write and submit").
// Styling stays soft-skin (c- classes) so the site-wide contrast swap re-skins
// this page for free.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { opsToday } from '@/lib/time'
import { fmtTaskTime } from '@/lib/tasks'
import { RichNoteEditor, RichNoteView, noteIsEmpty } from '@/components/shared/RichNote'
import {
  fetchNoteLog, addNotePost, updateNotePost, deleteNotePost,
  fetchNoteDraft, saveNoteDraft, clearNoteDraft, shortDayLabel,
  type MyDayNotePost,
} from '@/lib/myday'
import { RunnerNotesChannel } from '@/components/runner/RunnerNotesChannel'
import { OPS_STUDIOS } from '@/lib/dailyOps'

const BILLING_CARD_LABEL = 'Billing Ops'
/** Notes-log pagination: day-groups shown before "Load more" (Eli 2026-09-06 —
    the log must never be a mile long). */
const DAYS_PER_PAGE = 7

export default function ShiftNotesPage() {
  const { profile, loading: profileLoading } = useUserProfile()
  const isMobile = useIsMobile()
  const noteDay = opsToday()
  const isEli = profile?.email === 'eli@paramountrecording.com'
  const isOwner = isEli || profile?.role === 'owner'
  // Which card a post lands on: billing posts to Billing Ops, everyone else
  // (manager, asst manager, owner) to the manager card — same rule as /my-day.
  const postRole = profile?.role === 'billing' ? 'billing' as const : 'manager' as const

  // Manager notes | Runner notes — the runner channel's admin view moved here
  // from Daily Ops (Eli 2026-09-06): all the building's notes, one tab.
  const [tab, setTab] = useState<'manager' | 'runner'>('manager')
  const [runnerStudio, setRunnerStudio] = useState<string>('paramount')
  const [daysShown, setDaysShown] = useState(DAYS_PER_PAGE)
  const [noteLog, setNoteLog] = useState<MyDayNotePost[]>([])
  const [drafts, setDrafts] = useState({ session: '', studio: '' })
  const [posting, setPosting] = useState(false)
  const [editingPost, setEditingPost] = useState<MyDayNotePost | null>(null)
  const [draftReady, setDraftReady] = useState(false)
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [pendingEditId, setPendingEditId] = useState<string | null>(null)

  const draftsRef = useRef(drafts)
  const editingRef = useRef<MyDayNotePost | null>(editingPost)
  const savedRef = useRef({ session: '', studio: '', editingId: null as string | null })
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { draftsRef.current = drafts }, [drafts])
  useEffect(() => { editingRef.current = editingPost }, [editingPost])

  const load = useCallback(async () => {
    setNoteLog(await fetchNoteLog(noteDay))
  }, [noteDay])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = supabase
      .channel('shift-notes-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_note_posts' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  // Draft hydrate — once per author; draftReady gates the autosave so the
  // empty initial state can't race the fetch and blank a real draft.
  useEffect(() => {
    let cancelled = false
    if (!profile?.id) return
    ;(async () => {
      const d = await fetchNoteDraft(profile.id)
      if (cancelled) return
      if (d) {
        setDrafts({ session: d.session_notes, studio: d.studio_notes })
        savedRef.current = { session: d.session_notes, studio: d.studio_notes, editingId: d.editing_post_id }
        if (d.editing_post_id) setPendingEditId(d.editing_post_id)
        if (d.session_notes || d.studio_notes) setDraftState('saved')
      }
      setDraftReady(true)
    })()
    return () => { cancelled = true }
  }, [profile?.id])

  // Resume an interrupted edit once the log is in hand.
  useEffect(() => {
    if (!pendingEditId || editingPost) return
    const post = noteLog.find(p => p.id === pendingEditId)
    if (post) setEditingPost(post)
    else if (noteLog.length) setPendingEditId(null)
  }, [pendingEditId, noteLog, editingPost])

  // Draft autosave — debounce + flush on hide/unmount; cancel before delete.
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

  // Cross-device draft sync — remote text applies only when nothing local is
  // waiting to save, so another device can never overwrite live typing.
  useEffect(() => {
    if (!profile?.id) return
    const ch = supabase
      .channel(`shift-notes-draft-${profile.id}`)
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

  async function postNotes() {
    if (!profile?.id || posting) return
    if (noteIsEmpty(drafts.session) && noteIsEmpty(drafts.studio)) return
    setPosting(true)
    const ok = editingPost
      ? await updateNotePost({ id: editingPost.id, sessionNotes: drafts.session, studioNotes: drafts.studio })
      : await addNotePost({ role: postRole, date: noteDay, sessionNotes: drafts.session, studioNotes: drafts.studio, createdBy: profile.id })
    if (ok) {
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

  function startEditPost(post: MyDayNotePost) {
    setEditingPost(post)
    setDrafts({ session: post.session_notes, studio: post.studio_notes })
  }
  function cancelEditPost() {
    setEditingPost(null)
    setPendingEditId(null)
    setDrafts({ session: '', studio: '' })
  }
  async function removePost(post: MyDayNotePost) {
    if (!window.confirm('Delete these shift notes?')) return
    if (editingPost?.id === post.id) cancelEditPost()
    await deleteNotePost(post.id)
    await load()
  }

  const canDeletePost = (p: MyDayNotePost) =>
    !!profile?.id && (p.created_by === profile.id || isOwner)
  const canEditPost = (p: MyDayNotePost) => !!profile?.id && p.created_by === profile.id

  if (profileLoading) return null

  const empty = noteIsEmpty(drafts.session) && noteIsEmpty(drafts.studio)
  const draftNote =
    draftState === 'error' ? 'not saved — check your connection'
    : draftState === 'saving' ? 'saving…'
    : draftState === 'saved' ? 'kept — safe to leave this page'
    : null

  // Group the log by date, preserving the query's order (date desc, created_at asc).
  const days: { date: string; items: MyDayNotePost[] }[] = []
  for (const p of noteLog) {
    const last = days[days.length - 1]
    if (last && last.date === p.date) last.items.push(p)
    else days.push({ date: p.date, items: [p] })
  }

  return (
    <div className="c-root" style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '2px 4px 14px', flexWrap: isMobile ? 'wrap' : undefined }}>
        <div>
          <span className="c-label" style={{ display: 'block', marginBottom: 3 }}>
            The referenceable history — every shift, signed
          </span>
          <h1 className="c-arch" style={{ fontSize: isMobile ? 20 : 26, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            Shift Notes
          </h1>
        </div>
        <div style={{ flex: 1 }} />
        <span className="c-seg" style={{ flexShrink: 0 }}>
          <button className={tab === 'manager' ? 'c-on' : ''} onClick={() => setTab('manager')}>Manager notes</button>
          <button className={tab === 'runner' ? 'c-on' : ''} onClick={() => setTab('runner')}>Runner notes</button>
        </span>
      </div>

      {/* ── RUNNER NOTES — the channel's admin view, one studio at a time.
          Same component the studio hub mounts; an office post wears an
          Office chip. Moved here from Daily Ops (2026-09-06). ── */}
      {tab === 'runner' && (
        <div style={{ maxWidth: 720 }}>
          <div style={{ display: 'flex', gap: 6, margin: '2px 0 10px' }}>
            {OPS_STUDIOS.map(s => (
              <button
                key={s.key}
                onClick={() => setRunnerStudio(s.key)}
                className={`c-soft${runnerStudio === s.key ? ' c-on' : ''}`}
                style={{ cursor: 'pointer' }}
              >{s.abbr}</button>
            ))}
          </div>
          <RunnerNotesChannel studio={runnerStudio} maxHeight={620} />
        </div>
      )}

      {tab === 'manager' && (<>
      {/* THE COMPOSER — two boxes, one signed post. */}
      <div className="c-panel" style={{ marginBottom: 12 }}>
        <div className="c-lozenge">
          <b>Post shift notes</b>
          <span className="c-ct" style={draftState === 'error' ? { color: 'var(--c-st-hot)', opacity: 1 } : undefined}>
            {editingPost ? 'editing your post' : 'posts appear in the log below'}
            {draftNote ? ` · ${draftNote}` : ''}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <span className="c-label" style={{ display: 'block', marginBottom: 5 }}>Session notes</span>
            <RichNoteEditor
              value={drafts.session}
              onChange={html => setDrafts(d => ({ ...d, session: html }))}
              placeholder="Anything the next shift needs to know…"
              minHeight={150}
              startWithBullets
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <span className="c-label" style={{ display: 'block', marginBottom: 5 }}>Studio notes</span>
            <RichNoteEditor
              value={drafts.studio}
              onChange={html => setDrafts(d => ({ ...d, studio: html }))}
              placeholder="Rooms, gear, maintenance…"
              minHeight={150}
              startWithBullets
            />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: isMobile ? 'wrap' : undefined }}>
          <span style={{ flex: 1, fontSize: 10.5, opacity: 0.45, textAlign: 'right' }}>
            {editingPost
              ? 'Submit saves your changes to the posted notes.'
              : 'Submits both boxes as one post, signed with your name.'}
          </span>
          {editingPost && (
            <button className="c-x" onClick={cancelEditPost} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>Cancel</button>
          )}
          <button
            className="c-btn"
            onClick={postNotes}
            disabled={posting || empty}
            style={{ opacity: empty ? 0.45 : 1, cursor: empty ? 'default' : 'pointer', flexShrink: 0 }}
          >{posting ? 'Saving…' : editingPost ? 'Update shift notes' : 'Submit shift notes'}</button>
        </div>
      </div>

      {/* THE LOG — every post, newest day first, today included. Full width,
          the whole page: this is the large box the ruling asked for. */}
      <div className="c-panel">
        <div className="c-lozenge"><b>Notes log</b><span className="c-ct">last 30 days</span></div>
        {days.length === 0 && (
          <div className="c-qrow">
            <span className="c-who" style={{ opacity: 0.5 }}>No notes yet — submitted posts appear here.</span>
          </div>
        )}
        {days.slice(0, daysShown).map(d => (
          <div key={d.date} style={{ marginBottom: 4 }}>
            <span className="c-label" style={{ display: 'block', padding: '8px 6px 3px' }}>
              {d.date === noteDay ? 'Today' : shortDayLabel(d.date)}
            </span>
            {d.items.map(p => {
              const who = p.author?.display_name || p.author?.initials || 'Staff'
              const isEditing = editingPost?.id === p.id
              return (
                <div key={p.id} className="c-mdnote" style={isEditing ? { opacity: 0.45 } : undefined}>
                  <div className="c-mdnote-meta" style={{ marginTop: 0, marginBottom: 6 }}>
                    <span>
                      <b className="c-mdnote-shift">{who}</b>
                      {` · ${p.role === 'billing' ? BILLING_CARD_LABEL : 'Manager'}`}
                      {' · '}{fmtTaskTime(p.created_at)}
                      {isEditing && <b className="c-mdnote-shift"> · Editing above</b>}
                    </span>
                    {canEditPost(p) && !isEditing && (
                      <button className="c-x" onClick={() => startEditPost(p)} title="Edit your shift notes" style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Edit</button>
                    )}
                    {canDeletePost(p) && (
                      <button className="c-x" onClick={() => removePost(p)} title="Delete shift notes" style={{ marginLeft: canEditPost(p) && !isEditing ? 0 : 'auto', fontSize: 13 }}>×</button>
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
            })}
          </div>
        ))}
        {days.length > daysShown && (
          <button
            className="c-soft"
            onClick={() => setDaysShown(n => n + DAYS_PER_PAGE)}
            style={{ display: 'block', margin: '10px auto 4px', cursor: 'pointer' }}
          >
            Load {Math.min(DAYS_PER_PAGE, days.length - daysShown)} more day{Math.min(DAYS_PER_PAGE, days.length - daysShown) === 1 ? '' : 's'} ↓
          </button>
        )}
      </div>
      </>)}
    </div>
  )
}
