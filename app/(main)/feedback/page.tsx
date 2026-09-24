'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /feedback — the DEV page: Feedback · Runner · Testing · Errors.
//
// RECARVED 2026-09-23 (Eli: "the Dev section has the old UI and doesn't work
// on phone, all scrambled"). This page and its three sections were the last
// surfaces still on the pre-carved tokens (--surface / --accent / Syne) with
// a fixed 200px sidebar copied from /admin — on a phone the sidebar ate half
// the width and the content wrapped under it. Now: one heading, a c-seg
// section switcher that wraps, and each section on the carved tokens with an
// isMobile branch where the desktop layout is a grid.
//
// Sections:
//   Feedback — the rollout board, open to any signed-in staff member
//   Runner   — bugs/ideas filed from the runner hub (same table, source='runner')
//   Testing  — PIN-gated (4321) test batches
//   Errors   — the app_errors sink. ELI ONLY: staff seeing raw stack traces
//              invites alarm about things already handled.
//
// Backed by the `app_feedback` table + RLS
// (supabase/migrations/20260713120000_app_feedback_temporary.sql).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { dbResult } from '@/lib/db'
import { TestingSection } from '@/components/dev/TestingSection'
import { RunnerSubmissionsSection } from '@/components/dev/RunnerSubmissionsSection'
import { ErrorsSection } from '@/components/admin/ErrorsSection'

type FeedbackType = 'bug' | 'suggestion' | 'question'

interface AppFeedback {
  id: string
  created_at: string
  author_name: string | null
  type: FeedbackType
  note: string
  resolved: boolean
}

