'use client'
// /runner/sop — the runner APP GUIDE (public/runner-sop.html), served inside
// the runner app the same way /sop serves the admin guide (iframe).
//
// This is the "how to use the app" SOP only. The RUNNER MANUAL — the job
// itself — is a separate document (paper today; its digital version is a
// planned later project) and keeps its own "Runners manual" slot on the hub.
//
// No AuthGuard, like every /runner/* route. Runners never see the admin SOP;
// this page is the only guide reachable from runner surfaces.
import { useRouter } from 'next/navigation'

export default function RunnerSopPage() {
  const router = useRouter()
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--c-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="c-control c-raised"
          style={{
            width: 38, height: 38, borderRadius: 99, flexShrink: 0,
            background: 'var(--c-wash)', color: 'var(--c-fg)', border: 'none', font: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, cursor: 'pointer',
          }}
        >←</button>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c-fg)' }}>App guide</span>
      </div>
      <iframe
        src="/runner-sop.html"
        style={{ flex: 1, width: '100%', border: 'none' }}
        title="Runner App Guide"
      />
    </div>
  )
}
