'use client'

// ─────────────────────────────────────────────────────────────────────────────
// MemoView — one memo, read where it appears (Eli, 2026-09-14: "I want that
// stuff to just appear and be very readable, not extra clicks").
//
//   kind 'note' → RichNoteView through sanitizeNote, like every note.
//   kind 'page' → the designed HTML in a SANDBOXED iframe (srcdoc, no
//                 scripts, no forms) so a one-sheet keeps its graphics without
//                 touching the app's DOM. Height follows the content via a
//                 tiny postMessage-free trick: we measure the frame's document
//                 on load (same-origin srcdoc allows it).
//
// The sign block is the same on every surface: initials pre-filled from the
// profile, shown large — pressing it is signing, not dismissing. `mode`
// decides which buttons exist: 'soft' has "later", 'hard' does not, 'read'
// (already signed, or a just-read memo in the archive) has none.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import { RichNoteView } from '@/components/shared/RichNote'
import { type Memo, type MemoReceipt, AUDIENCE_LABEL, hardAt, showMemoIntro, HARD_AFTER_HOURS } from '@/lib/memos'

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function PageFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(480)
  useEffect(() => {
    const f = ref.current
    if (!f) return
    const measure = () => {
      try {
        const doc = f.contentDocument
        if (doc) setH(Math.max(240, doc.documentElement.scrollHeight + 8))
      } catch { /* cross-origin never happens with srcdoc, but never throw in a memo */ }
    }
    f.addEventListener('load', measure)
    const t = setInterval(measure, 800) // fonts settle late; stop after a few
    const stop = setTimeout(() => clearInterval(t), 6000)
    return () => { f.removeEventListener('load', measure); clearInterval(t); clearTimeout(stop) }
  }, [html])
  // A designed page is authored for a wide screen; on a phone the frame is
  // as wide as the memo and the page's own responsive rules stack it.
  return (
    <iframe
      ref={ref}
      title="Memo"
      sandbox="allow-same-origin"
      srcDoc={html}
      style={{ width: '100%', height: h, border: 'none', borderRadius: 12, background: 'var(--c-bg)', display: 'block' }}
    />
  )
}

