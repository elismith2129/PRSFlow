'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// Client-side route protection for the internal (main) route group.
// Unauthenticated users are redirected to /login. While the session is being
// resolved we render nothing so protected content never flashes on screen.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)

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

  if (authed !== true) return null

  return <>{children}</>
}
