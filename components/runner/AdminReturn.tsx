'use client'
// ─────────────────────────────────────────────────────────────────────────────
// AdminReturn — the office's way back out of the runner subtree (2026-08-14).
//
// The rail links to /runner so admins can see and use the hub exactly as a
// runner does. But runner pages deliberately carry no nav — a real runner
// installs them as their own home-screen PWA and never leaves. Before this,
// an admin who followed the rail in was stuck with the browser back button.
//
// This bar renders ONLY for an authenticated non-runner profile:
//   - the shared runner PIN login has role 'runner'  → sees nothing
//   - no session (public access)                     → sees nothing
//   - owner/manager/billing/asst_manager/tech        → slim "back" bar on top
//
// So the runner PWA looks exactly as it always has, and the office gets a
// door home. Mounted once in app/runner/layout.tsx, covers every /runner page.
// ─────────────────────────────────────────────────────────────────────────────
import { useRouter } from 'next/navigation'
import { useUserProfile } from '@/hooks/useUserProfile'

export default function AdminReturn() {
  const router = useRouter()
  const { profile } = useUserProfile()
  if (!profile || profile.role === 'runner') return null

  return (
    <button
      onClick={() => router.push('/')}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', minHeight: 40,
        padding: '9px 16px',
        background: 'var(--c-wash2)', color: 'var(--c-fg)',
        border: 'none', font: 'inherit', fontSize: 11.5, fontWeight: 700,
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span aria-hidden style={{ fontSize: 13 }}>←</span>
      Back to PRSFlo
      <span style={{ marginLeft: 'auto', fontWeight: 400, opacity: 0.5, fontSize: 10.5 }}>
        Viewing as office
      </span>
    </button>
  )
}
