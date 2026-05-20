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

export default function ClientsPage() {
  return (
    <Suspense>
      <ClientsPageInner />
    </Suspense>
  )
}

function ClientsPageInner() {
  const [clients, setClients] = useState<Client[]>([])
  const [contactsMap, setContactsMap] = useState<ContactsMap>({})
  const [bookingCountMap, setBookingCountMap] = useState<BookingCountMap>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingRegs, setPendingRegs] = useState<PendingReg[]>([])
  const [regModalOpen, setRegModalOpen] = useState(false)
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
      supabase.from('client_contacts').select('id, client_id, fname, lname, email, phone, instagram, role, notes'),
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

  // Auto-select: prefer ?id= param, otherwise fall back to first client
  useEffect(() => {
    if (loading || hasAutoSelected.current || clients.length === 0) return
    if (idParam && clients.some(c => c.id === idParam)) {
      setSelectedId(idParam)
    } else {
      setSelectedId(clients[0].id)
    }
    hasAutoSelected.current = true
  }, [loading, clients, idParam])

  const selected = clients.find(c => c.id === selectedId) || null

  function handleNavigateToClient(id: string) {
    setPendingRegs(prev => prev.filter(r => r.id !== id))
    setSelectedId(id)
    setRegModalOpen(false)
    router.replace(`/clients?id=${id}`)
  }

  const showList = !isMobile || !selectedId
  const showProfile = !isMobile || !!selectedId

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px - 24px)' }}>

      {/* Registration notification banner */}
      {pendingRegs.length > 0 && (
        <div
          onClick={() => setRegModalOpen(true)}
          style={{
            marginBottom: 12, padding: '10px 16px', flexShrink: 0,
            background: 'rgba(200,240,78,0.08)', border: '1px solid rgba(200,240,78,0.3)',
            borderRadius: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <span style={{ fontSize: 16 }}>↗</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.06em' }}>
              {pendingRegs.length} new registration{pendingRegs.length !== 1 ? 's' : ''} need{pendingRegs.length === 1 ? 's' : ''} review
            </span>
            <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', marginTop: 1 }}>
              Click to confirm client profiles
            </div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'DM Mono' }}>Review →</span>
        </div>
      )}

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
        const { data } = await supabase.storage.from('client-ids').createSignedUrl(reg.id_file_url, 3600)
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
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', marginTop: 2 }}>
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
                          <span style={{ fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)', textAlign: 'center' as const }}>No ID{'\n'}uploaded</span>
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
                        <div style={{ textAlign: 'center' as const, marginTop: 4, fontSize: 8, color: 'var(--text3)', fontFamily: 'DM Mono' }}>tap to enlarge</div>
                      )}
                    </div>

                    {/* Identity + contact */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'DM Serif Display', fontSize: 18, lineHeight: 1.2, marginBottom: 6 }}>{reg.name}</div>
                      <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)', lineHeight: 1.8 }}>
                        {reg.email && <div>{reg.email}</div>}
                        {reg.phone && <div>{reg.phone}</div>}
                        {reg.instagram && <div>@{reg.instagram.replace(/^@/, '')}</div>}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 9, fontFamily: 'DM Mono', color: 'var(--text3)' }}>
                        Registered {regDate}
                      </div>
                    </div>
                  </div>

                  {/* Address + how heard */}
                  {(addressLine || cityLine || reg.how_heard) && (
                    <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.15)' }}>
                      {(addressLine || cityLine) && (
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)', lineHeight: 1.6, marginBottom: reg.how_heard ? 6 : 0 }}>
                          {addressLine && <div>{addressLine}</div>}
                          {cityLine && <div>{cityLine}</div>}
                        </div>
                      )}
                      {reg.how_heard && (
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text3)' }}>
                          How heard: <span style={{ color: 'var(--text2)' }}>{reg.how_heard}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Footer: badges + confirm button */}
                  <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' as const }}>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
                      {reg.terms_accepted && (
                        <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--booked)', background: 'rgba(78,240,162,0.1)', border: '1px solid rgba(78,240,162,0.3)', padding: '2px 6px', borderRadius: 3 }}>
                          TERMS ACCEPTED
                        </span>
                      )}
                      {reg.id_file_url ? (
                        <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent)', background: 'rgba(200,240,78,0.08)', border: '1px solid rgba(200,240,78,0.25)', padding: '2px 6px', borderRadius: 3 }}>
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
                      style={{ background: 'var(--accent)', color: '#0d0f14', border: 'none', borderRadius: 5, padding: '7px 16px', fontFamily: 'Syne', fontWeight: 700, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' as const, cursor: isConfirming ? 'default' : 'pointer', opacity: isConfirming ? 0.7 : 1, flexShrink: 0 }}
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
            <button onClick={() => setLightboxUrl(null)} style={{ position: 'absolute', top: -16, right: -16, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, fontFamily: 'DM Mono', flexShrink: 0 }}>×</button>
          </div>
        </div>
      )}
    </>
  )
}
