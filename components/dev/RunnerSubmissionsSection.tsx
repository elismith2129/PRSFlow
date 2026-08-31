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

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  bug: { label: 'Broken', color: 'var(--c-st-hot, #ff5a4d)' },
  suggestion: { label: 'Idea', color: 'var(--c-st-booked, #43dfae)' },
  question: { label: 'Question', color: 'var(--c-st-uncon, #7fb2e5)' },
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

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 24, letterSpacing: -0.5, marginBottom: 6, color: 'var(--text)' }}>
        Runner submissions
      </h1>
      <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 18 }}>
        Sent from the runner hub — bugs and ideas from the people using the app on the floor.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {([false, true] as const).map(r => (
          <button
            key={String(r)}
            onClick={() => setShowResolved(r)}
            style={{
              padding: '7px 14px', fontSize: 11, fontFamily: 'Inter', fontWeight: 600,
              borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${showResolved === r ? 'var(--accent)' : 'var(--border)'}`,
              background: showResolved === r ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
              color: showResolved === r ? 'var(--text)' : 'var(--text2)',
            }}
          >
            {r ? `Resolved (${done.length})` : `Open (${open.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text2)', padding: '18px 0' }}>
          {showResolved ? 'Nothing resolved yet.' : 'Nothing open — the runners have nothing to report.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map(item => {
            const meta = TYPE_LABEL[item.type] ?? TYPE_LABEL.question
            return (
              <div
                key={item.id}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: 14, opacity: item.resolved ? 0.6 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: meta.color, border: `1px solid ${meta.color}`, borderRadius: 99, padding: '2px 8px',
                  }}>{meta.label}</span>
                  {item.studio && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)' }}>
                      {STUDIO_ABBR[item.studio] ?? item.studio}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text2)' }}>{item.author_name || 'Runner'}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--text3)', marginLeft: 'auto' }}>{fmtWhen(item.created_at)}</span>
                </div>

                <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                  {item.note}
                </div>

                {item.photo_url && (
                  photos[item.id] ? (
                    <a href={photos[item.id]} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photos[item.id]}
                        alt="Runner photo"
                        style={{ marginTop: 10, maxHeight: 160, borderRadius: 8, display: 'block' }}
                      />
                    </a>
                  ) : (
                    <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--text3)' }}>Photo attached — loading…</div>
                  )
                )}

                {canModerate && (
                  <button
                    onClick={() => toggleResolved(item)}
                    style={{
                      marginTop: 10, padding: '6px 12px', fontSize: 10.5, fontWeight: 600,
                      borderRadius: 8, cursor: 'pointer', background: 'transparent',
                      border: '1px solid var(--border)', color: 'var(--text2)',
                    }}
                  >
                    {item.resolved ? 'Reopen' : 'Mark resolved'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
