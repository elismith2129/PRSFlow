'use client'

// Shared pieces of the public registration page — used by both the individual
// form (page.tsx) and the business form (BusinessForm.tsx). Pulled out of
// page.tsx on 2026-11-16 when the business form arrived; nothing here changed
// in the move. This page keeps its own skin (Syne / Inter / DM Serif, --bg
// --accent tokens from register/layout.tsx), separate from the app's.

import { TERMS_SECTIONS } from '@/lib/terms'

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function validatePhone(phone: string): boolean {
  if (phone.startsWith('+')) return phone.length >= 8
  return /^\d{10}$/.test(phone)
}

export function Header({ kind = 'Client' }: { kind?: 'Client' | 'Business' }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <p style={{
        fontFamily: 'Syne',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--accent)',
        marginBottom: 8,
      }}>
        Paramount Recording Studios
      </p>
      <h1 style={{
        fontFamily: 'DM Serif Display',
        fontSize: 28,
        fontWeight: 400,
        color: 'var(--text)',
        lineHeight: 1.2,
      }}>
        {kind} <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Registration</em>
      </h1>
    </div>
  )
}

export function SectionLabel({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <p style={{
        fontFamily: 'Syne',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--text3)',
        margin: 0,
      }}>
        {children}
      </p>
      {sub && (
        <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text2)', margin: '3px 0 0', lineHeight: 1.5 }}>
          {sub}
        </p>
      )}
    </div>
  )
}

export function OptionalTag() {
  return (
    <span style={{
      fontFamily: 'Inter',
      fontSize: 10,
      fontWeight: 400,
      letterSpacing: '0.04em',
      textTransform: 'none',
      color: 'var(--text3)',
      marginLeft: 6,
    }}>
      optional
    </span>
  )
}

export function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: 'Inter',
      fontSize: 11,
      color: 'var(--hot)',
      marginTop: 4,
    }}>
      {children}
    </p>
  )
}

export function Spacer() {
  return <div style={{ height: 24 }} />
}

export interface InputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  error?: boolean
  type?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  style?: React.CSSProperties
}

export function Input({ value, onChange, placeholder, disabled, error, type = 'text', inputMode, style }: InputProps) {
  return (
    <input
      type={type}
      inputMode={inputMode}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '10px 12px',
        background: 'var(--surface)',
        border: `1px solid ${error ? 'var(--hot)' : 'var(--border)'}`,
        borderRadius: 6,
        fontFamily: 'Inter',
        fontSize: 13,
        color: 'var(--text)',
        outline: 'none',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'text',
        ...style,
      }}
    />
  )
}

// A row of pick-one chips (PO required? how to send invoices?). Keyboard
// reachable: each chip is a real button.
export function Segmented<T extends string>({ value, options, onChange, disabled }: {
  value: T | ''
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(o => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.value)}
            style={{
              fontFamily: 'Inter',
              fontSize: 12,
              fontWeight: 600,
              padding: '7px 12px',
              borderRadius: 6,
              border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
              background: on ? 'rgba(var(--accent-rgb), 0.08)' : 'var(--surface)',
              color: on ? 'var(--accent)' : 'var(--text2)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function CheckRow({ checked, onChange, disabled, error, children }: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  error?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--surface2)',
      border: `1px solid ${error ? 'var(--hot)' : 'var(--border)'}`,
      borderRadius: 6,
      marginTop: 8,
    }}>
      <label style={{ display: 'flex', gap: 12, cursor: 'pointer', alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          disabled={disabled}
          style={{ marginTop: 2, accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0 }}
        />
        <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          {children}
        </span>
      </label>
    </div>
  )
}

export function TermsScroller() {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 6,
      background: 'var(--surface)',
      position: 'relative',
      display: 'block',
    }}>
      <div style={{
        height: 280,
        maxHeight: 280,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '14px 16px',
      }}>
        {TERMS_SECTIONS.map((section, i) => (
          <div key={section.heading} style={{ marginTop: i === 0 ? 0 : 12 }}>
            <p style={{
              fontFamily: 'Inter',
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text2)',
              margin: '0 0 4px',
            }}>
              {section.heading}
            </p>
            <p style={{
              fontFamily: 'Inter',
              fontSize: 13,
              color: 'var(--text3)',
              lineHeight: 1.65,
              margin: 0,
              whiteSpace: 'pre-wrap',
            }}>
              {section.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
