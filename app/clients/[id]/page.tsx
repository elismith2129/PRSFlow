'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, Client, ClientContact, Lead, CLIENT_TYPE_LABELS } from '@/lib/supabase'

interface BookingLead {
  id: number
  fname: string
  lname: string
  session_date: string
  booking: string
  created_at: string
}

// ─── Inline field ────────────────────────────────────────────────────────────

function InlineField({
  label, value, onSave, multiline = false, placeholder = '—',
}: {
  label: string
  value: string | null
  onSave: (v: string) => void
  multiline?: boolean
  placeholder?: string
}) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])

  const sharedStyle: React.CSSProperties = {
    width: '100%', background: 'transparent', border: 'none',
    borderBottom: '1px solid transparent', outline: 'none',
    color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 12,
    padding: '2px 0', lineHeight: 1.5, resize: 'none' as const,
    transition: 'border-color 0.15s',
  }

  const handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderBottomColor = 'var(--border)'
  }
  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderBottomColor = 'transparent'
    if (local !== (value ?? '')) onSave(local)
  }

  return (
    <div>
      <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 3 }}>
        {label}
      </div>
      {multiline ? (
        <textarea
          rows={3}
          value={local}
          placeholder={placeholder}
          onChange={e => setLocal(e.target.value)}
          onFocus={handleFocus as React.FocusEventHandler<HTMLTextAreaElement>}
          onBlur={handleBlur as React.FocusEventHandler<HTMLTextAreaElement>}
          style={{ ...sharedStyle, display: 'block' }}
        />
      ) : (
        <input
          type="text"
          value={local}
          placeholder={placeholder}
          onChange={e => setLocal(e.target.value)}
          onFocus={handleFocus as React.FocusEventHandler<HTMLInputElement>}
          onBlur={handleBlur as React.FocusEventHandler<HTMLInputElement>}
          style={sharedStyle}
        />
      )}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text3)' }}>
        {label}
      </div>
      {action}
    </div>
  )
}

// ─── Contact row ──────────────────────────────────────────────────────────────

function ContactRow({
  contact, onSave, onDelete,
}: {
  contact: ClientContact
  onSave: (id: string, data: Partial<ClientContact>) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState({ ...contact })
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { setDraft({ ...contact }) }, [contact])

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginBottom: 6 }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface2)', cursor: 'pointer' }}
      >
        <div>
          <span style={{ fontSize: 12, fontWeight: 500 }}>
            {[contact.fname, contact.lname].filter(Boolean).join(' ') || 'Unnamed contact'}
          </span>
          {contact.role && (
            <span style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginLeft: 8 }}>
              {contact.role}
            </span>
          )}
          {contact.email && (
            <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono', marginTop: 1 }}>{contact.email}</div>
          )}
        </div>
        <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '12px 12px 10px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 10 }}>
            {(['fname', 'lname'] as const).map(f => (
              <div key={f}>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 3 }}>
                  {f === 'fname' ? 'First name' : 'Last name'}
                </div>
                <input
                  type="text"
                  value={draft[f] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
                  style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 12, padding: '2px 0' }}
                />
              </div>
            ))}
            {(['role', 'email', 'phone', 'instagram'] as const).map(f => (
              <div key={f} style={{ gridColumn: f === 'email' || f === 'phone' ? 'auto' : '1 / -1' }}>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 3 }}>
                  {f}
                </div>
                <input
                  type="text"
                  value={draft[f] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
                  style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 12, padding: '2px 0' }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            {confirmDelete ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: 'var(--hot)', fontFamily: 'DM Mono' }}>
                Remove this contact?
                <button onClick={() => onDelete(contact.id)} style={dangerBtn}>Yes, remove</button>
                <button onClick={() => setConfirmDelete(false)} style={ghostBtn}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} style={{ ...ghostBtn, color: 'var(--hot)', fontSize: 10 }}>
                Remove contact
              </button>
            )}
            <button
              onClick={() => { onSave(contact.id, draft); setExpanded(false) }}
              style={accentBtn}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Add contact form ─────────────────────────────────────────────────────────

