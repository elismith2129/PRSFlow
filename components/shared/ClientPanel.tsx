'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Client, ClientContact } from '@/lib/supabase'
import { addArtistToLabel } from '@/lib/roster'
import { ClientProfile } from '@/components/clients/ClientProfile'

// ─────────────────────────────────────────────────────────────────────────────
// ClientPanel — the unified client identity + contact block.
//
// The rich client UI (SRS toggle · COD/Label-Billing toggle · client search +
// autofill · client card with artist / A&R / admin contacts · view-full-profile)
// lifted out of BookingForm into a self-contained, reusable component so it can
// live at the top of the Work Order (the single source of truth). See
// docs/WO-SPEC.md §3a. Manages all its own search / roster / contact state and
// emits only the client-subset of session fields via `onChange`.
// ─────────────────────────────────────────────────────────────────────────────

export type ClientPanelValue = {
  payment_type: string // 'COD' | 'billing'
  cod_method: string
  client_name: string
  artist: string
  label: string
  ordered_by: string
  phone: string
  email: string
  client_db_id: string | null
  is_srs: boolean
  anr_contact_id: string | null
  anr_admin_contact_id: string | null
}

export function emptyClientValue(overrides: Partial<ClientPanelValue> = {}): ClientPanelValue {
  return {
    payment_type: 'COD', cod_method: '',
    client_name: '', artist: '', label: '', ordered_by: '',
    phone: '', email: '', client_db_id: null, is_srs: false,
    anr_contact_id: null, anr_admin_contact_id: null,
    ...overrides,
  }
}

const COD_METHODS = ['Cash', 'Credit Card', 'Zelle', 'Check', 'Venmo']

const fL: React.CSSProperties = {
  fontSize: 9, color: 'var(--c-fg-3)', letterSpacing: '0.08em',
  textTransform: 'uppercase', marginBottom: 3, display: 'block',
}

// ─── Client profile popup (view full profile) ─────────────────────────────────

function ClientProfilePopup({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [client, setClient] = useState<Client | null>(null)
  const [contacts, setContacts] = useState<ClientContact[]>([])
  const [bookingCount, setBookingCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [{ data: c }, { data: ct }, { count }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('client_contacts').select('*').eq('client_id', clientId),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('status', 'booked'),
    ])
    setClient(c as Client | null)
    setContacts((ct as ClientContact[]) || [])
    setBookingCount(count ?? 0)
    setLoading(false)
  }, [clientId])

  useEffect(() => { load() }, [load])

  return (
    <div
      style={{ position: 'fixed', top: 52, left: 0, right: 0, bottom: 0, zIndex: 2000, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', borderRadius: 10, overflow: 'hidden' }}>
        <ClientProfile client={client} contacts={contacts} bookingCount={bookingCount} loading={loading} onRefresh={load} onBack={onClose} />
      </div>
    </div>
  )
}

// ─── Client card field (COD email/phone) ──────────────────────────────────────

function ClientCardField({ label, value, fieldKey, onEdit }: {
  label: string; value: string; fieldKey: string; onEdit: (fieldKey: string, value: string) => void
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 2 }}>{label}</div>
      <div className="c-well">
        <input
          type="text" value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={() => { if (local !== value) onEdit(fieldKey, local) }}
        />
      </div>
    </div>
  )
}

// ─── ClientPanel ──────────────────────────────────────────────────────────────

