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
import { useEffect, useState } from 'react'

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

export function Hint({ tip }: { tip: string }) {
  const on = useHints()
  const [open, setOpen] = useState(false)

  // Tap-anywhere-else closes the tip (phones have no hover).
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  if (!on) return null
  return (
    <span
      className="c-hint"
      role="button"
      aria-label="Hint"
      onClick={e => {
        // Never let a hint tap activate the row/card it sits on.
        e.stopPropagation()
        e.preventDefault()
        setOpen(o => !o)
      }}
    >
      ?
      {open && <span className="c-hint-tip" onClick={e => e.stopPropagation()}>{tip}</span>}
    </span>
  )
}
