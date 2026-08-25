'use client'
// Helpful hints — first-time-user coach marks across the app (Eli, 2026-08-17).
//
// A small pulsing "?" beside things worth a tip; tap it for the tip, tap
// anywhere to dismiss. ON BY DEFAULT (they exist for first-timers) and
// toggleable — admin: the rail's "Helpful hints" button; runners: the 💡 in
// the hub header. Off is remembered per device in localStorage['prsflo-hints']
// (same pattern as the theme).
//
// Mechanic approved in the SOP mocks (billing-sop.html / manager-sop.html /
// runner-sop.html carry the same markers inside the manuals).
//
// Usage: <Hint tip="…" /> inline next to the thing it explains. The click
// handler stops propagation so a hint inside a clickable row (queue items,
// session cards) never triggers the row.
//
// Styles: .c-hint / .c-hint-tip in styles/globals.css.
//
// The tip renders through a PORTAL to <body> (2026-08-25): CSS `opacity` dims
// an element's ENTIRE subtree — absolutely-positioned children included — so a
// tip opened from inside a dimmed label (.c-label is opacity 0.45) rendered
// translucent. No background value can fix inherited opacity; escaping the
// subtree is the fix. Position is measured from the marker at open and the tip
// closes on any scroll, so it never drifts away from its "?".
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const KEY = 'prsflo-hints'
const EVT = 'prsflo-hints-change'

/** Read the persisted setting. Default ON — hints exist for first-timers. */
export function hintsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(KEY) !== 'off'
}

export function setHintsEnabled(on: boolean) {
  localStorage.setItem(KEY, on ? 'on' : 'off')
  window.dispatchEvent(new Event(EVT))
}

/**
 * Live view of the setting. First render is `false` on purpose — same
 * hydration-safe pattern as useIsMobile (server has no localStorage), so the
 * markers pop in after mount rather than mismatching.
 */
export function useHints(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const sync = () => setOn(hintsEnabled())
    sync()
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync) // other tabs
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return on
}

const TIP_W = 230

export function Hint({ tip }: { tip: string }) {
  const on = useHints()
  const markerRef = useRef<HTMLSpanElement>(null)
  // Tip position, measured from the marker at open. null = closed.
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const open = pos !== null

  // Tap-anywhere-else closes the tip (phones have no hover); so does any
  // scroll, since a fixed-position tip would otherwise detach from its "?".
  useEffect(() => {
    if (!open) return
    const close = () => setPos(null)
    document.addEventListener('click', close)
    window.addEventListener('scroll', close, true) // capture: inner scrollers too
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  if (!on) return null
  return (
    <span
      ref={markerRef}
      className="c-hint"
      role="button"
      aria-label="Hint"
      onClick={e => {
        // Never let a hint tap activate the row/card it sits on.
        e.stopPropagation()
        e.preventDefault()
        if (open) { setPos(null); return }
        const r = markerRef.current?.getBoundingClientRect()
        if (!r) return
        setPos({
          left: Math.min(Math.max(8, r.left - 12), window.innerWidth - TIP_W - 8),
          bottom: window.innerHeight - r.top + 7,
        })
      }}
    >
      ?
      {open && createPortal(
        <span
          className="c-hint-tip"
          style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, width: TIP_W }}
          onClick={e => e.stopPropagation()}
        >{tip}</span>,
        document.body,
      )}
    </span>
  )
}
