'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Client, ClientContact, CLIENT_TYPE_LABELS } from '@/lib/supabase'
import PhoneInput from '@/components/shared/PhoneInput'
import { addArtistToLabel } from '@/lib/roster'
import { RegViewModal } from '@/components/shared/RegViewModal'

interface BookingLead {
  id: number
  fname: string
  lname: string
  session_date: string
  booking: string
  created_at: string
}

interface Props {
  client: Client | null
  contacts: ClientContact[]
  bookingCount: number
  loading?: boolean
  isMobile?: boolean
  onRefresh: () => void
  onBack?: () => void
  onDelete?: () => void
}

// ─── Shared button styles ─────────────────────────────────────────────────────

const accentBtn: React.CSSProperties = {
  background: '#e8eaf0', color: '#0d0f14', border: 'none', borderRadius: 4,
  padding: '5px 12px', fontSize: 10, fontFamily: 'Syne', fontWeight: 700,
  letterSpacing: '0.08em', cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)',
  borderRadius: 4, padding: '5px 12px', fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer',
}
const dangerBtn: React.CSSProperties = {
  background: 'rgba(239,68,68,0.15)', color: 'var(--hot)', border: '1px solid rgba(239,68,68,0.3)',
  borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer',
}

const aBtn = (color: string): React.CSSProperties => ({
  padding: '2px 7px', borderRadius: 3, border: '1px solid var(--border)',
  background: 'var(--surface)', color, fontFamily: 'DM Mono', fontSize: 9,
  textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap' as const,
})

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ label, action, mt = 16 }: { label: string; action?: React.ReactNode; mt?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: mt }}>
      <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text3)' }}>
        {label}
      </div>
      {action}
    </div>
  )
}

// ─── Inline field ─────────────────────────────────────────────────────────────

function InlineField({ label, value, onSave, multiline = false, placeholder = '—' }: {
  label: string; value: string | null; onSave: (v: string) => void; multiline?: boolean; placeholder?: string
}) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])

  const sharedStyle: React.CSSProperties = {
    width: '100%', background: 'transparent', border: 'none',
    borderBottom: '1px solid transparent', outline: 'none',
    color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11,
    padding: '2px 0', lineHeight: 1.5, resize: 'none' as const,
    transition: 'border-color 0.15s',
  }
  const onFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderBottomColor = 'var(--border)'
  }
  const onBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderBottomColor = 'transparent'
    if (local !== (value ?? '')) onSave(local)
  }

  return (
    <div>
      {label && (
        <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>
          {label}
        </div>
      )}
      {multiline ? (
        <textarea rows={3} value={local} placeholder={placeholder}
          onChange={e => setLocal(e.target.value)}
          onFocus={onFocus as React.FocusEventHandler<HTMLTextAreaElement>}
          onBlur={onBlur as React.FocusEventHandler<HTMLTextAreaElement>}
          style={{ ...sharedStyle, display: 'block' }} />
      ) : (
        <input type="text" value={local} placeholder={placeholder}
          onChange={e => setLocal(e.target.value)}
          onFocus={onFocus as React.FocusEventHandler<HTMLInputElement>}
          onBlur={onBlur as React.FocusEventHandler<HTMLInputElement>}
          style={sharedStyle} />
      )}
    </div>
  )
}

function PhoneInlineField({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])
  return (
    <div>
      <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>Phone</div>
      <PhoneInput
        value={local}
        onChange={v => setLocal(v)}
        onBlur={() => { if (local !== (value ?? '')) onSave(local) }}
        variant="inline"
        placeholder="—"
      />
    </div>
  )
}

// ─── Contact row ──────────────────────────────────────────────────────────────

