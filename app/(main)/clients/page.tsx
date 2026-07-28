'use client'
import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase, Client, ClientContact } from '@/lib/supabase'
import { ClientList, BookingCountMap, ContactsMap } from '@/components/clients/ClientList'
import { ClientProfile } from '@/components/clients/ClientProfile'

interface PendingReg {
  id: string
  name: string
  email: string | null
  phone: string | null
  instagram: string | null
  how_heard: string | null
  address_street: string | null
  address_street2: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  registered_at: string
  id_file_url: string | null
  terms_accepted: boolean | null
}

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
  const [pendingRegs, setPendingRegs] = useState<PendingReg[]>([])
  const [regModalOpen, setRegModalOpen] = useState(false)
  const [newClientOpen, setNewClientOpen] = useState(() => {
    try { return !!sessionStorage.getItem('clients_new_draft') } catch { return false }
  })
  const [isMobile, setIsMobile] = useState(false)
  const hasAutoSelected = useRef(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const idParam = searchParams.get('id')

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 600) }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const load = useCallback(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const [
      { data: clientsData },
      { data: contactsData },
      { data: bookingData },
      { data: regData },
    ] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('client_contacts').select('id, client_id, fname, lname, email, phone, instagram, role, notes, artists, contact_type'),
      supabase.from('leads').select('client_id').not('client_id', 'is', null),
      supabase.from('clients')
        .select('id, name, email, phone, instagram, how_heard, address_street, address_street2, address_city, address_state, address_zip, registered_at, id_file_url, terms_accepted')
        .not('registered_at', 'is', null)
        .is('profile_confirmed_at', null)
        .gt('registered_at', thirtyDaysAgo)
        .order('registered_at', { ascending: false }),
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
    setPendingRegs((regData || []) as PendingReg[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Real-time: re-fetch the client list live when clients/contacts change elsewhere.
  useEffect(() => {
    const channel = supabase
      .channel('clients-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => { load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_contacts' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  // Auto-select: prefer initialClientId prop or ?id= param, otherwise fall back to first client
  useEffect(() => {
    if (loading || hasAutoSelected.current || clients.length === 0) return
    const targetId = initialClientId || idParam
    if (targetId && clients.some(c => c.id === targetId)) {
      setSelectedId(targetId)
    } else {
      setSelectedId(clients[0].id)
    }
    hasAutoSelected.current = true
  }, [loading, clients, idParam, initialClientId])

  const selected = clients.find(c => c.id === selectedId) || null

  async function handleNavigateToClient(id: string) {
    setPendingRegs(prev => prev.filter(r => r.id !== id))
    setSelectedId(id)
    setRegModalOpen(false)
    router.replace(`/crm?clientId=${id}`)
    await supabase
      .from('registration_tokens')
      .update({ registration_reviewed: true })
      .eq('client_id', id)
      .eq('registration_reviewed', false)
  }

  const showList = !isMobile || !selectedId
  const showProfile = !isMobile || !!selectedId

  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...(embedded ? { flex: 1, minHeight: 0 } : { height: 'calc(100vh - 52px - 24px)' }) }}>

      {/* Registration notification banner */}
      {pendingRegs.length > 0 && (
        <div
          onClick={() => setRegModalOpen(true)}
          style={{
            marginBottom: 12, padding: '10px 16px', flexShrink: 0,
            background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.3)',
            borderRadius: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <span style={{ fontSize: 16 }}>↗</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.06em' }}>
              {pendingRegs.length} new registration{pendingRegs.length !== 1 ? 's' : ''} need{pendingRegs.length === 1 ? 's' : ''} review
            </span>
            <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'Inter', marginTop: 1 }}>
              Click to confirm client profiles
            </div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'Inter' }}>Review →</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexShrink: 0 }}>
        <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)' }}>
          Clients
        </div>
        <button
          onClick={() => setNewClientOpen(true)}
          style={{ padding: '5px 12px', background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'Syne', fontWeight: 700, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}
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

      {regModalOpen && (
        <RegistrationReviewModal
          regs={pendingRegs}
          onClose={() => setRegModalOpen(false)}
          onNavigate={handleNavigateToClient}
        />
      )}

      {newClientOpen && (
        <NewClientModal
          onClose={() => { try { sessionStorage.removeItem('clients_new_draft') } catch {} setNewClientOpen(false) }}
          onCreated={(id) => { try { sessionStorage.removeItem('clients_new_draft') } catch {} setNewClientOpen(false); load().then(() => setSelectedId(id)) }}
        />
      )}
    </div>
  )
}

