'use client'
// Route-level error boundary — catches render/runtime errors in any page and
// shows a friendly recovery screen instead of a white page. (Phase 0 audit fix.)
import { useEffect } from 'react'
import { logAppError } from '@/lib/errlog'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logAppError(error, { source: 'error-boundary' })
  }, [error])

  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 20, color: 'var(--text)', marginBottom: 10 }}>
          Something went wrong
        </div>
        <div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 20 }}>
          This page hit an error. Your data is safe — the error has been logged.
          Try again, or head back to the dashboard.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            onClick={() => reset()}
            style={{ padding: '9px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'Syne', fontWeight: 700, fontSize: 12, background: 'var(--accent)', color: 'var(--bg)' }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{ padding: '9px 20px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'Syne', fontWeight: 700, fontSize: 12, background: 'transparent', color: 'var(--text2)', textDecoration: 'none' }}
          >
            Dashboard
          </a>
        </div>
        {error?.digest && (
          <div style={{ marginTop: 16, fontFamily: 'DM Mono', fontSize: 10, color: 'var(--text3)' }}>ref: {error.digest}</div>
        )}
      </div>
    </div>
  )
}