export function ClientPanel({
  value, onChange, readOnly = false,
}: {
  value: ClientPanelValue
  onChange: (patch: Partial<ClientPanelValue>) => void
  readOnly?: boolean
}) {
  const set = <K extends keyof ClientPanelValue>(k: K, v: ClientPanelValue[K]) => onChange({ [k]: v })

  const [searchQuery, setSearchQuery] = useState('')
  const [clientSuggestions, setClientSuggestions] = useState<Array<{ id: string; label: string; sub: string; isLabel: boolean; record: any }>>([])
  const [showClientDD, setShowClientDD] = useState(false)
  const [clientHighlight, setClientHighlight] = useState(-1)

  const [clientArtists, setClientArtists] = useState<string[]>([])
  const [showArtistDD, setShowArtistDD] = useState(false)
  const [labelContacts, setLabelContacts] = useState<ClientContact[]>([])
  const [labelAdminContacts, setLabelAdminContacts] = useState<ClientContact[]>([])

  const [anrQuery, setAnrQuery] = useState(value.ordered_by || '')
  const [anrContact, setAnrContact] = useState<ClientContact | null>(null)
  const [anrEmail, setAnrEmail] = useState('')
  const [anrPhone, setAnrPhone] = useState('')
  const [showAnrDD, setShowAnrDD] = useState(false)

  const [adminQuery, setAdminQuery] = useState('')
  const [adminContact, setAdminContact] = useState<ClientContact | null>(null)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPhone, setAdminPhone] = useState('')
  const [showAdminDD, setShowAdminDD] = useState(false)

  const [showSrsModal, setShowSrsModal] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [contactUpdatePrompt, setContactUpdatePrompt] = useState<{
    contactId: string; column: 'email' | 'phone'; value: string; onUpdate: () => void
  } | null>(null)

  const isBilling = value.payment_type === 'billing'
  const hasClient = isBilling ? !!(value.label || value.client_name) : !!value.client_name

  // Load label roster + contacts (A&Rs + Admins) for billing clients.
  useEffect(() => {
    const id = value.client_db_id
    if (!id || value.payment_type !== 'billing') {
      setLabelContacts([]); setLabelAdminContacts([]); setClientArtists([]); return
    }
    Promise.all([
      supabase.from('client_contacts').select('*').eq('client_id', id),
      supabase.from('clients').select('artists').eq('id', id).single(),
    ]).then(([{ data: contacts }, { data: client }]) => {
      const all = (contacts as ClientContact[]) || []
      const anrs = all.filter(c => c.contact_type !== 'admin')
      const admins = all.filter(c => c.contact_type === 'admin')
      setLabelContacts(anrs)
      setLabelAdminContacts(admins)
      setClientArtists((client?.artists as string[]) || [])
      if (value.anr_contact_id) {
        const found = all.find(c => c.id === value.anr_contact_id)
        if (found) { setAnrContact(found); setAnrEmail(found.email || ''); setAnrPhone(found.phone || '') }
      }
      if (value.anr_admin_contact_id) {
        const found = admins.find(c => c.id === value.anr_admin_contact_id)
        if (found) { setAdminContact(found); setAdminQuery(`${found.fname || ''} ${found.lname || ''}`.trim()); setAdminEmail(found.email || ''); setAdminPhone(found.phone || ''); return }
      }
      // No admin chosen yet — auto-pick from most recent booking, else the single admin.
      if (!value.anr_admin_contact_id) {
        supabase.from('bookings')
          .select('anr_admin_contact_id')
          .eq('client_id', id)
          .not('anr_admin_contact_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .then(({ data: recent }) => {
            const recentId = (recent as any)?.[0]?.anr_admin_contact_id
            const fromHistory = recentId ? admins.find(c => c.id === recentId) : null
            const autoAdmin = fromHistory || (admins.length === 1 ? admins[0] : null)
            if (autoAdmin) {
              setAdminContact(autoAdmin)
              setAdminQuery(`${autoAdmin.fname || ''} ${autoAdmin.lname || ''}`.trim())
              setAdminEmail(autoAdmin.email || '')
              setAdminPhone(autoAdmin.phone || '')
              set('anr_admin_contact_id', autoAdmin.id)
            }
          })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.client_db_id, value.payment_type])

  // Client search — clients by name, A&R contacts by name, artist-name matches.
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) { setClientSuggestions([]); setShowClientDD(false); return }
    const t = setTimeout(async () => {
      const [{ data: cd }, { data: ctd }, { data: ald }] = await Promise.all([
        supabase.from('clients')
          .select('id,type,name,fname,lname,email,phone,artists,srs_client')
          .or(`name.ilike.%${q}%,fname.ilike.%${q}%,lname.ilike.%${q}%`)
          .limit(30),
        supabase.from('client_contacts')
          .select('id,client_id,fname,lname,email,phone,clients(id,name,type,srs_client)')
          .or(`fname.ilike.%${q}%,lname.ilike.%${q}%`)
          .limit(20),
        supabase.from('client_contacts')
          .select('id,client_id,fname,lname,email,phone,artists,contact_type,clients(id,name,type,srs_client)')
          .neq('artists', '{}')
          .limit(100),
      ])

      const seen = new Set<string>()
      const results: typeof clientSuggestions = []

      for (const ct of (ctd || []) as any[]) {
        const parentClient = ct.clients as any
        if (!parentClient) continue
        const personName = `${ct.fname || ''} ${ct.lname || ''}`.trim()
        if (!personName) continue
        const key = `contact-${ct.id}`
        if (seen.has(key)) continue
        seen.add(key)
        results.push({
          id: ct.client_id, label: personName,
          sub: parentClient.type === 'label' ? parentClient.name : '',
          isLabel: parentClient.type === 'label',
          record: { ...parentClient, _anrFname: ct.fname, _anrLname: ct.lname, _anrEmail: ct.email, _anrPhone: ct.phone },
        })
      }

      for (const c of (cd || []) as any[]) {
        const personName = `${c.fname || ''} ${c.lname || ''}`.trim()
        const displayName = personName || c.name || ''
        const key = `client-${c.id}`
        if (seen.has(key)) continue
        seen.add(key)
        results.push({ id: c.id, label: displayName, sub: '', isLabel: c.type === 'label', record: c })
      }

      for (const ct of (ald || []) as any[]) {
        const parentClient = ct.clients as any
        if (!parentClient) continue
        if (ct.contact_type === 'admin') continue
        if (!Array.isArray(ct.artists)) continue
        for (const artistName of ct.artists as string[]) {
          if (typeof artistName !== 'string') continue
          if (!artistName.toLowerCase().includes(q.toLowerCase())) continue
          const key = `artist-${ct.id}-${artistName}`
          if (seen.has(key)) continue
          seen.add(key)
          results.push({
            id: parentClient.id, label: artistName, sub: parentClient.name,
            isLabel: parentClient.type === 'label',
            record: { ...parentClient, _artistMatch: artistName },
          })
        }
      }

      setClientSuggestions(results)
      setShowClientDD(results.length > 0)
    }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  async function applyClientAutofill(s: typeof clientSuggestions[0]) {
    const r = s.record
    const isAnrContact = !!r._anrFname
    const anrName = isAnrContact ? `${r._anrFname || ''} ${r._anrLname || ''}`.trim() : `${r.fname || ''} ${r.lname || ''}`.trim()
    const labelName = r.type === 'label' ? r.name : ''
    const clientName = anrName || (r.type !== 'label' ? r.name : '') || ''
    const email = isAnrContact ? (r._anrEmail || '') : (r.email || '')
    const phone = isAnrContact ? (r._anrPhone || '') : (r.phone || '')
    onChange({
      client_db_id: r.id,
      client_name: clientName,
      label: labelName || value.label,
      ordered_by: labelName ? clientName : value.ordered_by,
      phone: phone || value.phone,
      email: email || value.email,
      payment_type: labelName ? 'billing' : value.payment_type,
      artist: r._artistMatch ? r._artistMatch : (labelName ? '' : ((r.artists && r.artists.length > 0 ? r.artists[0] : value.artist) || value.artist)),
      is_srs: r.srs_client === true ? true : value.is_srs,
    })
    setAnrQuery(labelName ? clientName : '')
    setSearchQuery('')
    setShowClientDD(false)
    setClientHighlight(-1)

    if (r._artistMatch) {
      const { data: contacts } = await supabase.from('client_contacts').select('*').eq('client_id', r.id).or('contact_type.eq.anr,contact_type.is.null')
      const artistLower = (r._artistMatch as string).toLowerCase()
      const matched = ((contacts as ClientContact[]) || []).find(c => Array.isArray(c.artists) && c.artists.some(a => a.toLowerCase() === artistLower))
      if (matched) {
        const nm = `${matched.fname || ''} ${matched.lname || ''}`.trim()
        setAnrQuery(nm); setAnrContact(matched); setAnrEmail(matched.email || ''); setAnrPhone(matched.phone || '')
        onChange({ client_name: nm, ordered_by: nm, anr_contact_id: matched.id, email: matched.email || value.email, phone: matched.phone || value.phone })
      }
    }
  }

  function clearClient() {
    onChange({ client_name: '', artist: '', label: '', ordered_by: '', phone: '', email: '', client_db_id: null, anr_contact_id: null, anr_admin_contact_id: null })
    setClientArtists([]); setLabelContacts([]); setLabelAdminContacts([])
    setAnrQuery(''); setAnrContact(null); setAnrEmail(''); setAnrPhone('')
    setAdminQuery(''); setAdminContact(null); setAdminEmail(''); setAdminPhone('')
    setSearchQuery('')
  }

  function handleClientFieldEdit(fieldKey: string, val: string) {
    if (fieldKey === 'email') set('email', val)
    else if (fieldKey === 'phone') set('phone', val)
  }

  const nameColor = 'var(--c-fg)'
  const badgeLabel = isBilling ? 'LABEL/BILLING' : 'COD'
  const displayName = isBilling ? (value.client_name || value.label) : value.client_name

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ fontSize: 9, color: 'var(--c-fg-3)', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: "'Archivo Black', sans-serif", fontWeight: 700 }}>Client</div>

      {/* SRS + COD / Label-Billing toggle row */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
        {/* SRS is a FLAG, not one of the payment options — it stays its own
            control rather than joining the housing beside it, because a housing
            means "pick one of these" and SRS is orthogonal to COD/Billing.
            Two controls side by side is fine; §8 bars raised INSIDE raised. */}
        <div className="c-seg">
          <button
            type="button"
            disabled={readOnly}
            className={value.is_srs ? 'c-on c-fill-hot' : ''}
            onClick={() => { if (readOnly) return; if (!value.is_srs) setShowSrsModal(true); else set('is_srs', false) }}
            style={{ padding: '6px 18px', cursor: readOnly ? 'default' : 'pointer' }}
          >SRS</button>
        </div>

        {/* ONE housing (§8) — was a flat box holding two flat buttons, which read
            as neither a control nor a container. Selected segment presses in. */}
        <div className="c-seg">
          {(['COD', 'billing'] as const).map(m => (
            <button
              key={m}
              type="button"
              disabled={readOnly}
              className={value.payment_type === m ? 'c-on' : ''}
              onClick={() => { if (readOnly) return; if (m !== value.payment_type) clearClient(); set('payment_type', m) }}
              style={{ padding: '6px 22px', cursor: readOnly ? 'default' : 'pointer' }}
            >{m === 'COD' ? 'COD' : 'Label/Billing'}</button>
          ))}
        </div>
      </div>

      {/* SRS referral modal */}
      {showSrsModal && (
        <div className="c-modal-backdrop" style={{ zIndex: 200 }}>
          <div style={{ background: 'var(--c-wash)', borderRadius: 10, padding: '28px 32px', width: 380, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 15, color: 'var(--c-fg)', marginBottom: 10 }}>SRS Referral</div>
            <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--c-fg-2)', lineHeight: 1.6, marginBottom: 24 }}>
              Apply this to the client&apos;s profile so all future bookings are automatically flagged as SRS?
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { set('is_srs', true); setShowSrsModal(false) }} style={{ padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, background: 'transparent', color: 'var(--c-fg-2)' }}>Just this session</button>
              <button type="button" onClick={async () => { set('is_srs', true); if (value.client_db_id) await supabase.from('clients').update({ srs_client: true }).eq('id', value.client_db_id); setShowSrsModal(false) }} style={{ padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 700, background: 'var(--c-fg)', color: 'var(--c-bg)' }}>Apply to profile</button>
            </div>
          </div>
        </div>
      )}

      {/* Search input — shown when no client attached */}
      {!hasClient && !readOnly && (
        <div style={{ position: 'relative' }}>
          <input
            placeholder={isBilling ? 'Search client, A&R, or artist…' : 'Search client name…'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => searchQuery.trim().length >= 2 && setShowClientDD(true)}
            onBlur={() => setTimeout(() => setShowClientDD(false), 150)}
            onKeyDown={e => {
              if (!showClientDD) return
              if (e.key === 'ArrowDown') { e.preventDefault(); setClientHighlight(h => Math.min(h + 1, clientSuggestions.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setClientHighlight(h => Math.max(h - 1, 0)) }
              if (e.key === 'Enter' && clientHighlight >= 0) { e.preventDefault(); applyClientAutofill(clientSuggestions[clientHighlight]) }
              if (e.key === 'Escape') setShowClientDD(false)
            }}
            className="c-input c-inset2"
            autoComplete="off"
          />
          {showClientDD && clientSuggestions.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--c-bg)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 }}>
              {clientSuggestions.map((s, i) => (
                <div key={i} onMouseDown={() => applyClientAutofill(s)} style={{ padding: '8px 12px', cursor: 'pointer', background: i === clientHighlight ? 'var(--c-wash)' : 'transparent' }}>
                  <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg)' }}>{s.label}</div>
                  {s.sub && <div style={{ fontSize: 9, fontFamily: 'Inter', color: 'var(--c-fg-3)', marginTop: 1 }}>{s.sub}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Client card — shown when a client is attached */}
      {hasClient && (
        <div style={{ background: 'var(--c-wash)', borderRadius: 8, overflow: 'hidden' }}>
          {/* Card header */}
          <div style={{ padding: '12px 14px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 17, lineHeight: 1.2, color: nameColor, wordBreak: 'break-word' }}>{displayName}</div>
                {value.label && value.label !== displayName && (
                  <div style={{ fontSize: 12, fontFamily: 'Inter', color: nameColor, marginTop: 3, opacity: 0.75 }}>{value.label}</div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 8, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, marginTop: 2, background: 'rgba(139,144,168,0.12)', color: 'var(--c-fg-2)' }}>{badgeLabel}</span>
                {!readOnly && (
                  <button type="button" onClick={clearClient} title="Change client" style={{ background: 'transparent', color: 'var(--c-fg-3)', borderRadius: 3, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '3px 6px', marginTop: 2 }}>✕</button>
                )}
              </div>
            </div>
          </div>

          {/* Card fields */}
          <div style={{ padding: '10px 14px 12px' }}>
            {isBilling ? (
              <>
                {/* Artist */}
                <div style={{ marginBottom: 8, position: 'relative' }}>
                  <div style={{ fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 2 }}>Artist</div>
                  <input
                    value={value.artist} disabled={readOnly}
                    onChange={e => { set('artist', e.target.value); setShowArtistDD(true) }}
                    onFocus={() => setShowArtistDD(true)}
                    onBlur={() => setTimeout(() => setShowArtistDD(false), 150)}
                    placeholder="—"
                    style={{ width: '100%', background: 'var(--c-bg)', outline: 'none', color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 11, padding: '2px 0', lineHeight: 1.5 }}
                  />
                  {showArtistDD && !readOnly && (clientArtists.filter(a => !value.artist || a.toLowerCase().includes(value.artist.toLowerCase())).length > 0 || value.artist.trim().length >= 2) && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--c-bg)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 }}>
                      {clientArtists.filter(a => !value.artist || a.toLowerCase().includes(value.artist.toLowerCase())).map((a, i) => (
                        <div key={i} onMouseDown={e => { e.preventDefault(); set('artist', a); setShowArtistDD(false) }} style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--c-wash)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{a}</div>
                      ))}
                      {value.artist.trim().length >= 2 && !clientArtists.some(a => a.toLowerCase() === value.artist.trim().toLowerCase()) && value.client_db_id && (() => {
                        const clientId = value.client_db_id
                        return (
                          <div onMouseDown={async e => { e.preventDefault(); const updated = await addArtistToLabel(clientId, value.artist.trim(), clientArtists); setClientArtists(updated); setShowArtistDD(false) }} style={{ padding: '7px 10px', cursor: 'pointer', color: 'var(--c-fg)', fontSize: 11, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Don&apos;t see this artist? Add &ldquo;{value.artist.trim()}&rdquo;
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>

                {/* A&R */}
                {(() => {
                  const cInpStyle: React.CSSProperties = { flex: 1, background: 'transparent', outline: 'none', color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 10, padding: '1px 0' }
                  const aBtnStyle = (color: string, active: boolean): React.CSSProperties => ({ padding: '2px 7px', borderRadius: 3, background: 'transparent', color, fontFamily: 'Inter', fontSize: 9, textDecoration: 'none', opacity: active ? 1 : 0.3, cursor: active ? 'pointer' : 'default', whiteSpace: 'nowrap' })
                  const anrPh = anrPhone.replace(/\D/g, '')
                  return (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 2 }}>A&amp;R</div>
                      <div style={{ position: 'relative' }}>
                        <input value={anrQuery} disabled={readOnly}
                          onChange={e => { setAnrQuery(e.target.value); set('ordered_by', e.target.value); set('anr_contact_id', null); setAnrContact(null); setShowAnrDD(true) }}
                          onFocus={() => setShowAnrDD(true)}
                          onBlur={() => { setTimeout(() => setShowAnrDD(false), 150); set('ordered_by', anrQuery) }}
                          placeholder="—"
                          style={{ width: '100%', background: 'var(--c-bg)', outline: 'none', color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 11, padding: '2px 0', lineHeight: 1.5 }}
                        />
                        {showAnrDD && !readOnly && (labelContacts.filter(c => !anrQuery || `${c.fname || ''} ${c.lname || ''}`.toLowerCase().includes(anrQuery.toLowerCase())).length > 0 || anrQuery.trim().length >= 2) && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--c-bg)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 }}>
                            {labelContacts.filter(c => !anrQuery || `${c.fname || ''} ${c.lname || ''}`.toLowerCase().includes(anrQuery.toLowerCase())).map((c, i) => {
                              const name = `${c.fname || ''} ${c.lname || ''}`.trim()
                              return (
                                <div key={c.id} onMouseDown={e => { e.preventDefault(); setAnrQuery(name); set('ordered_by', name); set('client_name', name); set('anr_contact_id', c.id); setAnrContact(c); setAnrEmail(c.email || ''); setAnrPhone(c.phone || ''); set('email', c.email || ''); set('phone', c.phone || ''); setShowAnrDD(false) }} style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg)' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--c-wash)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                  <div>{name}</div>
                                  {c.email && <div style={{ fontSize: 9, color: 'var(--c-fg-3)', marginTop: 1 }}>{c.email}</div>}
                                </div>
                              )
                            })}
                            {anrQuery.trim().length >= 2 && !labelContacts.some(c => `${c.fname || ''} ${c.lname || ''}`.trim().toLowerCase() === anrQuery.trim().toLowerCase()) && (() => {
                              const clientId = value.client_db_id
                              return (
                                <div onMouseDown={async e => { e.preventDefault(); if (!clientId) return; const parts = anrQuery.trim().split(/\s+/); const fname = parts[0] || '', lname = parts.slice(1).join(' '); const { data } = await supabase.from('client_contacts').insert({ client_id: clientId, fname, lname: lname || null, contact_type: 'anr', artists: [] }).select().single(); if (data) { const contact = data as ClientContact; setLabelContacts(prev => [...prev, contact]); const nm = `${fname} ${lname}`.trim(); setAnrQuery(nm); set('ordered_by', nm); set('client_name', nm); set('anr_contact_id', contact.id); setAnrContact(contact); setAnrEmail(''); setAnrPhone('') } setShowAnrDD(false) }} style={{ padding: '7px 10px', cursor: 'pointer', color: 'var(--c-fg)', fontSize: 11, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Don&apos;t see this A&R? Add &ldquo;{anrQuery.trim()}&rdquo;
                                </div>
                              )
                            })()}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
                        <input value={anrEmail} disabled={readOnly} onChange={e => setAnrEmail(e.target.value)} onBlur={() => { set('email', anrEmail); if (anrContact?.id && anrEmail !== (anrContact.email || '')) { const cid = anrContact.id; setContactUpdatePrompt({ contactId: cid, column: 'email', value: anrEmail, onUpdate: () => { setAnrContact(p => p ? { ...p, email: anrEmail } : p); setLabelContacts(p => p.map(c => c.id === cid ? { ...c, email: anrEmail } : c)) } }) } }} placeholder="Email" style={cInpStyle} />
                        <a href={anrEmail ? `mailto:${anrEmail}` : undefined} onClick={!anrEmail ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--c-st-booked)', !!anrEmail)}>Email</a>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                        <input value={anrPhone} disabled={readOnly} onChange={e => setAnrPhone(e.target.value)} onBlur={() => { set('phone', anrPhone); if (anrContact?.id && anrPhone !== (anrContact.phone || '')) { const cid = anrContact.id; setContactUpdatePrompt({ contactId: cid, column: 'phone', value: anrPhone, onUpdate: () => { setAnrContact(p => p ? { ...p, phone: anrPhone } : p); setLabelContacts(p => p.map(c => c.id === cid ? { ...c, phone: anrPhone } : c)) } }) } }} placeholder="Phone" style={cInpStyle} />
                        <a href={anrPh ? `tel:${anrPh}` : undefined} onClick={!anrPh ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--c-st-booked)', !!anrPh)}>Call</a>
                        <a href={anrPh ? `sms:${anrPh}` : undefined} onClick={!anrPh ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--c-st-warm)', !!anrPh)}>Text</a>
                      </div>
                    </div>
                  )
                })()}

                {/* Admin */}
                {(() => {
                  const cInpStyle: React.CSSProperties = { flex: 1, background: 'transparent', outline: 'none', color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 10, padding: '1px 0' }
                  const aBtnStyle = (color: string, active: boolean): React.CSSProperties => ({ padding: '2px 7px', borderRadius: 3, background: 'transparent', color, fontFamily: 'Inter', fontSize: 9, textDecoration: 'none', opacity: active ? 1 : 0.3, cursor: active ? 'pointer' : 'default', whiteSpace: 'nowrap' })
                  const adminPh = adminPhone.replace(/\D/g, '')
                  return (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 2 }}>Admin</div>
                      <div style={{ position: 'relative' }}>
                        <input value={adminQuery} disabled={readOnly}
                          onChange={e => { setAdminQuery(e.target.value); set('anr_admin_contact_id', null); setAdminContact(null); setShowAdminDD(true) }}
                          onFocus={() => setShowAdminDD(true)}
                          onBlur={() => setTimeout(() => setShowAdminDD(false), 150)}
                          placeholder="—"
                          style={{ width: '100%', background: 'var(--c-bg)', outline: 'none', color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 11, padding: '2px 0', lineHeight: 1.5 }}
                        />
                        {showAdminDD && !readOnly && (labelAdminContacts.filter(c => !adminQuery || `${c.fname || ''} ${c.lname || ''}`.toLowerCase().includes(adminQuery.toLowerCase())).length > 0 || adminQuery.trim().length >= 2) && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--c-bg)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 }}>
                            {labelAdminContacts.filter(c => !adminQuery || `${c.fname || ''} ${c.lname || ''}`.toLowerCase().includes(adminQuery.toLowerCase())).map((c, i) => {
                              const name = `${c.fname || ''} ${c.lname || ''}`.trim()
                              return (
                                <div key={c.id} onMouseDown={e => { e.preventDefault(); setAdminQuery(name); set('anr_admin_contact_id', c.id); setAdminContact(c); setAdminEmail(c.email || ''); setAdminPhone(c.phone || ''); setShowAdminDD(false) }} style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg)' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--c-wash)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                  <div>{name}</div>
                                  {c.role && <div style={{ fontSize: 9, color: 'var(--c-fg-3)', marginTop: 1 }}>{c.role}</div>}
                                </div>
                              )
                            })}
                            {adminQuery.trim().length >= 2 && !labelAdminContacts.some(c => `${c.fname || ''} ${c.lname || ''}`.trim().toLowerCase() === adminQuery.trim().toLowerCase()) && (() => {
                              const clientId = value.client_db_id
                              return (
                                <div onMouseDown={async e => { e.preventDefault(); if (!clientId) return; const parts = adminQuery.trim().split(/\s+/); const fname = parts[0] || '', lname = parts.slice(1).join(' '); const { data } = await supabase.from('client_contacts').insert({ client_id: clientId, fname, lname: lname || null, contact_type: 'admin' }).select().single(); if (data) { const contact = data as ClientContact; setLabelAdminContacts(prev => [...prev, contact]); setAdminQuery(adminQuery.trim()); set('anr_admin_contact_id', contact.id); setAdminContact(contact); setAdminEmail(''); setAdminPhone('') } setShowAdminDD(false) }} style={{ padding: '7px 10px', cursor: 'pointer', color: 'var(--c-fg)', fontSize: 11, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Don&apos;t see this admin? Add &ldquo;{adminQuery.trim()}&rdquo;
                                </div>
                              )
                            })()}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
                        <input value={adminEmail} disabled={readOnly} onChange={e => setAdminEmail(e.target.value)} onBlur={() => { if (adminContact?.id && adminEmail !== (adminContact.email || '')) { const cid = adminContact.id; setContactUpdatePrompt({ contactId: cid, column: 'email', value: adminEmail, onUpdate: () => { setAdminContact(p => p ? { ...p, email: adminEmail } : p); setLabelAdminContacts(p => p.map(c => c.id === cid ? { ...c, email: adminEmail } : c)) } }) } }} placeholder="Email" style={cInpStyle} />
                        <a href={adminEmail ? `mailto:${adminEmail}` : undefined} onClick={!adminEmail ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--c-st-booked)', !!adminEmail)}>Email</a>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                        <input value={adminPhone} disabled={readOnly} onChange={e => setAdminPhone(e.target.value)} onBlur={() => { if (adminContact?.id && adminPhone !== (adminContact.phone || '')) { const cid = adminContact.id; setContactUpdatePrompt({ contactId: cid, column: 'phone', value: adminPhone, onUpdate: () => { setAdminContact(p => p ? { ...p, phone: adminPhone } : p); setLabelAdminContacts(p => p.map(c => c.id === cid ? { ...c, phone: adminPhone } : c)) } }) } }} placeholder="Phone" style={cInpStyle} />
                        <a href={adminPh ? `tel:${adminPh}` : undefined} onClick={!adminPh ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--c-st-booked)', !!adminPh)}>Call</a>
                        <a href={adminPh ? `sms:${adminPh}` : undefined} onClick={!adminPh ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--c-st-warm)', !!adminPh)}>Text</a>
                      </div>
                    </div>
                  )
                })()}

                {/* Contact update prompt */}
                {contactUpdatePrompt && (
                  <div className="c-modal-backdrop" style={{ zIndex: 400 }}>
                    <div style={{ background: 'var(--c-wash)', borderRadius: 10, padding: '24px 28px', width: 340, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
                      <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 13, color: 'var(--c-fg)', marginBottom: 8 }}>Update client profile or just this session?</div>
                      <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--c-fg-2)', lineHeight: 1.6, marginBottom: 20 }}>
                        Save the new {contactUpdatePrompt.column} back to the contact record, or keep it for this booking only.
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button type="button" onClick={() => setContactUpdatePrompt(null)} style={{ padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, background: 'transparent', color: 'var(--c-fg-2)' }}>Just this session</button>
                        <button type="button" onClick={async () => { await supabase.from('client_contacts').update({ [contactUpdatePrompt.column]: contactUpdatePrompt.value }).eq('id', contactUpdatePrompt.contactId); contactUpdatePrompt.onUpdate(); setContactUpdatePrompt(null) }} style={{ padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 700, background: 'var(--c-fg)', color: 'var(--c-bg)' }}>Update profile</button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <ClientCardField label="Email" value={value.email} fieldKey="email" onEdit={handleClientFieldEdit} />
                <ClientCardField label="Phone" value={value.phone} fieldKey="phone" onEdit={handleClientFieldEdit} />
              </>
            )}

            <button onClick={() => value.client_db_id && setShowProfile(true)} style={{ marginTop: 10, width: '100%', padding: '6px 10px', borderRadius: 4, background: 'transparent', color: value.client_db_id ? 'var(--c-fg-2)' : 'var(--c-fg-3)', fontFamily: 'Inter', fontSize: 10, cursor: value.client_db_id ? 'pointer' : 'default', textAlign: 'center' }}>
              {value.client_db_id ? 'View full profile →' : 'No profile linked'}
            </button>
          </div>
        </div>
      )}

      {/* COD method — only shown when COD toggle active */}
      {/* COD method — Was a flat grey box left over from before the carved
          system. Now the standard well, with its label inside as an IdWell
          prefix (§8): the field holds one short value, so a stacked label above
          it was a wasted line. */}
      {value.payment_type === 'COD' && (
        <div className="c-well">
          <span className="c-pfx">Method</span>
          <select
            value={value.cod_method}
            disabled={readOnly}
            onChange={e => set('cod_method', e.target.value)}
            style={{ cursor: readOnly ? 'default' : 'pointer', appearance: 'none' }}
          >
            <option value="">Select…</option>
            {COD_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="c-ico" aria-hidden>▾</span>
        </div>
      )}

      {/* Client profile popup */}
      {showProfile && value.client_db_id && (
        <ClientProfilePopup clientId={value.client_db_id} onClose={() => setShowProfile(false)} />
      )}
    </div>
  )
}