// ─── Registration review modal ────────────────────────────────────────────────

function isImagePath(path: string | null): boolean {
  if (!path) return false
  return /\.(jpg|jpeg|png|heic|webp)$/i.test(path)
}

function RegistrationReviewModal({ regs, onClose, onNavigate }: {
  regs: PendingReg[]
  onClose: () => void
  onNavigate: (id: string) => void
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  useEffect(() => {
    async function fetchSignedUrls() {
      const map: Record<string, string> = {}
      for (const reg of regs) {
        if (!reg.id_file_url) continue
        const { data, error } = await supabase.storage.from('client-ids').createSignedUrl(reg.id_file_url, 3600)
        if (error) console.error('[client-ids] signed URL failed for', reg.id_file_url, error.message)
        if (data?.signedUrl) map[reg.id] = data.signedUrl
      }
      setSignedUrls(map)
    }
    fetchSignedUrls()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function confirm(id: string) {
    setConfirmingId(id)
    await supabase.from('clients').update({ profile_confirmed_at: new Date().toISOString() }).eq('id', id)
    setConfirmingId(null)
    onNavigate(id)
  }

  const ghostBtn: React.CSSProperties = {
    background: 'none', border: '1px solid var(--border)', color: 'var(--text2)',
    borderRadius: 6, padding: '7px 16px', fontFamily: 'Syne', fontWeight: 700,
    fontSize: 10, letterSpacing: '0.06em', cursor: 'pointer',
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 580, maxHeight: '88vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>

          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
            <div>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15 }}>New Registrations</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'Inter', marginTop: 2 }}>
                {regs.length} pending — review ID and confirm to create client profile
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>

          {/* Registration cards */}
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {regs.map(reg => {
              const isConfirming = confirmingId === reg.id
              const regDate = new Date(reg.registered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              const signedUrl = signedUrls[reg.id]
              const hasImage = reg.id_file_url && isImagePath(reg.id_file_url)
              const hasPdf = reg.id_file_url && !isImagePath(reg.id_file_url)

              const addressLine = [reg.address_street, reg.address_street2].filter(Boolean).join(', ')
              const cityLine = [reg.address_city, [reg.address_state, reg.address_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')

              return (
                <div key={reg.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>

                  {/* Top: ID thumb + identity */}
                  <div style={{ display: 'flex', gap: 14, padding: '14px 14px 12px' }}>
                    {/* ID thumbnail — always shown */}
                    <div style={{ flexShrink: 0 }}>
                      {!reg.id_file_url ? (
                        <div style={{ width: 80, height: 80, borderRadius: 7, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <span style={{ fontSize: 22, opacity: 0.25 }}>🪪</span>
                          <span style={{ fontSize: 8, fontFamily: 'Inter', color: 'var(--text3)', textAlign: 'center' as const }}>No ID{'\n'}uploaded</span>
                        </div>
                      ) : hasImage && signedUrl ? (
                        <img
                          src={signedUrl}
                          onClick={() => setLightboxUrl(signedUrl)}
                          title="Click to view full size"
                          style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 7, cursor: 'pointer', border: '1px solid var(--border)', display: 'block' }}
                        />
                      ) : hasImage && !signedUrl ? (
                        <div style={{ width: 80, height: 80, borderRadius: 7, background: 'var(--surface)', border: '1px solid var(--border)', animation: 'shimmer 1.4s ease-in-out infinite' }} />
                      ) : hasPdf && signedUrl ? (
                        <a href={signedUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 80, height: 80, borderRadius: 7, background: 'var(--surface)', border: '1px solid var(--border)', textDecoration: 'none', gap: 4 }}>
                          <span style={{ fontSize: 24 }}>📄</span>
                          <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.06em' }}>PDF — tap to open</span>
                        </a>
                      ) : (
                        <div style={{ width: 80, height: 80, borderRadius: 7, background: 'var(--surface)', border: '1px solid var(--border)', animation: 'shimmer 1.4s ease-in-out infinite' }} />
                      )}
                      {hasImage && signedUrl && (
                        <div style={{ textAlign: 'center' as const, marginTop: 4, fontSize: 8, color: 'var(--text3)', fontFamily: 'Inter' }}>tap to enlarge</div>
                      )}
                    </div>

                    {/* Identity + contact */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'DM Serif Display', fontSize: 18, lineHeight: 1.2, marginBottom: 6 }}>{reg.name}</div>
                      <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.8 }}>
                        {reg.email && <div>{reg.email}</div>}
                        {reg.phone && <div>{reg.phone}</div>}
                        {reg.instagram && <div>@{reg.instagram.replace(/^@/, '')}</div>}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 9, fontFamily: 'Inter', color: 'var(--text3)' }}>
                        Registered {regDate}
                      </div>
                    </div>
                  </div>

                  {/* Address + how heard */}
                  {(addressLine || cityLine || reg.how_heard) && (
                    <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.15)' }}>
                      {(addressLine || cityLine) && (
                        <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.6, marginBottom: reg.how_heard ? 6 : 0 }}>
                          {addressLine && <div>{addressLine}</div>}
                          {cityLine && <div>{cityLine}</div>}
                        </div>
                      )}
                      {reg.how_heard && (
                        <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text3)' }}>
                          How heard: <span style={{ color: 'var(--text2)' }}>{reg.how_heard}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Footer: badges + confirm button */}
                  <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' as const }}>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
                      {reg.terms_accepted && (
                        <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--booked)', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)', padding: '2px 6px', borderRadius: 3 }}>
                          TERMS ACCEPTED
                        </span>
                      )}
                      {reg.id_file_url ? (
                        <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent)', background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.25)', padding: '2px 6px', borderRadius: 3 }}>
                          ID ON FILE
                        </span>
                      ) : (
                        <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text3)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '2px 6px', borderRadius: 3 }}>
                          NO ID
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => confirm(reg.id)}
                      disabled={isConfirming}
                      style={{ background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 5, padding: '7px 16px', fontFamily: 'Syne', fontWeight: 700, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' as const, cursor: isConfirming ? 'default' : 'pointer', opacity: isConfirming ? 0.7 : 1, flexShrink: 0 }}
                    >
                      {isConfirming ? 'Creating…' : 'Create Client Profile →'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={ghostBtn}>Close</button>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div onClick={() => setLightboxUrl(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '92vw', maxHeight: '90vh' }}>
            <img src={lightboxUrl} alt="ID document" style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, display: 'block' }} />
            <button onClick={() => setLightboxUrl(null)} style={{ position: 'absolute', top: -16, right: -16, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, fontFamily: 'Inter', flexShrink: 0 }}>×</button>
          </div>
        </div>
      )}
    </>
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
    const hasQuery = query.length >= 3 || email.length >= 3 || phone.length >= 5
    if (!hasQuery) { setMatches([]); return }
    searchDebounce.current = setTimeout(async () => {
      const orParts: string[] = []
      if (query.length >= 3) {
        const words = query.split(' ').filter(Boolean)
        if (words[0]) orParts.push(`name.ilike.%${words[0]}%`, `fname.ilike.%${words[0]}%`, `lname.ilike.%${words[0]}%`)
        if (words[1]) orParts.push(`lname.ilike.%${words[1]}%`)
      }
      if (email.length >= 3) orParts.push(`email.ilike.%${email}%`)
      if (phone.length >= 5) orParts.push(`phone.ilike.%${phone.replace(/\D/g,'')}%`)
      if (!orParts.length) return
      const { data } = await supabase.from('clients').select('id, type, name, fname, lname, email, phone, created_at').or(orParts.join(',')).limit(5)
      setMatches((data || []) as Client[])
    }, 300)
    return () => clearTimeout(searchDebounce.current)
  }, [fname, lname, email, phone])

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

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }
  const modal: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, width: '100%', maxWidth: 500, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
  const fL: React.CSSProperties = { fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 3, display: 'block' }
  const inp: React.CSSProperties = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontFamily: 'Inter', fontSize: 11, padding: '6px 9px', outline: 'none', boxSizing: 'border-box' }
  const valid = (fname.trim() || lname.trim() || (isLabel && company.trim())) && (email.trim() || phone.trim())

  return (
    <>
      <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={modal}>
          {/* Header */}
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ fontFamily: 'DM Serif Display', fontSize: 18, color: 'var(--text)' }}>New Client</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>

          {/* Body */}
          <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Type toggle */}
            <div>
              <label style={fL}>Account Type</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['individual', 'label'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setType(t)} style={{
                    flex: 1, padding: '6px 0', borderRadius: 5, fontSize: 10,
                    fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                    cursor: 'pointer',
                    background: type === t ? 'rgba(139,144,168,0.12)' : 'var(--surface2)',
                    color: type === t ? 'var(--text)' : 'var(--text3)',
                    border: '1px solid var(--border)',
                  }}>
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
                <label style={fL}>{isLabel ? 'A&R First Name' : 'First Name'}</label>
                <input style={inp} value={fname} onChange={e => setFname(e.target.value)} placeholder="First" />
              </div>
              <div>
                <label style={fL}>{isLabel ? 'A&R Last Name' : 'Last Name'}</label>
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

            {/* Artist — label only */}
            {isLabel && (
              <div>
                <label style={fL}>Artist</label>
                <input style={inp} value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist name" />
              </div>
            )}

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
              <div style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--warm)', marginBottom: 8 }}>
                  Possible Duplicates
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {matches.map(m => (
                    <div key={m.id} onClick={() => { setDupTarget(m); setShowDupModal(true) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--text)' }}>{m.name || [m.fname, m.lname].filter(Boolean).join(' ')}</div>
                        <div style={{ fontSize: 9, fontFamily: 'Inter', color: 'var(--text3)', marginTop: 1 }}>{[m.email, m.phone].filter(Boolean).join(' · ')}</div>
                      </div>
                      <span style={{ fontSize: 9, color: 'var(--warm)', fontFamily: 'Inter' }}>view →</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {saveError && (
              <div style={{ fontSize: 10, color: 'var(--hot)', fontFamily: 'Inter', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4 }}>
                {saveError}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {matches.length > 0 && !forceCreate ? (
              <button onClick={() => setForceCreate(true)} style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', textDecoration: 'underline' }}>
                Create anyway
              </button>
            ) : <div />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '7px 16px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 5, fontFamily: 'Inter', fontSize: 11, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!valid || saving}
                style={{
                  padding: '7px 18px', borderRadius: 5, fontFamily: 'Syne', fontWeight: 700,
                  fontSize: 11, letterSpacing: '0.05em', border: 'none',
                  cursor: (valid && !saving) ? 'pointer' : 'default',
                  background: valid ? 'var(--accent)' : 'var(--surface2)',
                  color: valid ? 'var(--bg)' : 'var(--text3)',
                }}
              >
                {saving ? 'Creating…' : 'Create Client'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Duplicate exists modal */}
      {showDupModal && dupTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, width: '100%', maxWidth: 380, padding: '20px' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 12, color: 'var(--warm)', marginBottom: 6 }}>Client Already Exists</div>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text)', marginBottom: 4 }}>{dupTarget.name || [dupTarget.fname, dupTarget.lname].filter(Boolean).join(' ')}</div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--text3)', marginBottom: 16 }}>{[dupTarget.email, dupTarget.phone].filter(Boolean).join(' · ')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={() => onCreated(dupTarget.id)} style={{ padding: '8px 0', background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 5, fontFamily: 'Syne', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', cursor: 'pointer' }}>
                Open Existing Profile
              </button>
              <button onClick={() => { setShowDupModal(false); setForceCreate(true) }} style={{ padding: '8px 0', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 5, fontFamily: 'Inter', fontSize: 10, cursor: 'pointer' }}>
                Create Duplicate Anyway
              </button>
              <button onClick={() => setShowDupModal(false)} style={{ padding: '6px 0', background: 'none', border: 'none', color: 'var(--text3)', fontFamily: 'Inter', fontSize: 10, cursor: 'pointer' }}>
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
