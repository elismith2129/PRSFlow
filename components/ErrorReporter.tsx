'use client'
// Global window error listeners (Phase 0 audit fix). Mounted once in the root
// layout. Catches errors that escape React (event handlers, async code,
// unhandled promise rejections) and reports them to the app_errors sink.
// Renders nothing.
import { useEffect } from 'react'
import { logAppError } from '@/lib/errlog'

// Noise from outside our code. `window.onerror` catches everything on the page,
// including browser extensions and iOS in-app webviews probing for native bridges
// that don't exist. These are not our bugs and can't be acted on — and an error
// log nobody trusts is an error log nobody reads, which defeats the point of
// having one. Add to this list only for errors provably not ours.
const IGNORED_ERROR_PATTERNS: RegExp[] = [
  // iOS/WKWebView + some extensions: probing for a native message bridge.
  /window\.webkit\.messageHandlers/i,
  // Safari extensions and cross-origin scripts report opaque messages.
  /^Script error\.?$/i,
  // ResizeObserver's benign loop warning; browsers report it as an error.
  /ResizeObserver loop/i,
]

function isIgnorable(value: unknown): boolean {
  const msg = value instanceof Error ? value.message : String(value ?? '')
  return IGNORED_ERROR_PATTERNS.some(re => re.test(msg))
}

export default function ErrorReporter(): null {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const value = e.error ?? e.message
      if (isIgnorable(value)) return
      logAppError(value, { source: 'window.onerror' })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const value = e.reason ?? 'unhandled rejection'
      if (isIgnorable(value)) return
      logAppError(value, { source: 'unhandledrejection' })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
