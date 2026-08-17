'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /runner/[studio]/shift-notes — the shift LOG (spec §19, 2026-08-14).
//
// Replaces the Slack shift-notes post. Deliberately a log, not a text box:
// real notes run 15+ bullets and a night often has two authors (a runner is
// relieved mid-shift). So: append an entry any time, stamped with who and
// when; the night's entries stack newest-last like the Slack thread did.
//
// Append-only — an entry is a record, not a draft (no edit, no delete; the
// table has no policies for either). Write another entry to correct one.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { getLocalToday, dayPartLabel, dayPartPossessive } from '@/lib/time'
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
}

export default function ShiftNotesPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio }
  const today = getLocalToday()
  const { profile } = useUserProfile()

  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [author, setAuthor] = useState('')
  const [saving, setSaving] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

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
            someone else just means they add their own.
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
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{e.text}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
