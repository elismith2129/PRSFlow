'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// /clients is a redirect stub (the CRM + Clients merge, June 2026) — kept so old
// bookmarks and links land on the CRM. Do not delete. The Clients view itself
// is components/clients/ClientsPageInner.tsx, mounted as a tab of /crm; it
// lived in this file until 2026-10-12, when exporting it from a page file
// turned out to fail Next's page type check.
export default function ClientsPage(): null {
  const router = useRouter()
  useEffect(() => { router.replace('/crm') }, [router])
  return null
}
