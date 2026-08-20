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
// carved (var(--c-bg)) background while the session resolves — so the screen stays
// from the moment the page loads until the dashboard's welcome splash takes over,
// with no visible flash in between. We only read the flag here (never remove it);
// the dashboard clears it once its splash mounts.
//
// Runner lockout: a `runner`-role session has no business in the internal app, so
// it is bounced to /runner and the children never render. This is UX/organization
// only — RLS is the real boundary and already grants the runner role nothing on
// leads, clients, client_contacts, registration_tokens, engineers, qc_reports or
// srs_log, so those pages could only ever have rendered empty. Don't rely on this
// guard for security; keep the RLS tiers correct.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [blockedRunner, setBlockedRunner] = useState(false)
  const [pendingWelcome] = useState<boolean>(
    () => typeof window !== 'undefined' && !!sessionStorage.getItem('showWelcome')
  )

  useEffect(() => {
    let active = true

    // Bounce a runner-role session out of the internal app. Runners can read
    // their own user_profiles row under RLS, which is all this needs.
    async function redirectIfRunner(): Promise<boolean> {
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth?.user?.id
      if (!uid) return false
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('auth_user_id', uid)
        .maybeSingle()
      if (!active || profile?.role !== 'runner') return false
      setBlockedRunner(true)
      router.replace('/runner')
      return true
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      if (data.session) {
        // Check the role BEFORE authorizing render, so internal pages never
        // flash on a runner's screen.
        if (await redirectIfRunner()) return
        if (!active) return
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

  // Redirect to /runner is in flight — render nothing so no internal page shows.
  if (blockedRunner) return null

  if (authed !== true) {
    // Fresh login: hold a dark screen until the session resolves and the dashboard's
    // welcome splash takes over, so nothing flashes. Otherwise render nothing.
    return pendingWelcome ? (
      <div data-auth-hold="" style={{ position: 'fixed', inset: 0, background: 'var(--c-bg)', zIndex: 100001 }} />
    ) : null
  }

  return <>{children}</>
}
