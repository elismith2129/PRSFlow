'use client'
// ─────────────────────────────────────────────────────────────────────────────
// RunnerNotesChannel — one channel of the notes room.
//
// 2026-09-01 (option A of runner-notes-options.html): one Slack-shaped feed
// per studio, every note ever in submit order, composer in the same place.
// 2026-09-15 (option A of runner-channel-options.html): the feed became a
// ROOM. Eli: "spaces you want to live in — easy nav, easy understand, easy
// input." Runners: "@ people like Slack… a General channel."
//
//   · variant 'room'  — the full-screen page (app/runner/[studio]/notes):
//                       newest at the BOTTOM, composer pinned under it, the
//                       Messages-app feel. Supersedes the Sep 1 "newest at
//                       the top" — that ruling was for a window on the hub,
//                       where you wrote and read under your thumbs. In a room
//                       the thumbs are at the bottom.
//     variant 'panel' — Daily Ops' embedded window: newest first, composer
//                       above, as before.
//   · @MENTIONS: the @ button opens the roster (runners + office); picking
//     someone inserts "@Handle". Handles are parsed at send (lib/
//     runnerChannel) — hand-typed ones resolve too. A tagged person sees the
//     message with a warm edge; the hub counts it under "for you".
//   · MENTION + TIME = TASK (studio channels only): the message makes a
//     studio task for that person with the time on it, shown under the
//     message here and under "From the office" on their hub.
//   · READS: opening the room stamps runner_note_reads (channel_read RPC);
//     "New since you looked" sits before the first post after the stamp we
//     found on open, and stays put for the visit.
//   · Photos, drafts (lib/draft), own-post edit, realtime: unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useReloadOnReturn } from '@/hooks/useReloadOnReturn'
import { RichNoteEditor, RichNoteView, noteIsEmpty } from '@/components/shared/RichNote'
import { SignedImage } from '@/components/shared/SignedImage'
import { draftKey, readDraft, writeDraft, clearDraft } from '@/lib/draft'
import { opsToday } from '@/lib/time'
import {
  type ChannelKey, type ChannelPost, type RosterPerson, CHANNEL_SHORT, STUDIO_CHANNELS,
  fetchRoster, handleFor, parseMentions, parseTime, taskTextFrom, markMentions, markChannelRead,
  avatarInitials, isOfficeRole,
} from '@/lib/runnerChannel'

const PAGE = 60

type Role = 'opener' | 'floater' | 'closer'
const ROLES: { key: Role; label: string }[] = [
  { key: 'opener', label: 'Opener' },
  { key: 'floater', label: 'Floater' },
  { key: 'closer', label: 'Closer' },
]

type TaskRow = { id: string; post_id: string | null; task: string; assigned_to_name: string | null; due_time: string | null; done_at: string | null }

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

function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Append "@Handle " to RichNote HTML without breaking its last block. */
function appendHandle(html: string, handle: string): string {
  const token = `@${handle}&nbsp;`
  if (noteIsEmpty(html)) return token
  const m = /(<\/(?:div|p|li)>\s*)+$/i.exec(html)
  if (m) return html.slice(0, m.index) + ' ' + token + html.slice(m.index)
  return html + ' ' + token
}

