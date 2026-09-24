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
//
// RECARVED 2026-09-23 — carved tokens and classes; the two-column grid already
// collapsed on a phone (auto-fit), the cards and buttons did not.
import React, { useState } from 'react'
import { TEST_BATCHES, batchNeedsPhone, phoneItemCount } from '@/lib/testBatches'
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
      <div className="c-panel" style={{ maxWidth: 320, margin: '24px auto', textAlign: 'center', padding: 22 }}>
        <div className="c-arch" style={{ fontSize: 16, marginBottom: 6 }}>Testing</div>
        <div className="c-sub" style={{ marginBottom: 16, lineHeight: 1.6 }}>
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
          className="c-input c-mono"
          style={{
            width: 150, margin: '0 auto', textAlign: 'center', letterSpacing: '0.5em', fontSize: 20, height: 46,
            boxShadow: pinError ? 'inset 0 0 0 1px var(--c-st-hot)' : undefined,
          }}
        />
        {pinError && <div style={{ marginTop: 10, fontSize: 11, color: 'var(--c-st-hot)', fontWeight: 700 }}>Incorrect PIN</div>}
      </div>
    )
  }

  if (reviewId) {
    return <BatchReview batchId={reviewId} onBack={() => setReviewId(null)} />
  }

  const anyPhone = TEST_BATCHES.some(batchNeedsPhone)

  return (
    // Two columns: instructions stacked on the left, batches on the right. The
    // tester reads down the left once, then works from the right. Collapses to a
    // single column on narrow screens (auto-fit via minmax on the grid).
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 16, alignItems: 'start' }}>
      {/* ── LEFT: instructions ─────────────────────────────────────────────
          Deliberately always visible rather than a collapsed panel: a tester
          opening this for the first time shouldn't have to find them, and the
          phone setup has to be read BEFORE starting a batch. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div className="c-panel" style={{ padding: 16 }}>
        <div className="c-arch" style={{ fontSize: 15, marginBottom: 10 }}>
          How testing works
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: 'var(--c-fg-2)', lineHeight: 1.8 }}>
          <li><b>Pick a batch below</b> and press <b>Start testing</b>. A batch is one list of checks for recent work.</li>
          <li>A <b>small window appears in the corner</b> showing <b>one check at a time</b>: what to look at, and exactly what to do.</li>
          <li>Do the thing it describes, then press <b>Works</b> or <b>Broken</b>. You can’t move on until you pick one.</li>
          <li>If something’s wrong, <b>type what you saw in the notes box first</b>, then press Broken. The note is the part that gets it fixed — “didn’t work” on its own tells us nothing.</li>
          <li>Press <b>Next</b>. Use <b>Prev</b> any time to go back and change an answer.</li>
        </ol>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--c-wash2)', fontSize: 12, color: 'var(--c-fg-2)', lineHeight: 1.75 }}>
          <b style={{ color: 'var(--c-fg)' }}>About that little window:</b> drag it by the <span style={{ fontFamily: 'DM Mono, monospace' }}>⠿</span> handle at the top —
          it <b>will</b> end up covering something you need to click, so just move it. Press <b>▾</b> to shrink it
          to a bar, <b>▴</b> to open it back up. It follows you around the app, so you never come back to this page
          to tick something off. Closing it with <b>×</b> doesn’t lose anything — press Continue on the batch to pick
          up where you stopped.
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--c-wash2)', fontSize: 12, color: 'var(--c-fg-3)', lineHeight: 1.7 }}>
          Nothing you do here can break anything. Wrong answers are fine — you can change them.
          If you get stuck on a check, mark it Broken, say why in the note, and move on.
        </div>
      </div>

      {/* Phone setup — shown whenever any batch has phone checks, because finding
          out halfway through that you need the app installed wastes the session. */}
      {anyPhone && <PhoneSetupCallout />}
      </div>

      {/* ── RIGHT: the batches themselves ──────────────────────────────── */}
      <div style={{ minWidth: 0 }}>
        <div className="c-label" style={{ marginBottom: 10 }}>Batches</div>
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
    </div>
  )
}

