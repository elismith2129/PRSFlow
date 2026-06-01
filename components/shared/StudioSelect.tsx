'use client'
import React from 'react'
import { STUDIO_LOCATIONS } from '@/lib/studios'

interface StudioSelectProps {
  location: string
  studio: string
  onChange: (location: string, studio: string) => void
  selectStyle?: React.CSSProperties
}

export default function StudioSelect({ location, studio, onChange, selectStyle }: StudioSelectProps) {
  const base: React.CSSProperties = {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    padding: '4px 6px',
    fontFamily: 'DM Mono',
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
            {l.name} — {r}
          </option>
        ))
      )}
    </select>
  )
}
