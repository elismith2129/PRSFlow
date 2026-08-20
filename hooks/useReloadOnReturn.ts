'use client'
import { useEffect } from 'react'

/**
 * Re-fetch when the app returns to the foreground (Eli, 2026-08-16).
 *
 * The realtime rule (CLAUDE.md) keeps every surface live while the socket is
 * OPEN — but on a phone, iOS suspends the WebSocket the moment the screen
 * locks or the PWA goes to the background, and events that fired while it was
 * asleep are never replayed. A runner's phone spends most of its shift asleep
 * in a pocket, so "live" surfaces looked stale until a manual refresh.
 *
 * This is the missing half of the pattern: pair it with the channel, passing
 * the SAME load() the channel calls. Fires on `visibilitychange` → visible and
 * on window focus (belt and braces — iOS standalone PWAs are inconsistent
 * about which one they deliver).
 */
export function useReloadOnReturn(reload: () => void) {
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'visible') reload()
    }
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [reload])
}