// ── Phone setup ───────────────────────────────────────────────────────────────
// Runner checks are done ON A PHONE with this checklist open on a computer. The
// runner hub installs as its own home-screen app (separate PWA manifest, start_url
// /runner), which is how staff actually use it — so testing it from a desktop
// browser wouldn't be testing the real thing.
function PhoneSetupCallout() {
  const [copied, setCopied] = useState(false)
  const url = typeof window !== 'undefined' ? window.location.origin : 'https://prsflow.paramountrecording.com'

  return (
    <div className="c-panel" style={{ padding: 16, outline: '1px solid rgba(255,169,77,.4)', outlineOffset: -1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>📱</span>
        <span className="c-arch" style={{ fontSize: 14, color: 'var(--c-st-warm)' }}>
          Some checks need a phone — set this up first
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--c-fg-2)', lineHeight: 1.8, marginBottom: 12 }}>
        Checks tagged <b style={{ color: 'var(--c-st-warm)' }}>📱 PHONE</b> are done on your phone, in the Runner app.
        Keep this checklist open on the computer and mark them here after you’ve done them on the phone.
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: 'var(--c-fg-2)', lineHeight: 1.9 }}>
        <li>On your phone, open <b>Safari</b> (iPhone) or <b>Chrome</b> (Android) and go to the address below.</li>
        <li>Sign in with the <b>shared runner PIN</b> — ask Eli or a manager for it. You’ll land on the studio list.</li>
        <li>Tap the <b>Share</b> button, then <b>Add to Home Screen</b>. It installs as <b>“Runner”</b> with its own icon.</li>
        <li>Open it from your home screen from then on. That’s the version the runners actually use, so it’s the one to test.</li>
      </ol>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <code className="c-mono c-inset2" style={{ fontSize: 12, borderRadius: 10, padding: '7px 10px', wordBreak: 'break-all' }}>
          {url}/runner
        </code>
        <button
          type="button"
          className={`c-soft${copied ? ' c-on' : ''}`}
          onClick={() => {
            navigator.clipboard.writeText(`${url}/runner`).then(() => setCopied(true), () => setCopied(false))
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? '✓ Copied' : 'Copy link'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--c-fg-3)' }}>
          — text it to yourself, or type it in
        </span>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--c-wash2)', fontSize: 11.5, color: 'var(--c-fg-3)', lineHeight: 1.7 }}>
        <b style={{ color: 'var(--c-fg-2)' }}>Note:</b> signing in as the runner on your phone signs you out of your own
        account <i>on that phone only</i>. Your computer is unaffected. Use a private/incognito tab if you’d rather keep both.
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
  const batch = TEST_BATCHES.find(b => b.id === batchId)
  const { results, loading } = useTestResults(batchId)
  // Defensive: a stale batch id (old sessionStorage, or a batch removed in a
  // later deploy) must not take the whole page down with it.
  const prog = batchProgress(batch ? batch.items.map(i => i.id) : [], results)
  if (!batch) return null

  const state = loading ? 'loading'
    : prog.tested === 0 ? 'new'
    : prog.complete ? 'done'
    : 'progress'
  const meta: Record<string, { label: string; color: string; ink: string }> = {
    loading: { label: '…', color: 'var(--c-wash2)', ink: 'var(--c-fg)' },
    new: { label: 'Not started', color: 'var(--c-wash2)', ink: 'var(--c-fg)' },
    progress: { label: `${prog.tested}/${prog.total} tested`, color: 'var(--c-st-warm)', ink: 'var(--c-chip-ink)' },
    done: { label: prog.failed > 0 ? `Done · ${prog.failed} broken` : 'Done · all working', color: prog.failed > 0 ? 'var(--c-st-hot)' : 'var(--c-st-booked)', ink: prog.failed > 0 ? 'var(--c-hot-text)' : 'var(--c-chip-ink)' },
  }
  const m = meta[state]

  return (
    // A finished batch reads as finished without hiding it — you may still want
    // to look at what failed.
    <div className="c-panel" style={{ padding: 14, opacity: state === 'done' ? 0.85 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="c-arch" style={{ fontSize: 14, lineHeight: 1.3 }}>{batch.title}</div>
          <div className="c-mono" style={{ fontSize: 10.5, color: 'var(--c-fg-3)', marginTop: 2 }}>{batch.version} · {batch.date} · {batch.items.length} checks</div>
          {batchNeedsPhone(batch) && (
            <div style={{ marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-st-warm)' }}>
              📱 {phoneItemCount(batch)} need a phone
            </div>
          )}
        </div>
        <span className="c-pill" style={{ background: m.color, color: m.ink }}>
          {m.label}
        </span>
      </div>

      <div className="c-inset2" style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ width: `${(prog.passed / prog.total) * 100}%`, background: 'var(--c-st-booked)' }} />
        <div style={{ width: `${(prog.failed / prog.total) * 100}%`, background: 'var(--c-st-hot)' }} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={isActive ? 'c-soft' : 'c-btn'} onClick={onStart}>
          {isActive ? 'Open in panel' : prog.tested === 0 ? 'Start testing' : 'Continue'}
        </button>
        {prog.tested > 0 && (
          <button type="button" className="c-soft" onClick={onReview}>
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
  const batch = TEST_BATCHES.find(b => b.id === batchId)
  const { results } = useTestResults(batchId)
  const { profile } = useUserProfile()
  const [copied, setCopied] = useState(false)
  const canReset = profile?.role === 'owner' || profile?.role === 'manager'
  const prog = batchProgress(batch ? batch.items.map(i => i.id) : [], results)
  if (!batch) return null

  const failedItems = batch.items.filter(i => results[i.id]?.status === 'fail')
  const passedItems = batch.items.filter(i => results[i.id]?.status === 'pass')
  const untestedItems = batch.items.filter(i => !results[i.id])

  const row = (i: typeof batch.items[number], tone: string) => {
    const v = results[i.id]
    return (
      <div key={i.id} className="c-panel" style={{ padding: '10px 12px 10px 14px', borderLeft: `3px solid ${tone}` }}>
        <div className="c-label" style={{ marginBottom: 3, opacity: 0.6 }}>{i.area}</div>
        <div style={{ fontSize: 13, lineHeight: 1.45 }}>{i.what}</div>
        {v?.note && (
          <div className="c-inset2" style={{ marginTop: 7, padding: '7px 9px', borderRadius: 10, fontSize: 12, color: 'var(--c-fg-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {v.note}
          </div>
        )}
        {v && (
          <div className="c-mono" style={{ marginTop: 6, fontSize: 10, color: 'var(--c-fg-3)' }}>
            {v.tested_by || 'Staff'} · {new Date(v.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        )}
      </div>
    )
  }

  const group = (title: string, items: typeof batch.items, tone: string) => items.length === 0 ? null : (
    <div style={{ marginBottom: 18 }}>
      <div className="c-label" style={{ color: tone, opacity: 1, marginBottom: 8 }}>
        {title} · {items.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(i => row(i, tone))}
      </div>
    </div>
  )

  // Copy the failures as plain text, ready to paste to Claude. Closes the loop:
  // tester records what broke → Eli pastes this → fixes come back. Without it he'd
  // be retyping notes by hand, which is exactly where detail gets lost.
  function copyFailures() {
    if (!batch) return
    const lines = [
      `${batch.title} — ${batch.version}`,
      `${prog.passed} working · ${prog.failed} broken · ${prog.untested} not tested`,
      '',
      ...(failedItems.length === 0 ? ['No failures.'] : failedItems.flatMap(i => {
        const v = results[i.id]
        return [
          `BROKEN — [${i.id}] ${i.area}: ${i.what}`,
          `  how: ${i.how}`,
          `  note: ${v?.note || '(none given)'}`,
          '',
        ]
      })),
      ...(untestedItems.length > 0 ? [`Not tested: ${untestedItems.map(i => i.id).join(', ')}`] : []),
    ]
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => setCopied(true),
      () => setCopied(false),
    )
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <button type="button" className="c-soft" onClick={onBack} style={{ marginBottom: 12 }}>← Batches</button>
      <div className="c-arch" style={{ fontSize: 16 }}>{batch.title}</div>
      <div className="c-mono" style={{ fontSize: 10.5, color: 'var(--c-fg-3)', marginBottom: 12 }}>
        {prog.passed} working · {prog.failed} broken · {prog.untested} not tested
        {canReset && ' · results are kept until reset in Supabase'}
      </div>
      <button type="button" className={`c-soft${copied ? ' c-on' : ''}`} onClick={copyFailures} style={{ marginBottom: 18 }}>
        {copied ? '✓ Copied' : 'Copy failures + notes'}
      </button>
      {group('Broken', failedItems, 'var(--c-st-hot)')}
      {group('Not tested', untestedItems, 'var(--c-fg-3)')}
      {group('Working', passedItems, 'var(--c-st-booked)')}
    </div>
  )
}
