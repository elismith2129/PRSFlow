'use client'
// ─────────────────────────────────────────────────────────────────────────────
// RunnerNotesChannel — the runner notes channel (Eli, 2026-09-01; option A of
// docs/design-refs/runner-notes-options.html). "It will be like manager. one
// chronological list, not based on midnight or the day, just in order of them
// submitted… combine the view and submit into one thing."
//
// One Slack-shaped channel per studio: every note ever, one feed in pure
// submit order, composer pinned underneath. Mounted on the studio hub
// (runners) AND on Daily Ops (the admin view) — same component, so the two
// can never disagree about what the channel is.
//
//   · Feed scrolls inside its own window, opens at the newest message.
//   · Date dividers are DISPLAY ONLY, like Slack's — a ruler for the eye,
//     never grouping. Nothing rolls at midnight or 8:50.
//   · Composer: RichNote (bold/bullets — the app's only rich-text surface),
//     mirrored to localStorage on every keystroke (lib/draft — a runner's
//     typing must never be wiped), Send posts it. Role chips for runners
//     (opener/floater/closer); office posts wear an Office chip instead.
//   · Own posts stay editable (like the manager log) — author-matched in the
//     UI and enforced by RLS through user_profiles.
//   · Realtime per the standing rule; channel name runner-notes-<studio> is
//     unique per page (the hub and Daily Ops never share a page).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { opsToday } from '@/lib/time'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useReloadOnReturn } from '@/hooks/useReloadOnReturn'
import { draftKey, readDraft, writeDraft, clearDraft } from '@/lib/draft'
import { RichNoteEditor, RichNoteView, noteIsEmpty } from '@/components/shared/RichNote'

const PAGE = 60

type Role = 'opener' | 'floater' | 'closer'
const ROLES: { key: Role; label: string }[] = [
  { key: 'opener', label: 'Opener' },
  { key: 'floater', label: 'Floater' },
  { key: 'closer', label: 'Closer' },
]

