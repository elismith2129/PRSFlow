'use client'

import { useState, useRef, useCallback } from 'react'

interface PhoneInputProps {
  value: string
  onChange: (normalized: string) => void
  variant?: 'inline' | 'bordered'
  placeholder?: string
  onBlur?: () => void
  style?: React.CSSProperties
}

function normalizeUS(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 10)
}

function formatUS(digits: string): string {
  const d = digits.slice(0, 10)
  if (d.length <= 3) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

function normalizeIntl(raw: string): string {
  const stripped = raw.replace(/[^\d+]/g, '')
  if (!stripped) return ''
  if (stripped.startsWith('+')) return stripped
  return `+${stripped}`
}

export default function PhoneInput({
  value,
  onChange,
  variant = 'inline',
  placeholder = 'Phone',
  onBlur,
  style,
}: PhoneInputProps) {
  const [intl, setIntl] = useState(() => value.startsWith('+'))
  const inputRef = useRef<HTMLInputElement>(null)

  const displayValue = intl
    ? value
    : formatUS(value.replace(/\D/g, ''))

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      if (intl) {
        onChange(normalizeIntl(raw))
      } else {
        onChange(normalizeUS(raw))
      }
    },
    [intl, onChange]
  )

  function toggleIntl() {
    const next = !intl
    if (next && value && !value.startsWith('+')) {
      onChange(`+1${value}`)
    } else if (!next && value.startsWith('+1') && value.length === 12) {
      onChange(value.slice(2))
    } else if (!next) {
      onChange('')
    }
    setIntl(next)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const baseStyle: React.CSSProperties =
    variant === 'inline'
      ? {
          background: 'transparent',
          outline: 'none',
          color: 'var(--c-fg)',
          fontFamily: 'Inter',
          fontSize: 13,
          padding: '2px 4px',
          width: '100%',
        }
      : {
          background: 'var(--c-wash)',
          borderRadius: 6,
          outline: 'none',
          color: 'var(--c-fg)',
          fontFamily: 'Inter',
          fontSize: 13,
          padding: '8px 10px',
          width: '100%',
        }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        ref={inputRef}
        type="tel"
        inputMode={intl ? 'tel' : 'numeric'}
        value={displayValue}
        onChange={handleChange}
        onBlur={onBlur}
        placeholder={intl ? '+1 (country code) number' : placeholder}
        style={{ ...baseStyle, ...style, flex: 1 }}
      />
      <button
        type="button"
        onClick={toggleIntl}
        title={intl ? 'Switch to US format' : 'Switch to international format'}
        style={{
          background: 'none',
          cursor: 'pointer',
          color: intl ? 'var(--c-fg)' : 'var(--c-fg-3)',
          fontFamily: 'Inter',
          fontSize: 10,
          padding: '2px 4px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {intl ? '🌐 Intl' : '+ Intl'}
      </button>
    </div>
  )
}
