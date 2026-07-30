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

  const anyPhone = TEST_BATCHES.some(batchNeedsPhone)

  return (
    <div>
      {/* Instructions. Deliberately always visible rather than a collapsed panel:
          a tester opening this for the first time shouldn't have to find them, and
          the phone setup in particular has to be read BEFORE starting a batch. */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 16, color: 'var(--text)', marginBottom: 10 }}>
          How testing works
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.8 }}>
          <li><b>Pick a batch below</b> and press <b>Start testing</b>. A batch is one list of checks for recent work.</li>
          <li>A <b>small window appears in the corner</b> showing <b>one check at a time</b>: what to look at, and exactly what to do.</li>
          <li>Do the thing it describes, then press <b>Works</b> or <b>Broken</b>. You can’t move on until you pick one.</li>
          <li>If something’s wrong, <b>type what you saw in the notes box first</b>, then press Broken. The note is the part that gets it fixed — “didn’t work” on its own tells us nothing.</li>
          <li>Press <b>Next</b>. Use <b>Prev</b> any time to go back and change an answer.</li>
        </ol>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.75 }}>
          <b style={{ color: 'var(--text)' }}>About that little window:</b> drag it by the <span style={{ fontFamily: 'DM Mono, monospace' }}>⠿</span> handle at the top —
          it <b>will</b> end up covering something you need to click, so just move it. Press <b>▾</b> to shrink it
          to a bar, <b>▴</b> to open it back up. It follows you around the app, so you never come back to this page
          to tick something off. Closing it with <b>×</b> doesn’t lose anything — press Continue on the batch to pick
          up where you stopped.
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, fontFamily: 'Inter', color: 'var(--text3)', lineHeight: 1.7 }}>
          Nothing you do here can break anything. Wrong answers are fine — you can change them.
          If you get stuck on a check, mark it Broken, say why in the note, and move on.
        </div>
      </div>

      {/* Phone setup — shown whenever any batch has phone checks, because finding
          out halfway through that you need the app installed wastes the session. */}
      {anyPhone && <PhoneSetupCallout />}

      <div style={{ fontSize: 12, fontFamily: 'Inter', color: 'var(--text3)', lineHeight: 1.7, marginBottom: 12 }}>
        Batches:
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

// ── Phone setup ───────────────────────────────────────────────────────────────
// Runner checks are done ON A PHONE with this checklist open on a computer. The
// runner hub installs as its own home-screen app (separate PWA manifest, start_url
// /runner), which is how staff actually use it — so testing it from a desktop
// browser wouldn't be testing the real thing.
function PhoneSetupCallout() {
  const [copied, setCopied] = useState(false)
  const url = typeof window !== 'undefined' ? window.location.origin : 'https://prsflow.paramountrecording.com'

  return (
    <div style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.4)', borderRadius: 12, padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>📱</span>
        <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15, color: 'var(--warm)' }}>
          Some checks need a phone — set this up first
        </span>
      </div>
      <div style={{ fontSize: 12.5, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.8, marginBottom: 12 }}>
        Checks tagged <b style={{ color: 'var(--warm)' }}>📱 PHONE</b> are done on your phone, in the Runner app.
        Keep this checklist open on the computer and mark them here after you’ve done them on the phone.
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.9 }}>
        <li>On your phone, open <b>Safari</b> (iPhone) or <b>Chrome</b> (Android) and go to the address below.</li>
        <li>Sign in with the <b>shared runner PIN</b> — ask Eli or a manager for it. You’ll land on the studio list.</li>
        <li>Tap the <b>Share</b> button, then <b>Add to Home Screen</b>. It installs as <b>“Runner”</b> with its own icon.</li>
        <li>Open it from your home screen from then on. That’s the version the runners actually use, so it’s the one to test.</li>
      </ol>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <code style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px' }}>
          {url}/runner
        </code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(`${url}/runner`).then(() => setCopied(true), () => setCopied(false))
            setTimeout(() => setCopied(false), 2000)
          }}
          style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: copied ? 'var(--accent)' : 'var(--text)', fontFamily: 'Syne', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
        >
          {copied ? '✓ Copied' : 'Copy link'}
        </button>
        <span style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--text3)' }}>
          — text it to yourself, or type it in
        </span>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(249,115,22,0.25)', fontSize: 11.5, fontFamily: 'Inter', color: 'var(--text3)', lineHeight: 1.7 }}>
        <b style={{ color: 'var(--text2)' }}>Note:</b> signing in as the runner on your phone signs you out of your own
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
          {batchNeedsPhone(batch) && (
            <div style={{ marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--warm)', border: '1px solid rgba(249,115,22,0.45)', background: 'rgba(249,115,22,0.10)', borderRadius: 999, padding: '3px 9px' }}>
              📱 {phoneItemCount(batch)} need a phone
            </div>
          )}
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
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontFamily: 'Inter', fontSize: 11, cursor: 'pointer', padding: 0, marginBottom: 12 }}>← Batches</button>
      <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>{batch.title}</div>
      <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--text3)', marginBottom: 12 }}>
        {prog.passed} working · {prog.failed} broken · {prog.untested} not tested
        {canReset && ' · results are kept until reset in Supabase'}
      </div>
      <button
        onClick={copyFailures}
        style={{ marginBottom: 18, padding: '8px 14px', borderRadius: 7, border: `1px solid ${copied ? 'rgba(var(--accent-rgb),0.5)' : 'var(--border)'}`, background: copied ? 'rgba(var(--accent-rgb),0.12)' : 'transparent', color: copied ? 'var(--accent)' : 'var(--text)', fontFamily: 'Syne', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
      >
        {copied ? '✓ Copied' : 'Copy failures + notes'}
      </button>
      {group('Broken', failedItems, 'var(--hot)')}
      {group('Not tested', untestedItems, 'var(--text3)')}
      {group('Working', passedItems, 'var(--booked)')}
    </div>
  )
}