function AddContactForm({ onAdd, onCancel }: { onAdd: (data: Partial<ClientContact>) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState({ fname: '', lname: '', role: '', email: '', phone: '', instagram: '' })
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '12px 12px 10px', background: 'var(--surface2)', marginTop: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 10 }}>
        {([
          ['fname', 'First name'], ['lname', 'Last name'], ['role', 'Role'], ['email', 'Email'],
          ['phone', 'Phone'], ['instagram', 'Instagram'],
        ] as [keyof typeof draft, string][]).map(([f, lbl]) => (
          <div key={f}>
            <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 3 }}>
              {lbl}
            </div>
            <input
              type="text"
              value={draft[f]}
              onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
              style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 12, padding: '2px 0' }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button
          onClick={() => { if (draft.fname || draft.lname || draft.email) onAdd(draft) }}
          style={accentBtn}
        >
          Add contact
        </button>
      </div>
    </div>
  )
}

// ─── Booking history ──────────────────────────────────────────────────────────

function BookingHistory({ leads }: { leads: BookingLead[] }) {
  if (leads.length === 0) {
    return <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>No bookings on file.</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {leads.map(l => {
        const dateStr = l.session_date
          ? l.session_date
          : new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        const name = [l.fname, l.lname].filter(Boolean).join(' ') || '—'
        return (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)', minWidth: 80, flexShrink: 0 }}>{dateStr}</div>
            <div style={{ fontSize: 11, color: 'var(--text)', flex: 1 }}>{name}</div>
            {l.booking && (
              <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '2px 6px', borderRadius: 3, flexShrink: 0 }}>
                {l.booking}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Button styles ────────────────────────────────────────────────────────────

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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string

  const [client, setClient] = useState<Client | null>(null)
  const [contacts, setContacts] = useState<ClientContact[]>([])
  const [bookings, setBookings] = useState<BookingLead[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddContact, setShowAddContact] = useState(false)
  const [newArtist, setNewArtist] = useState('')
  const [showAddress, setShowAddress] = useState(false)

  const load = useCallback(async () => {
    const [{ data: c }, { data: cts }, { data: bks }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).single(),
      supabase.from('client_contacts').select('*').eq('client_id', id).order('lname'),
      supabase.from('leads').select('id, fname, lname, session_date, booking, created_at')
        .eq('client_id', id).eq('status', 'booked').order('created_at', { ascending: false }),
    ])
    if (c) setClient({ ...c, artists: c.artists || [] } as Client)
    setContacts((cts || []) as ClientContact[])
    setBookings((bks || []) as BookingLead[])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (client) {
      const hasAddress = client.address_street || client.address_city || client.address_zip
      if (hasAddress) setShowAddress(true)
    }
  }, [client])

  const saveClient = useCallback(async (fields: Partial<Client>) => {
    await supabase.from('clients').update(fields).eq('id', id)
    load()
  }, [id, load])

  const saveContact = useCallback(async (contactId: string, data: Partial<ClientContact>) => {
    await supabase.from('client_contacts').update(data).eq('id', contactId)
    load()
  }, [load])

  const deleteContact = useCallback(async (contactId: string) => {
    await supabase.from('client_contacts').delete().eq('id', contactId)
    load()
  }, [load])

  const addContact = useCallback(async (data: Partial<ClientContact>) => {
    await supabase.from('client_contacts').insert({ ...data, client_id: id })
    setShowAddContact(false)
    load()
  }, [id, load])

  const addArtist = useCallback(async () => {
    const name = newArtist.trim()
    if (!name || !client) return
    const updated = [...(client.artists || []), name]
    await supabase.from('clients').update({ artists: updated }).eq('id', id)
    setNewArtist('')
    load()
  }, [newArtist, client, id, load])

  const removeArtist = useCallback(async (artist: string) => {
    if (!client) return
    const updated = client.artists.filter(a => a !== artist)
    await supabase.from('clients').update({ artists: updated }).eq('id', id)
    load()
  }, [client, id, load])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 52px)', color: 'var(--text3)', fontFamily: 'DM Mono', fontSize: 11 }}>
        Loading…
      </div>
    )
  }

  if (!client) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 52px)', color: 'var(--text3)', fontFamily: 'DM Mono', fontSize: 11 }}>
        Client not found.
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
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '20px 20px 48px' }}>
      {/* Back */}
      <button
        onClick={() => router.push('/clients')}
        style={{ background: 'none', border: 'none', color: 'var(--text3)', fontFamily: 'DM Mono', fontSize: 10, cursor: 'pointer', padding: 0, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}
      >
        ← Clients
      </button>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
          <div style={{ fontFamily: 'DM Serif Display', fontSize: 28, lineHeight: 1.15, flex: 1 }}>
            {client.name}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center' }}>
          <span style={typeBadgeStyle}>{typeLabel}</span>
          {bookings.length > 0 && (
            <span style={{ fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)', background: 'var(--surface2)', padding: '3px 7px', borderRadius: 3, border: '1px solid var(--border)' }}>
              {bookings.length} booking{bookings.length !== 1 ? 's' : ''}
            </span>
          )}
          {client.registered_at && (
            <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', padding: '3px 7px', borderRadius: 3, background: 'rgba(78,240,162,0.12)', color: 'var(--booked)', border: '1px solid rgba(78,240,162,0.3)' }}>
              REGISTERED
            </span>
          )}
        </div>
      </div>

      {/* ── LABEL VIEW ── */}
      {isLabel && (
        <>
          {/* Contacts */}
          <Card>
            <SectionHeader
              label="Contacts (A&Rs)"
              action={
                <button onClick={() => setShowAddContact(v => !v)} style={ghostBtn}>
                  {showAddContact ? 'Cancel' : '+ Add contact'}
                </button>
              }
            />
            {contacts.map(ct => (
              <ContactRow key={ct.id} contact={ct} onSave={saveContact} onDelete={deleteContact} />
            ))}
            {contacts.length === 0 && !showAddContact && (
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>No contacts on file.</div>
            )}
            {showAddContact && (
              <AddContactForm onAdd={addContact} onCancel={() => setShowAddContact(false)} />
            )}
          </Card>

          {/* Artists */}
          <Card>
            <SectionHeader label="Artists" />
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5, marginBottom: 10 }}>
              {(client.artists || []).map((a, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)', background: 'var(--surface2)', border: '1px solid var(--border)', padding: '3px 8px', borderRadius: 4 }}>
                  {a}
                  <button
                    onClick={() => removeArtist(a)}
                    style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 0, fontSize: 10, lineHeight: 1 }}
                    title="Remove artist"
                  >
                    ×
                  </button>
                </span>
              ))}
              {(client.artists || []).length === 0 && (
                <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>No artists listed.</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Artist name"
                value={newArtist}
                onChange={e => setNewArtist(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addArtist() }}
                style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 10px', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, outline: 'none' }}
              />
              <button onClick={addArtist} style={accentBtn}>Add</button>
            </div>
          </Card>
        </>
      )}

      {/* ── INDIVIDUAL VIEW ── */}
      {!isLabel && (
        <>
          {/* Contact info */}
          <Card>
            <SectionHeader label="Contact" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
              <InlineField label="Email" value={client.email} onSave={v => saveClient({ email: v })} />
              <InlineField label="Phone" value={client.phone} onSave={v => saveClient({ phone: v })} />
              <InlineField label="Instagram" value={client.instagram} onSave={v => saveClient({ instagram: v })} />
              <InlineField label="How heard" value={client.how_heard} onSave={v => saveClient({ how_heard: v })} />
            </div>
          </Card>

          {/* Billing address */}
          <Card>
            <SectionHeader
              label="Billing Address"
              action={
                <button
                  onClick={() => setShowAddress(v => !v)}
                  style={{ ...ghostBtn, fontSize: 9 }}
                >
                  {showAddress ? 'Collapse' : 'Expand'}
                </button>
              }
            />
            {showAddress && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
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
            )}
            {!showAddress && (
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
                {client.address_street
                  ? `${client.address_street}${client.address_city ? ', ' + client.address_city : ''}`
                  : 'No address on file.'}
              </div>
            )}
          </Card>

          {/* Verification */}
          <Card>
            <SectionHeader label="Verification" />
            {client.registered_at ? (
              <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: 'var(--booked)', lineHeight: 1.8 }}>
                Registered {new Date(client.registered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {client.terms_accepted && <span> · Terms accepted</span>}
                {client.id_file_url && <span> · ID on file</span>}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>Not yet registered</span>
                <button
                  disabled
                  title="Coming in 4.6 — registration link flow"
                  style={{ ...ghostBtn, opacity: 0.45, cursor: 'not-allowed' }}
                >
                  Send registration link
                </button>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── SHARED SECTIONS ── */}

      {/* Booking history */}
      <Card>
        <SectionHeader label="Booking History" />
        <BookingHistory leads={bookings} />
      </Card>

      {/* Notes */}
      <Card>
        <SectionHeader label="Notes" />
        <InlineField
          label=""
          value={client.notes}
          onSave={v => saveClient({ notes: v })}
          multiline
          placeholder="Add notes…"
        />
      </Card>

      {/* Footer */}
      <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
        {!client.registered_at ? 'Migrated · ' : ''}
        Added {client.created_at ? new Date(client.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
        {client.updated_at && ` · Updated ${new Date(client.updated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`}
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px', marginBottom: 12 }}>
      {children}
    </div>
  )
}
