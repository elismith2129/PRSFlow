'use client'
// TEMPORARY: remove when rollout period ends
// Lightweight staff feedback board for the rollout period (bugs / suggestions /
// questions). Backed by the temporary `app_feedback` table + RLS
// (supabase/migrations/20260713120000_app_feedback_temporary.sql).
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'

// TEMPORARY: remove when rollout period ends
type FeedbackType = 'bug' | 'suggestion' | 'question'

// TEMPORARY: remove when rollout period ends
interface AppFeedback {
  id: string
  created_at: string
  author_name: string | null
  type: FeedbackType
  note: string
  resolved: boolean
}

// TEMPORARY: remove when rollout period ends — type badge colors (red/lime/blue)
const TYPE_META: Record<FeedbackType, { label: string; color: string }> = {
  bug: { label: 'Bug', color: 'var(--hot)' },
  suggestion: { label: 'Suggestion', color: 'var(--accent)' },
  question: { label: 'Question', color: 'var(--uncontacted)' },
}

// TEMPORARY: remove when rollout period ends
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// TEMPORARY: remove when rollout period ends — entire page/route
export default function FeedbackPage() {
  const { profile } = useUserProfile()
  const authorName = profile?.display_name || 'Staff'
  const canModerate = profile?.role === 'owner' || profile?.role === 'manager'

  const [items, setItems] = useState<AppFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState<FeedbackType>('bug')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('app_feedback')
      .select('*')
      .order('created_at', { ascending: false })
    setItems((data as AppFeedback[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // Standing architecture rule: pair every Supabase fetch with a realtime subscription.
    const channel = supabase
      .channel('app-feedback-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_feedback' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function handleSubmit() {
    if (!note.trim() || submitting) return
    setSubmitting(true)
    await supabase.from('app_feedback').insert({
      author_name: authorName,
      type,
      note: note.trim(),
      resolved: false,
    })
    setNote('')
    setType('bug')
    setSubmitting(false)
    load()
  }

  async function toggleResolved(item: AppFeedback) {
    if (!canModerate) return
    await supabase.from('app_feedback').update({ resolved: !item.resolved }).eq('id', item.id)
    load()
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontFamily: 'DM Mono', fontWeight: 500, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 8,
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* TEMPORARY: remove when rollout period ends — banner */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 20, padding: '8px 12px', border: '1px dashed rgba(200,240,78,0.4)', borderRadius: 8, background: 'rgba(200,240,78,0.06)' }}>
        <span style={{ fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>Temporary</span>
        <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text2)' }}>
          Rollout feedback board — report bugs, suggestions, and questions about the app.
        </span>
      </div>

      {/* Title */}
      <h1 style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 24, letterSpacing: -0.5, marginBottom: 16, color: 'var(--text)' }}>
        Staff Feedback
      </h1>

      {/* ── Submit form ─────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <div style={labelStyle}>Type</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(Object.keys(TYPE_META) as FeedbackType[]).map(t => {
            const meta = TYPE_META[t]
            const selected = type === t
            return (
              <button
                key={t}
                onClick={() => setType(t)}
                style={{
                  flex: 1, padding: '8px 0', fontSize: 11, fontFamily: 'Syne', fontWeight: 700,
                  letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
                  borderRadius: 8, transition: 'all 0.15s',
                  color: selected ? 'var(--bg)' : meta.color,
                  background: selected ? meta.color : 'transparent',
                  border: `1px solid ${selected ? meta.color : 'var(--border)'}`,
                }}
              >
                {meta.label}
              </button>
            )
          })}
        </div>

        <div style={labelStyle}>Note</div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Describe the bug, suggestion, or question…"
          rows={4}
          style={{
            width: '100%', padding: 10, fontSize: 12, fontFamily: 'DM Mono',
            background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--text)', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 12 }}>
          <span style={{ fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text3)' }}>
            Posting as {authorName}
          </span>
          <button
            onClick={handleSubmit}
            disabled={!note.trim() || submitting}
            style={{
              padding: '8px 18px', fontSize: 11, fontFamily: 'Syne', fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase', borderRadius: 8, border: 'none',
              background: note.trim() ? 'var(--accent)' : 'var(--surface2)',
              color: note.trim() ? 'var(--bg)' : 'var(--text3)',
              cursor: note.trim() && !submitting ? 'pointer' : 'default',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>

      {/* ── Feed ─────────────────────────────── */}
      <div style={labelStyle}>Feed</div>
      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 11, fontFamily: 'DM Mono' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 11, fontFamily: 'DM Mono' }}>No feedback yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(item => {
            const meta = TYPE_META[item.type] || TYPE_META.question
            return (
              <div
                key={item.id}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                  padding: '12px 14px', opacity: item.resolved ? 0.5 : 1, transition: 'opacity 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', padding: '2px 7px', borderRadius: 4,
                    color: meta.color, background: `${meta.color}1f`, border: `1px solid ${meta.color}55`,
                  }}>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: 12, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text)' }}>
                    {item.author_name || 'Staff'}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text3)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                    {fmtWhen(item.created_at)}
                  </span>
                  {/* TEMPORARY: remove when rollout period ends — owner/manager-only resolve toggle */}
                  {canModerate && (
                    <button
                      onClick={() => toggleResolved(item)}
                      style={{
                        flexShrink: 0, padding: '3px 8px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700,
                        letterSpacing: '0.04em', textTransform: 'uppercase', borderRadius: 4, cursor: 'pointer',
                        background: 'transparent',
                        border: `1px solid ${item.resolved ? 'var(--accent)' : 'var(--border)'}`,
                        color: item.resolved ? 'var(--accent)' : 'var(--text3)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      ✓ Resolved
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 13, fontFamily: 'DM Mono', color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {item.note}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
