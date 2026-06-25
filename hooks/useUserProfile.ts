'use client'

import { useEffect, useState } from 'react'
import { supabase, UserProfile } from '@/lib/supabase'

// Resolves the logged-in user's user_profiles row by matching the auth session
// email. Returns { profile, loading }; profile is null when there is no session
// or no matching profile row. Single source of profile-fetching logic — reuse
// this everywhere rather than re-querying user_profiles inline.
export function useUserProfile(): { profile: UserProfile | null; loading: boolean } {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession()
      const email = sessionData.session?.user?.email
      if (!email) {
        if (active) {
          setProfile(null)
          setLoading(false)
        }
        return
      }
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('email', email)
        .limit(1)
      if (active) {
        setProfile(data && data.length > 0 ? (data[0] as UserProfile) : null)
        setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [])

  return { profile, loading }
}
