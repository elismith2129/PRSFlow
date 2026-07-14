'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import type { Booking, Client, ClientContact } from '@/lib/supabase'
import { ClientProfile } from '@/components/clients/ClientProfile'
import { WorkOrderPopup, type WOFormSync } from '@/components/calendar/WorkOrderPopup'
import { emptyForm, bookingToForm, type FormData } from '@/components/calendar/BookingForm'
import { addArtistToLabel } from '@/lib/roster'

// ─── COLOR TOKENS ────────────────────────────────────────────────────────────

const STATUS_TOP_COLORS: Record<string, string> = {
  confirmed:  'var(--booked)',
  tentative:  'var(--warm)',
  cancelled:  'var(--hot)',
  tour:       '#a855f7',
  tech:       'var(--cold)',
  open_hours: '#e2e8f0',
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmed', tentative: 'Tentative', cancelled: 'Cancelled',
  tour: 'Tour', tech: 'Tech', open_hours: 'Open Hours',
}

const COD_METHODS = ['Cash', 'Credit Card', 'Zelle', 'Check', 'Venmo']

// ─── LAYOUT CONSTANTS ────────────────────────────────────────────────────────

const fL: React.CSSProperties = {
  fontSize: 9, color: 'var(--text3)', letterSpacing: '0.08em',
  textTransform: 'uppercase', marginBottom: 3, display: 'block',
}
const inp: React.CSSProperties = {
  background: 'var(--surface2)', border: '1px solid var(--border)',
  color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11,
  padding: '4px 8px', borderRadius: 4, width: '100%', outline: 'none',
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Build a synthetic Booking from form state for the "new session" case, where no
// booking row exists yet. Mirrors the synthetic booking BookingForm passes to the WO.
function synthBooking(f: FormData): Booking {
  return {
    id: '',
    status: f.status as Booking['status'],
    session_type: f.session_type as Booking['session_type'],
    payment_type: f.payment_type,
    cod_method: f.cod_method || null,
    location: f.location,
    studio: f.studio,
    start_date: f.start_date,
    end_date: f.end_date,
    from_time: f.from_time || null,
    to_time: f.to_time || null,
    rate: f.rate || null,
    rate_daily: f.rate_daily || null,
    rate_type: f.rate_type === 'daily' ? 'day' : 'hour',
    invoice_num: f.invoice_num || null,
    client_id: f.client_db_id,
    client_name: f.client_name || null,
    artist: f.artist || null,
    label: f.label || null,
    ordered_by: f.ordered_by || null,
    phone: f.phone || null,
    email: f.email || null,
    po: f.po || null,
    producer: f.producer || null,
    food_budget: f.food_budget,
    food_amount: f.food_amount || null,
    engineer_name: f.engineer_name || null,
    engineer_rate: f.engineer_rate || null,
    engineer_status: f.engineer_status as Booking['engineer_status'],
    assistant_name: f.assistant_name || null,
    assistant_status: f.assistant_status as Booking['assistant_status'],
    notes: f.notes || null,
    is_srs: f.is_srs,
    srs_fee_amount: null,
    anr_contact_id: f.anr_contact_id,
    anr_admin_contact_id: f.anr_admin_contact_id,
    created_at: '',
    updated_at: null,
  }
}

// ─── CLIENT CARD FIELD ───────────────────────────────────────────────────────

function ClientCardField({
  label, value, fieldKey, onEdit, editing,
}: {
  label: string; value: string; fieldKey: string
  onEdit: (fieldKey: string, value: string) => void
  editing: boolean
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
      {editing ? (
        <input
          type="text" value={local}
          onChange={e => setLocal(e.target.value)}
          onFocus={e => { e.currentTarget.style.borderBottomColor = 'var(--accent)' }}
          onBlur={e => {
            e.currentTarget.style.borderBottomColor = 'var(--border)'
            if (local !== value) onEdit(fieldKey, local)
          }}
          style={{ width: '100%', background: 'var(--surface)', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0', lineHeight: 1.5, transition: 'border-color 0.15s' }}
        />
      ) : (
        <div style={{ color: value ? 'var(--text)' : 'var(--text3)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0', lineHeight: 1.5, minHeight: 18 }}>
          {value || '—'}
        </div>
      )}
    </div>
  )
}

// ─── CLIENT PROFILE POPUP ────────────────────────────────────────────────────

function ClientProfilePopup({ clientId, onClose, onDelete }: { clientId: string; onClose: () => void; onDelete?: () => void }) {
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
      style={{ position: 'fixed', top: 52, left: 0, right: 0, bottom: 0, zIndex: 10030, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', borderRadius: 10, overflow: 'hidden' }}
      >
        <ClientProfile
          client={client} contacts={contacts} bookingCount={bookingCount}
          loading={loading} onRefresh={load} onBack={onClose}
          onDelete={() => { onDelete?.(); onClose() }}
        />
      </div>
    </div>
  )
}

// ─── UNIFIED SESSION FORM ────────────────────────────────────────────────────

export function UnifiedSessionForm({ bookingId, onClose }: { bookingId: string | null; onClose: () => void }) {
  const [form, setForm] = useState<FormData>(emptyForm())
  const [loading, setLoading] = useState(true)
  const [booking, setBooking] = useState<Booking | null>(null)
  const [woStatus, setWoStatus] = useState<string | null>(null)

  // Client-card state (copied from BookingForm) ────────────────────────────────
  const [clientEdits, setClientEdits] = useState<Record<string, string>>({})
  const [showProfileUpdate, setShowProfileUpdate] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [clientSuggestions, setClientSuggestions] = useState<Array<{ id: string; label: string; sub: string; isLabel: boolean; record: any }>>([])
  const [showClientDD, setShowClientDD] = useState(false)
  const [clientHighlight, setClientHighlight] = useState(-1)
  const [searchQuery, setSearchQuery] = useState('')
  const nameDebounce = useRef<ReturnType<typeof setTimeout>>()
  const skipNameSearch = useRef(false)
  const [clientArtists, setClientArtists] = useState<string[]>([])
  const [showArtistDD, setShowArtistDD] = useState(false)
  const [labelContacts, setLabelContacts] = useState<ClientContact[]>([])
  const [labelAdminContacts, setLabelAdminContacts] = useState<ClientContact[]>([])
  const [anrQuery, setAnrQuery] = useState('')
  const [anrContact, setAnrContact] = useState<ClientContact | null>(null)
  const [showAnrDD, setShowAnrDD] = useState(false)
  const [adminQuery, setAdminQuery] = useState('')
  const [adminContact, setAdminContact] = useState<ClientContact | null>(null)
  const [showAdminDD, setShowAdminDD] = useState(false)
  const [showSrsModal, setShowSrsModal] = useState(false)
  const [anrEmail, setAnrEmail] = useState('')
  const [anrPhone, setAnrPhone] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPhone, setAdminPhone] = useState('')
  const [contactUpdatePrompt, setContactUpdatePrompt] = useState<{
    contactId: string; column: 'email' | 'phone'; value: string; onUpdate: () => void
  } | null>(null)

  // Initial data load — booking row when editing, empty form for a new session
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (bookingId) {
        const { data } = await supabase.from('bookings').select('*').eq('id', bookingId).single()
        if (cancelled) return
        const b = data as Booking | null
        if (b) {
          const f = bookingToForm(b)
          setForm(f)
          setBooking(b)
          setAnrQuery(f.ordered_by || '')
          // WO status for any downstream display
          supabase.from('work_orders').select('status').eq('booking_id', b.id).maybeSingle()
            .then(({ data: wo }) => { if (wo && !cancelled) setWoStatus(wo.status) })
        } else {
          const f = emptyForm()
          setForm(f)
          setBooking(synthBooking(f))
        }
      } else {
        const f = emptyForm()
        setForm(f)
        setBooking(synthBooking(f))
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [bookingId])

  function set<K extends keyof FormData>(k: K, v: FormData[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  // Live WO sync object (WOFormSync shape) — keeps the WO in step with card edits
  const liveForm = useMemo<WOFormSync>(() => ({
    client_name: form.client_name, artist: form.artist,
    label: form.label, ordered_by: form.ordered_by,
    po: form.po, phone: form.phone, email: form.email,
    from_time: form.from_time, to_time: form.to_time,
    producer: form.producer, engineer_name: form.engineer_name,
    assistant_name: form.assistant_name,
    payment_type: form.payment_type, food_budget: form.food_budget,
    food_amount: form.food_amount, invoice_num: form.invoice_num,
    start_date: form.start_date, end_date: form.end_date, studio: form.studio,
    location: form.location, rate: form.rate,
    rate_daily: form.rate_daily, rate_type: form.rate_type,
    engineer_rate: form.engineer_rate,
  }), [form.client_name, form.artist, form.label, form.ordered_by,
    form.po, form.phone, form.email, form.from_time, form.to_time,
    form.producer, form.engineer_name, form.assistant_name,
    form.payment_type, form.food_budget, form.food_amount,
    form.invoice_num, form.start_date, form.end_date, form.studio, form.location,
    form.rate, form.rate_daily, form.rate_type, form.engineer_rate])

  // Updates pushed back from the WO into our form state
  const handleFormSync = useCallback((updates: Partial<WOFormSync>) => {
    setForm(f => {
      const next: FormData = { ...f }
      const u = updates as Record<string, any>
      const keys: (keyof FormData)[] = [
        'client_name', 'artist', 'label', 'ordered_by', 'po', 'phone', 'email',
        'from_time', 'to_time', 'producer', 'engineer_name', 'assistant_name',
        'payment_type', 'food_budget', 'food_amount', 'invoice_num',
        'start_date', 'end_date', 'studio', 'location', 'rate', 'rate_daily',
        'notes', 'engineer_status', 'engineer_rate',
      ]
      for (const k of keys) {
        if (k in u && u[k] !== undefined) (next as any)[k] = u[k]
      }
      if ('rate_type' in u && u.rate_type !== undefined) {
        next.rate_type = u.rate_type === 'day' || u.rate_type === 'daily' ? 'daily' : 'hourly'
      }
      return next
    })
  }, [])

  // Label roster + contacts (A&Rs + Admins) for billing bookings
  useEffect(() => {
    const id = form.client_db_id
    if (!id || form.payment_type !== 'billing') {
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
      // Restore anrContact from saved ID (edit mode)
      if (form.anr_contact_id) {
        const found = all.find(c => c.id === form.anr_contact_id)
        if (found) { setAnrContact(found); setAnrEmail(found.email || ''); setAnrPhone(found.phone || '') }
      }
      // Restore adminContact from saved ID (edit mode)
      if (form.anr_admin_contact_id) {
        const found = admins.find(c => c.id === form.anr_admin_contact_id)
        if (found) { setAdminContact(found); setAdminQuery(`${found.fname || ''} ${found.lname || ''}`.trim()); setAdminEmail(found.email || ''); setAdminPhone(found.phone || '') }
      }
    })
  }, [form.client_db_id, form.payment_type]) // eslint-disable-line react-hooks/exhaustive-deps

  // Client search (name / A&R / artist) — identical to BookingForm
  useEffect(() => {
    if (skipNameSearch.current) { skipNameSearch.current = false; return }
    const q = searchQuery.trim()
    if (q.length < 2) { setClientSuggestions([]); setShowClientDD(false); return }
    clearTimeout(nameDebounce.current)
    nameDebounce.current = setTimeout(async () => {
      const [{ data: cd }, { data: ctd }, { data: ald }] = await Promise.all([
        supabase
          .from('clients')
          .select('id,type,name,fname,lname,email,phone,artists,srs_client')
          .or(`name.ilike.%${q}%,fname.ilike.%${q}%,lname.ilike.%${q}%`)
          .limit(30),
        supabase
          .from('client_contacts')
          .select('id,client_id,fname,lname,email,phone,clients(id,name,type,srs_client)')
          .or(`fname.ilike.%${q}%,lname.ilike.%${q}%`)
          .limit(20),
        supabase
          .from('clients')
          .select('id,type,name,fname,lname,email,phone,artists,srs_client')
          .eq('type', 'label')
          .limit(50),
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
          id: ct.client_id,
          label: personName,
          sub: parentClient.type === 'label' ? parentClient.name : '',
          isLabel: parentClient.type === 'label',
          record: { ...parentClient, _anrFname: ct.fname, _anrLname: ct.lname, _anrEmail: ct.email, _anrPhone: ct.phone },
        })
      }

      for (const c of (cd || []) as any[]) {
        const personName = `${c.fname || ''} ${c.lname || ''}`.trim()
        const displayName = personName || c.name || ''
        const sub = ''
        const key = `client-${c.id}`
        if (seen.has(key)) continue
        seen.add(key)
        results.push({
          id: c.id,
          label: displayName,
          sub,
          isLabel: c.type === 'label',
          record: c,
        })
      }

      for (const c of (ald || []) as any[]) {
        if (!Array.isArray(c.artists)) continue
        for (const artistName of c.artists as string[]) {
          if (typeof artistName !== 'string') continue
          if (!artistName.toLowerCase().includes(q.toLowerCase())) continue
          const key = `artist-${c.id}-${artistName}`
          if (seen.has(key)) continue
          seen.add(key)
          results.push({
            id: c.id,
            label: artistName,
            sub: c.name,
            isLabel: true,
            record: { ...c, _artistMatch: artistName },
          })
        }
      }

      setClientSuggestions(results)
      setShowClientDD(results.length > 0)
    }, 200)
    return () => clearTimeout(nameDebounce.current)
  }, [searchQuery])

  async function applyClientAutofill(s: typeof clientSuggestions[0]) {
    skipNameSearch.current = true
    const r = s.record
    const isAnrContact = !!r._anrFname
    const anrName = isAnrContact
      ? `${r._anrFname || ''} ${r._anrLname || ''}`.trim()
      : `${r.fname || ''} ${r.lname || ''}`.trim()
    const labelName = r.type === 'label' ? r.name : ''
    const clientName = anrName || (r.type !== 'label' ? r.name : '') || ''
    const email = isAnrContact ? (r._anrEmail || '') : (r.email || '')
    const phone = isAnrContact ? (r._anrPhone || '') : (r.phone || '')
    setForm(f => ({
      ...f,
      client_db_id: r.id,
      client_name: clientName,
      label: labelName || f.label,
      ordered_by: labelName ? clientName : f.ordered_by,
      phone: phone || f.phone,
      email: email || f.email,
      payment_type: labelName ? 'billing' : f.payment_type,
      artist: r._artistMatch ? r._artistMatch : (labelName ? '' : ((r.artists && r.artists.length > 0 ? r.artists[0] : f.artist) || f.artist)),
      is_srs: r.srs_client === true ? true : f.is_srs,
    }))
    setAnrQuery(labelName ? clientName : '')
    setSearchQuery('')
    setShowClientDD(false)
    setClientHighlight(-1)
    setClientEdits({})

    if (r._artistMatch) {
      const { data: contacts } = await supabase
        .from('client_contacts')
        .select('*')
        .eq('client_id', r.id)
        .neq('contact_type', 'admin')
      const artistLower = (r._artistMatch as string).toLowerCase()
      const matched = ((contacts as ClientContact[]) || []).find(c =>
        Array.isArray(c.artists) && c.artists.some(a => a.toLowerCase() === artistLower)
      )
      if (matched) {
        const nm = `${matched.fname || ''} ${matched.lname || ''}`.trim()
        setAnrQuery(nm)
        setAnrContact(matched)
        setAnrEmail(matched.email || '')
        setAnrPhone(matched.phone || '')
        setForm(f => ({
          ...f,
          client_name: nm,
          ordered_by: nm,
          anr_contact_id: matched.id,
          email: matched.email || f.email,
          phone: matched.phone || f.phone,
        }))
      }
    }
  }

  function clearClient() {
    setForm(f => ({ ...f, client_name: '', artist: '', label: '', ordered_by: '', phone: '', email: '', client_db_id: null }))
    setClientArtists([])
    setLabelContacts([])
    setAnrQuery('')
    setSearchQuery('')
    setClientEdits({})
  }

  function handleClientFieldEdit(formKey: keyof FormData, value: string) {
    set(formKey, value)
    const colMap: Partial<Record<keyof FormData, string>> = { email: 'email', phone: 'phone', client_name: 'name', label: 'label' }
    const clientColumn = colMap[formKey] ?? null
    if (form.client_db_id && clientColumn) {
      setClientEdits(prev => ({ ...prev, [clientColumn]: value }))
    }
  }

  const sectionHead: React.CSSProperties = {
    fontSize: 9, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text3)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
    borderBottom: '1px solid var(--border)', paddingBottom: 7, marginBottom: 12,
  }

  if (loading || !booking) {
    return createPortal(
      <div style={{ position: 'fixed', top: 52, left: 0, right: 0, bottom: 0, zIndex: 10020, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#f0f0f0', fontFamily: 'DM Mono', fontSize: 12 }}>Loading session…</div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div
      style={{ position: 'fixed', top: 52, left: 0, right: 0, bottom: 0, zIndex: 10010, background: 'rgba(0,0,0,0.75)', overflowY: 'auto' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Outer modal card — the scrollable wrapper is the overlay above; content here
          flows in natural order: header → status chips → client card → work order.
          WorkOrderPopup is rendered with inline so its root flows in normal flow. */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 960, margin: '20px auto', width: '100%',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
        }}
      >

          {/* HEADER */}
          <div style={{
            padding: '12px 20px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'flex-start', gap: 12,
          }}>
            {form.payment_type === 'billing' ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: 'Syne', fontWeight: 800, fontSize: 30, lineHeight: 1.15,
                  color: (form.artist || form.label) ? '#96A9FF' : 'var(--text3)',
                }}>
                  {form.artist || form.label || 'New Session'}
                </div>
                {form.client_name && (
                  <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text2)', marginTop: 3 }}>
                    {form.client_name}
                  </div>
                )}
                {form.label && form.artist && (
                  <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#96A9FF', marginTop: 1 }}>
                    {form.label}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: 'Syne', fontWeight: 800, fontSize: 30, lineHeight: 1.15,
                  color: form.client_name ? (form.payment_type === 'COD' ? '#6D7FC7' : '#96A9FF') : 'var(--text3)',
                }}>
                  {form.client_name || 'New Session'}
                </div>
              </div>
            )}
            {/* WO status badge */}
            <div style={{
              fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em',
              padding: '4px 9px', borderRadius: 4, flexShrink: 0, marginTop: 4,
              textTransform: 'uppercase',
              color: woStatus === 'completed' ? 'var(--booked)' : 'var(--warm)',
              border: `1px solid ${woStatus === 'completed' ? 'rgba(20,184,166,0.5)' : 'rgba(249,115,22,0.5)'}`,
              background: woStatus === 'completed' ? 'rgba(20,184,166,0.1)' : 'rgba(249,115,22,0.1)',
            }}>
              {woStatus === 'completed' ? 'Completed' : 'Open'}
            </div>
            {form.invoice_num && (
              <div style={{
                fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)',
                border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', flexShrink: 0, marginTop: 4,
              }}>
                #{form.invoice_num}
              </div>
            )}
            <button onClick={onClose} style={{
              background: 'transparent', border: 'none', color: 'var(--text3)',
              fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '0 4px', flexShrink: 0,
            }}>×</button>
          </div>

          {/* STATUS CHIPS */}
          <div style={{
            padding: '8px 20px', borderBottom: '1px solid var(--border)',
            display: 'flex', gap: 6, flexWrap: 'wrap',
          }}>
            {Object.entries(STATUS_LABELS).map(([s, label]) => (
              <button key={s} onClick={() => set('status', s)} style={{
                padding: '4px 14px', borderRadius: 20, fontSize: 10, fontFamily: 'DM Mono',
                fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.1s',
                background: form.status === s ? STATUS_TOP_COLORS[s] : 'var(--surface2)',
                color: form.status === s ? '#fff' : 'var(--text2)',
                outline: form.status === s ? `2px solid ${STATUS_TOP_COLORS[s]}66` : 'none',
              }}>{label}</button>
            ))}
          </div>

          {/* CLIENT CARD */}
          <div style={{ padding: '16px 20px' }}>
            {(() => {
              const isBilling = form.payment_type === 'billing'
              const hasClient = isBilling
                ? !!(form.label || form.client_name)
                : !!form.client_name

              const nameColor = isBilling ? '#96A9FF' : '#7BBFFF'
              const badgeBg = isBilling ? 'rgba(150,169,255,0.12)' : 'rgba(123,191,255,0.12)'
              const badgeColor = isBilling ? '#96A9FF' : '#7BBFFF'
              const badgeBorder = isBilling ? 'rgba(150,169,255,0.3)' : 'rgba(123,191,255,0.3)'
              const badgeLabel = isBilling ? 'LABEL/BILLING' : 'COD'
              const displayName = isBilling ? (form.client_name || form.label) : form.client_name

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11, maxWidth: 460 }}>
                  <div style={sectionHead}>Client</div>

                  {/* SRS + COD / Label billing toggle row */}
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!form.is_srs) {
                          setShowSrsModal(true)
                        } else {
                          set('is_srs', false)
                        }
                      }}
                      style={{
                        padding: '7px 16px', borderRadius: 6, border: form.is_srs ? '1px solid rgba(255,59,59,0.4)' : '1px solid rgba(255,255,255,0.12)',
                        cursor: 'pointer', fontFamily: 'DM Mono', fontSize: 11, fontWeight: 700,
                        background: form.is_srs ? 'rgba(255,59,59,0.12)' : 'transparent',
                        color: form.is_srs ? '#ff3b3b' : 'var(--cold)',
                        letterSpacing: '0.08em', transition: 'all 0.15s',
                      }}
                    >
                      SRS
                    </button>

                    <div style={{
                      display: 'flex', gap: 2, background: 'var(--surface)',
                      border: '1px solid var(--border)', borderRadius: 8, padding: 3,
                    }}>
                      {(['COD', 'billing'] as const).map(m => (
                        <button key={m} type="button" onClick={() => {
                          if (m !== form.payment_type) clearClient()
                          set('payment_type', m)
                        }} style={{
                          padding: '7px 28px', borderRadius: 6, border: 'none', cursor: 'pointer',
                          fontFamily: 'DM Mono', fontSize: 11, fontWeight: 500,
                          background: form.payment_type === m ? 'var(--surface2)' : 'transparent',
                          color: form.payment_type === m ? (m === 'COD' ? '#7BBFFF' : '#96A9FF') : 'var(--text2)',
                          transition: 'all 0.15s', letterSpacing: '0.04em',
                        }}>
                          {m === 'COD' ? 'COD' : 'Label/Billing'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* SRS referral modal */}
                  {showSrsModal && (
                    <div style={{
                      position: 'fixed', inset: 0, zIndex: 10040,
                      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{
                        background: 'var(--surface2)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 10, padding: '28px 32px', width: 380, maxWidth: '90vw',
                        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                      }}>
                        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 10 }}>
                          SRS Referral
                        </div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 24 }}>
                          Apply this to the client&apos;s profile so all future bookings are automatically flagged as SRS?
                        </div>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => {
                              set('is_srs', true)
                              setShowSrsModal(false)
                            }}
                            style={{
                              padding: '8px 18px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)',
                              cursor: 'pointer', fontFamily: 'DM Mono', fontSize: 11,
                              background: 'transparent', color: 'var(--text2)',
                            }}
                          >
                            Just this session
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              set('is_srs', true)
                              if (form.client_db_id) {
                                await supabase.from('clients').update({ srs_client: true }).eq('id', form.client_db_id)
                              }
                              setShowSrsModal(false)
                            }}
                            style={{
                              padding: '8px 18px', borderRadius: 6, border: 'none',
                              cursor: 'pointer', fontFamily: 'DM Mono', fontSize: 11, fontWeight: 700,
                              background: 'var(--accent)', color: 'var(--bg)',
                            }}
                          >
                            Apply to profile
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Search input — shown when no client attached */}
                  {!hasClient && (
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
                        style={{ ...inp, padding: '8px 12px', fontSize: 11 }}
                        autoComplete="off"
                      />
                      {showClientDD && clientSuggestions.length > 0 && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2,
                        }}>
                          {clientSuggestions.map((s, i) => (
                            <div
                              key={i}
                              onMouseDown={() => applyClientAutofill(s)}
                              style={{
                                padding: '8px 12px', cursor: 'pointer',
                                background: i === clientHighlight ? 'var(--surface2)' : 'transparent',
                                borderBottom: i < clientSuggestions.length - 1 ? '1px solid var(--border)' : 'none',
                              }}
                            >
                              <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text)' }}>{s.label}</div>
                              {s.sub && <div style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#96A9FF', marginTop: 1 }}>{s.sub}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Client card — shown when a client is attached */}
                  {hasClient && (
                    <div style={{
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      borderRadius: 8, overflow: 'hidden',
                    }}>
                      {/* Card header */}
                      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 0 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontFamily: 'DM Serif Display', fontSize: 17, lineHeight: 1.2,
                              color: nameColor, wordBreak: 'break-word',
                            }}>
                              {displayName}
                            </div>
                            {form.label && form.label !== displayName && (
                              <div style={{ fontSize: 12, fontFamily: 'DM Mono', color: nameColor, marginTop: 3, opacity: 0.75 }}>
                                {form.label}
                              </div>
                            )}
                          </div>
                          <span style={{
                            fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em',
                            padding: '3px 7px', borderRadius: 3, flexShrink: 0, marginTop: 2,
                            background: badgeBg, color: badgeColor,
                            border: `1px solid ${badgeBorder}`,
                          }}>{badgeLabel}</span>
                        </div>
                      </div>

                      {/* Card fields */}
                      <div style={{ padding: '10px 14px 12px' }}>
                        {isBilling ? (
                          <>
                            {/* 1. Artist — plain text + roster autocomplete */}
                            <div style={{ marginBottom: 8, position: 'relative' }}>
                              <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>Artist</div>
                              <input
                                value={form.artist}
                                onChange={e => { set('artist', e.target.value); setShowArtistDD(true) }}
                                onFocus={() => setShowArtistDD(true)}
                                onBlur={() => setTimeout(() => setShowArtistDD(false), 150)}
                                placeholder="—"
                                style={{ width: '100%', background: 'var(--surface)', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0', lineHeight: 1.5 }}
                              />
                              {showArtistDD && (clientArtists.filter(a => !form.artist || a.toLowerCase().includes(form.artist.toLowerCase())).length > 0 || form.artist.trim().length >= 2) && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 }}>
                                  {clientArtists
                                    .filter(a => !form.artist || a.toLowerCase().includes(form.artist.toLowerCase()))
                                    .map((a, i) => (
                                      <div key={i} onMouseDown={e => { e.preventDefault(); set('artist', a); setShowArtistDD(false) }}
                                        style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text)', background: 'transparent' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                      >{a}</div>
                                    ))}
                                  {form.artist.trim().length >= 2 && !clientArtists.some(a => a.toLowerCase() === form.artist.trim().toLowerCase()) && form.client_db_id && (() => {
                                    const clientId = form.client_db_id
                                    return (
                                      <div onMouseDown={async e => {
                                        e.preventDefault()
                                        const updated = await addArtistToLabel(clientId, form.artist.trim(), clientArtists)
                                        setClientArtists(updated)
                                        setShowArtistDD(false)
                                      }} style={{ padding: '7px 10px', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', borderTop: clientArtists.filter(a => !form.artist || a.toLowerCase().includes(form.artist.toLowerCase())).length > 0 ? '1px solid var(--border)' : undefined, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Don&apos;t see this artist? Add &ldquo;{form.artist.trim()}&rdquo;
                                      </div>
                                    )
                                  })()}
                                </div>
                              )}
                            </div>

                            {/* 2. A&R — always-visible name + inline email + phone */}
                            {(() => {
                              const cInpStyle: React.CSSProperties = { flex: 1, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 10, padding: '1px 0' }
                              const aBtnStyle = (color: string, active: boolean): React.CSSProperties => ({ padding: '2px 7px', borderRadius: 3, border: '1px solid var(--border)', background: 'transparent', color, fontFamily: 'DM Mono', fontSize: 9, textDecoration: 'none', opacity: active ? 1 : 0.3, cursor: active ? 'pointer' : 'default', whiteSpace: 'nowrap' as const })
                              const anrPh = anrPhone.replace(/\D/g, '')
                              return (
                                <div style={{ marginBottom: 10 }}>
                                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>A&amp;R</div>
                                  <div style={{ position: 'relative' }}>
                                    <input
                                      value={anrQuery}
                                      onChange={e => { setAnrQuery(e.target.value); set('ordered_by', e.target.value); set('anr_contact_id', null); setAnrContact(null); setShowAnrDD(true) }}
                                      onFocus={() => setShowAnrDD(true)}
                                      onBlur={() => { setTimeout(() => setShowAnrDD(false), 150); set('ordered_by', anrQuery) }}
                                      placeholder="—"
                                      style={{ width: '100%', background: 'var(--surface)', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0', lineHeight: 1.5 }}
                                    />
                                    {showAnrDD && (labelContacts.filter(c => !anrQuery || `${c.fname || ''} ${c.lname || ''}`.toLowerCase().includes(anrQuery.toLowerCase())).length > 0 || anrQuery.trim().length >= 2) && (
                                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 }}>
                                        {labelContacts.filter(c => !anrQuery || `${c.fname || ''} ${c.lname || ''}`.toLowerCase().includes(anrQuery.toLowerCase())).map((c, i) => {
                                          const name = `${c.fname || ''} ${c.lname || ''}`.trim()
                                          return (
                                            <div key={c.id} onMouseDown={e => {
                                              e.preventDefault()
                                              setAnrQuery(name); set('ordered_by', name); set('client_name', name)
                                              set('anr_contact_id', c.id); setAnrContact(c)
                                              setAnrEmail(c.email || ''); setAnrPhone(c.phone || '')
                                              set('email', c.email || ''); set('phone', c.phone || '')
                                              setShowAnrDD(false)
                                            }} style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text)', background: 'transparent', borderBottom: i < labelContacts.length - 1 ? '1px solid var(--border)' : 'none' }}
                                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                            >
                                              <div>{name}</div>
                                              {c.email && <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 1 }}>{c.email}</div>}
                                            </div>
                                          )
                                        })}
                                        {anrQuery.trim().length >= 2 && !labelContacts.some(c => `${c.fname || ''} ${c.lname || ''}`.trim().toLowerCase() === anrQuery.trim().toLowerCase()) && (() => {
                                          const clientId = form.client_db_id
                                          return (
                                            <div onMouseDown={async e => {
                                              e.preventDefault()
                                              if (!clientId) return
                                              const parts = anrQuery.trim().split(/\s+/)
                                              const fname = parts[0] || '', lname = parts.slice(1).join(' ')
                                              const { data } = await supabase.from('client_contacts').insert({ client_id: clientId, fname, lname: lname || null, contact_type: 'anr', artists: [] }).select().single()
                                              if (data) { const contact = data as ClientContact; setLabelContacts(prev => [...prev, contact]); const nm = `${fname} ${lname}`.trim(); setAnrQuery(nm); set('ordered_by', nm); set('client_name', nm); set('anr_contact_id', contact.id); setAnrContact(contact); setAnrEmail(''); setAnrPhone('') }
                                              setShowAnrDD(false)
                                            }} style={{ padding: '7px 10px', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                              <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Don&apos;t see this A&R? Add &ldquo;{anrQuery.trim()}&rdquo;
                                            </div>
                                          )
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
                                    <input value={anrEmail} onChange={e => setAnrEmail(e.target.value)} onBlur={() => { set('email', anrEmail); if (anrContact?.id && anrEmail !== (anrContact.email || '')) { const cid = anrContact.id; setContactUpdatePrompt({ contactId: cid, column: 'email', value: anrEmail, onUpdate: () => { setAnrContact(p => p ? { ...p, email: anrEmail } : p); setLabelContacts(p => p.map(c => c.id === cid ? { ...c, email: anrEmail } : c)) } }) } }} placeholder="Email" style={cInpStyle} />
                                    <a href={anrEmail ? `mailto:${anrEmail}` : undefined} onClick={!anrEmail ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--booked)', !!anrEmail)}>Email</a>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                    <input value={anrPhone} onChange={e => setAnrPhone(e.target.value)} onBlur={() => { set('phone', anrPhone); if (anrContact?.id && anrPhone !== (anrContact.phone || '')) { const cid = anrContact.id; setContactUpdatePrompt({ contactId: cid, column: 'phone', value: anrPhone, onUpdate: () => { setAnrContact(p => p ? { ...p, phone: anrPhone } : p); setLabelContacts(p => p.map(c => c.id === cid ? { ...c, phone: anrPhone } : c)) } }) } }} placeholder="Phone" style={cInpStyle} />
                                    <a href={anrPh ? `tel:${anrPh}` : undefined} onClick={!anrPh ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--booked)', !!anrPh)}>Call</a>
                                    <a href={anrPh ? `sms:${anrPh}` : undefined} onClick={!anrPh ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--warm)', !!anrPh)}>Text</a>
                                  </div>
                                </div>
                              )
                            })()}

                            {/* 3. Admin — identical layout to A&R */}
                            {(() => {
                              const cInpStyle: React.CSSProperties = { flex: 1, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 10, padding: '1px 0' }
                              const aBtnStyle = (color: string, active: boolean): React.CSSProperties => ({ padding: '2px 7px', borderRadius: 3, border: '1px solid var(--border)', background: 'transparent', color, fontFamily: 'DM Mono', fontSize: 9, textDecoration: 'none', opacity: active ? 1 : 0.3, cursor: active ? 'pointer' : 'default', whiteSpace: 'nowrap' as const })
                              const adminPh = adminPhone.replace(/\D/g, '')
                              return (
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>Admin</div>
                                  <div style={{ position: 'relative' }}>
                                    <input
                                      value={adminQuery}
                                      onChange={e => { setAdminQuery(e.target.value); set('anr_admin_contact_id', null); setAdminContact(null); setShowAdminDD(true) }}
                                      onFocus={() => setShowAdminDD(true)}
                                      onBlur={() => setTimeout(() => setShowAdminDD(false), 150)}
                                      placeholder="—"
                                      style={{ width: '100%', background: 'var(--surface)', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0', lineHeight: 1.5 }}
                                    />
                                    {showAdminDD && (labelAdminContacts.filter(c => !adminQuery || `${c.fname || ''} ${c.lname || ''}`.toLowerCase().includes(adminQuery.toLowerCase())).length > 0 || adminQuery.trim().length >= 2) && (
                                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 }}>
                                        {labelAdminContacts.filter(c => !adminQuery || `${c.fname || ''} ${c.lname || ''}`.toLowerCase().includes(adminQuery.toLowerCase())).map((c, i) => {
                                          const name = `${c.fname || ''} ${c.lname || ''}`.trim()
                                          return (
                                            <div key={c.id} onMouseDown={e => {
                                              e.preventDefault()
                                              setAdminQuery(name); set('anr_admin_contact_id', c.id); setAdminContact(c)
                                              setAdminEmail(c.email || ''); setAdminPhone(c.phone || '')
                                              setShowAdminDD(false)
                                            }} style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text)', background: 'transparent', borderBottom: i < labelAdminContacts.length - 1 ? '1px solid var(--border)' : 'none' }}
                                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                            >
                                              <div>{name}</div>
                                              {c.role && <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 1 }}>{c.role}</div>}
                                            </div>
                                          )
                                        })}
                                        {adminQuery.trim().length >= 2 && !labelAdminContacts.some(c => `${c.fname || ''} ${c.lname || ''}`.trim().toLowerCase() === adminQuery.trim().toLowerCase()) && (() => {
                                          const clientId = form.client_db_id
                                          return (
                                            <div onMouseDown={async e => {
                                              e.preventDefault()
                                              if (!clientId) return
                                              const parts = adminQuery.trim().split(/\s+/)
                                              const fname = parts[0] || '', lname = parts.slice(1).join(' ')
                                              const { data } = await supabase.from('client_contacts').insert({ client_id: clientId, fname, lname: lname || null, contact_type: 'admin' }).select().single()
                                              if (data) { const contact = data as ClientContact; setLabelAdminContacts(prev => [...prev, contact]); setAdminQuery(adminQuery.trim()); set('anr_admin_contact_id', contact.id); setAdminContact(contact); setAdminEmail(''); setAdminPhone('') }
                                              setShowAdminDD(false)
                                            }} style={{ padding: '7px 10px', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                              <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Don&apos;t see this admin? Add &ldquo;{adminQuery.trim()}&rdquo;
                                            </div>
                                          )
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
                                    <input value={adminEmail} onChange={e => setAdminEmail(e.target.value)} onBlur={() => { if (adminContact?.id && adminEmail !== (adminContact.email || '')) { const cid = adminContact.id; setContactUpdatePrompt({ contactId: cid, column: 'email', value: adminEmail, onUpdate: () => { setAdminContact(p => p ? { ...p, email: adminEmail } : p); setLabelAdminContacts(p => p.map(c => c.id === cid ? { ...c, email: adminEmail } : c)) } }) } }} placeholder="Email" style={cInpStyle} />
                                    <a href={adminEmail ? `mailto:${adminEmail}` : undefined} onClick={!adminEmail ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--booked)', !!adminEmail)}>Email</a>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                    <input value={adminPhone} onChange={e => setAdminPhone(e.target.value)} onBlur={() => { if (adminContact?.id && adminPhone !== (adminContact.phone || '')) { const cid = adminContact.id; setContactUpdatePrompt({ contactId: cid, column: 'phone', value: adminPhone, onUpdate: () => { setAdminContact(p => p ? { ...p, phone: adminPhone } : p); setLabelAdminContacts(p => p.map(c => c.id === cid ? { ...c, phone: adminPhone } : c)) } }) } }} placeholder="Phone" style={cInpStyle} />
                                    <a href={adminPh ? `tel:${adminPh}` : undefined} onClick={!adminPh ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--booked)', !!adminPh)}>Call</a>
                                    <a href={adminPh ? `sms:${adminPh}` : undefined} onClick={!adminPh ? e => e.preventDefault() : undefined} style={aBtnStyle('var(--warm)', !!adminPh)}>Text</a>
                                  </div>
                                </div>
                              )
                            })()}

                            {/* Contact update prompt — "Update profile or just this session?" */}
                            {contactUpdatePrompt && (
                              <div style={{ position: 'fixed', inset: 0, zIndex: 10040, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ background: 'var(--surface2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '24px 28px', width: 340, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
                                  <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>Update client profile or just this session?</div>
                                  <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 20 }}>
                                    Save the new {contactUpdatePrompt.column} back to the contact record, or keep it for this booking only.
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                    <button type="button" onClick={() => setContactUpdatePrompt(null)} style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', fontFamily: 'DM Mono', fontSize: 11, background: 'transparent', color: 'var(--text2)' }}>Just this session</button>
                                    <button type="button" onClick={async () => { await supabase.from('client_contacts').update({ [contactUpdatePrompt.column]: contactUpdatePrompt.value }).eq('id', contactUpdatePrompt.contactId); contactUpdatePrompt.onUpdate(); setContactUpdatePrompt(null) }} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'DM Mono', fontSize: 11, fontWeight: 700, background: 'var(--accent)', color: 'var(--bg)' }}>Update profile</button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <ClientCardField label="Email" value={form.email} fieldKey="email" onEdit={handleClientFieldEdit} editing={true} />
                            <ClientCardField label="Phone" value={form.phone} fieldKey="phone" onEdit={handleClientFieldEdit} editing={true} />
                          </>
                        )}

                        {/* View full profile */}
                        {(
                          <button
                            onClick={() => form.client_db_id && setShowProfile(true)}
                            style={{
                              marginTop: 10, width: '100%', padding: '6px 10px', borderRadius: 4,
                              background: 'transparent', border: '1px solid var(--border)',
                              color: form.client_db_id ? 'var(--text2)' : 'var(--text3)',
                              fontFamily: 'DM Mono', fontSize: 10,
                              cursor: form.client_db_id ? 'pointer' : 'default', textAlign: 'center',
                            }}
                          >
                            {form.client_db_id ? 'View full profile →' : 'No profile linked'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* COD method — only shown when COD toggle active */}
                  {form.payment_type === 'COD' && (
                    <div>
                      <label style={fL}>COD Payment Method</label>
                      <select value={form.cod_method} onChange={e => set('cod_method', e.target.value)} style={inp}>
                        <option value="">Select method...</option>
                        {COD_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  )}

                </div>
              )
            })()}
          </div>

          {/* WORK ORDER — flows inline below the client card via the inline prop */}
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <WorkOrderPopup
              booking={booking}
              liveForm={liveForm}
              onClose={onClose}
              onStatusChange={setWoStatus}
              onFormSync={handleFormSync}
              onSaved={onClose}
              inline
            />
          </div>
        </div>

      {/* Profile update dialog — appears when user saves card edits */}
      {showProfileUpdate && (
        <div onClick={() => setShowProfileUpdate(false)} style={{ position: 'fixed', top: 52, left: 0, right: 0, bottom: 0, zIndex: 10040, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '20px 24px', maxWidth: 360, width: '100%' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Update client profile?</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'DM Mono', lineHeight: 1.6, marginBottom: 18 }}>
              You edited contact details on this booking. Save those changes to the full client profile too?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowProfileUpdate(false); setClientEdits({}) }} style={{ padding: '6px 14px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>
                Just this session
              </button>
              <button
                onClick={async () => {
                  if (form.client_db_id) {
                    for (const [col, val] of Object.entries(clientEdits)) {
                      await supabase.from('clients').update({ [col]: val }).eq('id', form.client_db_id)
                    }
                  }
                  setShowProfileUpdate(false)
                  setClientEdits({})
                }}
                style={{ padding: '6px 14px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', background: '#1e40af', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
              >
                Update profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client profile popup */}
      {showProfile && form.client_db_id && (
        <ClientProfilePopup clientId={form.client_db_id} onClose={() => setShowProfile(false)} />
      )}
    </div>,
    document.body,
  )
}

export default UnifiedSessionForm
