'use client'
// /my-day — RETIRED (2026-09-06, the dashboard∪my-day merge). The Noir
// dashboard absorbed the duties, queues and money; Shift Notes got its own
// page (/shift-notes). This stub keeps old bookmarks working — the /clients
// → /crm precedent. Do not delete.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function MyDayPage(): null {
  const router = useRouter()
  useEffect(() => { router.replace('/') }, [router])
  return null
}