function ContactRow({ contact, onSave, onDelete }: {
  contact: ClientContact
  onSave: (id: string, data: Partial<ClientContact>) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState({ ...contact })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [localArtists, setLocalArtists] = useState<string[]>(contact.artists || [])
  const [newArtistInput, setNewArtistInput] = useState('')
  useEffect(() => { setDraft({ ...contact }); setLocalArtists(contact.artists || []) }, [contact])

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 5 }}>
      <div onClick={() => setExpanded(e => !e)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--surface2)', cursor: 'pointer' }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 500 }}>
            {[contact.fname, contact.lname].filter(Boolean).join(' ') || 'Unnamed contact'}
          </span>
          {contact.email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
              <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono' }}>{contact.email}</span>
              <a href={`mailto:${contact.email}`} onClick={e => e.stopPropagation()} style={aBtn('#8b90a8')}>Email</a>
            </div>
          )}
          {contact.phone && (
            <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
              <a href={`tel:${contact.phone.replace(/\D/g, '')}`} onClick={e => e.stopPropagation()} style={aBtn('#8b90a8')}>Call</a>
              <a href={`sms:${contact.phone.replace(/\D/g, '')}`} onClick={e => e.stopPropagation()} style={aBtn('#8b90a8')}>Text</a>
            </div>
          )}
          {localArtists.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
              {localArtists.map((a, i) => (
                <span key={i} style={{ fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: 3, lineHeight: 1.6 }}>
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
        <span style={{ fontSize: 9, color: 'var(--text3)', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '10px 10px 8px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginBottom: 8 }}>
            {(['fname', 'lname'] as const).map(f => (
              <div key={f}>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>
                  {f === 'fname' ? 'First' : 'Last'}
                </div>
                <input type="text" value={draft[f] ?? ''} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
                  style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0' }} />
              </div>
            ))}
            <div>
              <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>Email</div>
              <input type="text" value={draft.email ?? ''} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0' }} />
            </div>
            <div>
              <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>Phone</div>
              <PhoneInput value={draft.phone ?? ''} onChange={v => setDraft(d => ({ ...d, phone: v }))} variant="inline" placeholder="—" />
            </div>
          </div>
          {/* Artists */}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>Artists</div>
            {localArtists.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4, marginBottom: 6 }}>
                {localArtists.map((a, i) => (
                  <ArtistChip key={i} name={a} onRemove={() => setLocalArtists(prev => prev.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text" placeholder="Artist name" value={newArtistInput}
                onChange={e => setNewArtistInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { const n = newArtistInput.trim(); if (n) { setLocalArtists(p => [...p, n]); setNewArtistInput('') } } }}
                style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 10, outline: 'none' }}
              />
              <button onClick={() => { const n = newArtistInput.trim(); if (n) { setLocalArtists(p => [...p, n]); setNewArtistInput('') } }} style={{ ...ghostBtn, fontSize: 9, padding: '3px 8px' }}>+ Add</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            {confirmDelete ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: 'var(--hot)', fontFamily: 'DM Mono' }}>
                Remove?
                <button onClick={() => onDelete(contact.id)} style={dangerBtn}>Yes</button>
                <button onClick={() => setConfirmDelete(false)} style={ghostBtn}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} style={{ ...ghostBtn, color: 'var(--hot)', fontSize: 10 }}>Remove</button>
            )}
            <button onClick={() => { onSave(contact.id, { ...draft, artists: localArtists }); setExpanded(false) }} style={accentBtn}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Add contact form ─────────────────────────────────────────────────────────

function AddContactForm({ onAdd, onCancel }: { onAdd: (data: Partial<ClientContact>) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState({ fname: '', lname: '', email: '', phone: '' })
  const fields: [keyof typeof draft, string][] = [
    ['fname', 'First'], ['lname', 'Last'], ['email', 'Email'],
  ]
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '10px 10px 8px', background: 'var(--surface2)', marginTop: 5 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginBottom: 8 }}>
        {fields.map(([f, lbl]) => (
          <div key={f}>
            <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>{lbl}</div>
            <input type="text" value={draft[f]} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
              style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0' }} />
          </div>
        ))}
        <div>
          <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>Phone</div>
          <PhoneInput value={draft.phone} onChange={v => setDraft(d => ({ ...d, phone: v }))} variant="inline" placeholder="—" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button onClick={() => { if (draft.fname || draft.lname || draft.email) onAdd(draft) }} style={accentBtn}>Add</button>
      </div>
    </div>
  )
}

// ─── Admin row ────────────────────────────────────────────────────────────────

function AdminRow({ contact, onSave, onDelete }: {
  contact: ClientContact
  onSave: (id: string, data: Partial<ClientContact>) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState({ ...contact })
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { setDraft({ ...contact }) }, [contact])

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 5 }}>
      <div onClick={() => setExpanded(e => !e)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--surface2)', cursor: 'pointer' }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 500 }}>
            {[contact.fname, contact.lname].filter(Boolean).join(' ') || 'Unnamed admin'}
          </span>
          {contact.role && (
            <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginLeft: 7 }}>
              {contact.role}
            </span>
          )}
          {contact.email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
              <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono' }}>{contact.email}</span>
              <a href={`mailto:${contact.email}`} onClick={e => e.stopPropagation()} style={aBtn('#8b90a8')}>Email</a>
            </div>
          )}
          {contact.phone && (
            <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
              <a href={`tel:${contact.phone.replace(/\D/g, '')}`} onClick={e => e.stopPropagation()} style={aBtn('#8b90a8')}>Call</a>
              <a href={`sms:${contact.phone.replace(/\D/g, '')}`} onClick={e => e.stopPropagation()} style={aBtn('#8b90a8')}>Text</a>
            </div>
          )}
        </div>
        <span style={{ fontSize: 9, color: 'var(--text3)', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '10px 10px 8px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginBottom: 8 }}>
            {(['fname', 'lname'] as const).map(f => (
              <div key={f}>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>
                  {f === 'fname' ? 'First' : 'Last'}
                </div>
                <input type="text" value={draft[f] ?? ''} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
                  style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0' }} />
              </div>
            ))}
            {(['role', 'email'] as const).map(f => (
              <div key={f}>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>{f}</div>
                <input type="text" value={draft[f] ?? ''} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
                  style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0' }} />
              </div>
            ))}
            <div>
              <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>Phone</div>
              <PhoneInput value={draft.phone ?? ''} onChange={v => setDraft(d => ({ ...d, phone: v }))} variant="inline" placeholder="—" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            {confirmDelete ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: 'var(--hot)', fontFamily: 'DM Mono' }}>
                Remove?
                <button onClick={() => onDelete(contact.id)} style={dangerBtn}>Yes</button>
                <button onClick={() => setConfirmDelete(false)} style={ghostBtn}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} style={{ ...ghostBtn, color: 'var(--hot)', fontSize: 10 }}>Remove</button>
            )}
            <button onClick={() => { onSave(contact.id, draft); setExpanded(false) }} style={accentBtn}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Add admin form ───────────────────────────────────────────────────────────

