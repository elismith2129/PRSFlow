'use client'

// Site-wide toast host for new Web Inquiry alerts. Rendered once in the (main)
// layout (outside page content), so a toast appears no matter which internal page
// the user is on. Each toast slides in from the right, auto-dismisses after 12s or
// on click, and multiple toasts stack vertically. Toasts are transient only — the
// persistent indicators are the dashboard pulse + the tab badge (see the provider).
import React, { useEffect, useState } from 'react'
import { useWebInquiries, type WebInquiryToast } from './WebInquiryProvider'

const AUTO_DISMISS_MS = 12000
const EXIT_MS = 300
const STACK_OFFSET = 72

export function WebInquiryToaster() {
  const { toasts, dismissToast } = useWebInquiries()
  return (
    <>
      {toasts.map((t, i) => (
        <ToastItem key={t.key} toast={t} index={i} onDismiss={() => dismissToast(t.key)} />
      ))}
    </>
  )
}

function ToastItem({
  toast,
  index,
  onDismiss,
}: {
  toast: WebInquiryToast
  index: number
  onDismiss: () => void
}) {
  const [shown, setShown] = useState(false)
  const [leaving, setLeaving] = useState(false)

  // Enter on the next frame so the transform transition actually animates.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Auto-dismiss after 12s.
  useEffect(() => {
    const id = setTimeout(() => setLeaving(true), AUTO_DISMISS_MS)
    return () => clearTimeout(id)
  }, [])

  // Remove from the list once the exit transition has finished.
  useEffect(() => {
    if (!leaving) return
    const id = setTimeout(onDismiss, EXIT_MS)
    return () => clearTimeout(id)
  }, [leaving, onDismiss])

  const name = `${toast.fname} ${toast.lname}`.trim()
  const offscreen = !shown || leaving

  return (
    <div
      onClick={() => setLeaving(true)}
      style={{
        position: 'fixed',
        top: 20 + index * STACK_OFFSET,
        right: 20,
        // Above the Nav (zIndex 99999) so toasts are never hidden behind it.
        zIndex: 100000,
        width: 260,
        boxSizing: 'border-box',
        cursor: 'pointer',
        background: 'var(--surface)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 8,
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: 'var(--text)',
        transform: offscreen ? 'translateX(120%)' : 'translateX(0)',
        opacity: offscreen ? 0 : 1,
        transition: `transform ${EXIT_MS}ms ease, opacity ${EXIT_MS}ms ease, top 0.2s ease`,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--accent)',
          flexShrink: 0,
          boxShadow: '0 0 6px rgba(200,240,78,0.8)',
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 9,
            fontFamily: 'DM Mono, monospace',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            marginBottom: 3,
          }}
        >
          New Inquiry
        </div>
        <div
          style={{
            fontSize: 12,
            fontFamily: 'Syne, sans-serif',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {name ? `New inquiry from ${name}` : 'New inquiry received'}
        </div>
      </div>
    </div>
  )
}
