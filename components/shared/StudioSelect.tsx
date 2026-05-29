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
  const rooms = STUDIO_LOCATIONS.find(l => l.name === location)?.rooms ?? []

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
    flex: 1,
    minWidth: 0,
    ...selectStyle,
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select
        value={location}
        onChange={e => onChange(e.target.value, '')}
        style={base}
      >
        <option value="">Undetermined</option>
        {STUDIO_LOCATIONS.map(l => (
          <option key={l.name} value={l.name}>{l.name}</option>
        ))}
      </select>
      <select
        value={studio}
        onChange={e => onChange(location, e.target.value)}
        disabled={!location}
        style={{ ...base, opacity: location ? 1 : 0.4 }}
      >
        <option value="">— Studio</option>
        {rooms.map(r => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    </div>
  )
}
