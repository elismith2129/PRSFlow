'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { supabase, Client, ClientContact, CLIENT_TYPE_LABELS } from '@/lib/supabase'

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
  onRefresh: () => void
  onBack?: () => void
}

// ─── Shared button styles ─────────────────────────────────────────────────────

const accentBtn: React.CSSProperties = {
  background: 'var(--accent)', color: '#0d0f14', border: 'none', borderRadius: 4,
  padding: '5px 12px', fontSize: 10, fontFamily: 'Syne', fontWeight: 700,
  letterSpacing: '0.08em', cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)',
  borderRadius: 4, padding: '5px 12px', fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer',
}
const dangerBtn: React.CSSProperties = {
  background: 'rgba(240,78,122,0.15)', color: 'var(--hot)', border: '1px solid rgba(240,78,122,0.3)',
  borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer',
}

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

// ─── Contact row ──────────────────────────────────────────────────────────────

function ContactRow({ contact, onSave, onDelete }: {
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
            {[contact.fname, contact.lname].filter(Boolean).join(' ') || 'Unnamed contact'}
          </span>
          {contact.role && (
            <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginLeft: 7 }}>
              {contact.role}
            </span>
          )}
          {contact.email && (
            <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono', marginTop: 1 }}>{contact.email}</div>
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
            {(['role', 'email', 'phone', 'instagram'] as const).map(f => (
              <div key={f}>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>
                  {f}
                </div>
                <input type="text" value={draft[f] ?? ''} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
                  style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0' }} />
              </div>
            ))}
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

// ─── Add contact form ─────────────────────────────────────────────────────────

function AddContactForm({ onAdd, onCancel }: { onAdd: (data: Partial<ClientContact>) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState({ fname: '', lname: '', role: '', email: '', phone: '', instagram: '' })
  const fields: [keyof typeof draft, string][] = [
    ['fname', 'First'], ['lname', 'Last'], ['role', 'Role'], ['email', 'Email'], ['phone', 'Phone'], ['instagram', 'Instagram'],
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
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button onClick={() => { if (draft.fname || draft.lname || draft.email) onAdd(draft) }} style={accentBtn}>Add</button>
      </div>
    </div>
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

export function ClientProfile({ client, contacts, bookingCount, loading, onRefresh, onBack }: Props) {
  const [bookings, setBookings] = useState<BookingLead[]>([])
  const [showAddContact, setShowAddContact] = useState(false)
  const [newArtist, setNewArtist] = useState('')
  const [showAddress, setShowAddress] = useState(false)

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
    setNewArtist('')
  }, [client?.id])

  const saveClient = useCallback(async (fields: Partial<Client>) => {
    if (!client) return
    await supabase.from('clients').update(fields).eq('id', client.id)
    onRefresh()
  }, [client, onRefresh])

  const saveContact = useCallback(async (contactId: string, data: Partial<ClientContact>) => {
    await supabase.from('client_contacts').update(data).eq('id', contactId)
    onRefresh()
  }, [onRefresh])

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

  const addArtist = useCallback(async () => {
    if (!client) return
    const name = newArtist.trim()
    if (!name) return
    const updated = [...(client.artists || []), name]
    await supabase.from('clients').update({ artists: updated }).eq('id', client.id)
    setNewArtist('')
    onRefresh()
  }, [client, newArtist, onRefresh])

  const removeArtist = useCallback(async (artist: string) => {
    if (!client) return
    const updated = client.artists.filter(a => a !== artist)
    await supabase.from('clients').update({ artists: updated }).eq('id', client.id)
    onRefresh()
  }, [client, onRefresh])

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
    background: isLabel ? 'rgba(200,240,78,0.12)' : 'rgba(139,144,168,0.12)',
    color: isLabel ? 'var(--accent)' : 'var(--text3)',
    border: `1px solid ${isLabel ? 'rgba(200,240,78,0.3)' : 'var(--border)'}`,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', flex: 1, minHeight: 0 }}>

      {/* Header */}
      <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontFamily: 'DM Serif Display', fontSize: 20, lineHeight: 1.2, marginBottom: 7 }}>
          {client.name}
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const, alignItems: 'center' }}>
          <span style={typeBadgeStyle}>{typeLabel}</span>
          {bookingCount > 0 && (
            <span style={{ fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)', background: 'var(--surface2)', padding: '3px 7px', borderRadius: 3, border: '1px solid var(--border)' }}>
              {bookingCount} booking{bookingCount !== 1 ? 's' : ''}
            </span>
          )}
          {client.registered_at && (
            <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', padding: '3px 7px', borderRadius: 3, background: 'rgba(78,240,162,0.12)', color: 'var(--booked)', border: '1px solid rgba(78,240,162,0.3)' }}>
              REGISTERED
            </span>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '14px 18px 18px' }}>

        {/* ── LABEL SECTIONS ── */}
        {isLabel && (
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
            {contacts.map(ct => (
              <ContactRow key={ct.id} contact={ct} onSave={saveContact} onDelete={deleteContact} />
            ))}
            {contacts.length === 0 && !showAddContact && (
              <div style={{ padding: '10px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>No A&Rs or reps on file yet.</span>
                <button onClick={() => setShowAddContact(true)} style={{ ...accentBtn, fontSize: 9, padding: '3px 10px' }}>Add Contact</button>
              </div>
            )}
            {showAddContact && <AddContactForm onAdd={addContact} onCancel={() => setShowAddContact(false)} />}

            <SectionHeader label="Artists" />
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4, marginBottom: 8 }}>
              {(client.artists || []).map((a, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)', background: 'var(--surface2)', border: '1px solid var(--border)', padding: '2px 7px', borderRadius: 4 }}>
                  {a}
                  <button onClick={() => removeArtist(a)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1 }} title="Remove">×</button>
                </span>
              ))}
              {(client.artists || []).length === 0 && (
                <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>No artists on file yet — add one below.</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text" placeholder="Artist name" value={newArtist}
                onChange={e => setNewArtist(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addArtist() }}
                style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 10, outline: 'none' }}
              />
              <button onClick={addArtist} style={{ ...accentBtn, padding: '4px 10px' }}>Add</button>
            </div>
          </>
        )}

        {/* ── COD SECTIONS ── */}
        {!isLabel && (
          <>
            <SectionHeader label="Contact" mt={0} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 4 }}>
              <InlineField label="Email" value={client.email} onSave={v => saveClient({ email: v })} />
              <InlineField label="Phone" value={client.phone} onSave={v => saveClient({ phone: v })} />
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 4 }}>
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
              <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: 'var(--booked)', lineHeight: 1.8, marginBottom: 4 }}>
                Registered {new Date(client.registered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {client.terms_accepted && <span> · Terms accepted</span>}
                {client.id_file_url && <span> · ID on file</span>}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>Not yet registered</span>
                <button disabled title="Coming in 4.6 — registration link flow" style={{ ...ghostBtn, opacity: 0.4, cursor: 'not-allowed', fontSize: 9, padding: '3px 8px' }}>
                  Send registration link
                </button>
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
        <div style={{ marginTop: 16, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
          {!client.registered_at ? 'Migrated · ' : ''}
          Added {client.created_at ? new Date(client.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
        </div>
      </div>
    </div>
  )
}
