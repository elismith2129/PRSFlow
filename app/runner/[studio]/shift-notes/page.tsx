'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /runner/[studio]/shift-notes — the shift LOG (spec §19, 2026-08-14).
//
// Replaces the Slack shift-notes post. Deliberately a log, not a text box:
// real notes run 15+ bullets and a night often has two authors (a runner is
// relieved mid-shift). So: append an entry any time, stamped with who and
// when; the night's entries stack newest-last like the Slack thread did.
//
// EDITABLE WHILE LIVE, SEALED AT 8:50 AM (Eli, 2026-08-20 — replaced the
// original append-only rule, whose "write another entry to correct a typo"
// bred confusing correction-chains). The log's day runs 8:50 AM → 8:49 AM
// (lib/time shiftLogDate — which also fixed the old midnight split, where a
// 1 AM note filed under tomorrow's page). While the log is live, any entry
// can be tapped and fixed and wears an "edited" marker; at 8:50 AM it seals —
// enforced server-side by the shift_log_entries UPDATE policy (migration
// 20260820130000), not just hidden in the UI. No submit button exists:
// entries are live the moment they're added, and 8:50 AM is the submission.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { shiftLogDate, dayPartLabel, dayPartPossessive } from '@/lib/time'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useReloadOnReturn } from '@/hooks/useReloadOnReturn'

const STUDIO_META: Record<string, { label: string }> = {
  paramount: { label: 'Paramount' },
  ameraycan: { label: 'Ameraycan' },
  encore:    { label: 'Encore' },
  track:     { label: 'Track' },
}

type Entry = {
  id: string
  studio: string
  date: string
  author_name: string
  text: string
  created_at: string
  edited_at: string | null
}

