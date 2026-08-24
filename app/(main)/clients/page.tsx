'use client'
import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, Client, ClientContact } from '@/lib/supabase'
import { ClientList, BookingCountMap, ContactsMap } from '@/components/clients/ClientList'
import { ClientProfile } from '@/components/clients/ClientProfile'
import { useClientsVersion } from '@/hooks/useClientsVersion'

export default function ClientsPage(): null {
  const router = useRouter()
  useEffect(() => { router.replace('/crm') }, [router])
  return null
}

export function ClientsPageInner({ initialClientId, embedded }: { initialClientId?: string | null, embedded?: boolean }) {
  const [clients, setClients] = useState<Client[]>([])
  const [contactsMap, setContactsMap] = useState<ContactsMap>({})
  const [bookingCountMap, setBookingCountMap] = useState<BookingCountMap>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [newClientOpen, setNewClientOpen] = useState(() => {
    try { return !!sessionStorage.getItem('clients_new_draft') } catch { return false }
  })
  const [isMobile, setIsMobile] = useState(false)
  const hasAutoSelected = useRef(false)
  const clientsVersion = useClientsVersion()
  const searchParams = useSearchParams()
  const idParam = searchParams.get('id')

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 600) }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const load = useCallback(async () => {
    const [
      { data: clientsData },
      { data: contactsData },
      { data: bookingData },
    ] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('client_contacts').select('id, client_id, fname, lname, email, phone, instagram, role, notes, artists, contact_type'),
      supabase.from('leads').select('client_id').not('client_id', 'is', null),
    ])

    setClients((clientsData || []).map(c => ({ ...c, artists: c.artists || [] })) as Client[])

    const cMap: ContactsMap = {}
    for (const ct of (contactsData || []) as ClientContact[]) {
      if (!cMap[ct.client_id]) cMap[ct.client_id] = []
      cMap[ct.client_id].push(ct)
    }
    setContactsMap(cMap)

    const bMap: BookingCountMap = {}
    for (const row of (bookingData || [])) {
      if (row.client_id) bMap[row.client_id] = (bMap[row.client_id] || 0) + 1
    }
    setBookingCountMap(bMap)
    setLoading(false)
  }, [])

  // Real-time: re-fetch the client list live when clients/contacts change.
  //
  // `clients` comes from the shared channel (hooks/useClientsVersion) rather than
  // a local subscription — the CRM's registration banner and REGISTRATIONS list
  // watch the same table, and three parallel subscriptions would mean three
  // re-fetches per change. client_contacts has only this one consumer, so it
  // keeps a local channel.
  useEffect(() => { load() }, [load, clientsVersion])

  useEffect(() => {
    const channel = supabase
      .channel('clients-contacts-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_contacts' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  // Auto-select: prefer initialClientId prop or ?id= param, otherwise fall back
  // to the first client.
  //
  // An explicit target applies EVERY time it changes, not just on first mount —
  // the CRM's registration banner sets initialClientId after confirming a
  // profile, while this view is already mounted. appliedTargetRef makes each
  // distinct target apply exactly once, so a realtime `clients` refresh can't
  // yank the user back off a row they picked themselves.
  const appliedTargetRef = useRef<string | null>(null)
  useEffect(() => {
    if (loading || clients.length === 0) return
    const targetId = initialClientId || idParam
    if (targetId && targetId !== appliedTargetRef.current && clients.some(c => c.id === targetId)) {
      appliedTargetRef.current = targetId
      hasAutoSelected.current = true
      setSelectedId(targetId)
      return
    }
    if (hasAutoSelected.current) return
    hasAutoSelected.current = true
    setSelectedId(clients[0].id)
  }, [loading, clients, idParam, initialClientId])

  const selected = clients.find(c => c.id === selectedId) || null

  const showList = !isMobile || !selectedId
  const showProfile = !isMobile || !!selectedId

  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...(embedded ? { flex: 1, minHeight: 0 } : { height: 'calc(100vh - 52px - 24px)' }) }}>

      {/* Carved to match the leads tab (Eli 2026-08-24 — "update the client
          page to match the UI of the lead tracker"). Same header anatomy and
          the same primary button as + New Lead. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }}>
          Clients
        </div>
        <button
          onClick={() => setNewClientOpen(true)}
          className="c-btn c-control c-raised-primary"
          style={{ flexShrink: 0 }}
        >
          + New Client
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '60fr 40fr', gap: 14, flex: 1, minHeight: 0 }}>
        {showList && (
          <ClientList
            clients={clients}
            contactsMap={contactsMap}
            bookingCountMap={bookingCountMap}
            selectedId={selectedId}
            loading={loading}
            onSelect={setSelectedId}
          />
        )}
        {showProfile && (
          <ClientProfile
            client={selected}
            contacts={selected ? (contactsMap[selected.id] || []) : []}
            bookingCount={selected ? (bookingCountMap[selected.id] || 0) : 0}
            loading={loading}
            isMobile={isMobile}
            onRefresh={load}
            onBack={isMobile ? () => setSelectedId(null) : undefined}
            onDelete={() => { setSelectedId(null); load() }}
          />
        )}
      </div>

      {newClientOpen && (
        <NewClientModal
          onClose={() => { try { sessionStorage.removeItem('clients_new_draft') } catch {} setNewClientOpen(false) }}
          onCreated={(id) => { try { sessionStorage.removeItem('clients_new_draft') } catch {} setNewClientOpen(false); load().then(() => setSelectedId(id)) }}
        />
      )}
    </div>
  )
}

// ─── NEW CLIENT MODAL ─────────────────────────────────────────────────────────

function NewClientModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (clientId: string) => void
}) {
  const [type, setType] = useState<'individual' | 'label'>('individual')
  const [fname, setFname] = useState('')
  const [lname, setLname] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [artist, setArtist] = useState('')
  const [instagram, setInstagram] = useState('')
  const [addrStreet, setAddrStreet] = useState('')
  const [addrCity, setAddrCity] = useState('')
  const [addrState, setAddrState] = useState('')
  const [addrZip, setAddrZip] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Duplicate detection
  const [matches, setMatches] = useState<Client[]>([])
  const [dupTarget, setDupTarget] = useState<Client | null>(null)
  const [showDupModal, setShowDupModal] = useState(false)
  const [forceCreate, setForceCreate] = useState(false)
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>()

  const isLabel = type === 'label'

  // Restore draft on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('clients_new_draft')
      if (!raw) return
      const d = JSON.parse(raw)
      if (d.type) setType(d.type)
      if (d.fname) setFname(d.fname)
      if (d.lname) setLname(d.lname)
      if (d.email) setEmail(d.email)
      if (d.phone) setPhone(d.phone)
      if (d.company) setCompany(d.company)
      if (d.artist) setArtist(d.artist)
      if (d.instagram) setInstagram(d.instagram)
      if (d.addrStreet) setAddrStreet(d.addrStreet)
      if (d.addrCity) setAddrCity(d.addrCity)
      if (d.addrState) setAddrState(d.addrState)
      if (d.addrZip) setAddrZip(d.addrZip)
      if (d.notes) setNotes(d.notes)
    } catch {}
  }, [])

  // Autosave draft on any field change
  useEffect(() => {
    try {
      sessionStorage.setItem('clients_new_draft', JSON.stringify({ type, fname, lname, email, phone, company, artist, instagram, addrStreet, addrCity, addrState, addrZip, notes }))
    } catch {}
  }, [type, fname, lname, email, phone, company, artist, instagram, addrStreet, addrCity, addrState, addrZip, notes])

  // Debounced search on name/email/phone
  useEffect(() => {
    clearTimeout(searchDebounce.current)
    const query = `${fname} ${lname}`.trim()
    // A label may now be created from the company name alone, so the company
    // field has to feed duplicate detection too — otherwise the one field a
    // label-only entry fills is the one field we never check, and a second
    // "Interscope" gets created silently.
    const companyQuery = isLabel ? company.trim() : ''
    const hasQuery = query.length >= 3 || email.length >= 3 || phone.length >= 5 || companyQuery.length >= 3
    if (!hasQuery) { setMatches([]); return }
    searchDebounce.current = setTimeout(async () => {
      const orParts: string[] = []
      if (query.length >= 3) {
        const words = query.split(' ').filter(Boolean)
        if (words[0]) orParts.push(`name.ilike.%${words[0]}%`, `fname.ilike.%${words[0]}%`, `lname.ilike.%${words[0]}%`)
        if (words[1]) orParts.push(`lname.ilike.%${words[1]}%`)
      }
      if (companyQuery.length >= 3) orParts.push(`name.ilike.%${companyQuery}%`)
      if (email.length >= 3) orParts.push(`email.ilike.%${email}%`)
      if (phone.length >= 5) orParts.push(`phone.ilike.%${phone.replace(/\D/g,'')}%`)
      if (!orParts.length) return
      const { data } = await supabase.from('clients').select('id, type, name, fname, lname, email, phone, created_at').or(orParts.join(',')).limit(5)
      setMatches((data || []) as Client[])
    }, 300)
    return () => clearTimeout(searchDebounce.current)
  }, [fname, lname, email, phone, company, isLabel])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setSaveError('')

    // Final duplicate check on exact email/phone (unless user already chose to force-create)
    if (!forceCreate && (email.trim() || phone.trim())) {
      const orParts: string[] = []
      if (email.trim()) orParts.push(`email.eq.${email.trim()}`)
      if (phone.trim()) orParts.push(`phone.eq.${phone.trim()}`)
      const { data: exactMatches } = await supabase.from('clients').select('id, type, name, fname, lname, email, phone').or(orParts.join(',')).limit(1)
      if (exactMatches && exactMatches.length > 0) {
        setDupTarget(exactMatches[0] as Client)
        setShowDupModal(true)
        setSaving(false)
        return
      }
    }

    const clientId = crypto.randomUUID()
    const name = isLabel
      ? (company.trim() || `${fname} ${lname}`.trim())
      : `${fname} ${lname}`.trim() || fname.trim() || lname.trim()

    const { error } = await supabase.from('clients').insert({
      id: clientId, type,
      name: name || 'Unknown',
      fname: fname || null, lname: lname || null,
      email: email || null, phone: phone || null,
      instagram: instagram || null,
      address_street: addrStreet || null,
      address_city: addrCity || null,
      address_state: addrState || null,
      address_zip: addrZip || null,
      artists: artist ? [artist] : [],
      notes: notes || null,
      created_at: new Date().toISOString(),
    })
    if (error) { setSaveError(error.message); setSaving(false); return }
    onCreated(clientId)
  }

  // Carved shell + fields (2026-08-24) — same recipes as the New Lead modal
  // (c-modal-backdrop + c-sheet, Archivo header, wash pill inputs, 10px/800
  // uppercase labels). The old Syne/1px-border skin was the last pre-carved
  // surface on the clients tab.
  const overlay: React.CSSProperties = { zIndex: 3000, paddingTop: 64 }
  const modal: React.CSSProperties = { width: 500, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }
  const fL: React.CSSProperties = { fontSize: 10, fontWeight: 800, color: 'var(--c-fg-3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5, display: 'block' }
  const inp: React.CSSProperties = { width: '100%', background: 'var(--c-wash)', color: 'var(--c-fg)', padding: '10px 16px', borderRadius: 99, fontFamily: 'Inter', fontSize: 12, outline: 'none', boxSizing: 'border-box' }
  // A label can be created from the parent company name ALONE — the A&R contact
  // and its email/phone are optional, because labels are routinely opened before
  // anyone knows which A&R will run the project (contacts get added per-A&R on
  // the profile later). An individual still needs a name plus a way to reach them.
  const valid = isLabel
    ? !!company.trim()
    : !!(fname.trim() || lname.trim()) && !!(email.trim() || phone.trim())

  return (
    <>
      <div className="c-modal-backdrop" style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="c-sheet" style={modal}>
          {/* Header */}
          <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: 'var(--c-bg)' }}>
            <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 15 }}>New Client</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--c-fg-3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>

          {/* Body */}
          <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Type toggle — one housing, selected segment presses in (§8). */}
            <div>
              <label style={fL}>Account Type</label>
              <div className="c-seg" style={{ display: 'flex', width: '100%' }}>
                {(['individual', 'label'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={type === t ? 'c-on' : ''}
                    style={{ flex: 1, padding: '7px 0', cursor: 'pointer' }}
                  >
                    {t === 'label' ? 'Label / Billing' : 'COD'}
                  </button>
                ))}
              </div>
            </div>

            {/* Label name */}
            {isLabel && (
              <div>
                <label style={fL}>Label / Company</label>
                <input style={inp} value={company} onChange={e => setCompany(e.target.value)} placeholder="Label or company name" />
              </div>
            )}

            {/* Name */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={fL}>{isLabel ? 'A&R First Name (optional)' : 'First Name'}</label>
                <input style={inp} value={fname} onChange={e => setFname(e.target.value)} placeholder="First" />
              </div>
              <div>
                <label style={fL}>{isLabel ? 'A&R Last Name (optional)' : 'Last Name'}</label>
                <input style={inp} value={lname} onChange={e => setLname(e.target.value)} placeholder="Last" />
              </div>
            </div>

            {/* Email + Phone */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={fL}>Email</label>
                <input style={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="email@..." type="email" />
              </div>
              <div>
                <label style={fL}>Phone</label>
                <input style={inp} value={phone} onChange={e => setPhone(e.target.value)} placeholder="000-000-0000" />
              </div>
            </div>

            {/* Instagram */}
            <div>
              <label style={fL}>Instagram</label>
              <input style={inp} value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@handle" />
            </div>

            {/* Artist — both types (COD gained it 2026-08-24; the insert always
                wrote clients.artists, only this gate hid the field for COD). */}
            <div>
              <label style={fL}>Artist</label>
              <input style={inp} value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist name" />
            </div>

            {/* Address */}
            <div>
              <label style={fL}>Address</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input style={inp} value={addrStreet} onChange={e => setAddrStreet(e.target.value)} placeholder="Street address" />
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 6 }}>
                  <input style={inp} value={addrCity} onChange={e => setAddrCity(e.target.value)} placeholder="City" />
                  <input style={inp} value={addrState} onChange={e => setAddrState(e.target.value)} placeholder="State" />
                  <input style={inp} value={addrZip} onChange={e => setAddrZip(e.target.value)} placeholder="ZIP" />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label style={fL}>Notes</label>
              <textarea style={{ ...inp, height: 60, resize: 'vertical' as const, lineHeight: 1.5 }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes..." />
            </div>

            {/* Duplicate suggestions */}
            {matches.length > 0 && !forceCreate && (
              <div style={{ background: 'color-mix(in srgb, var(--c-st-warm) 9%, transparent)', borderRadius: 12, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-st-warm)', marginBottom: 8 }}>
                  Possible Duplicates
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {matches.map(m => (
                    <div key={m.id} onClick={() => { setDupTarget(m); setShowDupModal(true) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 11px', background: 'var(--c-wash)', borderRadius: 9, cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg)' }}>{m.name || [m.fname, m.lname].filter(Boolean).join(' ')}</div>
                        <div style={{ fontSize: 9, fontFamily: 'Inter', color: 'var(--c-fg-3)', marginTop: 1 }}>{[m.email, m.phone].filter(Boolean).join(' · ')}</div>
                      </div>
                      <span style={{ fontSize: 9, color: 'var(--c-st-warm)', fontFamily: 'Inter' }}>view →</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {saveError && (
              <div style={{ fontSize: 11, color: 'var(--c-st-hot)', fontFamily: 'Inter' }}>
                {saveError}
              </div>
            )}
          </div>

          {/* Footer — the New Lead recipe: full-width primary + quiet Cancel. */}
          <div style={{ padding: '12px 20px 20px', flexShrink: 0, background: 'var(--c-bg)' }}>
            {matches.length > 0 && !forceCreate && (
              <button onClick={() => setForceCreate(true)} style={{ marginBottom: 8, fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                Create anyway
              </button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSave}
                disabled={!valid || saving}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 6, border: 'none',
                  fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11,
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  cursor: (valid && !saving) ? 'pointer' : 'default',
                  background: valid ? 'var(--c-fg)' : 'var(--c-wash2)',
                  color: valid ? 'var(--c-bg)' : 'var(--c-fg-3)',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Creating…' : 'Create Client'}
              </button>
              <button onClick={onClose} style={{ padding: '9px 20px', background: 'transparent', border: 'none', color: 'var(--c-fg-2)', borderRadius: 6, fontFamily: 'Inter', fontSize: 11, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Duplicate exists modal */}
      {showDupModal && dupTarget && (
        <div className="c-modal-backdrop" style={{ zIndex: 4000 }}>
          <div style={{ background: 'var(--c-wash)', borderRadius: 10, padding: '24px 28px', width: 380, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 13, color: 'var(--c-st-warm)', marginBottom: 8 }}>Client Already Exists</div>
            <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--c-fg)', marginBottom: 3 }}>{dupTarget.name || [dupTarget.fname, dupTarget.lname].filter(Boolean).join(' ')}</div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--c-fg-3)', marginBottom: 18 }}>{[dupTarget.email, dupTarget.phone].filter(Boolean).join(' · ')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={() => onCreated(dupTarget.id)} style={{ padding: '9px 0', background: 'var(--c-fg)', color: 'var(--c-bg)', border: 'none', borderRadius: 6, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer' }}>
                Open Existing Profile
              </button>
              <button onClick={() => { setShowDupModal(false); setForceCreate(true) }} style={{ padding: '8px 0', background: 'var(--c-wash2)', border: 'none', color: 'var(--c-fg-2)', borderRadius: 6, fontFamily: 'Inter', fontSize: 10, cursor: 'pointer' }}>
                Create Duplicate Anyway
              </button>
              <button onClick={() => setShowDupModal(false)} style={{ padding: '6px 0', background: 'none', border: 'none', color: 'var(--c-fg-3)', fontFamily: 'Inter', fontSize: 10, cursor: 'pointer' }}>
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
