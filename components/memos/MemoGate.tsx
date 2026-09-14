'use client'

// ─────────────────────────────────────────────────────────────────────────────
// MemoGate — the memo pop-up (mock docs/design-refs/memos-options.html §2).
//
// Mounted in BOTH layouts, but it only ever shows on the person's LANDING
// surface — the dashboard for admin, the studio hub for runners — never
// inside a work order or a checklist mid-shift. One memo at a time, oldest
// unread first.
//
// SOFT THEN HARD (Eli): the first showing has "I'll read it later" — pressed
// once, the memo stays out of the way until the next open. HARD_AFTER_HOURS
// after that press it comes back without the link and says why.
//
// The SopGate precedent: full-screen, above the nav (99999), a SECURITY
// DEFINER RPC writes the person's own row. Also stamps last_seen_at once per
// mount — the scoreboard's "hasn't opened the app since" reads it.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useMyMemos } from '@/hooks/useMyMemos'
import { pendingMemos, isHard, markSeen, deferMemo, ackMemo, touchLastSeen } from '@/lib/memos'
import { MemoView } from '@/components/memos/MemoView'

function profileInitials(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.map(p => p[0]).join('').toUpperCase().slice(0, 3)
}

export function MemoGate({ surface }: { surface: 'admin' | 'runner' }) {
  const pathname = usePathname()
  const { profile, loading: profileLoading } = useUserProfile()
  const { memos, loading, reload } = useMyMemos(profile)
  const [busy, setBusy] = useState(false)
  // Memos deferred THIS session hide until the next mount — "later" means
  // later, not "after the next realtime tick".
  const [hiddenNow, setHiddenNow] = useState<Set<string>>(() => new Set())
  const touched = useRef(false)

  useEffect(() => {
    if (profile && !touched.current) { touched.current = true; touchLastSeen() }
  }, [profile])

  // Landing surfaces only.
  const onLanding = surface === 'admin'
    ? pathname === '/'
    : /^\/runner\/[^/]+\/?$/.test(pathname ?? '')

  const queue = pendingMemos(memos).filter(m => {
    if (!hiddenNow.has(m.id)) return true
    // A deferred memo that has gone HARD is never hidden, even this session.
    return isHard(m)
  })
  const current = queue[0] ?? null

  // Opening = a receipt. Recorded once per memo per showing.
  const seenRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!current || !onLanding) return
    if (seenRef.current.has(current.id)) return
    seenRef.current.add(current.id)
    if (!current.receipt) markSeen(current.id)
  }, [current, onLanding])

  if (profileLoading || loading || !profile || !onLanding || !current) return null

  // Soft until the 48h after the FIRST "later" run out; then hard. Every
  // open in between shows it again (with the moment it turns hard), and
  // "Not now" still works — the deadline is the deferral, not the count.
  const mode: 'soft' | 'hard' = isHard(current) ? 'hard' : 'soft'

  async function sign(initials: string) {
    if (!current) return
    setBusy(true)
    const ok = await ackMemo(current.id, initials)
    setBusy(false)
    if (ok) await reload()
  }
  async function later() {
    if (!current) return
    setBusy(true)
    const ok = await deferMemo(current.id)
    setBusy(false)
    if (ok) {
      setHiddenNow(prev => new Set(prev).add(current.id))
      await reload()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'var(--c-bg)',
        display: 'flex', alignItems: 'stretch', justifyContent: 'center',
        padding: 'calc(12px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div
        className="c-panel"
        style={{
          width: 'min(720px, 100%)', display: 'flex', flexDirection: 'column',
          background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 20,
          padding: '18px 18px 16px', minHeight: 0, overflow: 'hidden',
        }}
      >
        <MemoView
          memo={current}
          receipt={current.receipt}
          initials={profile.initials || profileInitials(profile.display_name)}
          mode={mode}
          position={{ i: 1, n: queue.length }}
          busy={busy}
          onSign={sign}
          onLater={mode === 'soft' ? later : undefined}
        />
      </div>
    </div>
  )
}
