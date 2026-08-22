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
 * Treatment (docs/PRSFLO-DESIGN-SPEC.md §4; casing amended by Eli 2026-08-22):
 * Archivo Black, `PRS` at full strength and `Flo` at .45 (capital F, lowercase
 * l-o — the original casing, restored), tracking −.02em, monochrome ink in BOTH
 * themes. The wordmark carries no colour; the brand colour lives on the ribbon
 * mark (`PRSFloIcon`) alone. Only `size` may vary per placement.
 */
export function Wordmark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span
      className={['c-wordmark', className].filter(Boolean).join(' ')}
      style={{ fontSize: size }}
    >
      PRS<span className="c-wordmark-flo">Flo</span>
    </span>
  )
}

export default Wordmark
