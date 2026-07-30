'use client'
// Floating tester panel — the checklist that follows you around the app.
//
// Why this exists: for the desktop parts of a batch the tester is navigating the
// office app while reading step 12, and a checklist on its own page means tabbing
// back and forth for every item — which is how items get skipped or mis-marked.
// Mounted in the (main) layout so it survives navigation across the internal app.
//
// Deliberately NOT on /runner: runner testing is done on a PHONE with this
// checklist open on a computer, so a panel there would only cover the phone-first
// UI being tested. Being in (main) also keeps it off /login, /register and
// /inquiry. Items carry a Phone/Desktop badge so the tester knows which screen
// each step belongs to.
//
// It shows ONE item at a time on purpose: a scrolling list inside a small draggable
// window is worse than useless. What to test, how to test it, two verdict buttons,
// a note, and next.
//
// Draggable because it will inevitably sit on top of the button being tested —
// anticipated rather than discovered.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { TEST_BATCHES, deviceFor } from '@/lib/testBatches'
import { useUserProfile } from '@/hooks/useUserProfile'
import {
  useTestingSession, useTestResults, setActiveBatch, lockTesting, batchProgress,
} from '@/hooks/useTestResults'

const POS_KEY = 'dev_testing_floater_pos'
const MIN_KEY = 'dev_testing_floater_min'

