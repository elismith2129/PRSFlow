'use client'

import { useRef, useState, useEffect } from 'react'

interface TimeInputProps {
  value: string
  onChange: (val: string) => void
  onBlur?: () => void
  placeholder?: string
  style?: React.CSSProperties
}

function parse12h(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const sl = s.toLowerCase()

  // Already normalized: "H:MM AM/PM" — force suffix to uppercase
  if (/^\d{1,2}:\d{2} (am|pm)$/i.test(s)) return s.slice(0, -2) + s.slice(-2).toUpperCase()

  // Legacy 24-hour "HH:MM" colon format, no suffix
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [hStr, mStr] = s.split(':')
    const h24 = parseInt(hStr, 10)
    const m = Math.min(parseInt(mStr, 10), 59)
    if (isNaN(h24) || isNaN(m)) return ''
    const isPm = h24 >= 12
    const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24
    return `${h12}:${m.toString().padStart(2, '0')} ${isPm ? 'PM' : 'AM'}`
  }

  const hasPm = /p(m)?$/.test(sl)
  const hasAm = /a(m)?$/.test(sl)
  const hasSuffix = hasPm || hasAm

  const digits = sl.replace(/\D/g, '')
  if (!digits) return ''

  let h: number
  let m: number

  if (digits.length === 1) {
    h = parseInt(digits, 10); m = 0
  } else if (digits.length === 2) {
    const n = parseInt(digits, 10)
    if (n >= 13) return `${n - 12}:00 PM`
    h = n; m = 0
  } else if (digits.length === 3) {
    h = parseInt(digits.slice(0, 1), 10)
    m = Math.min(parseInt(digits.slice(1, 3), 10), 59)
  } else {
    h = parseInt(digits.slice(0, 2), 10)
    m = Math.min(parseInt(digits.slice(2, 4), 10), 59)
    if (h >= 13) return `${h - 12}:${m.toString().padStart(2, '0')} PM`
  }

  if (isNaN(h) || isNaN(m)) return ''

  if (h === 0) return `12:${m.toString().padStart(2, '0')} AM`

  let isPm: boolean
  if (hasSuffix) {
    isPm = hasPm
  } else {
    // No suffix: 12 → noon (PM), everything else → AM
    isPm = h === 12
  }

  return `${h}:${m.toString().padStart(2, '0')} ${isPm ? 'PM' : 'AM'}`
}

export default function TimeInput({
  value,
  onChange,
  onBlur,
  placeholder = '--:--',
  style,
}: TimeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [display, setDisplay] = useState(value || '')

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDisplay(value || '')
    }
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDisplay(e.target.value)
  }

  function handleBlur() {
    const parsed = parse12h(display)
    setDisplay(parsed)
    onChange(parsed)
    onBlur?.()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') (e.target as HTMLElement).blur()
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      style={style}
    />
  )
}
