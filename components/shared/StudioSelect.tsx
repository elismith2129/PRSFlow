'use client'
import React from 'react'
import { STUDIO_LOCATIONS, STUDIO_SHORT } from '@/lib/studios'

interface StudioSelectProps {
  location: string
  studio: string
  onChange: (location: string, studio: string) => void
  selectStyle?: React.CSSProperties
  shortCodes?: boolean
}

// Display-only short codes for the venue name. The stored value ("Venue|Room")
// is unchanged — only the rendered option label is abbreviated when shortCodes is set.
// The map itself is lib/studios.STUDIO_SHORT (2026-08-13) — this was a private
// copy, and it still said TRK after Track was renamed TRS.
const STUDIO_CODES = STUDIO_SHORT

export default function StudioSelect({ location, studio, onChange, selectStyle, shortCodes }: StudioSelectProps) {
  const base: React.CSSProperties = {
    background: 'var(--c-wash)',
    color: 'var(--c-fg)',
    padding: '4px 6px',
    fontFamily: 'Inter',
    fontSize: 12,
    outline: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    width: '100%',
    ...selectStyle,
  }

  // Value is "Venue|Room"; empty string = Undetermined
  const value = location && studio ? `${location}|${studio}` : ''

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    if (!val) { onChange('', ''); return }
    const sep = val.indexOf('|')
    onChange(val.slice(0, sep), val.slice(sep + 1))
  }

  return (
    <select value={value} onChange={handleChange} style={base}>
      <option value="">Undetermined</option>
      {STUDIO_LOCATIONS.flatMap(l =>
        l.rooms.map(r => (
          <option key={`${l.name}|${r}`} value={`${l.name}|${r}`}>
            {shortCodes ? `${STUDIO_CODES[l.name] || l.name} · ${r}` : `${l.name} — ${r}`}
          </option>
        ))
      )}
    </select>
  )
}