export default function TestingFloater() {
  const { unlocked, activeBatchId } = useTestingSession()
  const { profile } = useUserProfile()
  const testerName = profile?.display_name || 'Staff'

  const batch = TEST_BATCHES.find(b => b.id === activeBatchId) || null
  const { results, loading, save } = useTestResults(batch?.id ?? null)

  const [idx, setIdx] = useState(0)
  const [minimised, setMinimised] = useState(false)
  // Draft notes per item, so moving between items (or typing before deciding)
  // never loses what was written.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  // Restore position + minimised state so it stays where the tester parked it.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(POS_KEY)
      if (raw) setPos(JSON.parse(raw))
      setMinimised(sessionStorage.getItem(MIN_KEY) === '1')
    } catch { /* ignore */ }
  }, [])

  // Open on the first item without a verdict — resuming where they left off.
  //
  // Must wait for `loading` to finish: this used to run on batch-id change alone,
  // when `results` was still empty because the fetch hadn't resolved, so it always
  // computed "first untested = item 1". That's why "Continue" opened at the top.
  // positionedRef makes it fire once per batch and never again, so it can't jump
  // the tester mid-tap when a verdict lands.
  const positionedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!batch || loading) return
    if (positionedRef.current === batch.id) return
    positionedRef.current = batch.id
    const firstUntested = batch.items.findIndex(i => !results[i.id])
    setIdx(firstUntested === -1 ? 0 : firstUntested)
  }, [batch?.id, loading, batch, results])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = (e.currentTarget as HTMLElement).closest('[data-floater]') as HTMLElement | null
    if (!el) return
    const r = el.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    // Clamped so it can never be dragged off-screen and become unreachable.
    const w = 340, h = 120
    const x = Math.min(Math.max(0, e.clientX - dragRef.current.dx), Math.max(0, window.innerWidth - w))
    const y = Math.min(Math.max(0, e.clientY - dragRef.current.dy), Math.max(0, window.innerHeight - h))
    setPos({ x, y })
  }, [])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    setPos(p => {
      if (p) { try { sessionStorage.setItem(POS_KEY, JSON.stringify(p)) } catch { /* ignore */ } }
      return p
    })
  }, [])

  if (!unlocked || !batch) return null

  const item = batch.items[idx]
  const v = item ? results[item.id] : undefined
  const prog = batchProgress(batch.items.map(i => i.id), results)

  const style: React.CSSProperties = {
    position: 'fixed',
    left: pos ? pos.x : undefined,
    top: pos ? pos.y : undefined,
    right: pos ? undefined : 12,
    bottom: pos ? undefined : 12,
    width: 340,
    maxWidth: 'calc(100vw - 24px)',
    // Above the nav (99999) so it's never trapped behind it, below the welcome
    // splash. It's a dev tool; being on top is the point.
    zIndex: 100003,
    background: 'var(--surface)',
    border: '1px solid rgba(var(--accent-rgb),0.45)',
    borderRadius: 12,
    boxShadow: '0 10px 40px rgba(0,0,0,0.55)',
    overflow: 'hidden',
  }

  // The verdict is the ONLY thing that writes, and it carries whatever note has
  // been typed. Saving a note on its own used to default the status to 'fail',
  // which put a verdict on the record that nobody chose.
  //
  // No auto-advance: navigation is explicit (Prev/Next) so the tester can go back
  // and change an answer.
  const setVerdict = (status: 'pass' | 'fail') => {
    if (!item) return
    const note = (noteDrafts[item.id] ?? v?.note ?? '').trim() || null
    save(item.id, status, note, testerName)
  }

  const toggleMin = () => {
    setMinimised(m => {
      const next = !m
      try { sessionStorage.setItem(MIN_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  const grip = (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ flex: 1, cursor: 'grab', touchAction: 'none', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
    >
      <span style={{ fontSize: 12, color: 'var(--text3)', flexShrink: 0 }}>⠿</span>
      {/* Two different numbers, and conflating them was confusing: the position in
          the list (moves with Prev/Next) and how many have a verdict (only moves
          when one is recorded). Both are labelled now. */}
      <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        Item {idx + 1} of {prog.total}
      </span>
      <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {prog.tested} done
      </span>
    </div>
  )

  if (minimised) {
    return (
      <div data-floater style={{ ...style, width: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 10px' }}>
          {grip}
          <button onClick={toggleMin} title="Expand" style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>▴</button>
        </div>
      </div>
    )
  }

  return (
    <div data-floater style={style}>
      {/* Drag bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 10px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
        {grip}
        <button onClick={toggleMin} title="Minimise" style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>▾</button>
        <button
          onClick={() => { setActiveBatch(null) }}
          title="Close (stays unlocked)"
          style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
        >×</button>
      </div>

      {/* Progress */}
      <div style={{ display: 'flex', height: 4, background: 'var(--surface2)' }}>
        <div style={{ width: `${(prog.passed / prog.total) * 100}%`, background: 'var(--booked)' }} />
        <div style={{ width: `${(prog.failed / prog.total) * 100}%`, background: 'var(--hot)' }} />
      </div>

      {prog.complete && (
        <div style={{ padding: '8px 12px', background: 'rgba(20,184,166,0.10)', borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: 'Inter', color: 'var(--booked)' }}>
          Batch complete — {prog.passed} working{prog.failed > 0 ? `, ${prog.failed} broken` : ''}.
        </div>
      )}

      {item && (
        <div style={{ padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--text3)' }}>
              {String(idx + 1).padStart(2, '0')}/{batch.items.length}
            </span>
            <span style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)' }}>{item.area}</span>
            {/* Which screen to do this on. The tester is holding a phone AND looking
                at a computer, so leaving them to infer it invites mis-testing. */}
            {(() => {
              const d = deviceFor(item)
              const isPhone = d === 'phone'
              return (
                <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: isPhone ? 'var(--warm)' : 'var(--text2)', border: `1px solid ${isPhone ? 'rgba(249,115,22,0.45)' : 'var(--border)'}`, background: isPhone ? 'rgba(249,115,22,0.10)' : 'transparent', borderRadius: 999, padding: '2px 7px' }}>
                  {isPhone ? '📱 Phone' : 'Desktop'}
                </span>
              )
            })()}
          </div>
          <div style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 600, color: 'var(--text)', lineHeight: 1.4, marginBottom: 5 }}>
            {item.what}
          </div>
          <div style={{ fontSize: 12, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.6, marginBottom: 10, maxHeight: 150, overflowY: 'auto' }}>
            {item.how}
          </div>

          {/* Notes come BEFORE the verdict: a tester writes what they saw, then
              decides. The note is saved WITH the verdict, so nothing ever carries a
              status nobody picked. */}
          <textarea
            value={noteDrafts[item.id] ?? v?.note ?? ''}
            onChange={e => setNoteDrafts(p => ({ ...p, [item.id]: e.target.value }))}
            rows={2}
            placeholder="Notes (optional) — what did you see?"
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'Inter', fontSize: 13, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.5, marginBottom: 8 }}
          />

          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button
              onClick={() => setVerdict('pass')}
              style={{ flex: 1, padding: '10px 0', borderRadius: 7, cursor: 'pointer', border: `1px solid ${v?.status === 'pass' ? 'var(--booked)' : 'var(--border)'}`, background: v?.status === 'pass' ? 'rgba(20,184,166,0.16)' : 'transparent', color: v?.status === 'pass' ? 'var(--booked)' : 'var(--text2)', fontFamily: 'Syne', fontWeight: 700, fontSize: 12 }}
            >
              {v?.status === 'pass' ? '✓ Works' : 'Works'}
            </button>
            <button
              onClick={() => setVerdict('fail')}
              style={{ flex: 1, padding: '10px 0', borderRadius: 7, cursor: 'pointer', border: `1px solid ${v?.status === 'fail' ? 'var(--hot)' : 'var(--border)'}`, background: v?.status === 'fail' ? 'rgba(239,68,68,0.16)' : 'transparent', color: v?.status === 'fail' ? 'var(--hot)' : 'var(--text2)', fontFamily: 'Syne', fontWeight: 700, fontSize: 12 }}
            >
              {v?.status === 'fail' ? '✕ Broken' : 'Broken'}
            </button>
          </div>

          {/* Prev/Next at the bottom. Next is BLOCKED until a verdict exists, so
              nothing gets skipped — but Prev is always open so they can go back and
              change an answer. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setIdx(i => Math.max(0, i - 1))}
              disabled={idx === 0}
              style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: idx === 0 ? 'var(--text3)' : 'var(--text2)', fontFamily: 'Syne', fontWeight: 700, fontSize: 11, cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.45 : 1 }}
            >← Prev</button>
            <button
              onClick={() => setIdx(i => Math.min(batch.items.length - 1, i + 1))}
              disabled={!v || idx >= batch.items.length - 1}
              title={!v ? 'Pick Works or Broken first' : undefined}
              style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: 'none', background: (!v || idx >= batch.items.length - 1) ? 'var(--surface2)' : 'var(--accent)', color: (!v || idx >= batch.items.length - 1) ? 'var(--text3)' : 'var(--bg)', fontFamily: 'Syne', fontWeight: 700, fontSize: 11, cursor: (!v || idx >= batch.items.length - 1) ? 'default' : 'pointer' }}
            >Next →</button>
          </div>
          {!v && (
            <div style={{ marginTop: 6, fontSize: 10, fontFamily: 'Inter', color: 'var(--text3)', textAlign: 'center' }}>
              Pick Works or Broken to continue
            </div>
          )}

        </div>
      )}

      <div style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, fontFamily: 'Inter', color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{batch.title}</span>
        <button onClick={lockTesting} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontFamily: 'Inter', fontSize: 9, cursor: 'pointer', textDecoration: 'underline', flexShrink: 0 }}>Lock</button>
      </div>
    </div>
  )
}