function AddAdminForm({ onAdd, onCancel }: { onAdd: (data: Partial<ClientContact>) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState({ fname: '', lname: '', role: '', email: '', phone: '' })
  const fields: [keyof typeof draft, string][] = [
    ['fname', 'First'], ['lname', 'Last'], ['role', 'Role'], ['email', 'Email'],
  ]
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '10px 10px 8px', background: 'var(--surface2)', marginTop: 5 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginBottom: 8 }}>
        {fields.map(([f, lbl]) => (
          <div key={f}>
            <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>{lbl}</div>
            <input type="text" value={draft[f]} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
              style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0' }} />
          </div>
        ))}
        <div>
          <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>Phone</div>
          <PhoneInput value={draft.phone} onChange={v => setDraft(d => ({ ...d, phone: v }))} variant="inline" placeholder="—" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button onClick={() => { if (draft.fname || draft.lname || draft.email) onAdd(draft) }} style={accentBtn}>Add</button>
      </div>
    </div>
  )
}

// ─── Artist chip with inline confirm ─────────────────────────────────────────

function ArtistChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false)
  if (confirming) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontFamily: 'DM Mono', color: 'var(--hot)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', padding: '2px 7px', borderRadius: 4 }}>
        Remove {name}?
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--hot)', cursor: 'pointer', padding: 0, fontSize: 11, fontFamily: 'DM Mono', fontWeight: 700 }}>Yes</button>
        <button onClick={() => setConfirming(false)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 0, fontSize: 11, fontFamily: 'DM Mono' }}>Cancel</button>
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)', background: 'var(--surface2)', border: '1px solid var(--border)', padding: '2px 7px', borderRadius: 4 }}>
      {name}
      <button onClick={() => setConfirming(true)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1 }} title="Remove">×</button>
    </span>
  )
}

// ─── Booking history ──────────────────────────────────────────────────────────

