import React from 'react'

/**
 * PRSFlo WORDMARK — the single source of truth, site-wide.
 *
 * This component IS the locked convention. Before it existed, the rule was
 * "copy the exact span styling out of Nav.tsx and never recreate it from
 * description" — a rule that existed because the login page had already drifted
 * to the wrong font and colour, and which had to be re-enforced by hand across
 * five files. Now there is nothing to copy: every placement renders this.
 *
 * Do NOT reintroduce inline PRS/Flo spans anywhere. If the wordmark needs to
 * change, change it here and it changes everywhere by construction.
 *
 * Carved treatment (docs/PRSFLO-DESIGN-SPEC.md §4, approved by Eli 2026-07-30):
 * Archivo Black, `PRS` at full strength and `FLO` at .45, tracking −.02em,
 * monochrome ink in BOTH themes. The lime/blue accent it used to carry is gone —
 * this system has no accent colour. Only `size` may vary per placement.
 */
export function Wordmark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span
      className={['c-wordmark', className].filter(Boolean).join(' ')}
      style={{ fontSize: size }}
    >
      PRS<span className="c-wordmark-flo">FLO</span>
    </span>
  )
}

export default Wordmark
