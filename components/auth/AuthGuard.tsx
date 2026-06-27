'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// Client-side route protection for the internal (main) route group.
// Unauthenticated users are redirected to /login. While the session is being
// resolved we render nothing so protected content never flashes on screen.
//
// Fresh-login welcome hold: the login page sets a 'showWelcome' sessionStorage
// flag before redirecting here. When that flag is present we render a full-screen
// dark (#0d0f14) background while the session resolves — so the screen stays dark
// from the moment the page loads until the dashboard's welcome splash takes over,
// with no visible flash in between. We only read the flag here (never remove it);
// the dashboard clears it once its splash mounts.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [pendingWelcome] = useState<boolean>(
    () => typeof window !== 'undefined' && !!sessionStorage.getItem('showWelcome')
  )

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session) {
        setAuthed(true)
      } else {
        setAuthed(false)
        router.replace('/login')
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      if (session) {
        setAuthed(true)
      } else {
        setAuthed(false)
        router.replace('/login')
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [router])

  if (authed !== true) {
    // Fresh login: hold a dark screen until the session resolves and the dashboard's
    // welcome splash takes over, so nothing flashes. Otherwise render nothing.
    return pendingWelcome ? (
      <div style={{ position: 'fixed', inset: 0, background: '#0d0f14', zIndex: 100001 }} />
    ) : null
  }

  return <>{children}</>
}
