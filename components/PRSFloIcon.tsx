import React from 'react'

// THE RIBBON — the PRSFlo brand mark (nav rail + login/reset/runner/SOP gate + Flo box).
// No rounded-square container — that square is only for the home-screen app icon.
// `size` controls both width and height (square viewBox 0 0 200 200).
//
// ONE SOLID SHAPE, ONE COLOUR, as of 2026-08-22 (Eli: "take the logo and just fill it
// in, one colour" — picked option G1 · Ribbon from docs/design-refs/brand-mark-options.html).
// The fill is the space between the old mark's tallest and flattest wave; the two lines
// cross mid-mark, so the fill reads as a twisted ribbon still in motion.
//
// Colour: SEA GREEN `#43dfae` (--c-st-booked) — fixed in BOTH themes. This is the
// sanctioned brand exception to design-spec Law 3 ("colour is status, nothing else"),
// recorded in PRSFLO-DESIGN-SPEC.md §20 the way the Flo glow is recorded against §7.
// Do not swap it for currentColor, do not reintroduce the three-wave strokes, gradients,
// or the old radial glow.
//
// This supersedes the monochrome three-wave mark of the 2026-07-30 carved redesign
// (three currentColor strokes at .35/.6/1).
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
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ display: 'block', position: 'relative', flexShrink: 0 }}
      >
        <path
          d="M 14 100 Q 70 -10 113 100 Q 156 210 186 100 Q 156 130 113 100 Q 70 70 14 100 Z"
          fill="#43dfae"
        />
      </svg>
    </div>
  )
}
