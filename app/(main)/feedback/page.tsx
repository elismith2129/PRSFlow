'use client'
// TEMPORARY: remove when rollout period ends
// Lightweight staff feedback board for the rollout period (bugs / suggestions /
// questions). Backed by the temporary `app_feedback` table + RLS
// (supabase/migrations/20260713120000_app_feedback_temporary.sql).
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { TestingSection } from '@/components/dev/TestingSection'
import { ErrorsSection } from '@/components/admin/ErrorsSection'

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

// The rollout feedback board. Body untouched — it works and Eli asked that it not
// be changed; it simply became a tab rather than the whole page.
function FeedbackBoard() {
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
    fontSize: 11, fontFamily: 'Inter', fontWeight: 500, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 8,
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* TEMPORARY: remove when rollout period ends — banner */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 20, padding: '8px 12px', border: '1px dashed rgba(var(--accent-rgb),0.4)', borderRadius: 8, background: 'rgba(var(--accent-rgb),0.06)' }}>
        <span style={{ fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>Temporary</span>
        <span style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--text2)' }}>
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
            width: '100%', padding: 10, fontSize: 12, fontFamily: 'Inter',
            background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--text)', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 12 }}>
          <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text3)' }}>
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
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 11, fontFamily: 'Inter' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 11, fontFamily: 'Inter' }}>No feedback yet.</div>
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
                  <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text3)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
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
                <div style={{ fontSize: 13, fontFamily: 'Inter', color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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

// ─── DEV page shell ──────────────────────────────────────────────────────────
// Left sidebar matching the Admin page, so the two internal tool pages navigate
// the same way. Sections:
//   Feedback — the rollout board, open to any signed-in staff member
//   Testing  — PIN-gated (4321) test batches
//   Errors   — the app_errors sink, moved here from Admin. ELI ONLY: staff seeing
//              raw stack traces invites alarm about things that are already handled,
//              and it's a developer tool, not an operations one.
type DevSection = 'feedback' | 'testing' | 'errors'

const DEV_NAV: { key: DevSection; label: string }[] = [
  { key: 'feedback', label: 'Feedback' },
  { key: 'testing', label: 'Testing' },
  { key: 'errors', label: 'Errors' },
]

export default function DevPage() {
  const [section, setSection] = useState<DevSection>('feedback')
  const { profile } = useUserProfile()
  // Eli only — matched on his accounts, the same gate the CRM Campaigns tab uses.
  // Deliberately narrower than the app_errors RLS policy (which allows
  // owner/manager); RLS stays as-is, this just hides the surface.
  const isEli = profile?.email === 'srv2129@gmail.com' || profile?.email === 'eli@paramountrecording.com'
  const visibleNav = DEV_NAV.filter(n => n.key !== 'errors' || isEli)

  // Layout matches app/(main)/admin/page.tsx exactly — no negative margins, so the
  // sidebar sits inside the layout's padding rather than pinned to the window edge.
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar — mirrors components/../admin/page.tsx */}
      <div data-panel="admin-sidebar" style={{
        width: 200, flexShrink: 0, borderRight: '1px solid var(--border)',
        padding: '28px 0', display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', padding: '0 20px 12px' }}>
          Dev
        </div>
        {visibleNav.map(({ key, label }) => {
          const active = section === key
          return (
            <button
              key={key}
              onClick={() => setSection(key)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 20px', border: 'none', cursor: 'pointer',
                fontFamily: 'Inter', fontSize: 12,
                background: active ? 'var(--surface2)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--text2)',
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '28px 32px', minWidth: 0 }}>
        {/* Reading-width and centred, which is how the feedback board looked before
            it became a tab. Errors is a dense table and takes the full width. */}
        {section === 'feedback' && <div style={{ maxWidth: 720, margin: '0 auto' }}><FeedbackBoard /></div>}
        {/* Wider than the feedback board: Testing is two columns, not reading-width prose. */}
        {section === 'testing' && <div style={{ maxWidth: 1100, margin: '0 auto' }}><TestingSection /></div>}
        {section === 'errors' && isEli && <ErrorsSection />}
      </div>
    </div>
  )
}
