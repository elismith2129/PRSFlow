'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Runner submissions — the office side of the "Report a bug or an idea" card on
// the runner hub (Eli, 2026-08-31).
//
// Same table as the staff board (`app_feedback`), told apart by `source`:
// 'runner' here, 'office' on the Feedback tab. One inbox, one resolved flag,
// one set of policies — see migration 20260831130000_app_feedback_runner.sql.
//
// Photos live in the PRIVATE checklist-photos bucket, so the row stores a path
// and the thumbnail is signed at read time (lib/photos), exactly like flags.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { dbResult } from '@/lib/db'
import { signedPhotoUrl } from '@/lib/photos'

type RunnerSubmission = {
  id: string
  created_at: string
  author_name: string | null
  studio: string | null
  type: 'bug' | 'suggestion' | 'question'
  note: string
  photo_url: string | null
  resolved: boolean
}

const STUDIO_ABBR: Record<string, string> = {
  paramount: 'PRS', ameraycan: 'ARS', encore: 'ERS', track: 'TRK',
}

const TYPE_LABEL: Record<string, { label: string; color: string; ink: string }> = {
  bug: { label: 'Broken', color: 'var(--c-st-hot)', ink: 'var(--c-hot-text)' },
  suggestion: { label: 'Idea', color: 'var(--c-st-booked)', ink: 'var(--c-chip-ink)' },
  question: { label: 'Question', color: 'var(--c-st-uncon)', ink: 'var(--c-chip-ink)' },
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function RunnerSubmissionsSection() {
  const { profile } = useUserProfile()
  const canModerate = profile?.role === 'owner' || profile?.role === 'manager'

  const [items, setItems] = useState<RunnerSubmission[]>([])
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [showResolved, setShowResolved] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_feedback')
      .select('id, created_at, author_name, studio, type, note, photo_url, resolved')
      .eq('source', 'runner')
      .order('created_at', { ascending: false })
    if (!dbResult('Loading runner submissions', error)) { setLoading(false); return }
    const rows = (data ?? []) as RunnerSubmission[]
    setItems(rows)
    setLoading(false)

    // Sign thumbnails after the list paints — a slow storage round-trip must not
    // hold up the text, which is the part that matters.
    const signed: Record<string, string> = {}
    for (const r of rows) {
      if (!r.photo_url) continue
      const url = await signedPhotoUrl(r.photo_url)
      if (url) signed[r.id] = url
    }
    setPhotos(signed)
  }, [])

  // Standing rule: every fetch pairs with a realtime subscription.
  useEffect(() => {
    load()
    const ch = supabase
      .channel('runner-submissions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_feedback' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  async function toggleResolved(item: RunnerSubmission) {
    if (!canModerate) return
    // Optimistic — the realtime callback reloads and corrects if the write fails.
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, resolved: !i.resolved } : i))
    const { error } = await supabase
      .from('app_feedback').update({ resolved: !item.resolved }).eq('id', item.id)
    if (!dbResult('Saving', error)) load()
  }

  const open = items.filter(i => !i.resolved)
  const done = items.filter(i => i.resolved)
  const shown = showResolved ? done : open

  // RECARVED 2026-09-23 — carved tokens, c-seg filter, c-panel cards. The
  // page shell carries the heading and blurb now.
  return (
    <div style={{ maxWidth: 720 }}>
      <div className="c-seg-wrap" style={{ marginBottom: 12 }}>
        <span className="c-seg">
          <button type="button" className={!showResolved ? 'c-on' : ''} onClick={() => setShowResolved(false)}>Open · {open.length}</button>
          <button type="button" className={showResolved ? 'c-on' : ''} onClick={() => setShowResolved(true)}>Resolved · {done.length}</button>
        </span>
      </div>

      {loading ? (
        <div className="c-sub" style={{ padding: '18px 4px' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div className="c-sub" style={{ padding: '18px 4px' }}>
          {showResolved ? 'Nothing resolved yet.' : 'Nothing open — the runners have nothing to report.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(item => {
            const meta = TYPE_LABEL[item.type] ?? TYPE_LABEL.question
            return (
              <div key={item.id} className="c-panel" style={{ opacity: item.resolved ? 0.6 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span className="c-pill" style={{ background: meta.color, color: meta.ink }}>{meta.label}</span>
                  {item.studio && (
                    <span className="c-label" style={{ opacity: 0.7 }}>{STUDIO_ABBR[item.studio] ?? item.studio}</span>
                  )}
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{item.author_name || 'Runner'}</span>
                  <span className="c-mono" style={{ fontSize: 10.5, color: 'var(--c-fg-3)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{fmtWhen(item.created_at)}</span>
                </div>

                <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {item.note}
                </div>

                {item.photo_url && (
                  photos[item.id] ? (
                    <a href={photos[item.id]} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photos[item.id]}
                        alt="Runner photo"
                        style={{ marginTop: 10, maxHeight: 160, maxWidth: '100%', borderRadius: 10, display: 'block' }}
                      />
                    </a>
                  ) : (
                    <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--c-fg-3)' }}>Photo attached — loading…</div>
                  )
                )}

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
