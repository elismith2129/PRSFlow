'use client'

import { useEffect, useState } from 'react'
import { Rail } from '@/components/layout/Rail'

// Hides the nav during the fresh-login welcome splash so it never flashes for a
// frame before the splash covers it. Reads the 'showWelcome' flag synchronously
// (so the nav is hidden on the very first paint) and reveals the nav when the
// dashboard dispatches 'welcomeDone' after the splash dismisses. A fallback timer
// guarantees the nav can never stay hidden if that event is somehow missed.
// (Renders the side nav Rail since the §14 frame landed — Nav.tsx is retired.)
export function NavGate() {
  const [hidden, setHidden] = useState<boolean>(
    () => typeof window !== 'undefined' && sessionStorage.getItem('showWelcome') === 'true'
  )

  useEffect(() => {
    if (!hidden) return
    const reveal = () => setHidden(false)
    window.addEventListener('welcomeDone', reveal)
    const fallback = setTimeout(reveal, 3000)
    return () => {
      window.removeEventListener('welcomeDone', reveal)
      clearTimeout(fallback)
    }
  }, [hidden])

  return <Rail hiddenForWelcome={hidden} />
}
