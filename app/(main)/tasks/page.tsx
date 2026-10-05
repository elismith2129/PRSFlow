'use client'
// /tasks — RETIRED (2026-09-15, flags + tasks merged). A task is a flag
// someone typed by hand; the one list is the Flags tab of /daily-ops
// (2026-10-05 — it was /flags, which is now a stub too; this goes straight
// there rather than bouncing twice). Keeps old bookmarks working — the
// /my-day and /clients precedent. Do not delete.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function TasksPage(): null {
  const router = useRouter()
  useEffect(() => { router.replace('/daily-ops?tab=flags') }, [router])
  return null
}