export function RunnerNotesChannel({
  channel, variant = 'panel', maxHeight = 320, subscribe = true, reloadKey = 0,
}: {
  channel: ChannelKey
  variant?: 'room' | 'panel'
  /** panel only */
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
  const room = variant === 'room'
  // A task needs a hub to land on: studio channels only.
  const taskStudio = (STUDIO_CHANNELS as string[]).includes(channel) ? channel : null

  const [posts, setPosts] = useState<ChannelPost[] | null>(null)
  const [tasks, setTasks] = useState<Record<string, TaskRow>>({})
  const [haveOlder, setHaveOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [text, setText] = useState('')
  const [role, setRole] = useState<Role | null>(null)
  const [sending, setSending] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const [roster, setRoster] = useState<RosterPerson[]>([])
  const [tagOpen, setTagOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  // The read stamp as it stood when the room opened — the divider's anchor.
  const openedReadAt = useRef<string | null | undefined>(undefined)
  const feedRef = useRef<HTMLDivElement>(null)

  const textRef = useRef(text); textRef.current = text
  const roleRef = useRef(role); roleRef.current = role
  const photosRef = useRef(photos); photosRef.current = photos

  useEffect(() => { fetchRoster().then(setRoster) }, [])

  // Draft net — per channel per ops day (lib/draft prunes after 3 days).
  const dKey = draftKey('runner-channel', channel, opsToday())
  useEffect(() => {
    const d = readDraft<{ text: string; role: Role | null; photos?: string[] }>(dKey)
    if (d && (!noteIsEmpty(d.text) || (d.photos?.length ?? 0) > 0)) {
      setText(d.text); setRole(d.role ?? null); setPhotos(d.photos ?? [])
    } else { setText(''); setPhotos([]) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])
  const mirror = (patch: Partial<{ text: string; role: Role | null; photos: string[] }>) =>
    writeDraft(dKey, { text: textRef.current, role: roleRef.current, photos: photosRef.current, ...patch })
  const typed = (next: string) => { setText(next); mirror({ text: next }) }
  const pickRole = (r: Role) => {
    setRole(prev => { const next = prev === r ? null : r; mirror({ role: next }); return next })
  }

  async function pickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setUploading(true)
    const added: string[] = []
    for (const file of files.slice(0, 4 - photos.length)) {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `runner-notes/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
      if (dbResult('Uploading photo', error)) added.push(path)
    }
    setUploading(false)
    if (added.length > 0) setPhotos(prev => { const next = [...prev, ...added]; mirror({ photos: next }); return next })
  }
  const removePhoto = (p: string) => setPhotos(prev => { const next = prev.filter(x => x !== p); mirror({ photos: next }); return next })

  const loadTasks = useCallback(async (rows: ChannelPost[]) => {
    const ids = rows.map(p => p.id)
    if (ids.length === 0) { setTasks({}); return }
    const { data } = await supabase.from('studio_tasks')
      .select('id, post_id, task, assigned_to_name, due_time, done_at')
      .in('post_id', ids).is('deleted_at', null)
    const m: Record<string, TaskRow> = {}
    for (const t of (data ?? []) as TaskRow[]) if (t.post_id) m[t.post_id] = t
    setTasks(m)
  }, [])

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('runner_note_posts')
      .select('*')
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    if (!dbResult('Loading runner notes', error)) return
    const rows = (data ?? []) as ChannelPost[]
    setPosts(rows)
    setHaveOlder(rows.length === PAGE)
    loadTasks(rows)
  }, [channel, loadTasks])

  // Room: find my read stamp ONCE per visit, then stamp "read now". The
  // divider anchors on the first value; later reloads (realtime) re-stamp so
  // a message that arrives while I'm looking is read.
  useEffect(() => {
    if (!room || !profile) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('runner_note_reads').select('last_read_at')
        .eq('user_id', profile.id).eq('channel', channel).limit(1)
      if (cancelled) return
      openedReadAt.current = data?.[0]?.last_read_at ?? null
      markChannelRead(channel)
    })()
    return () => { cancelled = true; openedReadAt.current = undefined }
  }, [room, profile, channel])
  useEffect(() => {
    if (room && profile && posts && document.visibilityState === 'visible') markChannelRead(channel)
  }, [room, profile, posts, channel])

  useEffect(() => { load() }, [load, reloadKey])
  useReloadOnReturn(load)

  useEffect(() => {
    if (!subscribe) return
    const ch = supabase
      .channel(`runner-notes-${channel}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runner_note_posts', filter: `channel=eq.${channel}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_tasks' }, () => { if (posts) loadTasks(posts) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, load, subscribe])

  // Room: land on the newest message. On first load and after a send.
  const pinBottom = useRef(true)
  useLayoutEffect(() => {
    if (!room || !feedRef.current || !pinBottom.current) return
    feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [room, posts])

  async function loadOlder() {
    if (!posts || posts.length === 0) return
    setLoadingOlder(true)
    pinBottom.current = false
    const oldest = posts[posts.length - 1].created_at
    const { data, error } = await supabase
      .from('runner_note_posts')
      .select('*')
      .eq('channel', channel)
      .lt('created_at', oldest)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    setLoadingOlder(false)
    if (!dbResult('Loading older notes', error)) return
    const more = (data ?? []) as ChannelPost[]
    setPosts(prev => { const next = [...(prev ?? []), ...more]; loadTasks(next); return next })
    setHaveOlder(more.length === PAGE)
  }

  // ── What the draft will do — shown before send ──────────────────────────
  const mentioned = parseMentions(text, roster)
  const timeTok = parseTime(text)
  const taskFor = taskStudio && mentioned.length === 1 && timeTok ? mentioned[0] : null
  const taskText = taskFor ? taskTextFrom(text, handleFor(taskFor, roster)) : ''

  async function send() {
    if (!profile || sending || (noteIsEmpty(text) && photos.length === 0)) return
    setSending(true)
    const { data: post, error } = await supabase.from('runner_note_posts').insert({
      channel,
      studio: taskStudio,
      author_id: profile.id,
      author_name: authorName,
      role: isRunner ? role : null,
      source: isRunner ? 'runner' : 'office',
      text: noteIsEmpty(text) ? '' : text,
      photo_urls: photos.length > 0 ? photos : null,
      mentions: mentioned.map(p => p.id),
    }).select('id').single()
    if (!dbResult('Posting note', error)) { setSending(false); return }
    if (taskFor && taskStudio && post) {
      const { data: task, error: tErr } = await supabase.from('studio_tasks').insert({
        studio: taskStudio,
        task: taskText || `See note from ${authorName}`,
        created_by_name: authorName,
        assigned_to: taskFor.id,
        assigned_to_name: taskFor.display_name,
        due_time: timeTok,
        post_id: post.id,
      }).select('id').single()
      if (dbResult('Creating the task', tErr) && task) {
        const { error: uErr } = await supabase.from('runner_note_posts').update({ task_id: task.id }).eq('id', post.id)
        dbResult('Linking the task', uErr, { silent: true })
      }
    }
    setSending(false)
    setText(''); setPhotos([])
    clearDraft(dKey)
    pinBottom.current = true
    load()
  }

  async function saveEdit(p: ChannelPost) {
    if (noteIsEmpty(editText)) return
    const { error } = await supabase
      .from('runner_note_posts')
      .update({ text: editText, updated_at: new Date().toISOString(), mentions: parseMentions(editText, roster).map(x => x.id) })
      .eq('id', p.id)
    if (!dbResult('Saving note edit', error)) return
    setEditingId(null)
    load()
  }

  const canSend = !sending && !uploading && !(noteIsEmpty(text) && photos.length === 0)
  const chip: React.CSSProperties = {
    fontSize: 8, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
    background: 'var(--c-wash2)', borderRadius: 99, padding: '1px 7px', color: 'var(--c-fg-2)', flexShrink: 0,
  }
  const tagQ = tagQuery.trim().toLowerCase()
  const tagList = roster.filter(p => !tagQ || p.display_name.toLowerCase().includes(tagQ))

  // ── Composer ─────────────────────────────────────────────────────────────
  const composer = (
    <div style={{ position: 'relative', padding: room ? '8px 12px calc(10px + env(safe-area-inset-bottom, 0px))' : '9px 12px 11px', background: 'var(--c-srf, var(--c-bg))', borderTop: room ? '1px solid var(--c-wash2)' : undefined, borderBottom: room ? undefined : '1px solid var(--c-wash2)' }}>
      {/* Tag popover — above the composer, roster filtered as you type. */}
      {tagOpen && (
        <div style={{ position: 'absolute', left: 10, right: 10, bottom: room ? '100%' : undefined, top: room ? undefined : '100%', marginBottom: room ? -2 : 0, marginTop: room ? 0 : -2, zIndex: 30, background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh), 0 10px 30px rgba(0,0,0,0.3)', borderRadius: 14, padding: 6, maxHeight: 260, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 6px' }}>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }}>Tag someone</span>
            <input autoFocus value={tagQuery} onChange={e => setTagQuery(e.target.value)} placeholder="name…"
              style={{ marginLeft: 'auto', width: 120, background: 'var(--c-wash)', border: 'none', borderRadius: 8, padding: '4px 8px', font: 'inherit', fontSize: 11, color: 'var(--c-fg)', outline: 'none' }} />
            <button onClick={() => { setTagOpen(false); setTagQuery('') }} style={{ background: 'none', border: 'none', color: 'var(--c-fg-3)', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}>✕</button>
          </div>
          {tagList.map(p => (
            <button key={p.id} onClick={() => { typed(appendHandle(text, handleFor(p, roster))); setTagOpen(false); setTagQuery('') }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', borderRadius: 9, background: 'none', border: 'none', font: 'inherit', fontSize: 11.5, fontWeight: 600, color: 'var(--c-fg)', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ width: 22, height: 22, borderRadius: 99, background: isOfficeRole(p.role) ? 'var(--c-fg)' : 'var(--c-wash2)', color: isOfficeRole(p.role) ? 'var(--c-bg)' : 'var(--c-fg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 8, flexShrink: 0 }}>{avatarInitials(p)}</span>
              {p.display_name}
              <span style={{ marginLeft: 'auto', fontSize: 8.5, color: 'var(--c-fg-3)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{isOfficeRole(p.role) ? 'Office' : 'Runner'}</span>
            </button>
          ))}
          {tagList.length === 0 && <div style={{ fontSize: 11, opacity: 0.5, padding: '6px 8px' }}>Nobody by that name.</div>}
        </div>
      )}
      {isRunner && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 7 }}>
          {ROLES.map(r => (
            <button key={r.key} onClick={() => pickRole(r.key)}
              style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', borderRadius: 99, padding: '5px 12px', cursor: 'pointer', background: role === r.key ? 'var(--c-ivory)' : 'var(--c-wash)', color: role === r.key ? '#1b1a17' : 'var(--c-fg-2)' }}>{r.label}</button>
          ))}
        </div>
      )}
      <RichNoteEditor value={text} onChange={typed} minHeight={room ? 40 : 44} placeholder={`Message ${CHANNEL_SHORT[channel]}…`} />
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
          {photos.map(ph => (
            <span key={ph} style={{ position: 'relative', display: 'inline-flex' }}>
              <SignedImage path={ph} alt="Attached photo" style={{ height: 58, borderRadius: 8, display: 'block' }} />
              <button onClick={() => removePhoto(ph)} aria-label="Remove photo"
                style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 99, background: 'var(--c-fg)', color: 'var(--c-bg)', fontSize: 10, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>✕</button>
            </span>
          ))}
        </div>
      )}
      {/* What this message will do. */}
      {(mentioned.length > 0 || taskFor) && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {mentioned.length > 0 && !taskFor && (
            <div style={{ fontSize: 10, color: 'var(--c-fg-3)' }}>
              Tagging {mentioned.map(p => <b key={p.id} style={{ color: 'var(--c-st-cold)', marginRight: 5 }}>@{handleFor(p, roster)}</b>)}
            </div>
          )}
          {taskFor && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--c-wash)', borderRadius: 10, padding: '6px 9px', border: '1px dashed color-mix(in srgb, var(--c-st-warm) 50%, transparent)' }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, border: '1.5px solid var(--c-fg-3)', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ display: 'block', fontSize: 8, color: 'var(--c-fg-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>task for {taskFor.display_name}</span>
                {taskText || '(the note)'}
              </span>
              <span className="c-mono" style={{ fontSize: 10, fontWeight: 600, color: 'var(--c-st-warm)', flexShrink: 0 }}>{timeTok}</span>
            </div>
          )}
          {mentioned.length === 1 && timeTok && !taskStudio && (
            <div style={{ fontSize: 9.5, color: 'var(--c-fg-3)' }}>A time in General doesn't make a task — post it in the studio's channel for that.</div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7 }}>
        <input ref={photoInput} type="file" accept="image/*" multiple onChange={pickPhotos} style={{ display: 'none' }} />
        <button onClick={() => photoInput.current?.click()} disabled={uploading || photos.length >= 4} aria-label="Add photo"
          style={{ background: 'var(--c-wash)', color: 'var(--c-fg-2)', fontSize: 13, borderRadius: 99, minWidth: 34, minHeight: 34, cursor: 'pointer', opacity: photos.length >= 4 ? 0.4 : 1 }}>{uploading ? '…' : '📷'}</button>
        <button onClick={() => setTagOpen(o => !o)} aria-label="Tag someone"
          style={{ background: tagOpen ? 'var(--c-fg)' : 'var(--c-wash)', color: tagOpen ? 'var(--c-bg)' : 'var(--c-fg-2)', fontSize: 14, fontWeight: 800, borderRadius: 99, minWidth: 34, minHeight: 34, cursor: 'pointer' }}>@</button>
        <span style={{ fontSize: 9, color: 'var(--c-fg-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {uploading ? 'Uploading photo…' : noteIsEmpty(text) && photos.length === 0 ? 'Tag someone with @ · a tag + a time makes a task' : 'Draft kept'}
        </span>
        <button onClick={send} disabled={!canSend}
          style={{ background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', borderRadius: 99, padding: '7px 18px', minHeight: 34, cursor: canSend ? 'pointer' : 'default', opacity: canSend ? 1 : 0.45 }}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )

  // ── Feed ─────────────────────────────────────────────────────────────────
  const ordered = room ? [...(posts ?? [])].reverse() : (posts ?? [])
  const openedAt = openedReadAt.current
  const firstNewId = room && posts && profile
    ? ordered.find(p => p.author_id !== profile.id && (openedAt === null || (openedAt && p.created_at > openedAt)))?.id ?? null
    : null

  const feed = (
    <div ref={feedRef} style={room
      ? { flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: '8px 12px 10px', background: 'var(--c-bg)' }
      : { maxHeight, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: '10px 13px 6px' }}>
      {room && haveOlder && (
        <button onClick={loadOlder} disabled={loadingOlder}
          style={{ display: 'block', margin: '2px auto 8px', background: 'var(--c-wash)', color: 'var(--c-fg-2)', fontSize: 10, fontWeight: 800, borderRadius: 99, padding: '5px 14px', cursor: 'pointer' }}>
          {loadingOlder ? 'Loading…' : 'Earlier notes'}
        </button>
      )}
      {posts === null && <div style={{ fontSize: 12, opacity: 0.5, padding: '6px 0' }}>Loading…</div>}
      {posts !== null && posts.length === 0 && (
        <div style={{ fontSize: 12, opacity: 0.5, padding: '14px 0', textAlign: room ? 'center' : 'left' }}>
          {channel === 'general' ? 'Nothing in General yet — everyone at every studio sees this one.' : 'No notes yet — start the channel.'}
        </div>
      )}
      {ordered.map((p, i) => {
        const prev = ordered[i - 1]
        const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(p.created_at)
        const mine = !!profile && p.author_id === profile.id
        const forMe = !!profile && (p.mentions ?? []).includes(profile.id)
        const task = tasks[p.id]
        const office = p.source === 'office'
        return (
          <div key={p.id}>
            {newDay && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '9px 0 7px', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }}>
                <span style={{ flex: 1, height: 1, background: 'var(--c-wash2)' }} />{dayLabel(p.created_at)}<span style={{ flex: 1, height: 1, background: 'var(--c-wash2)' }} />
              </div>
            )}
            {firstNewId === p.id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 8px', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-st-warm)' }}>
                <span style={{ flex: 1, height: 1, background: 'color-mix(in srgb, var(--c-st-warm) 45%, transparent)' }} />New since you looked<span style={{ flex: 1, height: 1, background: 'color-mix(in srgb, var(--c-st-warm) 45%, transparent)' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: room ? 10 : 9 }}>
              {room && (
                <span style={{ width: 28, height: 28, borderRadius: 99, flexShrink: 0, marginTop: 2, background: office ? 'var(--c-fg)' : 'var(--c-wash2)', color: office ? 'var(--c-bg)' : 'var(--c-fg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 9.5, fontWeight: 600 }}>
                  {nameInitials(p.author_name)}
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 1 }}>
                  <span style={{ fontWeight: 800, fontSize: 12 }}>{p.author_name || '—'}</span>
                  {office ? <span style={chip}>Office</span> : p.role && <span style={chip}>{p.role}</span>}
                  <span style={{ fontSize: 9.5, color: 'var(--c-fg-3)', marginLeft: room ? 'auto' : undefined, fontFamily: room ? "'DM Mono', ui-monospace, monospace" : undefined }}>
                    {fmtTime(p.created_at)}
                    {new Date(p.updated_at).getTime() - new Date(p.created_at).getTime() > 60000 && ' · edited'}
                  </span>
                  {mine && editingId !== p.id && (
                    <button onClick={() => { setEditingId(p.id); setEditText(p.text) }} aria-label="Edit note"
                      style={{ marginLeft: room ? 0 : 'auto', background: 'none', color: 'var(--c-fg-3)', fontSize: 11, cursor: 'pointer', padding: '0 4px' }}>✎</button>
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
                  <div style={room
                    ? { background: mine ? 'var(--c-wash2)' : 'var(--c-srf, var(--c-bg))', boxShadow: mine ? (forMe ? 'inset 3px 0 0 var(--c-st-warm)' : 'none') : (forMe ? 'var(--c-softsh), inset 3px 0 0 var(--c-st-warm)' : 'var(--c-softsh)'), borderRadius: '4px 12px 12px 12px', padding: '8px 10px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--c-fg)', marginTop: 3 }
                    : { fontSize: 12.5, lineHeight: 1.55, color: 'var(--c-fg-2)', boxShadow: forMe ? 'inset 3px 0 0 var(--c-st-warm)' : undefined, paddingLeft: forMe ? 8 : 0 }}>
                    {p.text !== '' && <RichNoteView html={markMentions(p.text)} />}
                    {(p.photo_urls ?? []).length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: p.text !== '' ? 5 : 2 }}>
                        {(p.photo_urls ?? []).map(ph => (
                          <span key={ph} onClick={() => setLightbox(ph)} style={{ cursor: 'pointer', display: 'inline-flex' }}>
                            <SignedImage path={ph} alt="Note photo" style={{ maxHeight: 110, maxWidth: 160, borderRadius: 8, display: 'block' }} />
                          </span>
                        ))}
                      </div>
                    )}
                    {task && (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--c-bg)', borderRadius: 10, padding: '6px 9px', border: `1px dashed color-mix(in srgb, ${task.done_at ? 'var(--c-st-booked)' : 'var(--c-st-warm)'} 50%, transparent)` }}>
                        <span style={{ width: 15, height: 15, borderRadius: 5, flexShrink: 0, border: task.done_at ? 'none' : '1.5px solid var(--c-fg-3)', background: task.done_at ? 'var(--c-st-booked)' : 'transparent', color: 'var(--c-chip-ink)', fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{task.done_at ? '✓' : ''}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: task.done_at ? 0.55 : 1 }}>
                          <span style={{ display: 'block', fontSize: 8, color: 'var(--c-fg-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>task for {task.assigned_to_name ?? '—'}{task.done_at ? ` · done ${fmtTime(task.done_at)}` : ''}</span>
                          {task.task}
                        </span>
                        {task.due_time && <span className="c-mono" style={{ fontSize: 10, fontWeight: 600, color: task.done_at ? 'var(--c-fg-3)' : 'var(--c-st-warm)', flexShrink: 0 }}>{task.due_time}</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
      {!room && haveOlder && (
        <button onClick={loadOlder} disabled={loadingOlder}
          style={{ display: 'block', margin: '2px auto 8px', background: 'var(--c-wash)', color: 'var(--c-fg-2)', fontSize: 10, fontWeight: 800, borderRadius: 99, padding: '5px 14px', cursor: 'pointer' }}>
          {loadingOlder ? 'Loading…' : 'Load older notes'}
        </button>
      )}
    </div>
  )

  return (
    <div style={room
      ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }
      : { background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 16, overflow: 'hidden' }}>
      {room ? <>{feed}{composer}</> : <>{composer}{feed}</>}
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10040, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, cursor: 'pointer' }}>
          <SignedImage path={lightbox} alt="Note photo" style={{ maxWidth: '94vw', maxHeight: '86vh', borderRadius: 12 }} />
        </div>
      )}
    </div>
  )
}
