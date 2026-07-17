'use client'
import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  clientId: string
  value: string
  onChange: (value: string) => void
  onArtistAdded?: (newArtists: string[]) => void
  placeholder?: string
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '7px 10px', borderRadius: 6,
  fontFamily: 'Inter', fontSize: 12, outline: 'none',
}
const ddWrap: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 6, marginTop: 2, overflow: 'hidden',
  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
}
const ddRow: React.CSSProperties = {
  padding: '8px 10px', cursor: 'pointer',
  borderBottom: '1px solid var(--border)',
  fontSize: 12, fontFamily: 'Inter',
}

export function ArtistPicker({ clientId, value, onChange, onArtistAdded, placeholder = 'Type an artist name…' }: Props) {
  const [artists, setArtists] = useState<string[]>([])
  const [showDD, setShowDD] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!clientId) return
    supabase.from('clients').select('artists').eq('id', clientId).single()
      .then(({ data }) => setArtists((data?.artists as string[]) || []))
  }, [clientId])

  const query = value.toLowerCase().trim()
  const filtered = artists.filter(a => a.toLowerCase().includes(query))
  const exactMatch = artists.some(a => a.toLowerCase() === query)
  const showAddNew = query.length >= 2 && !exactMatch
  const open = showDD && (filtered.length > 0 || showAddNew)

  async function addArtist() {
    const name = value.trim()
    setAdding(true)
    const newArtists = [...artists, name]
    await supabase.from('clients').update({ artists: newArtists }).eq('id', clientId)
    setArtists(newArtists)
    onChange(name)
    onArtistAdded?.(newArtists)
    setAdding(false)
    setShowDD(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setShowDD(true) }}
        onFocus={() => setShowDD(true)}
        onBlur={() => setTimeout(() => setShowDD(false), 150)}
        placeholder={placeholder}
        style={inputStyle}
      />
      {open && (
        <div style={ddWrap}>
          {filtered.map(a => (
            <div
              key={a}
              onMouseDown={() => { onChange(a); setShowDD(false) }}
              style={ddRow}
            >
              {a}
            </div>
          ))}
          {showAddNew && (
            <div
              onMouseDown={addArtist}
              style={{ ...ddRow, fontFamily: 'Syne', fontWeight: 700, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.04em', borderBottom: 'none' }}
            >
              {adding ? 'Adding…' : `+ Add "${value}" as new artist`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
