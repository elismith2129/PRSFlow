import type { Metadata } from 'next'

export const metadata: Metadata = {
  manifest: '/runner-manifest.json',
  icons: {
    apple: '/runner-apple-touch-icon-v2.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Runner',
  },
}

import AdminReturn from '@/components/runner/AdminReturn'
import RunnerGuard from '@/components/runner/RunnerGuard'
import { MemoGate } from '@/components/memos/MemoGate'
import { AskFlo } from '@/components/ask/AskFlo'

export default function RunnerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // AdminReturn renders nothing for runners and the public — see the component.
  // RunnerGuard (2026-08-20) is the subtree's login gate: no session → /login.
  // /runner/* was public since the pre-RLS era; RLS made that LOOK safe by
  // returning empty data, but a tablet being set up saw a hollow app instead
  // of a login. /runner/sop stays public (see the guard).
  // MemoGate (2026-09-14): the memo pop-up, on the studio hub only.
  // Ask Flo on the runner landing + studio hub only (2026-10-22); it hides
  // itself on pages with a fixed Save / Submit bar. Runner guide answers only.
  return <><AdminReturn /><RunnerGuard>{children}<MemoGate surface="runner" /><AskFlo surface="runner" /></RunnerGuard></>
}
