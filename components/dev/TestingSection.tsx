'use client'
// DEV → Testing. PIN gate, then a list of BATCH CARDS.
//
// Batches, not one long list: each card shows its own progress and whether it's
// finished, so opening this next month you can see at a glance which runs are done
// and which are new. Opening a batch starts the floating tester panel, which is
// where the actual work happens — this page is for choosing a batch and reviewing
// results, not for working through 40 items in a scroll.
//
// The PIN is a soft gate, NOT security: everything behind it is already readable by
// any signed-in staff member under RLS. Don't let this pattern spread to anything
// that matters.
import React, { useState } from 'react'
import { TEST_BATCHES } from '@/lib/testBatches'
import { useUserProfile } from '@/hooks/useUserProfile'
import {
  TESTING_PIN, unlockTesting, setActiveBatch, useTestingSession,
  useTestResults, batchProgress,
} from '@/hooks/useTestResults'

export function TestingSection() {
  const { unlocked, activeBatchId } = useTestingSession()
  const [pinEntry, setPinEntry] = useState('')
  const [pinError, setPinError] = useState(false)
  const [reviewId, setReviewId] = useState<string | null>(null)

  if (!unlocked) {
    return (
      <div style={{ maxWidth: 320, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: 'var(--text)', marginBottom: 6 }}>Testing</div>
        <div style={{ fontSize: 12, fontFamily: 'Inter', color: 'var(--text2)', marginBottom: 18, lineHeight: 1.6 }}>
          Enter the testing PIN to open the checklists.
        </div>
        <input
          value={pinEntry}
          onChange={e => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 4)
            setPinEntry(v)
            setPinError(false)
            if (v.length === 4) {
              if (v === TESTING_PIN) unlockTesting()
              else { setPinError(true); setPinEntry('') }
            }
          }}
          inputMode="numeric"
          autoFocus
          placeholder="••••"
          style={{
            width: 140, textAlign: 'center', letterSpacing: '0.5em',
            background: 'var(--surface2)', border: `1px solid ${pinError ? 'var(--hot)' : 'var(--border)'}`,
            borderRadius: 8, color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 20,
            padding: '12px 0', outline: 'none',
          }}
        />
        {pinError && <div style={{ marginTop: 10, fontSize: 11, fontFamily: 'Inter', color: 'var(--hot)' }}>Incorrect PIN</div>}
      </div>
    )
  }

  if (reviewId) {
    return <BatchReview batchId={reviewId} onBack={() => setReviewId(null)} />
  }

  return (
    <div>
      <div style={{ fontSize: 12, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.7, marginBottom: 16 }}>
        Pick a batch to start testing. The checklist opens as a small window you can
        drag anywhere — it stays with you as you move around the app, so you never
        have to come back here to tick something off.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {TEST_BATCHES.map(b => (
          <BatchCard
            key={b.id}
            batchId={b.id}
            isActive={activeBatchId === b.id}
            onStart={() => setActiveBatch(b.id)}
            onReview={() => setReviewId(b.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ── One batch, as a card with live progress ────────────────────────────────────
function BatchCard({ batchId, isActive, onStart, onReview }: {
  batchId: string
  isActive: boolean
  onStart: () => void
  onReview: () => void
}) {
  const batch = TEST_BATCHES.find(b => b.id === batchId)!
  const { results, loading } = useTestResults(batchId)
  const prog = batchProgress(batch.items.map(i => i.id), results)

  const state = loading ? 'loading'
    : prog.tested === 0 ? 'new'
    : prog.complete ? 'done'
    : 'progress'
  const meta: Record<string, { label: string; color: string }> = {
    loading: { label: '…', color: 'var(--text3)' },
    new: { label: 'Not started', color: 'var(--text3)' },
    progress: { label: `${prog.tested}/${prog.total} tested`, color: 'var(--warm)' },
    done: { label: prog.failed > 0 ? `Done · ${prog.failed} broken` : 'Done · all working', color: prog.failed > 0 ? 'var(--hot)' : 'var(--booked)' },
  }
  const m = meta[state]

  return (
    <div style={{
      background: 'var(--surface)',
      // A finished batch reads as finished without hiding it — you may still want
      // to look at what failed.
      border: `1px solid ${state === 'done' ? (prog.failed > 0 ? 'rgba(239,68,68,0.4)' : 'rgba(20,184,166,0.4)') : 'var(--border)'}`,
      borderRadius: 12, padding: 16,
      opacity: state === 'done' ? 0.85 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>{batch.title}</div>
          <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--text3)' }}>{batch.version} · {batch.date} · {batch.items.length} checks</div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '3px 9px' }}>
          {m.label}
        </span>
      </div>

      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--surface2)', marginBottom: 12 }}>
        <div style={{ width: `${(prog.passed / prog.total) * 100}%`, background: 'var(--booked)' }} />
        <div style={{ width: `${(prog.failed / prog.total) * 100}%`, background: 'var(--hot)' }} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={onStart}
          style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: isActive ? 'var(--surface2)' : 'var(--accent)', color: isActive ? 'var(--text2)' : 'var(--bg)', fontFamily: 'Syne', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
        >
          {isActive ? 'Open in panel' : prog.tested === 0 ? 'Start testing' : 'Continue'}
        </button>
        {prog.tested > 0 && (
          <button
            onClick={onReview}
            style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontFamily: 'Syne', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            Review results
          </button>
        )}
      </div>
    </div>
  )
}

// ── Results review: what passed, what broke, and every note ────────────────────
// This is Eli's read-out, not the tester's workspace — failures first, since
// that's what he's looking for.
function BatchReview({ batchId, onBack }: { batchId: string; onBack: () => void }) {
  const batch = TEST_BATCHES.find(b => b.id === batchId)!
  const { results } = useTestResults(batchId)
  const { profile } = useUserProfile()
  const canReset = profile?.role === 'owner' || profile?.role === 'manager'
  const prog = batchProgress(batch.items.map(i => i.id), results)

  const failedItems = batch.items.filter(i => results[i.id]?.status === 'fail')
  const passedItems = batch.items.filter(i => results[i.id]?.status === 'pass')
  const untestedItems = batch.items.filter(i => !results[i.id])

  const row = (i: typeof batch.items[number], tone: string) => {
    const v = results[i.id]
    return (
      <div key={i.id} style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${tone}`, borderRadius: '0 8px 8px 0' }}>
        <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 3 }}>{i.area}</div>
        <div style={{ fontSize: 13, fontFamily: 'Inter', color: 'var(--text)', lineHeight: 1.45 }}>{i.what}</div>
        {v?.note && (
          <div style={{ marginTop: 7, padding: '7px 9px', background: 'var(--surface2)', borderRadius: 5, fontSize: 12, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {v.note}
          </div>
        )}
        {v && (
          <div style={{ marginTop: 6, fontSize: 10, fontFamily: 'Inter', color: 'var(--text3)' }}>
            {v.tested_by || 'Staff'} · {new Date(v.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        )}
      </div>
    )
  }

  const group = (title: string, items: typeof batch.items, tone: string) => items.length === 0 ? null : (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: tone, marginBottom: 8 }}>
        {title} ({items.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(i => row(i, tone))}
      </div>
    </div>
  )

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontFamily: 'Inter', fontSize: 11, cursor: 'pointer', padding: 0, marginBottom: 12 }}>← Batches</button>
      <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>{batch.title}</div>
      <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--text3)', marginBottom: 16 }}>
        {prog.passed} working · {prog.failed} broken · {prog.untested} not tested
        {canReset && ' · results are kept until reset in Supabase'}
      </div>
      {group('Broken', failedItems, 'var(--hot)')}
      {group('Not tested', untestedItems, 'var(--text3)')}
      {group('Working', passedItems, 'var(--booked)')}
    </div>
  )
}
