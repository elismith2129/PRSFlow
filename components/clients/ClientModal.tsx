'use client'
import { useState, useEffect } from 'react'
import { Client } from '@/lib/supabase'

interface Props {
  initial?: Partial<Client>
  isEdit?: boolean
  onSave: (data: Partial<Client>) => void
  onClose: () => void
}

export function ClientModal({ initial, isEdit, onSave, onClose }: Props) {
  const [type, setType] = useState<'individual' | 'label' | 'company'>(initial?.type || 'individual')
  const [billing, setBilling] = useState<'COD' | 'Billing'>(initial?.billing || 'COD')
  const [fname, setFname] = useState(initial?.fname || '')
  const [lname, setLname] = useState(initial?.lname || '')
  const [company, setCompany] = useState(initial?.company || '')
  const [label, setLabel] = useState(initial?.label || '')
  const [email, setEmail] = useState(initial?.email || '')
  const [phone, setPhone] = useState(initial?.phone || '')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [source, setSource] = useState(initial?.source || '')
  const [artists, setArtists] = useState<string[]>(initial?.artists || [])
  const [newArtist, setNewArtist] = useState('')
  const [saving, setSaving] = useState(false)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleSave() {
    if (!fname && !company) return
    setSaving(true)
    await onSave({
      type, billing, fname, lname, company, label,
      email, phone, notes, source, artists,
      lead_id: initial?.lead_id || null,
    })
    setSaving(false)
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, backdropFilter: 'blur(6px)',
      }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 14, width: 580, maxWidth: '95vw', maxHeight: '90vh',
        overflowY: 'auto', padding: 24,
      }}>
        {/* Title */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 16 }}>
            {isEdit ? 'Edit Client' : initial?.lead_id ? 'Create Client from Lead' : 'New Client Profile'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* Type toggle */}
        <Label>Client Type</Label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {(['individual', 'label', 'company'] as const).map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'DM Mono', fontSize: 11, border: 'none',
              background: type === t ? 'var(--accent2)' : 'var(--surface2)',
              color: type === t ? '#fff' : 'var(--text2)',
              transition: 'all 0.15s',
            }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>

        {/* Form grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <Field label="First Name *"><Input value={fname} onChange={setFname} placeholder="Jane" /></Field>
          <Field label="Last Name"><Input value={lname} onChange={setLname} placeholder="Smith" /></Field>
          <Field label="Company / Artist"><Input value={company} onChange={setCompany} placeholder="One Stone Records" /></Field>
          <Field label="Label"><Input value={label} onChange={setLabel} placeholder="Sony, Independent…" /></Field>
          <Field label="Email"><Input value={email} onChange={setEmail} placeholder="jane@label.com" type="email" /></Field>
          <Field label="Phone"><Input value={phone} onChange={setPhone} placeholder="+1 323-000-0000" /></Field>
          <Field label="Source">
            <select value={source} onChange={e => setSource(e.target.value)} style={selectStyle}>
              <option value="">— Source —</option>
              {['SRS', 'Call', 'Email', 'Squarespace', 'Referral'].map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        {/* Billing */}
        <Label>Billing</Label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {(['COD', 'Billing'] as const).map(b => (
            <button key={b} onClick={() => setBilling(b)} style={{
              padding: '7px 20px', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'DM Mono', fontSize: 11, border: 'none',
              background: billing === b ? (b === 'COD' ? 'var(--accent)' : 'var(--accent2)') : 'var(--surface2)',
              color: billing === b ? '#0d0f14' : 'var(--text2)',
              transition: 'all 0.15s',
            }}>{b}</button>
          ))}
        </div>

        {/* Notes */}
        <Label>Notes</Label>
        <textarea
          value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Notes about this client…"
          style={{ ...selectStyle, width: '100%', minHeight: 70, resize: 'vertical', marginBottom: 16 }}
        />

        {/* Artists (label only) */}
        {type === 'label' && (
          <>
            <Label>Artists on Roster</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {artists.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', padding: '6px 10px', borderRadius: 5 }}>
                  <span style={{ flex: 1, fontSize: 11 }}>{a}</span>
                  <button onClick={() => setArtists(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <Input value={newArtist} onChange={setNewArtist} placeholder="Artist name" />
              <button onClick={() => { if (newArtist.trim()) { setArtists(p => [...p, newArtist.trim()]); setNewArtist('') } }} style={{
                padding: '8px 14px', background: 'transparent',
                border: '1px solid var(--accent)', color: 'var(--accent)',
                borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11, cursor: 'pointer'
              }}>Add</button>
            </div>
          </>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{
            padding: '8px 20px', background: 'transparent',
            border: '1px solid var(--border)', color: 'var(--text2)',
            borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11, cursor: 'pointer'
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || (!fname && !company)} style={{
            padding: '8px 24px', background: 'var(--accent)', color: '#0d0f14',
            border: 'none', borderRadius: 6, fontFamily: 'Syne',
            fontWeight: 700, fontSize: 11, cursor: 'pointer', opacity: saving ? 0.6 : 1
          }}>{saving ? 'Saving…' : isEdit ? 'Update Client' : 'Save Client'}</button>
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>{children}</div>
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return <div><Label>{label}</Label>{children}</div>
}

function Input({ value, onChange, placeholder, type }: { value: string, onChange: (v: string) => void, placeholder?: string, type?: string }) {
  return (
    <input
      type={type || 'text'} value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11, outline: 'none' }}
    />
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '8px 10px', borderRadius: 6,
  fontFamily: 'DM Mono', fontSize: 11, outline: 'none',
}
