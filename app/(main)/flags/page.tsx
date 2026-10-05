'use client'
// /flags — MOVED (2026-10-05). Flags is the second tab of /daily-ops now
// (Eli: "we keep adding things to the rail and things get more complicated and
// get hidden to where people don't actually use them"). The list itself is
// components/flags/FlagsView.tsx, unchanged. This stub keeps bookmarks, the
// dashboard's older links and Flo's "flags →" chip working, and carries the
// ?item=<id> deep link across — the /tasks, /my-day and /clients precedent.
// Do not delete.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function FlagsPage(): null {
  const router = useRouter()
  useEffect(() => {
    let item: string | null = null
    try { item = new URLSearchParams(window.location.search).get('item') } catch {}
    router.replace(`/daily-ops?tab=flags${item ? `&item=${encodeURIComponent(item)}` : ''}`)
  }, [router])
  return null
}
