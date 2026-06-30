import React from 'react'

// Bare wave mark for the PRSFlo logo lockup (nav + login). No background, no
// rounded-square container — that square is only for the home-screen app icon.
// `size` controls both width and height (square viewBox 0 0 200 200).
export function PRSFloIcon({ size = 38 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="prsflo-teal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5DCAA5" />
          <stop offset="100%" stopColor="#0e5446" />
        </linearGradient>
        <linearGradient id="prsflo-lime" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e3f99c" />
          <stop offset="100%" stopColor="#8ab030" />
        </linearGradient>
      </defs>
      <path d="M 25 100 Q 70 15, 110 100 T 178 100" stroke="url(#prsflo-teal)" strokeWidth="11" fill="none" strokeLinecap="round" opacity="0.6" />
      <path d="M 25 100 Q 70 45, 110 100 T 178 100" stroke="url(#prsflo-lime)" strokeWidth="11" fill="none" strokeLinecap="round" opacity="0.9" />
      <path d="M 25 100 Q 70 80, 110 100 T 178 100" stroke="#e8eaf0" strokeWidth="11" fill="none" strokeLinecap="round" />
    </svg>
  )
}
