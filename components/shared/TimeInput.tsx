'use client'
import { useState, useEffect, useRef } from 'react'

interface TimeInputProps {
  value: string
  onChange: (val: string) => void
  onBlur?: () => void
  placeholder?: string
  style?: React.CSSProperties
  /** Lets callers hand it a system recipe (`c-input c-inset2`) instead of a
      hand-written well in inline styles. */
  className?: string
  disabled?: boolean
}

function parseTime(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null

  // Already fully formatted: "10:00am", "2:30pm"
  const fmtMatch = s.match(/^(\d{1,2}):(\d{2})(am|pm)$/)
  if (fmtMatch) {
    const h = parseInt(fmtMatch[1], 10)
    const m = parseInt(fmtMatch[2], 10)
    const period = fmtMatch[3].toUpperCase()
    if (h >= 1 && h <= 12 && m >= 0 && m <= 59)
      return `${h}:${m.toString().padStart(2, '0')} ${period}`
    return null
  }

  // With AM/PM suffix: "10a", "8p", "930a", "1030p", "9:30a"
  const apMatch = s.match(/^(\d{1,4})(?::(\d{2}))?([ap])m?$/)
  if (apMatch) {
    const raw = apMatch[1]
    const minPart = apMatch[2]
    const ap = apMatch[3]
    let h: number, m: number
    if (minPart !== undefined) {
      h = parseInt(raw, 10)
      m = parseInt(minPart, 10)
    } else if (raw.length <= 2) {
      h = parseInt(raw, 10)
      m = 0
    } else if (raw.length === 3) {
      h = parseInt(raw[0], 10)
      m = parseInt(raw.slice(1), 10)
    } else {
      h = parseInt(raw.slice(0, 2), 10)
      m = parseInt(raw.slice(2), 10)
    }
    if (h < 1 || h > 12 || m < 0 || m > 59) return null
    const period = ap === 'a' ? 'AM' : 'PM'
    return `${h}:${m.toString().padStart(2, '0')} ${period}`
  }

  // Pure numeric 3-4 digits: 800, 930, 1000, 1200, 1430 (24h)
  const numMatch = s.match(/^(\d{3,4})$/)
  if (numMatch) {
    let h: number, m: number
    if (s.length === 3) {
      h = parseInt(s[0], 10)
      m = parseInt(s.slice(1), 10)
    } else {
      h = parseInt(s.slice(0, 2), 10)
      m = parseInt(s.slice(2), 10)
    }
    if (m < 0 || m > 59 || h < 0 || h > 23) return null
    const period = h < 12 ? 'AM' : 'PM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`
  }

  // HH:MM colon format without AM/PM (24h)
  const colonMatch = s.match(/^(\d{1,2}):(\d{2})$/)
  if (colonMatch) {
    const h = parseInt(colonMatch[1], 10)
    const m = parseInt(colonMatch[2], 10)
    if (m < 0 || m > 59 || h < 0 || h > 23) return null
    const period = h < 12 ? 'AM' : 'PM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`
  }

  return null
}

export default function TimeInput({ value, onChange, onBlur, placeholder = '—', style, className, disabled }: TimeInputProps) {
  const [raw, setRaw] = useState(value || '')
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setRaw(value || '')
  }, [value])

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    focused.current = true
    e.target.select()
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRaw(e.target.value)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }

  function handleBlur() {
    focused.current = false
    const parsed = parseTime(raw)
    const next = parsed ?? ''
    setRaw(next)
    onChange(next)
    onBlur?.()
  }

  return (
    <input
      type="text"
      value={raw}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      // When a caller supplies a recipe class, this contributes NO visual style
      // of its own — inline styles outrank classes, so a base background here
      // would silently defeat `c-input c-inset2`. It only styles itself when
      // left bare (the studio-time table cells, which want a naked input).
      style={className ? style : {
        background: 'transparent',
        color: raw ? 'var(--c-fg)' : 'var(--c-fg-3)',
        border: 'none',
        fontSize: 11,
        fontFamily: 'Inter',
        padding: '2px 0',
        width: '100%',
        outline: 'none',
        ...style,
      }}
    />
  )
}