type Post = {
  id: string
  studio: string
  author_id: string | null
  author_name: string
  role: Role | null
  source: 'runner' | 'office'
  text: string
  created_at: string
  updated_at: string
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/** Display-only date label ("Today" / "Sun · Aug 30") — never a grouping key. */
function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return 'Today'
  const yest = new Date(today); yest.setDate(yest.getDate() - 1)
  if (sameDay(d, yest)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', ' ·')
}

export function RunnerNotesChannel({ studio, maxHeight = 320, subscribe = true, reloadKey = 0 }: {
  studio: string
  maxHeight?: number
  /**
   * Pass false when the HOST PAGE already holds a runner_note_posts channel
   * (Daily Ops does — its loadNight watches the table for the sweep), per the
   * standing rule against duplicate channels on one table per page. The host
   * then bumps `reloadKey` from its own callback to refresh the feed.
   */
  subscribe?: boolean
  reloadKey?: number
}) {
  const { profile } = useUserProfile()
  const isRunner = profile?.role === 'runner'
  const authorName = profile ? (profile.initials || profile.display_name || 'Runner') : ''

  const [posts, setPosts] = useState<Post[] | null>(null)
  const [haveOlder, setHaveOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [text, setText] = useState('')
  const [role, setRole] = useState<Role | null>(null)
  const [sending, setSending] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const feedRef = useRef<HTMLDivElement>(null)
  const stickBottomRef = useRef(true)
  const textRef = useRef(text); textRef.current = text
  const roleRef = useRef(role); roleRef.current = role

  // Draft net — keyed on the ops day only so lib/draft's 3-day pruning can
  // read it; a draft that old is honestly stale. Restored before first paint
  // of the composer.
  const dKey = draftKey('runner-channel', studio, opsToday())
  useEffect(() => {
    const d = readDraft<{ text: string; role: Role | null }>(dKey)
    if (d && !noteIsEmpty(d.text)) { setText(d.text); setRole(d.role ?? null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio])
  const typed = (next: string) => {
    setText(next)
    writeDraft(dKey, { text: next, role: roleRef.current })
  }
  const pickRole = (r: Role) => {
    setRole(prev => {
      const next = prev === r ? null : r
      writeDraft(dKey, { text: textRef.current, role: next })
      return next
    })
  }

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('runner_note_posts')
      .select('*')
      .eq('studio', studio)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    if (!dbResult('Loading runner notes', error)) return
    const page = ((data ?? []) as Post[]).reverse()
    setPosts(page)
    setHaveOlder((data ?? []).length === PAGE)
  }, [studio])

  useEffect(() => { load() }, [load, reloadKey])
  useReloadOnReturn(load)

  useEffect(() => {
    if (!subscribe) return
    const ch = supabase
      .channel(`runner-notes-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runner_note_posts', filter: `studio=eq.${studio}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [studio, load, subscribe])

  async function loadOlder() {
    if (!posts || posts.length === 0) return
    setLoadingOlder(true)
    const { data, error } = await supabase
      .from('runner_note_posts')
      .select('*')
      .eq('studio', studio)
      .lt('created_at', posts[0].created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    setLoadingOlder(false)
    if (!dbResult('Loading older notes', error)) return
    const older = ((data ?? []) as Post[]).reverse()
    stickBottomRef.current = false
    setPosts(prev => [...older, ...(prev ?? [])])
    setHaveOlder((data ?? []).length === PAGE)
  }

  // Slack behavior: open at the newest message; follow new arrivals only when
  // already at the bottom (reading history must not be yanked down).
  useEffect(() => {
    const el = feedRef.current
    if (!el || posts === null) return
    if (stickBottomRef.current) el.scrollTop = el.scrollHeight
    stickBottomRef.current = true
  }, [posts])
  const onScroll = () => {
    const el = feedRef.current
    if (el) stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  async function send() {
    if (!profile || sending || noteIsEmpty(text)) return
    setSending(true)
    const { error } = await supabase.from('runner_note_posts').insert({
      studio,
      author_id: profile.id,
      author_name: authorName,
      role: isRunner ? role : null,
      source: isRunner ? 'runner' : 'office',
      text,
    })
    setSending(false)
    if (!dbResult('Posting note', error)) return
    // Success ONLY: clear the field and its net. Role stays picked — it is
    // the shift, not the message.
    setText('')
    clearDraft(dKey)
    stickBottomRef.current = true
    load()
  }

  async function saveEdit(p: Post) {
    if (noteIsEmpty(editText)) return
    const { error } = await supabase
      .from('runner_note_posts')
      .update({ text: editText, updated_at: new Date().toISOString() })
      .eq('id', p.id)
    if (!dbResult('Saving note edit', error)) return
    setEditingId(null)
    load()
  }

  const chip: React.CSSProperties = {
    fontSize: 8, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
    background: 'var(--c-wash2)', borderRadius: 99, padding: '1px 7px', color: 'var(--c-fg-2)', flexShrink: 0,
  }

  return (
    <div style={{ background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 16, overflow: 'hidden' }}>
      {/* ── Feed ── */}
      <div ref={feedRef} onScroll={onScroll} style={{ maxHeight, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: '10px 13px 6px' }}>
        {posts === null && <div style={{ fontSize: 12, opacity: 0.5, padding: '6px 0' }}>Loading…</div>}
        {posts !== null && posts.length === 0 && (
          <div style={{ fontSize: 12, opacity: 0.5, padding: '6px 0' }}>No notes yet — start the channel below.</div>
        )}
        {haveOlder && (
          <button onClick={loadOlder} disabled={loadingOlder}
            style={{ display: 'block', margin: '0 auto 8px', background: 'var(--c-wash)', color: 'var(--c-fg-2)', fontSize: 10, fontWeight: 800, borderRadius: 99, padding: '5px 14px', cursor: 'pointer' }}>
            {loadingOlder ? 'Loading…' : 'Load older notes'}
          </button>
        )}
        {(posts ?? []).map((p, i) => {
          const prev = (posts ?? [])[i - 1]
          const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(p.created_at)
          const mine = !!profile && p.author_id === profile.id
          return (
            <div key={p.id}>
              {newDay && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '9px 0 7px', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }}>
                  <span style={{ flex: 1, height: 1, background: 'var(--c-wash2)' }} />
                  {dayLabel(p.created_at)}
                  <span style={{ flex: 1, height: 1, background: 'var(--c-wash2)' }} />
                </div>
              )}
              <div style={{ marginBottom: 9 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 1 }}>
                  <span style={{ fontWeight: 800, fontSize: 12 }}>{p.author_name || '—'}</span>
                  {p.source === 'office'
                    ? <span style={chip}>Office</span>
                    : p.role && <span style={chip}>{p.role}</span>}
                  <span style={{ fontSize: 9.5, color: 'var(--c-fg-3)' }}>
                    {fmtTime(p.created_at)}
                    {new Date(p.updated_at).getTime() - new Date(p.created_at).getTime() > 60000 && ' · edited'}
                  </span>
                  {mine && editingId !== p.id && (
                    <button onClick={() => { setEditingId(p.id); setEditText(p.text) }} aria-label="Edit note"
                      style={{ marginLeft: 'auto', background: 'none', color: 'var(--c-fg-3)', fontSize: 11, cursor: 'pointer', padding: '0 4px' }}>✎</button>
                  )}
                </div>
                {editingId === p.id ? (
                  <div>
                    <RichNoteEditor value={editText} onChange={setEditText} minHeight={60} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
                      <button onClick={() => saveEdit(p)} style={{ background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)', fontSize: 10, fontWeight: 800, borderRadius: 99, padding: '4px 12px', cursor: 'pointer' }}>Save</button>
                      <button onClick={() => setEditingId(null)} style={{ background: 'var(--c-wash2)', color: 'var(--c-fg)', fontSize: 10, fontWeight: 800, borderRadius: 99, padding: '4px 12px', cursor: 'pointer' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--c-fg-2)' }}>
                    <RichNoteView html={p.text} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Composer ── */}
      <div style={{ borderTop: '1px solid var(--c-wash2)', padding: '9px 12px 11px' }}>
        {isRunner && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 7 }}>
            {ROLES.map(r => (
              <button key={r.key} onClick={() => pickRole(r.key)}
                style={{
                  fontSize: 9.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase',
                  borderRadius: 99, padding: '5px 12px', cursor: 'pointer',
                  background: role === r.key ? 'var(--c-ivory)' : 'var(--c-wash)',
                  color: role === r.key ? '#1b1a17' : 'var(--c-fg-2)',
                }}>{r.label}</button>
            ))}
          </div>
        )}
        <RichNoteEditor value={text} onChange={typed} minHeight={44} placeholder="Add a note…" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
          <span style={{ fontSize: 9, color: 'var(--c-fg-3)' }}>
            {noteIsEmpty(text) ? 'Everything you type is kept until you send' : 'Draft kept'}
          </span>
          <button
            onClick={send}
            disabled={sending || noteIsEmpty(text)}
            style={{
              marginLeft: 'auto', background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)',
              fontSize: 10.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
              borderRadius: 99, padding: '7px 18px', minHeight: 32,
              cursor: sending || noteIsEmpty(text) ? 'default' : 'pointer',
              opacity: sending || noteIsEmpty(text) ? 0.45 : 1,
            }}
          >{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  )
}
