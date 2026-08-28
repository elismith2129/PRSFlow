'use client'

import { useState, useEffect, useRef } from 'react'
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

  // ── SHIFT-CHANGE AUTO-LOGOUT (Eli, 2026-08-20) — RUNNER SESSIONS ONLY. ──
  // A runner session expires (a) 4 hours after sign-in, or (b) when it
  // crosses the 8:50 AM daily seal — whichever comes first. With per-person
  // PINs a re-login is two seconds, so expiry is cheap; without it a shared
  // tablet stays "whoever logged in last week" forever. Checked on mount, on
  // tablet wake (visibilitychange) and every 10 minutes — NEVER mid-keystroke;
  // the worst case is finishing a form and being asked for your PIN on the
  // next screen. Admin/staff sessions visiting runner pages are exempt: their
  // whole login (rail app included) must not be killed by a runner rule.
  // NEVER MID-KEYSTROKE, for real this time (ARS tester, Aug 28: "app
  // randomly logged me out in the middle of me inputting stock"). The
  // 10-minute expiry timer had no idea the runner was typing. Any touch or
  // keypress stamps this ref; expiry is DEFERRED while the last interaction
  // is under 5 minutes old — the tablet still expires once idle, so the
  // shared-device rule holds, but a runner mid-count is never yanked.
  // Starts at 0 so the MOUNT check still expires a stale overnight session
  // immediately — deferral only ever protects a person actually working.
  const lastActivityRef = useRef(0)
  useEffect(() => {
    const stamp = () => { lastActivityRef.current = Date.now() }
    window.addEventListener('pointerdown', stamp, { capture: true, passive: true })
    window.addEventListener('keydown', stamp, { capture: true, passive: true })
    return () => {
      window.removeEventListener('pointerdown', stamp, true)
      window.removeEventListener('keydown', stamp, true)
    }
  }, [])

  useEffect(() => {
    let active = true

    async function expireIfStale() {
      // Actively working → defer; the next tick or tablet-wake rechecks.
      if (Date.now() - lastActivityRef.current < 5 * 60_000) return
      const { data } = await supabase.auth.getSession()
      const session = data.session
      if (!active || !session) return
      const { data: profs } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('auth_user_id', session.user.id)
        .limit(1)
      if (!active || profs?.[0]?.role !== 'runner') return

      const signedInAt = new Date(session.user.last_sign_in_at ?? 0).getTime()
      const now = Date.now()
      const fourHours = now - signedInAt > 4 * 60 * 60_000
      // Today's 8:50 AM (local). Crossing it ends every session from before it.
      const seal = new Date(); seal.setHours(8, 50, 0, 0)
      const crossedSeal = signedInAt < seal.getTime() && now >= seal.getTime()
      if (fourHours || crossedSeal) {
        await supabase.auth.signOut()
        router.replace('/login')
      }
    }

    expireIfStale()
    const onVis = () => { if (document.visibilityState === 'visible') expireIfStale() }
    document.addEventListener('visibilitychange', onVis)
    const timer = setInterval(expireIfStale, 10 * 60_000)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(timer)
    }
  }, [router])

  if (exempt) return <>{children}</>
  // Nothing renders until the session resolves — the hub must never flash
  // (even hollow) on an unauthenticated screen.
  if (authed !== true) return null
  return <>{children}</>
}

export default RunnerGuard
