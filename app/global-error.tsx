'use client'
// Root-level error boundary — catches errors in the root layout itself.
// Must render its own <html>/<body> (Next.js requirement). Inline colors only:
// globals.css may not have loaded when this renders.
import { useEffect } from 'react'
import { logAppError } from '@/lib/errlog'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logAppError(error, { source: 'global-error-boundary' })
  }, [error])

  return (
    <html>
      <body style={{ margin: 0, background: '#0d0f14', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 420, textAlign: 'center', padding: 24 }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#e8eaf0', marginBottom: 10 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.6, marginBottom: 20 }}>
            The app hit an unexpected error. It has been logged. Reload to continue.
          </div>
          <button
            onClick={() => reset()}
            style={{ padding: '9px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: '#c8f04e', color: '#0d0f14' }}
          >
            Reload
          </button>
          {error?.digest && (
            <div style={{ marginTop: 16, fontFamily: 'monospace', fontSize: 10, color: '#6B7280' }}>ref: {error.digest}</div>
          )}
        </div>
      </body>
    </html>
  )
}