// Status colours, never the retired accent: a bug is hot, an idea is booked-
// green (something to build), a question is harbor blue.
const TYPE_META: Record<FeedbackType, { label: string; color: string; ink: string }> = {
  bug: { label: 'Bug', color: 'var(--c-st-hot)', ink: 'var(--c-hot-text)' },
  suggestion: { label: 'Suggestion', color: 'var(--c-st-booked)', ink: 'var(--c-chip-ink)' },
  question: { label: 'Question', color: 'var(--c-st-uncon)', ink: 'var(--c-chip-ink)' },
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// The rollout feedback board. Same table, same writes as before — only the
// surface changed.
function FeedbackBoard() {
  const { profile } = useUserProfile()
  const authorName = profile?.display_name || 'Staff'
  const canModerate = profile?.role === 'owner' || profile?.role === 'manager'

  const [items, setItems] = useState<AppFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState<FeedbackType>('bug')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showResolved, setShowResolved] = useState(false)

  async function load() {
    const { data, error } = await supabase
      .from('app_feedback')
      .select('*')
      // Runner submissions share this table (source='runner', 2026-08-31) and
      // have their own tab — this board is the OFFICE's.
      .eq('source', 'office')
      .order('created_at', { ascending: false })
    if (!dbResult('Loading feedback', error)) { setLoading(false); return }
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
    const { error } = await supabase.from('app_feedback').insert({
      author_name: authorName,
      type,
      note: note.trim(),
      resolved: false,
    })
    setSubmitting(false)
    if (!dbResult('Posting feedback', error)) return
    setNote('')
    setType('bug')
    load()
  }

  async function toggleResolved(item: AppFeedback) {
    if (!canModerate) return
    const { error } = await supabase.from('app_feedback').update({ resolved: !item.resolved }).eq('id', item.id)
    if (!dbResult('Saving', error)) return
    load()
  }

  const open = items.filter(i => !i.resolved)
  const done = items.filter(i => i.resolved)
  const shown = showResolved ? done : open

  return (
    <div style={{ maxWidth: 720 }}>
      {/* ── Post ──────────────────────────────────────────────────────── */}
      <div className="c-panel" style={{ marginBottom: 18 }}>
        <div className="c-label" style={{ marginBottom: 8 }}>Report something</div>
        <div className="c-seg-wrap" style={{ marginBottom: 10 }}>
          <span className="c-seg">
            {(Object.keys(TYPE_META) as FeedbackType[]).map(t => (
              <button key={t} type="button" className={type === t ? 'c-on' : ''} onClick={() => setType(t)}>
                {TYPE_META[t].label}
              </button>
            ))}
          </span>
        </div>
        <textarea
          className="c-textarea"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Describe the bug, suggestion, or question…"
          rows={4}
          style={{ minHeight: 90 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, color: 'var(--c-fg-3)' }}>Posting as {authorName}</span>
          <button
            type="button"
            className="c-btn"
            onClick={handleSubmit}
            disabled={!note.trim() || submitting}
            style={{ opacity: note.trim() && !submitting ? 1 : 0.45, cursor: note.trim() && !submitting ? 'pointer' : 'default' }}
          >
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>

      {/* ── Feed ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="c-label">Feed</div>
        <span className="c-seg" style={{ marginLeft: 'auto' }}>
          <button type="button" className={!showResolved ? 'c-on' : ''} onClick={() => setShowResolved(false)}>Open · {open.length}</button>
          <button type="button" className={showResolved ? 'c-on' : ''} onClick={() => setShowResolved(true)}>Resolved · {done.length}</button>
        </span>
      </div>
      {loading ? (
        <div className="c-sub" style={{ padding: '18px 4px' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div className="c-sub" style={{ padding: '18px 4px' }}>{showResolved ? 'Nothing resolved yet.' : 'Nothing open.'}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(item => {
            const meta = TYPE_META[item.type] || TYPE_META.question
            return (
              <div key={item.id} className="c-panel" style={{ opacity: item.resolved ? 0.6 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span className="c-pill" style={{ background: meta.color, color: meta.ink }}>{meta.label}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{item.author_name || 'Staff'}</span>
                  <span className="c-mono" style={{ fontSize: 10.5, color: 'var(--c-fg-3)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{fmtWhen(item.created_at)}</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.note}</div>
                {canModerate && (
                  <div style={{ marginTop: 10 }}>
                    <button type="button" className={`c-soft${item.resolved ? ' c-on' : ''}`} onClick={() => toggleResolved(item)}>
                      {item.resolved ? '✓ Resolved · reopen' : 'Mark resolved'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── DEV page shell ──────────────────────────────────────────────────────────
type DevSection = 'feedback' | 'runner' | 'testing' | 'errors'

const DEV_NAV: { key: DevSection; label: string }[] = [
  { key: 'feedback', label: 'Feedback' },
  { key: 'runner', label: 'Runner' },
  { key: 'testing', label: 'Testing' },
  { key: 'errors', label: 'Errors' },
]

const BLURB: Record<DevSection, string> = {
  feedback: 'Bugs, suggestions and questions about the app, from the office.',
  runner: 'Sent from the runner hub — bugs and ideas from the people using the app on the floor.',
  testing: 'Checklists for recent work. Pick a batch, work through it, mark what broke.',
  errors: 'Crashes, unhandled rejections and failed saves reported from the app. Newest first.',
}

export default function DevPage() {
  const [section, setSection] = useState<DevSection>('feedback')
  const { profile } = useUserProfile()
  // Eli only — matched on his account, the same gate the CRM Campaigns tab uses.
  // Deliberately narrower than the app_errors RLS policy (owner/manager); RLS
  // stays as-is, this just hides the surface.
  const isEli = profile?.email === 'eli@paramountrecording.com'
  const visibleNav = DEV_NAV.filter(n => n.key !== 'errors' || isEli)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '2px 0 4px' }}>
        <h1 className="c-arch" style={{ fontSize: 22, letterSpacing: '-0.01em', margin: 0 }}>Dev</h1>
        <div className="c-seg-wrap">
          <span className="c-seg">
            {visibleNav.map(({ key, label }) => (
              <button key={key} type="button" className={section === key ? 'c-on' : ''} onClick={() => setSection(key)}>
                {label}
              </button>
            ))}
          </span>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--c-fg-3)', marginBottom: 16, maxWidth: 620 }}>
        {BLURB[section]}
      </div>

      {section === 'feedback' && <FeedbackBoard />}
      {section === 'runner' && <RunnerSubmissionsSection />}
      {section === 'testing' && <TestingSection />}
      {section === 'errors' && isEli && <ErrorsSection />}
    </div>
  )
}
