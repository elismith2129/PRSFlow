'use client'
// Global window error listeners (Phase 0 audit fix). Mounted once in the root
// layout. Catches errors that escape React (event handlers, async code,
// unhandled promise rejections) and reports them to the app_errors sink.
// Renders nothing.
import { useEffect } from 'react'
import { logAppError } from '@/lib/errlog'

export default function ErrorReporter(): null {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      logAppError(e.error ?? e.message, { source: 'window.onerror' })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      logAppError(e.reason ?? 'unhandled rejection', { source: 'unhandledrejection' })
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
