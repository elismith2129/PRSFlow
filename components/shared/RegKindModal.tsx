'use client'
import React, { useState } from 'react'

// "Which registration?" — the small modal behind every "Send registration
// link" button (lead panel, client profile). v1.56.0, Eli 2026-11-16: "i'd
// like for the 'send registration' button to launch small modal that gives
// option for send/copy individual or business." The link it creates decides
// which form opens; the copy / email / text panel after it is unchanged.
export type RegKind = 'individual' | 'business'

export function RegKindModal({ defaultKind, busy, onPick, onClose }: {
  defaultKind: RegKind
  busy?: boolean
  onPick: (kind: RegKind) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<RegKind>(defaultKind)

  const opt = (k: RegKind, icon: string, title: string, body: string) => {
    const on = kind === k
    return (
      <button
        type="button"
        onClick={() => setKind(k)}
        style={{
          display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', width: '100%',
          background: 'var(--c-wash)', borderRadius: 12, padding: '12px 14px', cursor: 'pointer',
          boxShadow: on ? 'inset 0 0 0 1.5px var(--c-fg)' : 'none', color: 'var(--c-fg)',
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
        <span>
          <b style={{ display: 'block', fontSize: 13, fontFamily: 'Inter' }}>{title}</b>
          <span style={{ display: 'block', fontSize: 11, opacity: 0.6, marginTop: 2, fontFamily: 'Inter', lineHeight: 1.45 }}>{body}</span>
        </span>
      </button>
    )
  }

  return (
    <div className="c-modal-backdrop" style={{ zIndex: 10004 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div data-modal-gradient style={{ background: 'var(--c-bg)', borderRadius: 16, width: '100%', maxWidth: 380, padding: 16, boxShadow: '0 8px 48px rgba(0,0,0,.5)' }}>
        <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 14, color: 'var(--c-fg)', marginBottom: 4 }}>Which registration?</div>
        <div style={{ fontFamily: 'Inter', fontSize: 11.5, opacity: 0.6, color: 'var(--c-fg)', marginBottom: 12 }}>
          The link decides which form opens. Pick the one that fits who&apos;s paying.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {opt('individual', '👤', 'Individual · COD', 'Name, phone, photo ID, T&Cs, SMS opt-in. Pays at the session.')}
          {opt('business', '🏢', 'Business · label, management, brand', 'Company, billing & admin contact, A&R, PO & invoicing preference, T&Cs signed for the company, email + SMS opt-in. Invoiced.')}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className="c-btn" style={{ background: 'var(--c-wash2)' }}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => onPick(kind)} className="c-btn c-raised-primary" style={{ opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Creating…' : 'Create link'}
          </button>
        </div>
      </div>
    </div>
  )
}
