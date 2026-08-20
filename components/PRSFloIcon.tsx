import React from 'react'

// Bare wave mark for the PRSFlo logo lockup (nav + login/reset/runner/SOP gate).
// No rounded-square container — that square is only for the home-screen app icon.
// `size` controls both width and height (square viewBox 0 0 200 200).
//
// MONOCHROME as of 2026-07-30 (carved redesign, spec §4, approved by Eli). The
// three waves are all `currentColor` — which resolves to --c-fg — separated only
// by opacity steps. The teal/lime gradients and the light-mode blues are gone:
// this system has no accent colour, and the mark now simply inverts with the
// ground instead of switching palettes.
//
// This also let the component drop 'use client': it no longer needs a
// MutationObserver on data-theme to restyle itself, because CSS does that now.
// The old duplicate-gradient-id problem disappears with the gradients.
export function PRSFloIcon({ size = 38 }: { size?: number }) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--c-fg)',
      }}
    >
      {/* The teal radial glow is gone — spec §7 permits no glows or outer halos. */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ display: 'block', position: 'relative', flexShrink: 0 }}
      >
        <path d="M 14 100 Q 70 -10, 113 100 T 186 100" stroke="currentColor" strokeWidth="11" fill="none" strokeLinecap="round" opacity={0.35} />
        <path d="M 14 100 Q 70 30, 113 100 T 186 100" stroke="currentColor" strokeWidth="11" fill="none" strokeLinecap="round" opacity={0.6} />
        <path d="M 14 100 Q 70 70, 113 100 T 186 100" stroke="currentColor" strokeWidth="11" fill="none" strokeLinecap="round" opacity={1} />
      </svg>
    </div>
  )
}
