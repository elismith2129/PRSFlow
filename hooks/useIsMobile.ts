'use client'
import { useEffect, useState } from 'react'

// Returns true when the viewport is at or below the mobile breakpoint (768px).
// Used to apply mobile-only layout overrides via conditional inline styles
// without touching the desktop layout. Defaults to false (desktop) on the first
// render so server/first-paint output is always the desktop layout; the effect
// flips it on the client after mount. Pages here render client-side behind
// AuthGuard, so there is no visible hydration flash.
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [breakpoint])
  return isMobile
}
