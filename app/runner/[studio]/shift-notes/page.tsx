'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /runner/[studio]/shift-notes — REDIRECT STUB (2026-09-01).
//
// The v4 shift-notes surface (one autosaving doc per runner per shift,
// shift_note_docs) was replaced by the runner notes CHANNEL, which lives
// inline on the studio hub (components/runner/RunnerNotesChannel — option A
// of docs/design-refs/runner-notes-options.html). This route survives for
// muscle memory and stale bookmarks only, same pattern as /clients → /crm.
//
// It redirects rather than keeping the old editor alive because two write
// surfaces would diverge: a doc typed here would never appear in the channel,
// which is exactly the two-places problem Eli asked to remove. The
// shift_note_docs TABLE stays (history; its non-empty docs were poured into
// runner_note_posts by migration 20260901140000).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function ShiftNotesRedirect(): null {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  useEffect(() => { router.replace(`/runner/${studio}`) }, [router, studio])
  return null
}
