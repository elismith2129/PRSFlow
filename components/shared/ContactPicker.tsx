'use client'
import React, { useEffect, useState } from 'react'
import { supabase, ClientContact } from '@/lib/supabase'

interface Props {
  clientId: string
  value: string
  onChange: (value: string) => void
  onContactAdded?: (contact: ClientContact) => void
  placeholder?: string
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--c-wash)', color: 'var(--c-fg)', padding: '7px 10px', borderRadius: 6,
  fontFamily: 'Inter', fontSize: 12, outline: 'none',
}
const ddWrap: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
  background: 'var(--c-bg)', borderRadius: 6, marginTop: 2, overflow: 'hidden',
  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
}
const ddRow: React.CSSProperties = {
  padding: '8px 10px', cursor: 'pointer',
  fontSize: 12, fontFamily: 'Inter',
}

export function ContactPicker({ clientId, value, onChange, onContactAdded, placeholder = 'Type a name…' }: Props) {
  const [contacts, setContacts] = useState<ClientContact[]>([])
  const [showDD, setShowDD] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!clientId) return
    supabase.from('client_contacts').select('*').eq('client_id', clientId)
      .then(({ data }) => setContacts((data as ClientContact[]) || []))
  }, [clientId])

  const query = value.toLowerCase().trim()
  const filtered = contacts.filter(c =>
    `${c.fname ?? ''} ${c.lname ?? ''}`.toLowerCase().includes(query)
  )
  const exactMatch = filtered.some(
    c => `${c.fname ?? ''} ${c.lname ?? ''}`.trim().toLowerCase() === query
  )
  const showAddNew = query.length >= 2 && !exactMatch
  const open = showDD && (filtered.length > 0 || showAddNew)

  async function addContact() {
    const parts = value.trim().split(/\s+/)
    const fname = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]
    const lname = parts.length > 1 ? parts[parts.length - 1] : ''
    setAdding(true)
    const { data } = await supabase
      .from('client_contacts')
      .insert({ client_id: clientId, fname, lname })
      .select()
      .single()
    if (data) {
      const contact = data as ClientContact
      setContacts(prev => [...prev, contact])
      onChange(`${fname}${lname ? ' ' + lname : ''}`)
      onContactAdded?.(contact)
    }
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
          {filtered.map(c => (
            <div
              key={c.id}
              onMouseDown={() => { onChange(`${c.fname ?? ''} ${c.lname ?? ''}`.trim()); setShowDD(false) }}
              style={ddRow}
            >
              <span>{c.fname} {c.lname}</span>
              {c.role && (
                <span style={{ fontSize: 10, color: 'var(--c-fg-3)', marginLeft: 8 }}>{c.role}</span>
              )}
            </div>
          ))}
          {showAddNew && (
            <div
              onMouseDown={addContact}
              style={{ ...ddRow, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, color: 'var(--c-fg)', letterSpacing: '0.04em' }}
            >
              {adding ? 'Adding…' : `+ Add "${value}" as new contact`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
