'use client'

/**
 * TRAINING — the learning corner of the app (Eli, 2026-08-20: "lets pop sop
 * and hints that live in settings, into training instead"). The SOP link and
 * the helpful-hints toggle are learning tools, not settings, and this page
 * was an empty placeholder — so they moved here and the rail's Settings
 * disclosure slimmed to DEV / theme / Sign Out.
 *
 * The training TRACKER (per-person progress, sign-offs) is still the Phase C
 * HR build per docs/HR-SPEC.md — the note at the bottom keeps that promise
 * visible without pretending this page is it.
 */

import Link from 'next/link'
import { useHints, setHintsEnabled } from '@/components/ui/Hint'

export default function TrainingPage() {
  const hintsOn = useHints()

  return (
    <div style={{ maxWidth: 620, margin: '36px auto', padding: '0 16px' }}>
      <h1 className="c-arch" style={{ fontSize: 26, letterSpacing: '-0.03em', marginBottom: 4 }}>Training</h1>
      <p style={{ fontSize: 12.5, opacity: 0.6, marginTop: 0, marginBottom: 20 }}>
        Everything for learning the app lives here.
      </p>

      {/* SOP — the app guide */}
      <Link href="/sop" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
        <div className="c-panel" style={{ padding: '18px 20px', marginBottom: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 20 }}>✧</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>App guide (SOP)</div>
            <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 2 }}>
              Step-by-step guides for the CRM, clients, tasks and flags — plus the version
              history of what changed in each release.
            </div>
          </div>
          <span style={{ fontSize: 13, opacity: 0.4 }}>→</span>
        </div>
      </Link>

      {/* Helpful hints toggle */}
      <div className="c-panel" style={{ padding: '18px 20px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 20 }}>💡</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Helpful hints</div>
          <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 2 }}>
            Little ⓘ markers around the app that explain what a screen does as you use it.
            Great while you&apos;re learning; switch them off once you don&apos;t need them.
          </div>
        </div>
        <button
          onClick={() => setHintsEnabled(!hintsOn)}
          className="c-control"
          aria-pressed={hintsOn}
          style={{
            borderRadius: 99, padding: '8px 18px', fontSize: 11, fontWeight: 800,
            letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer',
            background: hintsOn ? 'var(--c-st-booked)' : 'var(--c-wash2)',
            color: hintsOn ? 'var(--c-chip-ink)' : 'var(--c-fg)',
            flexShrink: 0,
          }}
        >
          {hintsOn ? 'On' : 'Off'}
        </button>
      </div>

      {/* The HR training tracker is still to come — keep the promise visible. */}
      <div style={{ fontSize: 11, opacity: 0.45, marginTop: 18, lineHeight: 1.6 }}>
        Coming later: the training tracker — per-person progress and sign-offs, as part of
        the HR layer.
      </div>
    </div>
  )
}
