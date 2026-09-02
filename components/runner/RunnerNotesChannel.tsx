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
import { SignedImage } from '@/components/shared/SignedImage'

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
  /** Storage PATHS in the private checklist-photos bucket — signed at read. */
  photo_urls: string[] | null
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
  // Photos upload ON PICK (not on Send): the storage PATH goes into state and
  // the draft immediately, so a picked photo survives navigating away exactly
  // like typed text does. The cost is a stray uploaded file when a note is
  // abandoned — cheap, invisible, and the draft's photos are re-offered on
  // return rather than lost.
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  const feedRef = useRef<HTMLDivElement>(null)
  const stickBottomRef = useRef(true)
  const textRef = useRef(text); textRef.current = text
  const roleRef = useRef(role); roleRef.current = role

  // Draft net — keyed on the ops day only so lib/draft's 3-day pruning can
  // read it; a draft that old is honestly stale. Restored before first paint
  // of the composer.
  const dKey = draftKey('runner-channel', studio, opsToday())
  const photosRef = useRef(photos); photosRef.current = photos
  useEffect(() => {
    const d = readDraft<{ text: string; role: Role | null; photos?: string[] }>(dKey)
    if (d && (!noteIsEmpty(d.text) || (d.photos?.length ?? 0) > 0)) {
      setText(d.text); setRole(d.role ?? null); setPhotos(d.photos ?? [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio])
  const mirror = (patch: Partial<{ text: string; role: Role | null; photos: string[] }>) =>
    writeDraft(dKey, { text: textRef.current, role: roleRef.current, photos: photosRef.current, ...patch })
  const typed = (next: string) => {
    setText(next)
    mirror({ text: next })
  }
  const pickRole = (r: Role) => {
    setRole(prev => {
      const next = prev === r ? null : r
      mirror({ role: next })
      return next
    })
  }

  // Upload on pick — same private bucket + signed-URL pattern as every other
  // photo in the app (lib/photos.ts): store the PATH, sign at read.
  async function pickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // let the same file be picked again after a failure
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
    if (added.length > 0) {
      setPhotos(prev => {
        const next = [...prev, ...added]
        mirror({ photos: next })
        return next
      })
    }
  }
  const removePhoto = (p: string) => {
    setPhotos(prev => {
      const next = prev.filter(x => x !== p)
      mirror({ photos: next })
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
    // A photo alone is a valid note — "here's the broken thing" needs no prose.
    if (!profile || sending || (noteIsEmpty(text) && photos.length === 0)) return
    setSending(true)
    const { error } = await supabase.from('runner_note_posts').insert({
      studio,
      author_id: profile.id,
      author_name: authorName,
      role: isRunner ? role : null,
      source: isRunner ? 'runner' : 'office',
      text: noteIsEmpty(text) ? '' : text,
      photo_urls: photos.length > 0 ? photos : null,
    })
    setSending(false)
    if (!dbResult('Posting note', error)) return
    // Success ONLY: clear the field and its net. Role stays picked — it is
    // the shift, not the message.
    setText('')
    setPhotos([])
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
                    {p.text !== '' && <RichNoteView html={p.text} />}
                    {(p.photo_urls ?? []).length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: p.text !== '' ? 5 : 2 }}>
                        {(p.photo_urls ?? []).map(ph => (
                          <span key={ph} onClick={() => setLightbox(ph)} style={{ cursor: 'pointer', display: 'inline-flex' }}>
                            <SignedImage path={ph} alt="Note photo" style={{ maxHeight: 110, maxWidth: 160, borderRadius: 8, display: 'block' }} />
                          </span>
                        ))}
                      </div>
                    )}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
          {/* accept + no capture attr: the sheet offers camera AND library. */}
          <input ref={photoInput} type="file" accept="image/*" multiple onChange={pickPhotos} style={{ display: 'none' }} />
          <button
            onClick={() => photoInput.current?.click()}
            disabled={uploading || photos.length >= 4}
            aria-label="Add photo"
            style={{ background: 'var(--c-wash)', color: 'var(--c-fg-2)', fontSize: 13, borderRadius: 99, minWidth: 32, minHeight: 32, cursor: uploading || photos.length >= 4 ? 'default' : 'pointer', opacity: photos.length >= 4 ? 0.4 : 1 }}
          >{uploading ? '…' : '📷'}</button>
          <span style={{ fontSize: 9, color: 'var(--c-fg-3)' }}>
            {uploading ? 'Uploading photo…'
              : noteIsEmpty(text) && photos.length === 0 ? 'Everything you add is kept until you send'
              : 'Draft kept'}
          </span>
          <button
            onClick={send}
            disabled={sending || uploading || (noteIsEmpty(text) && photos.length === 0)}
            style={{
              marginLeft: 'auto', background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)',
              fontSize: 10.5, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
              borderRadius: 99, padding: '7px 18px', minHeight: 32,
              cursor: sending || uploading || (noteIsEmpty(text) && photos.length === 0) ? 'default' : 'pointer',
              opacity: sending || uploading || (noteIsEmpty(text) && photos.length === 0) ? 0.45 : 1,
            }}
          >{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>

      {/* Tap-to-enlarge — same z-band as the runner pages' own overlays. */}
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10040, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, cursor: 'pointer' }}>
          <SignedImage path={lightbox} alt="Note photo" style={{ maxWidth: '94vw', maxHeight: '86vh', borderRadius: 12 }} />
        </div>
      )}
    </div>
  )
}
