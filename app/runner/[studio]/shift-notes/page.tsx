'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /runner/[studio]/shift-notes — ONE BIG FIELD PER SHIFT (Eli, 2026-08-26).
//
// Supersedes the timestamped shift LOG (spec §19, shift_log_entries) — built
// Aug 14, sealed-edit added Aug 20, never adopted. Eli's ruling: this
// replaces the runners' Slack notes with the MANAGER-NOTES feel — "not logs
// with timestamps but a large text field they add to and it always saves so
// they never lose anything even if they close the app."
//
//   · One doc per (studio, shift-day, author) in shift_note_docs. A night
//     has at most an opener, a floater and a closer — the note is attached
//     to the person's shift via the role chips (warn-never-block: unset is
//     allowed, the office just sees no role).
//   · NO SAVE BUTTON. The field autosaves ~1s after typing stops, plus a
//     flush when the app is backgrounded/closed, plus the lib/draft
//     localStorage net underneath (applied on return, cleared only after a
//     confirmed server save). A quiet "Saved · 10:42 PM" line shows state.
//   · Every return key auto-inserts a bullet (Eli's ask) — the field starts
//     with one too.
//   · Same 8:50 AM shift-day + seal as the old log (lib/time shiftLogDate;
//     enforced server-side by shift_note_docs' INSERT/UPDATE policies,
//     migration 20260826140000). After 8:50 the page is simply a fresh day.
//   · Other runners' notes for the night render read-only below, live.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { shiftLogDate } from '@/lib/time'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useReloadOnReturn } from '@/hooks/useReloadOnReturn'
import { draftKey, readDraft, writeDraft, clearDraft } from '@/lib/draft'

const STUDIO_META: Record<string, { label: string }> = {
  paramount: { label: 'Paramount' },
  ameraycan: { label: 'Ameraycan' },
  encore:    { label: 'Encore' },
  track:     { label: 'Track' },
}

type Role = 'opener' | 'floater' | 'closer'
const ROLES: { key: Role; label: string }[] = [
  { key: 'opener', label: 'Opener' },
  { key: 'floater', label: 'Floater' },
  { key: 'closer', label: 'Closer' },
]

type Doc = {
  id: string
  studio: string
  date: string
  author_id: string | null
  author_name: string
  role: Role | null
  text: string
  updated_at: string
}

