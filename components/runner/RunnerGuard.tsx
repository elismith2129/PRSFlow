'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// LOGIN GATE FOR THE RUNNER SUBTREE (Eli, 2026-08-20, tablet setup: "when i
// go to /runner there was no login. it just opened the app").
//
// /runner/* was left public in the pre-RLS architecture and nobody noticed,
// because RLS quietly hands an anonymous visitor empty data — the hub RENDERS
// for a stranger, it just renders hollow. That is both a bad first-run
// experience (a tablet being set up sees a broken-looking app instead of a
// login) and an unnecessary exposure of the app's shape. The door belongs
// here, same client-guard pattern as components/auth/AuthGuard.tsx on the
// (main) group: any authenticated session may pass (admins open runner pages
// too — AdminReturn exists for exactly that), no session → /login.
//
// Like AuthGuard, this is UX/organization — RLS remains the real boundary.
//
// THE ONE EXEMPTION: /runner/sop (the app guide) stays reachable without a
// session — it's a static training page a runner may need precisely when
// they can't get in.
export function RunnerGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [exempt, setExempt] = useState(false)

  useEffect(() => {
    // Path check on mount (client-only): the SOP page is public.
    if (window.location.pathname.startsWith('/runner/sop')) {
      setExempt(true)
      return
    }
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session) setAuthed(true)
      else {
        setAuthed(false)
        router.replace('/login')
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      if (session) setAuthed(true)
      else {
        setAuthed(false)
        router.replace('/login')
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [router])

  if (exempt) return <>{children}</>
  // Nothing renders until the session resolves — the hub must never flash
  // (even hollow) on an unauthenticated screen.
  if (authed !== true) return null
  return <>{children}</>
}

export default RunnerGuard
