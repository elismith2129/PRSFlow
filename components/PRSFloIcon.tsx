'use client'
import React, { useEffect, useState } from 'react'

// Bare wave mark for the PRSFlo logo lockup (nav + login/reset). No rounded-square
// container — that square is only for the home-screen app icon. The mark sits on a
// subtle centered teal radial glow (~1.4x the icon diameter) that scales with `size`.
// `size` controls both width and height of the icon (square viewBox 0 0 200 200).
// Theme-aware: dark mode keeps the teal/lime gradients + white stroke; light mode
// swaps to solid blue/grey/blue strokes set directly on each path — avoids the
// duplicate-gradient-id problem that made CSS overrides fail across icon instances.
export function PRSFloIcon({ size = 38 }: { size?: number }) {
  const glowSize = size * 1.4
  const [isLight, setIsLight] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const update = () => setIsLight(root.getAttribute('data-theme') === 'light')
    update()
    // Update live when the theme toggle flips data-theme (icon stays mounted in the nav).
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

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
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: glowSize,
          height: glowSize,
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, rgba(93,202,165,0.10) 0%, rgba(93,202,165,0.04) 30%, rgba(0,0,0,0) 55%)',
          pointerEvents: 'none',
        }}
      />
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ display: 'block', position: 'relative', flexShrink: 0 }}
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
        <path data-wave="teal" d="M 14 100 Q 70 -10, 113 100 T 186 100" stroke={isLight ? '#3b82f6' : 'url(#prsflo-teal)'} strokeWidth="11" fill="none" strokeLinecap="round" opacity={isLight ? 0.9 : 0.6} />
        <path data-wave="lime" d="M 14 100 Q 70 30, 113 100 T 186 100" stroke={isLight ? '#cbd5e1' : 'url(#prsflo-lime)'} strokeWidth="11" fill="none" strokeLinecap="round" opacity={isLight ? 0.6 : 0.9} />
        <path data-wave="white" d="M 14 100 Q 70 70, 113 100 T 186 100" stroke={isLight ? '#3b82f6' : '#e8eaf0'} strokeWidth="11" fill="none" strokeLinecap="round" opacity={isLight ? 0.4 : 1} />
      </svg>
    </div>
  )
}