export function MemoView({
  memo, receipt, initials, mode, position, busy, onSign, onLater, onClose,
}: {
  memo: Memo
  receipt: MemoReceipt | null
  /** From the profile — the signature. */
  initials: string
  mode: 'soft' | 'hard' | 'read'
  /** "1 of 3" in the pop-up; omitted in the archive. */
  position?: { i: number; n: number }
  busy?: boolean
  onSign?: (initials: string) => void
  onLater?: () => void
  /** Archive only — a close control for a memo that needs nothing. */
  onClose?: () => void
}) {
  const [sig, setSig] = useState(initials)
  useEffect(() => { setSig(initials) }, [initials, memo.id])
  const signed = !!receipt?.acknowledged_at
  const turnsHard = hardAt(receipt)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: 1 }}>
      <div>
        <div style={{ fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }}>
          Memo{memo.sent_by_name ? ` · from ${memo.sent_by_name}` : ''}{position ? ` · ${position.i} of ${position.n}` : ''}
        </div>
        <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 19, letterSpacing: '-0.02em', lineHeight: 1.15, margin: '4px 0 4px', color: 'var(--c-fg)' }}>
          {memo.title}
        </div>
        <div style={{ fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg-3)' }}>
          Sent {fmtWhen(memo.sent_at)} · to {AUDIENCE_LABEL[memo.audience].toLowerCase()}
          {!memo.requires_ack ? ' · just read' : ''}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {/* THE EXPLAINER, while memos are new (Eli: "in big bold at the top of
            the memo what this is"). Pop-up only — the archive is for people
            who already know. Retires itself on MEMO_INTRO_UNTIL. */}
        {position && showMemoIntro() && (
          <div style={{ background: 'var(--c-wash)', borderLeft: '3px solid var(--c-st-booked)', borderRadius: '0 12px 12px 0', padding: '10px 14px', marginBottom: 12 }}>
            <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 14, letterSpacing: '-0.01em', color: 'var(--c-fg)', marginBottom: 4 }}>
              This is a memo. It's how the office tells you something that matters.
            </div>
            <div style={{ fontSize: 11.5, fontFamily: 'Inter', lineHeight: 1.55, color: 'var(--c-fg-2)' }}>
              Company updates, app changes, things that keep going wrong — they come here now, not in a text you have to find later.
              <b style={{ color: 'var(--c-fg)' }}> Read it, then sign it with your initials at the bottom.</b>
              {memo.requires_ack
                ? <> Can't right now? "I'll read it later" puts it off — it comes back next time you open the app, and after {HARD_AFTER_HOURS} hours it needs your signature to go on.</>
                : <> This one just needs reading — tap Got it when you have.</>}
              {' '}Every memo you've been sent is on your <b style={{ color: 'var(--c-fg)' }}>Memos</b> page.
            </div>
          </div>
        )}
        {memo.kind === 'page'
          ? <PageFrame html={memo.body_html} />
          : <RichNoteView html={memo.body_html} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--c-fg)' }} />}
      </div>

      {/* ── The signature ───────────────────────────────────────────────── */}
      {mode === 'read' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-2)', paddingTop: 6, borderTop: '1px solid var(--c-wash2)' }}>
          {signed
            ? <>Signed <b style={{ fontFamily: "'DM Mono', ui-monospace, monospace", color: 'var(--c-fg)' }}>{receipt?.initials || '✓'}</b> · {fmtWhen(receipt?.acknowledged_at)}</>
            : receipt ? <>Opened {fmtWhen(receipt.first_seen_at)}</> : null}
          {onClose && <button type="button" className="c-control c-soft c-raised-chip" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>}
        </div>
      ) : memo.requires_ack ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid var(--c-wash2)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--c-wash)', borderRadius: 12, padding: '9px 12px', fontSize: 12, fontFamily: 'Inter', color: 'var(--c-fg)' }}>
            I've read this
            <input
              id={`memo-sig-${memo.id}`}
              value={sig}
              onChange={e => setSig(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="initials"
              className="c-tin c-tin-mono c-tin-show"
              style={{ marginLeft: 'auto', width: 72, fontSize: 15, letterSpacing: '0.08em', textAlign: 'center', fontWeight: 700 }}
            />
          </label>
          <button
            type="button"
            className="c-control c-pill c-fill-booked c-raised-chip"
            disabled={busy || !sig.trim()}
            onClick={() => onSign?.(sig.trim())}
            style={{ minHeight: 46, justifyContent: 'center', display: 'flex', alignItems: 'center', fontSize: 13, opacity: busy || !sig.trim() ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }}
          >
            {busy ? 'Saving…' : 'Sign & continue'}
          </button>
          {mode === 'soft' ? (
            <>
              <button type="button" onClick={onLater} disabled={busy} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-3)', textDecoration: 'underline', padding: 4 }}>
                {receipt?.deferred_at ? 'Not now' : "I'll read it later"}
              </button>
              {turnsHard && (
                <div style={{ textAlign: 'center', fontSize: 10, fontFamily: 'Inter', color: 'var(--c-st-warm)', fontWeight: 700 }}>
                  You put this off. It needs a signature from {turnsHard.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-st-hot)', fontWeight: 700, padding: 2 }}>
              You put this off{turnsHard ? ` on ${turnsHard.toLocaleDateString('en-US', { weekday: 'long' })}` : ''}. It needs a signature to go on.
            </div>
          )}
        </div>
      ) : (
        <div style={{ paddingTop: 8, borderTop: '1px solid var(--c-wash2)' }}>
          <button
            type="button"
            className="c-control c-pill c-fill-booked c-raised-chip"
            disabled={busy}
            onClick={() => onSign?.('')}
            style={{ width: '100%', minHeight: 46, justifyContent: 'center', display: 'flex', alignItems: 'center', fontSize: 13 }}
          >
            {busy ? 'Saving…' : 'Got it'}
          </button>
        </div>
      )}
    </div>
  )
}
