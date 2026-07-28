'use client'
// Global toast system (Phase 0 audit fix). Mounted once in the root layout.
// Call toast('message', 'error' | 'success' | 'info') from anywhere — it fires
// a CustomEvent the mounted <Toaster/> renders. Errors stay 8s, others 4s.
import { useEffect, useState } from 'react'

type ToastKind = 'error' | 'success' | 'info'
type ToastItem = { id: number; message: string; kind: ToastKind }

export function toast(message: string, kind: ToastKind = 'info') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('prsflo-toast', { detail: { message, kind } }))
}

let nextId = 1

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const onToast = (e: Event) => {
      const { message, kind } = (e as CustomEvent).detail as { message: string; kind: ToastKind }
      const id = nextId++
      setItems(prev => [...prev.slice(-4), { id, message, kind }])
      setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), kind === 'error' ? 8000 : 4000)
    }
    window.addEventListener('prsflo-toast', onToast)
    return () => window.removeEventListener('prsflo-toast', onToast)
  }, [])

  if (items.length === 0) return null

  const colors: Record<ToastKind, { border: string; text: string }> = {
    error: { border: 'rgba(240,78,122,0.5)', text: '#f87171' },
    success: { border: 'rgba(20,184,166,0.5)', text: '#14B8A6' },
    info: { border: 'rgba(255,255,255,0.18)', text: 'var(--text)' },
  }

  return (
    <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 100002, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 'min(480px, calc(100vw - 32px))' }}>
      {items.map(t => (
        <div
          key={t.id}
          onClick={() => setItems(prev => prev.filter(x => x.id !== t.id))}
          style={{
            background: 'var(--surface2, #161920)', border: `1px solid ${colors[t.kind].border}`,
            color: colors[t.kind].text, borderRadius: 8, padding: '10px 14px',
            fontFamily: 'Inter, sans-serif', fontSize: 12, lineHeight: 1.5,
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)', cursor: 'pointer',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
