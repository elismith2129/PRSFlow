'use client'
// /tasks — RETIRED (2026-09-15, flags + tasks merged). A task is a flag
// someone typed by hand; the one list lives at /flags. This stub keeps old
// bookmarks and the dashboard's older links working — the /my-day and
// /clients precedent. Do not delete.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function TasksPage(): null {
  const router = useRouter()
  useEffect(() => { router.replace('/flags') }, [router])
  return null
}
