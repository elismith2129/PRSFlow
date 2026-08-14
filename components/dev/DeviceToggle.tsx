'use client'
// ─────────────────────────────────────────────────────────────────────────────
// DeviceToggle — floating phone/ipad preview button (2026-08-14, for Eli).
//
// ⚠ TEMPORARY — BUILD-TIME TOOL ONLY. Eli's ruling 2026-08-14: this exists for
// reviewing the redesign branch and is to be REMOVED (together with
// app/(main)/preview/) before this branch merges to main / goes live.
//
// OWNER-ONLY. A small floating button on every internal page; tapping it opens
// a two-option menu (iPhone / iPad) that jumps to /preview with the CURRENT
// page preloaded in the device frame. Inside the frame the whole app is
// browsable and stays at phone/tablet size, so any page can be reviewed at
// device width from a computer. Staff never see this control.
//
// Hidden on /preview itself (the frame page has its own toggles) and rendered
// as nothing for every non-owner role, so it costs the app nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useUserProfile } from '@/hooks/useUserProfile'

export default function DeviceToggle() {
  const router = useRouter()
  const pathname = usePathname()
  const { profile } = useUserProfile()
  const [open, setOpen] = useState(false)

  if (profile?.role !== 'owner') return null
  if (!pathname || pathname.startsWith('/preview')) return null

  function jump(device: 'phone' | 'ipad') {
    setOpen(false)
    router.push(`/preview?path=${encodeURIComponent(pathname ?? '/')}&device=${device}`)
  }

  const item: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '9px 14px', minHeight: 40,
    background: 'transparent', color: 'var(--c-fg)',
    border: 'none', font: 'inherit', fontSize: 12.5, fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap',
  }

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 9990 }}>
      {open && (
        <div style={{
          position: 'absolute', right: 0, bottom: 46,
          background: 'var(--c-srf, var(--c-bg))',
          boxShadow: 'var(--c-softsh)', borderRadius: 14,
          overflow: 'hidden', minWidth: 150,
        }}>
          <button style={item} onClick={() => jump('phone')}>View as iPhone</button>
          <button style={item} onClick={() => jump('ipad')}>View as iPad</button>
        </div>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Device preview"
        title="View this page as phone / tablet"
        style={{
          width: 40, height: 40, borderRadius: 99,
          background: 'var(--c-wash2)', color: 'var(--c-fg)',
          boxShadow: 'var(--c-softsh)',
          border: 'none', font: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, cursor: 'pointer', opacity: 0.85,
        }}
      >⧉</button>
    </div>
  )
}