export default function ShiftNotesPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio }
  // The note's day, NOT the calendar's — before 8:50 AM this is yesterday's
  // date, so after-midnight typing stays on the night it belongs to.
  const today = shiftLogDate()
  const { profile } = useUserProfile()

  const [text, setText] = useState('')
  const [role, setRole] = useState<Role | null>(null)
  const [others, setOthers] = useState<Doc[]>([])
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // True once the runner types; blocks realtime/server refreshes from
  // clobbering the field mid-edit. Cleared when a save confirms.
  const dirtyRef = useRef(false)
  const textRef = useRef(text); textRef.current = text
  const roleRef = useRef(role); roleRef.current = role
  const loadedRef = useRef(false)

  const authorName = profile ? (profile.initials || profile.display_name || 'Runner') : ''

  const grow = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.max(280, ta.scrollHeight) + 'px'
  }, [])

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('shift_note_docs')
      .select('*')
      .eq('studio', studio)
      .eq('date', today)
    const docs = (data ?? []) as Doc[]
    setOthers(docs.filter(d => d.author_id !== profile?.id))
    const mine = docs.find(d => d.author_id === profile?.id)
    if (!dirtyRef.current) {
      if (mine) { setText(mine.text); setRole(mine.role); setSaveState('saved'); setSavedAt(mine.updated_at) }
      // The localStorage net: unsaved typing from a previous visit wins over
      // the server (it is strictly newer — it never got saved).
      const draft = readDraft<{ text: string; role: Role | null }>(draftKey('shift-note', studio, today))
      if (draft && draft.text !== (mine?.text ?? '')) {
        setText(draft.text); setRole(draft.role ?? mine?.role ?? null)
        dirtyRef.current = true
        setSaveState('dirty')
      }
    }
    loadedRef.current = true
    setTimeout(grow, 0)
  }, [studio, today, profile?.id, grow])

  // Profile resolves async — the doc is keyed by author_id, so wait for it.
  useEffect(() => { if (profile) load() }, [profile, load])
  useReloadOnReturn(useCallback(() => { if (profile && !dirtyRef.current) load() }, [profile, load]))

  useEffect(() => {
    const channel = supabase
      .channel(`runner-shiftnotes-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_note_docs' }, () => {
        // Others' notes refresh freely; own field is dirty-guarded inside load.
        if (profile) load()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studio, profile, load])

  // ── The always-save engine ────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!profile) return
    const body = {
      studio, date: today,
      author_id: profile.id,
      author_name: profile.initials || profile.display_name || 'Runner',
      role: roleRef.current,
      text: textRef.current,
    }
    setSaveState('saving')
    const { error } = await supabase
      .from('shift_note_docs')
      .upsert(body, { onConflict: 'studio,date,author_id' })
    if (!dbResult('Saving shift note', error)) { setSaveState('error'); return }
    // Only clear the net if nothing new was typed while the save flew.
    if (textRef.current === body.text && roleRef.current === body.role) {
      dirtyRef.current = false
      clearDraft(draftKey('shift-note', studio, today))
      setSaveState('saved')
      setSavedAt(new Date().toISOString())
    }
  }, [profile, studio, today])
  const saveRef = useRef(save); saveRef.current = save

  // Debounced autosave + draft mirror on every keystroke.
  useEffect(() => {
    if (!loadedRef.current || !dirtyRef.current) return
    writeDraft(draftKey('shift-note', studio, today), { text, role })
    setSaveState('dirty')
    const t = setTimeout(() => { saveRef.current() }, 1000)
    return () => clearTimeout(t)
  }, [text, role, studio, today])

  // Flush when the app is backgrounded or the page unmounts — iOS killing
  // the PWA mid-shift must not cost a word (the draft net catches the rest).
  useEffect(() => {
    const flush = () => { if (dirtyRef.current) saveRef.current() }
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  function typed(next: string) {
    dirtyRef.current = true
    setText(next)
    grow()
  }

  // Every return key starts a fresh bullet (Eli's ask).
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const ta = e.currentTarget
    const { selectionStart: s, selectionEnd: eIdx, value } = ta
    const insert = '\n• '
    const next = value.slice(0, s) + insert + value.slice(eIdx)
    typed(next)
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + insert.length })
  }

  function onFocus() {
    if (text.trim() === '') typed('• ')
  }

  function pickRole(r: Role) {
    dirtyRef.current = true
    setRole(prev => (prev === r ? null : r))
  }

  const fmtClockTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  const surface: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))',
    boxShadow: 'var(--c-softsh)',
    borderRadius: 16,
    padding: '13px 14px',
  }

  const statusLine =
    saveState === 'saving' ? 'Saving…'
    : saveState === 'dirty' ? 'Typing…'
    : saveState === 'error' ? 'NOT saved — check connection'
    : saveState === 'saved' && savedAt ? `Saved · ${fmtClockTime(savedAt)}`
    : 'Everything you type saves by itself'

  return (
    <div style={{
      minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden',
      background: 'var(--c-bg)', color: 'var(--c-fg)',
      paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '14px 16px 10px', position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--c-bg)',
      }}>
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="c-arch" style={{ fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Shift notes</div>
          <div style={{ fontSize: 11.5, opacity: 0.5 }}>
            {meta.label} · {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700, flexShrink: 0,
          opacity: saveState === 'error' ? 1 : 0.45,
          color: saveState === 'error' ? 'var(--c-st-hot)' : 'var(--c-fg)',
        }}>
          {statusLine}
        </div>
      </div>

      <div style={{ padding: '4px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── My note ─────────────────────────────────────────────────────── */}
        <div style={surface}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 800 }}>{authorName || '…'}</span>
            <span style={{ flex: 1 }} />
            {ROLES.map(r => {
              const on = role === r.key
              return (
                <button
                  key={r.key}
                  onClick={() => pickRole(r.key)}
                  style={{
                    border: 'none', font: 'inherit', cursor: 'pointer',
                    borderRadius: 99, padding: '6px 12px', minHeight: 30,
                    fontSize: 10, fontWeight: 800, letterSpacing: '0.04em',
                    background: on ? 'var(--c-wash2)' : 'var(--c-wash)',
                    color: 'var(--c-fg)', opacity: on ? 1 : 0.55,
                    boxShadow: on ? 'inset 0 0 0 1.5px rgba(217,214,205,0.3)' : undefined,
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {r.label}
                </button>
              )
            })}
          </div>
          <textarea
            ref={taRef}
            value={text}
            onChange={e => typed(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            placeholder={'• Everything from your shift goes here — sessions, runs, anything the office should know.\n\nIt saves as you type. Return starts a new bullet.'}
            style={{
              width: '100%', boxSizing: 'border-box', minHeight: 280, resize: 'none',
              background: 'var(--c-wash)', border: 'none', borderRadius: 12,
              padding: '12px 13px', color: 'var(--c-fg)', font: 'inherit',
              fontSize: 13.5, lineHeight: 1.65, outline: 'none',
            }}
          />
          {!role && text.trim() !== '' && (
            <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6 }}>
              Tap Opener / Floater / Closer so the office knows which shift this was.
            </div>
          )}
        </div>

        {/* ── The rest of the night ───────────────────────────────────────── */}
        {others.filter(d => d.text.trim() !== '').length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="c-label">Also on tonight</div>
            {others.filter(d => d.text.trim() !== '').map(d => (
              <div key={d.id} style={surface}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800 }}>{d.author_name}</span>
                  {d.role && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.5 }}>{d.role}</span>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 9.5, opacity: 0.4 }}>{fmtClockTime(d.updated_at)}</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
                  {d.text}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
