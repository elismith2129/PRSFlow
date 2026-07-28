// ─────────────────────────────────────────────────────────────────────────────
// errlog — first-party client error reporting (Phase 0 audit fix).
//
// logAppError() fire-and-forgets the error to /api/log-error, which writes it
// to the app_errors table (service-role). Never throws; never blocks the UI.
// Used by: the error boundaries (app/error.tsx, app/global-error.tsx), the
// global window listeners (components/ErrorReporter.tsx), and dbResult() in
// lib/db.ts for failed database writes.
// ─────────────────────────────────────────────────────────────────────────────

const seen = new Set<string>()

export function logAppError(err: unknown, meta: Record<string, unknown> = {}): void {
  try {
    const e = err instanceof Error ? err : new Error(String(err))
    // De-dupe identical messages within a session (loops can fire thousands).
    const key = `${e.message}|${meta.source ?? ''}`
    if (seen.has(key)) return
    if (seen.size > 200) seen.clear()
    seen.add(key)

    const payload = {
      message: String(e.message ?? 'unknown').slice(0, 1000),
      stack: String(e.stack ?? '').slice(0, 4000),
      url: typeof window !== 'undefined' ? window.location.pathname : '',
      meta,
    }
    // sendBeacon survives page unloads; fetch keepalive as fallback.
    const body = JSON.stringify(payload)
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/log-error', new Blob([body], { type: 'application/json' }))
    } else if (typeof fetch !== 'undefined') {
      fetch('/api/log-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
  } catch {
    // Never let the error reporter itself throw.
  }
}
