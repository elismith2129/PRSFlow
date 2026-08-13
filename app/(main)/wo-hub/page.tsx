'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /wo-hub — RETIRED (2026-08-12). Redirects to /billing.
//
// The hub listed every work order and let you filter by studio, date and status.
// /billing does that and the whole invoice lifecycle besides, so the two pages
// were doing one job — and the abandoned one was still in the nav, which is how
// people end up filing work in a screen nobody reads.
//
// KEPT AS A STUB, not deleted, for the same reason /clients still exists after
// the CRM merge: bookmarks, muscle memory, and any link written down anywhere
// should land somewhere useful rather than on a 404.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function WoHubPage(): null {
  const router = useRouter()
  useEffect(() => { router.replace('/billing') }, [router])
  return null
}