function BookingHistory({ leads }: { leads: BookingLead[] }) {
  if (leads.length === 0) {
    return (
      <div style={{ padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>No bookings linked yet.</span>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {leads.map(l => {
        const dateStr = l.session_date || new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        const name = [l.fname, l.lname].filter(Boolean).join(' ') || '—'
        return (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--surface2)', borderRadius: 5, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)', minWidth: 72, flexShrink: 0 }}>{dateStr}</div>
            <div style={{ fontSize: 10, color: 'var(--text)', flex: 1 }}>{name}</div>
            {l.booking && (
              <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '2px 5px', borderRadius: 3, flexShrink: 0 }}>
                {l.booking}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ClientProfile({ client, contacts, bookingCount, loading, isMobile, onRefresh, onBack, onDelete }: Props) {
  const router = useRouter()
  const [bookings, setBookings] = useState<BookingLead[]>([])
  const [showAddContact, setShowAddContact] = useState(false)
  const [showAddAdmin, setShowAddAdmin] = useState(false)
  const [showAddress, setShowAddress] = useState(false)
  const [bookingToast, setBookingToast] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [regLinkUrl, setRegLinkUrl] = useState<string | null>(null)
  const [regLinkCopied, setRegLinkCopied] = useState(false)
  const [regLinkGenerating, setRegLinkGenerating] = useState(false)
  const [regViewOpen, setRegViewOpen] = useState(false)
  const [nameVal, setNameVal] = useState(client?.name || '')
  const [editingName, setEditingName] = useState(false)

  // Load bookings for selected client
  useEffect(() => {
    if (!client) { setBookings([]); return }
    supabase
      .from('leads')
      .select('id, fname, lname, session_date, booking, created_at')
      .eq('client_id', client.id)
      .eq('status', 'booked')
      .order('created_at', { ascending: false })
      .then(({ data }) => setBookings((data || []) as BookingLead[]))
  }, [client?.id])

  // Auto-expand address if data exists
  useEffect(() => {
    if (client?.address_street || client?.address_city || client?.address_zip) setShowAddress(true)
    else setShowAddress(false)
  }, [client?.id])

  // Reset panel state on client change
  useEffect(() => {
    setShowAddContact(false)
    setRegLinkUrl(null)
    setRegLinkCopied(false)
    setRegLinkGenerating(false)
    setNameVal(client?.name || '')
    setEditingName(false)
  }, [client?.id])

  const saveClient = useCallback(async (fields: Partial<Client>) => {
    if (!client) return
    await supabase.from('clients').update(fields).eq('id', client.id)
    onRefresh()
  }, [client, onRefresh])

  const saveContact = useCallback(async (contactId: string, data: Partial<ClientContact>) => {
    try {
      const { id: _id, client_id: _cid, ...updateData } = data
      const { error } = await supabase.from('client_contacts').update(updateData).eq('id', contactId)
      if (error) console.error('[ClientProfile] saveContact failed:', error)
    } catch (e) { console.error('[ClientProfile] saveContact exception:', e) }
    // Sync any new artists to clients.artists[] (the label-level roster)
    if (client && data.artists && data.artists.length > 0) {
      const current = (client.artists as string[]) || []
      const toAdd = data.artists.filter(a => !current.some(x => x.toLowerCase() === a.toLowerCase()))
      for (const name of toAdd) await addArtistToLabel(client.id, name, current)
    }
    onRefresh()
  }, [client, onRefresh])

  const deleteContact = useCallback(async (contactId: string) => {
    await supabase.from('client_contacts').delete().eq('id', contactId)
    onRefresh()
  }, [onRefresh])

  const addContact = useCallback(async (data: Partial<ClientContact>) => {
    if (!client) return
    await supabase.from('client_contacts').insert({ ...data, client_id: client.id })
    setShowAddContact(false)
    onRefresh()
  }, [client, onRefresh])

  const addAdmin = useCallback(async (data: Partial<ClientContact>) => {
    if (!client) return
    await supabase.from('client_contacts').insert({ ...data, contact_type: 'admin', client_id: client.id })
    setShowAddAdmin(false)
    onRefresh()
  }, [client, onRefresh])

  const deleteClient = useCallback(async () => {
    if (!client) return
    setDeleting(true)
    // Fetch contact IDs so we can nullify FK references on leads before deleting contacts
    const { data: contactRows } = await supabase.from('client_contacts').select('id').eq('client_id', client.id)
    const contactIds = (contactRows ?? []).map((c: { id: string }) => c.id)
    if (contactIds.length > 0) {
      await supabase.from('leads').update({ anr_contact_id: null }).in('anr_contact_id', contactIds)
      await supabase.from('leads').update({ anr_admin_contact_id: null }).in('anr_admin_contact_id', contactIds)
    }
    await supabase.from('leads').update({ client_id: null }).eq('client_id', client.id)
    await supabase.from('work_orders').update({ client_id: null }).eq('client_id', client.id)
    await supabase.from('client_contacts').delete().eq('client_id', client.id)
    const { error } = await supabase.from('clients').delete().eq('id', client.id)
    setDeleting(false)
    if (error) { console.error('Delete client failed:', error.message); return }
    setShowDeleteConfirm(false)
    onDelete?.()
  }, [client, onDelete])

  const generateRegLink = useCallback(async () => {
    if (!client) return
    setRegLinkGenerating(true)
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('registration_tokens').insert({
      token,
      client_id: client.id,
      lead_id: null,
      prefill_email: client.email || null,
      prefill_name: client.name || null,
      expires_at: expiresAt,
    })
    setRegLinkUrl(`${window.location.origin}/register/${token}`)
    setRegLinkGenerating(false)
  }, [client])

  const copyRegLink = useCallback(async () => {
    if (!regLinkUrl) return
    try { await navigator.clipboard.writeText(regLinkUrl) } catch (_) {}
    setRegLinkCopied(true)
    setTimeout(() => setRegLinkCopied(false), 2000)
  }, [regLinkUrl])

  const emailRegLink = useCallback(() => {
    if (!regLinkUrl || !client) return
    const subject = encodeURIComponent('Your Paramount Recording Studios registration link')
    const body = encodeURIComponent(
      `Hi ${client.name || 'there'},\n\nPlease complete your registration for Paramount Recording Studios using the link below:\n\n${regLinkUrl}\n\nThis link expires in 7 days.\n\n— Paramount Recording Studios`
    )
    window.location.href = `mailto:${client.email || ''}?subject=${subject}&body=${body}`
  }, [regLinkUrl, client])

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading && !client) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', flex: 1, minHeight: 0 }}>
        <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ height: 18, borderRadius: 4, background: 'var(--surface2)', animation: 'shimmer 1.4s ease-in-out infinite', width: '52%', marginBottom: 10 }} />
          <div style={{ height: 12, borderRadius: 3, background: 'var(--surface2)', animation: 'shimmer 1.4s ease-in-out infinite', width: '28%' }} />
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[80, 55, 70, 45].map((w, i) => (
            <div key={i}>
              <div style={{ height: 8, borderRadius: 3, background: 'var(--surface2)', animation: 'shimmer 1.4s ease-in-out infinite', width: '22%', marginBottom: 6 }} />
              <div style={{ height: 11, borderRadius: 3, background: 'var(--surface2)', animation: 'shimmer 1.4s ease-in-out infinite', width: `${w}%` }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!client) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text3)', fontSize: 11, fontFamily: 'DM Mono' }}>
        Select a client to view their profile
      </div>
    )
  }

  const isLabel = client.type === 'label'
  const typeLabel = CLIENT_TYPE_LABELS[client.type].toUpperCase()
  const typeBadgeStyle: React.CSSProperties = {
    fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em',
    padding: '3px 7px', borderRadius: 3,
    background: 'rgba(139,144,168,0.12)',
    color: 'var(--text2)',
    border: '1px solid var(--border)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', flex: 1, minHeight: 0 }}>

      {/* Header */}
      <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {onBack && (
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontFamily: 'DM Mono', fontSize: 10, cursor: 'pointer', padding: 0, marginBottom: 8, display: 'block' }}>
            ← Back
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
          {editingName ? (
            <input
              autoFocus
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onBlur={() => { saveClient({ name: nameVal.trim() || client.name || '' }); setEditingName(false) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { saveClient({ name: nameVal.trim() || client.name || '' }); setEditingName(false) }
                if (e.key === 'Escape') { setNameVal(client.name || ''); setEditingName(false) }
              }}
              style={{ fontFamily: 'DM Serif Display', fontSize: 20, lineHeight: 1.2, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', padding: '0 2px', width: '100%' }}
            />
          ) : (
            <div
              onClick={() => setEditingName(true)}
              title="Click to edit name"
              style={{ fontFamily: 'DM Serif Display', fontSize: 20, lineHeight: 1.2, cursor: 'text', borderBottom: '1px solid transparent', padding: '0 2px', color: 'var(--text)' }}
            >
              {client.name}
            </div>
          )}
          <button
            onClick={() => router.push(`/calendar?newBooking=1&clientId=${client.id}`)}
            style={{ ...accentBtn, fontSize: 9, padding: '5px 12px', flexShrink: 0, background: '#e8eaf0', color: '#0d0f14' }}
          >
            Start Booking
          </button>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const, alignItems: 'center' }}>
          <span style={typeBadgeStyle}>{typeLabel}</span>
          {bookingCount > 0 && (
            <span style={{ fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)', background: 'var(--surface2)', padding: '3px 7px', borderRadius: 3, border: '1px solid var(--border)' }}>
              {bookingCount} booking{bookingCount !== 1 ? 's' : ''}
            </span>
          )}
          {client.registered_at && (
            <button onClick={() => setRegViewOpen(true)} style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', padding: '3px 7px', borderRadius: 3, background: 'rgba(20,184,166,0.12)', color: 'var(--booked)', border: '1px solid rgba(20,184,166,0.3)', cursor: 'pointer' }}>
              ✓ REGISTERED
            </button>
          )}
        </div>
      </div>

      {/* Start Booking toast */}
      {bookingToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.5)', maxWidth: 320, fontFamily: 'DM Mono', fontSize: 11 }}>
          <span style={{ color: 'var(--accent)', fontSize: 14 }}>🗓</span>
          <span style={{ color: 'var(--text)', flex: 1 }}>Booking flow coming in Chunk 6.</span>
          <button onClick={() => setBookingToast(false)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
      )}

      {/* Scrollable body */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '14px 18px 18px' }}>

        {/* ── LABEL SECTIONS ── */}
        {isLabel && (() => {
          const anrContacts = contacts.filter(c => c.contact_type !== 'admin')
          const adminContacts = contacts.filter(c => c.contact_type === 'admin')
          return (
            <>
              <SectionHeader
                label="Contacts (A&Rs)"
                mt={0}
                action={
                  <button onClick={() => setShowAddContact(v => !v)} style={{ ...ghostBtn, fontSize: 9, padding: '3px 8px' }}>
                    {showAddContact ? 'Cancel' : '+ Add'}
                  </button>
                }
              />
              {anrContacts.map(ct => (
                <ContactRow key={ct.id} contact={ct} onSave={saveContact} onDelete={deleteContact} />
              ))}
              {anrContacts.length === 0 && !showAddContact && (
                <div style={{ padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>No A&Rs or reps on file yet.</span>
                  <button onClick={() => setShowAddContact(true)} style={{ ...accentBtn, fontSize: 9, padding: '3px 10px' }}>Add Contact</button>
                </div>
              )}
              {showAddContact && <AddContactForm onAdd={addContact} onCancel={() => setShowAddContact(false)} />}

              {/* Admins section — rendered inline to share anrContacts/adminContacts scope */}
              <SectionHeader
                label="Admins"
                mt={16}
                action={
                  <button onClick={() => setShowAddAdmin(v => !v)} style={{ ...ghostBtn, fontSize: 9, padding: '3px 8px' }}>
                    {showAddAdmin ? 'Cancel' : '+ Add'}
                  </button>
                }
              />
              {adminContacts.map(ct => (
                <AdminRow key={ct.id} contact={ct} onSave={saveContact} onDelete={deleteContact} />
              ))}
              {adminContacts.length === 0 && !showAddAdmin && (
                <div style={{ padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>No admins on file yet.</span>
                  <button onClick={() => setShowAddAdmin(true)} style={{ ...accentBtn, fontSize: 9, padding: '3px 10px' }}>Add Admin</button>
                </div>
              )}
              {showAddAdmin && <AddAdminForm onAdd={addAdmin} onCancel={() => setShowAddAdmin(false)} />}
            </>
          )
        })()}

        {/* ── COD SECTIONS ── */}
        {!isLabel && (
          <>
            <SectionHeader label="Contact" mt={0} />
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px 16px', marginBottom: 4 }}>
              <div>
                <InlineField label="Email" value={client.email} onSave={v => saveClient({ email: v })} />
                {client.email && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                    <a href={`mailto:${client.email}`} style={aBtn('#8b90a8')}>Email</a>
                  </div>
                )}
              </div>
              <div>
                <PhoneInlineField value={client.phone} onSave={v => saveClient({ phone: v })} />
                {client.phone && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                    <a href={`tel:${client.phone.replace(/\D/g, '')}`} style={aBtn('#8b90a8')}>Call</a>
                    <a href={`sms:${client.phone.replace(/\D/g, '')}`} style={aBtn('#8b90a8')}>Text</a>
                  </div>
                )}
              </div>
              <InlineField label="Instagram" value={client.instagram} onSave={v => saveClient({ instagram: v })} />
              <InlineField label="How heard" value={client.how_heard} onSave={v => saveClient({ how_heard: v })} />
            </div>

            <SectionHeader
              label="Billing Address"
              action={
                <button onClick={() => setShowAddress(v => !v)} style={{ ...ghostBtn, fontSize: 9, padding: '3px 8px' }}>
                  {showAddress ? 'Collapse' : 'Expand'}
                </button>
              }
            />
            {showAddress ? (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px 16px', marginBottom: 4 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <InlineField label="Street" value={client.address_street} onSave={v => saveClient({ address_street: v })} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <InlineField label="Street 2" value={client.address_street2} onSave={v => saveClient({ address_street2: v })} />
                </div>
                <InlineField label="City" value={client.address_city} onSave={v => saveClient({ address_city: v })} />
                <InlineField label="State" value={client.address_state} onSave={v => saveClient({ address_state: v })} />
                <InlineField label="Zip" value={client.address_zip} onSave={v => saveClient({ address_zip: v })} />
              </div>
            ) : (
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', marginBottom: 4 }}>
                {client.address_street
                  ? `${client.address_street}${client.address_city ? ', ' + client.address_city : ''}`
                  : 'No address on file.'}
              </div>
            )}

            <SectionHeader label="Verification" />
            {client.registered_at ? (
              <button onClick={() => setRegViewOpen(true)} style={{ fontSize: 10, fontFamily: 'DM Mono', color: 'var(--booked)', lineHeight: 1.8, marginBottom: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' as const }}>
                ✓ Registered {new Date(client.registered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {client.terms_accepted && <span> · Terms accepted</span>}
                {client.id_file_url && <span> · ID on file</span>}
                <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--text3)' }}>View →</span>
              </button>
            ) : (
              <div style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: regLinkUrl ? 6 : 0 }}>
                  <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>Not yet registered</span>
                  <button
                    onClick={generateRegLink}
                    disabled={regLinkGenerating || !!regLinkUrl}
                    style={{ ...ghostBtn, fontSize: 9, padding: '3px 8px', opacity: regLinkGenerating ? 0.6 : 1, cursor: (regLinkGenerating || !!regLinkUrl) ? 'default' : 'pointer' }}
                  >
                    {regLinkGenerating ? 'Generating…' : regLinkUrl ? '✓ Link created' : 'Send registration link'}
                  </button>
                </div>
                {regLinkUrl && (
                  <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                      {regLinkUrl}
                    </span>
                    <button onClick={copyRegLink} style={{ ...accentBtn, fontSize: 8, padding: '2px 8px', flexShrink: 0 }}>
                      {regLinkCopied ? 'Copied!' : 'Copy'}
                    </button>
                    <button onClick={emailRegLink} style={{ ...ghostBtn, fontSize: 8, padding: '2px 8px', flexShrink: 0 }}>
                      Email
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── SHARED SECTIONS ── */}

        <SectionHeader label="Booking History" />
        <BookingHistory leads={bookings} />

        <SectionHeader label="Notes" />
        <InlineField label="" value={client.notes} onSave={v => saveClient({ notes: v })} multiline placeholder="Add notes…" />

        {/* Footer */}
        <div style={{ marginTop: 16, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
            {!client.registered_at ? 'Migrated · ' : ''}
            Added {client.created_at ? new Date(client.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
          </div>
          <button onClick={() => setShowDeleteConfirm(true)} style={{ ...dangerBtn, fontSize: 9, padding: '3px 8px' }}>
            Delete Client
          </button>
        </div>
      </div>

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div onClick={() => setShowDeleteConfirm(false)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px', maxWidth: 400, width: '100%' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 14, marginBottom: 8 }}>Delete {client.name}?</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'DM Mono', lineHeight: 1.7, marginBottom: 20 }}>
              This will permanently delete this client and all associated contacts. Any linked leads will be unlinked but not deleted. This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={ghostBtn}>Cancel</button>
              <button onClick={deleteClient} disabled={deleting} style={{ ...dangerBtn, padding: '6px 16px', fontSize: 10, opacity: deleting ? 0.7 : 1, cursor: deleting ? 'default' : 'pointer' }}>
                {deleting ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
      {regViewOpen && client && (
        <RegViewModal clientId={client.id} onClose={() => setRegViewOpen(false)} />
      )}
    </div>
  )
}
