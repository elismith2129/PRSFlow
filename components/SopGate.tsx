'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { PRSFloIcon } from '@/components/PRSFloIcon'

// First-login gate: a full-screen, non-dismissable modal shown until the user
// acknowledges the SOP. Mounted in the (main) layout so it overlays every
// internal page. Uses the acknowledge_sop() RPC (SECURITY DEFINER) because the
// user_profiles UPDATE policy is mgr+-only, so a plain update would be denied
// for asst_manager / tech / runner.
export function SopGate() {
  const router = useRouter()
  const { profile, loading } = useUserProfile()
  const [acknowledging, setAcknowledging] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Show only for a resolved profile that hasn't acknowledged yet. `dismissed`
  // hides it immediately on click (useUserProfile's cached profile won't refresh
  // this session; the RPC persists the flag for the next session).
  const show = !loading && !!profile && !profile.sop_acknowledged && !dismissed
  if (!show) return null

  async function handleGo() {
    setAcknowledging(true)
    setDismissed(true)
    try {
      await supabase.rpc('acknowledge_sop')
    } catch {
      /* best-effort: navigate regardless; if it failed it simply re-shows next session */
    }
    router.push('/sop')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        // 99999 = same as the Nav; this element renders later in the DOM (after
        // <main> in the layout) so it paints over the Nav, while staying BELOW
        // the fresh-login welcome splash (z 100000) so the splash wins on a
        // brand-new user's very first login.
        zIndex: 99999,
        background: '#0d0f14',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: 420, textAlign: 'center' }}>
        {/* Locked PRSFlo lockup — span styling copied exactly from Nav.tsx
            (fontFamily Syne, weight 800, letterSpacing -0.5; PRS = accent;
            Flo = text, opacity 0.45, weight 500). Only fontSize differs. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <PRSFloIcon size={64} />
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 40, letterSpacing: -0.5, lineHeight: 1 }}>
            <span style={{ color: 'var(--accent)' }}>PRS</span>
            <span style={{ color: 'var(--text)', opacity: 0.45, fontWeight: 500 }}>Flo</span>
          </div>
        </div>

        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 22, color: 'var(--text)', marginTop: 32 }}>
          Before you start
        </div>

        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginTop: 14, maxWidth: 360 }}>
          Read the CRM Standard Operating Procedure before using the system. It covers everything you need to know.
        </div>

        <button
          onClick={handleGo}
          disabled={acknowledging}
          style={{
            marginTop: 32,
            width: '100%',
            maxWidth: 320,
            background: '#c8f04e',
            color: '#0d0f14',
            border: 'none',
            borderRadius: 6,
            padding: '14px',
            fontFamily: "'DM Mono', monospace",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: acknowledging ? 'default' : 'pointer',
          }}
        >
          {acknowledging ? 'Opening…' : 'Take me to the SOP'}
        </button>
      </div>
    </div>
  )
}