export default function ShiftNotesPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio }
  // The log's day, NOT the calendar's — before 8:50 AM this is yesterday's
  // date, so an after-midnight entry stays on the night it belongs to.
  const today = shiftLogDate()
  const { profile } = useUserProfile()

  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [author, setAuthor] = useState('')
  const [saving, setSaving] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  // Prefill the author from the profile when there is a real person behind the
  // session; the shared runner login has none, so it stays typed. Individual
  // runner logins (spec §15b) make this automatic for everyone.
  useEffect(() => {
    if (!author && profile && profile.email !== 'runner@paramountrecording.com') {
      setAuthor(profile.initials || profile.display_name || '')
    }
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('shift_log_entries')
      .select('*')
      .eq('studio', studio)
      .eq('date', today)
      .order('created_at', { ascending: true })
    setEntries((data ?? []) as Entry[])
  }, [studio, today])

  useEffect(() => { load() }, [load])
  useReloadOnReturn(load)

  useEffect(() => {
    const channel = supabase
      .channel(`runner-shiftlog-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_log_entries' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studio, load])

  async function addEntry() {
    setHint(null)
    if (!draft.trim()) { setHint('Write something first.'); return }
    if (!author.trim()) { setHint('Add your name or initials.'); return }
    setSaving(true)
    const { error } = await supabase.from('shift_log_entries').insert({
      studio, date: today,
      author_name: author.trim(),
      text: draft.trim(),
    })
    setSaving(false)
    if (!dbResult('Saving shift note', error)) return
    setDraft('')
    load()
  }

  // Fix a typo while the log is live. The 8:50 AM seal is enforced by the
  // UPDATE policy — after it, this write returns zero rows and the log stays
  // as the office will review it.
  async function saveEdit(id: string) {
    const text = editDraft.trim()
    if (!text) return
    const { error } = await supabase
      .from('shift_log_entries')
      .update({ text, edited_at: new Date().toISOString() })
      .eq('id', id)
    if (!dbResult('Editing shift note', error)) return
    setEditingId(null)
    setEditDraft('')
    load()
  }

  const surface: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))',
    boxShadow: 'var(--c-softsh)',
    borderRadius: 16,
    padding: '13px 14px',
  }

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
        <div>
          <div className="c-arch" style={{ fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Shift notes</div>
          <div style={{ fontSize: 11.5, opacity: 0.5 }}>
            {meta.label} · {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      <div style={{ padding: '4px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Write */}
        <div style={surface}>
          <div className="c-label" style={{ marginBottom: 8 }}>Add to {dayPartPossessive()} log</div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={7}
            placeholder={'Opened building, bathrooms good\nDid all opening tasks\nLight by the stairs is out — needs a bulb\nOpened A for G Herbo, crew in at 8'}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--c-wash)', border: 'none', borderRadius: 12,
              padding: '11px 13px', color: 'var(--c-fg)', fontSize: 13,
              font: 'inherit', outline: 'none', resize: 'vertical',
              lineHeight: 1.6, marginBottom: 10,
            }}
          />
          <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
            <input
              value={author}
              onChange={e => setAuthor(e.target.value)}
              placeholder="You"
              className="c-mono"
              style={{
                width: 92, minHeight: 46, padding: '10px 10px',
                background: 'var(--c-wash)', border: 'none', borderRadius: 12,
                color: 'var(--c-fg)', fontSize: 13, textAlign: 'center', outline: 'none',
              }}
            />
            <button
              onClick={addEntry}
              disabled={saving}
              className="c-control c-raised"
              style={{
                flex: 1, minHeight: 46, borderRadius: 14,
                background: 'var(--c-wash2)', color: 'var(--c-fg)',
                border: 'none', font: 'inherit', fontSize: 13.5, fontWeight: 800,
                cursor: 'pointer', opacity: saving ? 0.6 : 1,
                boxShadow: 'var(--c-softsh)',
              }}
            >
              {saving ? 'Adding…' : 'Add to log'}
            </button>
          </div>
          {hint && <div style={{ fontSize: 11.5, color: 'var(--c-st-hot)', fontWeight: 700, marginTop: 8 }}>{hint}</div>}
          <div style={{ fontSize: 10.5, opacity: 0.45, marginTop: 8, lineHeight: 1.5 }}>
            Add as many entries as you like through the night — handing off to
            someone else just means they add their own. Tap any entry to fix a
            typo. The log submits itself at 8:50 AM — after that it&apos;s sealed
            for the office&apos;s review and a fresh log starts.
          </div>
        </div>

        {/* The day's log (label tracks the clock — 24/7 operation) */}
        <div style={surface}>
          <div className="c-label" style={{ marginBottom: 8 }}>
            {dayPartLabel()} · {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </div>
          {entries.length === 0 ? (
            <div style={{ fontSize: 12.5, opacity: 0.5 }}>Nothing logged yet.</div>
          ) : entries.map((e, i) => (
            <div key={e.id} style={{
              padding: '10px 0',
              boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
            }}>
              <div className="c-mono" style={{ fontSize: 10.5, fontWeight: 800, opacity: 0.5, marginBottom: 4 }}>
                {e.author_name.toUpperCase()} · {new Date(e.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                {e.edited_at && <span style={{ fontWeight: 400, opacity: 0.8 }}> · edited</span>}
              </div>
              {editingId === e.id ? (
                <div>
                  <textarea
                    value={editDraft}
                    onChange={ev => setEditDraft(ev.target.value)}
                    rows={4}
                    autoFocus
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: 'var(--c-wash)', border: 'none', borderRadius: 10,
                      padding: '9px 11px', color: 'var(--c-fg)', fontSize: 13,
                      font: 'inherit', outline: 'none', resize: 'vertical',
                      lineHeight: 1.6, marginBottom: 8,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => saveEdit(e.id)}
                      className="c-control"
                      style={{ minHeight: 40, padding: '0 20px', borderRadius: 12, background: 'var(--c-wash2)', color: 'var(--c-fg)', border: 'none', font: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
                    >Save fix</button>
                    <button
                      onClick={() => { setEditingId(null); setEditDraft('') }}
                      className="c-control"
                      style={{ minHeight: 40, padding: '0 16px', borderRadius: 12, background: 'transparent', color: 'var(--c-fg)', opacity: 0.6, border: 'none', font: 'inherit', fontSize: 12.5, cursor: 'pointer' }}
                    >Cancel</button>
                  </div>
                </div>
              ) : (
                /* Tap to fix a typo — live-log only; the 8:50 AM seal is
                   enforced by the DB policy, so this is convenience, not the
                   boundary. */
                <div
                  onClick={() => { setEditingId(e.id); setEditDraft(e.text) }}
                  style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', cursor: 'pointer' }}
                >{e.text}</div>
              )}
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
