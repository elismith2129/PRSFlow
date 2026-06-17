'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Booking, Client, ClientContact, Engineer } from '@/lib/supabase'
import TimeInput from '@/components/shared/TimeInput'
import StudioSelect from '@/components/shared/StudioSelect'
import { ClientProfile } from '@/components/clients/ClientProfile'
import { WorkOrderPopup, type WOFormSync } from '@/components/calendar/WorkOrderPopup'
import { addArtistToLabel } from '@/lib/roster'

// ─── COLOR TOKENS ────────────────────────────────────────────────────────────

const STATUS_TOP_COLORS: Record<string, string> = {
  confirmed:  '#22c55e',
  tentative:  '#f97316',
  cancelled:  '#ef4444',
  tour:       '#a855f7',
  tech:       '#6b7280',
  open_hours: '#e2e8f0',
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmed', tentative: 'Tentative', cancelled: 'Cancelled',
  tour: 'Tour', tech: 'Tech', open_hours: 'Open Hours',
}

const COLOR_COD = '#7BBFFF'
const COLOR_LABEL = '#96A9FF'

const COD_METHODS = ['Cash', 'Credit Card', 'Zelle', 'Check', 'Venmo']

const SESSION_TYPE_LABELS: Record<string, string> = {
  recording: 'Recording', filming: 'Filming', event_playback: 'Event / Playback',
}

const ENG_STATUS_COLORS: Record<string, string> = {
  hold: '#f0a24e', confirmed: '#4ef0a2', not_needed: '#4a5568',
}
const ENG_STATUS_LABELS: Record<string, string> = {
  hold: 'Hold', confirmed: 'Confirmed', not_needed: 'Not needed',
}

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

function fmtMoney(v: string): string {
  if (!v?.trim()) return ''
  const n = parseFloat(v.replace(/[^0-9.]/g, ''))
  if (isNaN(n)) return v
  return `$${Math.round(n)}`
}

function cycleEng(s: string): string {
  const c = ['not_needed', 'hold', 'confirmed']
  return c[(c.indexOf(s) + 1) % 3]
}

// ─── FORM STATE ──────────────────────────────────────────────────────────────

export type FormData = {
  status: string; session_type: string; payment_type: string; cod_method: string
  location: string; studio: string; start_date: string; end_date: string
  from_time: string; to_time: string; rate: string; rate_daily: string; rate_type: 'hourly' | 'daily'; invoice_num: string
  client_name: string; artist: string; label: string; ordered_by: string
  phone: string; email: string; po: string; producer: string
  food_budget: boolean; food_amount: string
  engineer_name: string; engineer_rate: string; engineer_status: string
  assistant_name: string; assistant_status: string
  notes: string
  client_db_id: string | null
  is_srs: boolean
  anr_contact_id: string | null
  anr_admin_contact_id: string | null
}

export function emptyForm(overrides: Partial<FormData> = {}): FormData {
  const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) as Partial<FormData>
  return {
    status: 'tentative', session_type: 'recording', payment_type: 'COD', cod_method: '',
    location: '', studio: '',
    start_date: fmt(new Date()), end_date: fmt(new Date()),
    from_time: '', to_time: '', rate: '', rate_daily: '', rate_type: 'hourly', invoice_num: '',
    client_name: '', artist: '', label: '', ordered_by: '',
    phone: '', email: '', po: '', producer: '',
    food_budget: false, food_amount: '',
    engineer_name: '', engineer_rate: '', engineer_status: 'not_needed',
    assistant_name: '', assistant_status: 'not_needed',
    notes: '',
    client_db_id: null,
    is_srs: false,
    anr_contact_id: null,
    anr_admin_contact_id: null,
    ...clean,
  }
}

export function bookingToForm(b: Booking): FormData {
  return {
    status: b.status, session_type: b.session_type, payment_type: b.payment_type,
    cod_method: b.cod_method ?? '',
    location: b.location, studio: b.studio,
    start_date: b.start_date, end_date: b.end_date,
    from_time: b.from_time ?? '', to_time: b.to_time ?? '',
    rate: b.rate ?? '', rate_daily: b.rate_daily ?? '',
    rate_type: b.rate_type === 'day' ? 'daily' : b.rate_type === 'hour' ? 'hourly' : (b.rate_daily ? 'daily' : 'hourly'),
    invoice_num: b.invoice_num ?? '',
    client_name: b.client_name ?? '', artist: b.artist ?? '', label: b.label ?? '',
    ordered_by: b.ordered_by ?? '', phone: b.phone ?? '', email: b.email ?? '',
    po: b.po ?? '', producer: b.producer ?? '',
    food_budget: b.food_budget ?? false, food_amount: b.food_amount ?? '',
    engineer_name: b.engineer_name ?? '', engineer_rate: b.engineer_rate ?? '', engineer_status: b.engineer_status ?? 'not_needed',
    assistant_name: b.assistant_name ?? '', assistant_status: b.assistant_status ?? 'not_needed',
    notes: b.notes ?? '',
    client_db_id: b.client_id ?? null,
    is_srs: b.is_srs ?? false,
    anr_contact_id: b.anr_contact_id ?? null,
    anr_admin_contact_id: b.anr_admin_contact_id ?? null,
  }
}

// ─── CONTACT INFO POPOVER ────────────────────────────────────────────────────

function ContactInfoPopover({ contact, children }: { contact: ClientContact; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const name = `${contact.fname || ''} ${contact.lname || ''}`.trim()
  const phone = contact.phone?.replace(/\D/g, '') || ''

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey) }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: children ? 'var(--text)' : 'var(--accent)', fontSize: children ? 11 : 9, fontFamily: 'DM Mono', lineHeight: 1, textDecoration: children ? 'underline' : 'none', textDecorationColor: 'rgba(255,255,255,0.25)', textUnderlineOffset: '3px' }}
        title="Contact info"
      >
        {children ?? '↗'}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 300, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '10px 12px', minWidth: 180, maxWidth: 240 }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 12, color: 'var(--text)', marginBottom: contact.role ? 2 : 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name || '—'}
          </div>
          {contact.role && (
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8 }}>
              {contact.role}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            {phone && (
              <>
                <a href={`tel:${phone}`} style={{ flex: 1, textAlign: 'center', padding: '4px 6px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--booked)', fontFamily: 'DM Mono', fontSize: 9, textDecoration: 'none', cursor: 'pointer' }}>
                  Call
                </a>
                <a href={`sms:${phone}`} style={{ flex: 1, textAlign: 'center', padding: '4px 6px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--warm)', fontFamily: 'DM Mono', fontSize: 9, textDecoration: 'none', cursor: 'pointer' }}>
                  Text
                </a>
              </>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`} style={{ flex: 1, textAlign: 'center', padding: '4px 6px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: '#7BBFFF', fontFamily: 'DM Mono', fontSize: 9, textDecoration: 'none', cursor: 'pointer' }}>
                Email
              </a>
            )}
          </div>
          {!phone && !contact.email && (
            <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono' }}>No contact info on file.</div>
          )}
        </div>
      )}
    </div>
  )
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
      style={{ position: 'fixed', top: 52, left: 0, right: 0, bottom: 0, zIndex: 2000, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
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

// ─── BOOKING FORM ────────────────────────────────────────────────────────────

export function BookingForm({
  bookingId, booking, initial, onSave, onDelete, onClose, onDraftChange, onSaved,
}: {
  bookingId?: string
  booking?: Booking
  initial: FormData
  onSave: (data: FormData) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
  onDraftChange?: (data: FormData) => void
  onSaved?: () => void
}) {
  const [form, setForm] = useState<FormData>(initial)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [clientEdits, setClientEdits] = useState<Record<string, string>>({})
  const [showProfileUpdate, setShowProfileUpdate] = useState(false)
  const [editingCard, setEditingCard] = useState(false)
  const [cardSnapshot, setCardSnapshot] = useState<Partial<FormData> | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [clientSuggestions, setClientSuggestions] = useState<Array<{id: string; label: string; sub: string; isLabel: boolean; record: any}>>([])
  const [showClientDD, setShowClientDD] = useState(false)
  const [clientHighlight, setClientHighlight] = useState(-1)
  const [searchQuery, setSearchQuery] = useState('')
  const nameDebounce = useRef<ReturnType<typeof setTimeout>>()
  const draftTimer = useRef<ReturnType<typeof setTimeout>>()
  const skipNameSearch = useRef(false)
  const engApplied = useRef(false)
  const engEditingRef = useRef(false)
  const engPrevStatus = useRef<string>('')
  const asstApplied = useRef(false)
  const [clientArtists, setClientArtists] = useState<string[]>([])
  const [showArtistDD, setShowArtistDD] = useState(false)
  const [labelContacts, setLabelContacts] = useState<ClientContact[]>([])
  const [labelAdminContacts, setLabelAdminContacts] = useState<ClientContact[]>([])
  const [anrQuery, setAnrQuery] = useState(initial.ordered_by || '')
  const [anrContact, setAnrContact] = useState<ClientContact | null>(null)
  const [showAnrDD, setShowAnrDD] = useState(false)
  const [anrHighlight, setAnrHighlight] = useState(-1)
  const [adminQuery, setAdminQuery] = useState('')
  const [adminContact, setAdminContact] = useState<ClientContact | null>(null)
  const [showAdminDD, setShowAdminDD] = useState(false)
  const [timeTBD, setTimeTBD] = useState(false)
  const [multiDay, setMultiDay] = useState(initial.start_date !== initial.end_date && !!initial.end_date)
  const [engOn, setEngOn] = useState(initial.engineer_name !== '')
  const [asstOn, setAsstOn] = useState(initial.assistant_name !== '')
  const [engQuery, setEngQuery] = useState('')
  const [engSuggestions, setEngSuggestions] = useState<Engineer[]>([])
  const [showEngDD, setShowEngDD] = useState(false)
  const [engHighlight, setEngHighlight] = useState(-1)
  const [engEditing, setEngEditing] = useState(false)
  const [asstQuery, setAsstQuery] = useState('')
  const [asstSuggestions, setAsstSuggestions] = useState<Engineer[]>([])
  const [showAsstDD, setShowAsstDD] = useState(false)
  const [asstHighlight, setAsstHighlight] = useState(-1)
  const [showSrsModal, setShowSrsModal] = useState(false)
  const [showWO, setShowWO] = useState(false)
  const [woStatus, setWoStatus] = useState<string | null>(null)
  const [anrEmail, setAnrEmail] = useState('')
  const [anrPhone, setAnrPhone] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPhone, setAdminPhone] = useState('')
  const [contactUpdatePrompt, setContactUpdatePrompt] = useState<{
    contactId: string; column: 'email' | 'phone'; value: string; onUpdate: () => void
  } | null>(null)

  // Load WO status for button color on mount
  useEffect(() => {
    if (!bookingId) return
    supabase.from('work_orders').select('status').eq('booking_id', bookingId).maybeSingle()
      .then(({ data }) => { if (data) setWoStatus(data.status) })
  }, [bookingId])

  // Load label roster + contacts (A&Rs + Admins) for billing bookings
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
      // Edit mode: restore anrContact from ID
      if (initial.anr_contact_id) {
        const found = all.find(c => c.id === initial.anr_contact_id)
        if (found) { setAnrContact(found); setAnrEmail(found.email || ''); setAnrPhone(found.phone || '') }
      }
      // Edit mode: restore adminContact + adminQuery from ID
      if (initial.anr_admin_contact_id) {
        const found = admins.find(c => c.id === initial.anr_admin_contact_id)
        if (found) { setAdminContact(found); setAdminQuery(`${found.fname || ''} ${found.lname || ''}`.trim()); setAdminEmail(found.email || ''); setAdminPhone(found.phone || ''); return }
      }
      // New booking: auto-populate admin from most recent booking, then fall back to single admin
      if (!bookingId) {
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
  }, [form.client_db_id, form.payment_type]) // eslint-disable-line react-hooks/exhaustive-deps


  function set<K extends keyof FormData>(k: K, v: FormData[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  const liveForm = useMemo(() => ({
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

  // Debounced draft save — reports live form state back to parent for sessionStorage persistence
  useEffect(() => {
    if (!onDraftChange) return
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => onDraftChange(form), 400)
    return () => clearTimeout(draftTimer.current)
  }, [form]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skipNameSearch.current) { skipNameSearch.current = false; return }
    const q = searchQuery.trim()
    if (q.length < 2) { setClientSuggestions([]); setShowClientDD(false); return }
    clearTimeout(nameDebounce.current)
    nameDebounce.current = setTimeout(async () => {
      // Search clients (both individual by name and label clients by name)
      const [{ data: cd }, { data: ctd }] = await Promise.all([
        supabase
          .from('clients')
          .select('id,type,name,fname,lname,email,phone,artists,srs_client')
          .or(`name.ilike.%${q}%,fname.ilike.%${q}%,lname.ilike.%${q}%`)
          .limit(30),
        // Search A&R contacts by name, join to parent client for label name
        supabase
          .from('client_contacts')
          .select('id,client_id,fname,lname,email,phone,clients(id,name,type,srs_client)')
          .or(`fname.ilike.%${q}%,lname.ilike.%${q}%`)
          .limit(20),
      ])

      const seen = new Set<string>()
      const results: typeof clientSuggestions = []

      // A&R contacts from client_contacts (show label name as sub-text)
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

      // Direct client matches
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

      setClientSuggestions(results)
      setShowClientDD(results.length > 0)
    }, 200)
    return () => clearTimeout(nameDebounce.current)
  }, [searchQuery])

  useEffect(() => {
    if (!engOn) { setEngSuggestions([]); setShowEngDD(false); return }
    const q = engQuery.trim()
    const t = setTimeout(async () => {
      const base = supabase.from('engineers')
        .select('id,first_name,last_name,role,initials')
        .eq('active', true)
        .in('role', ['Engineer', 'Both'])
        .order('first_name')
        .limit(20)
      const { data } = q.length >= 1
        ? await base.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        : await base
      setEngSuggestions((data || []) as Engineer[])
      setShowEngDD(q.length >= 1 && (data || []).length > 0)
    }, q.length >= 1 ? 150 : 0)
    return () => clearTimeout(t)
  }, [engQuery, engOn])

  useEffect(() => {
    if (!asstOn) { setAsstSuggestions([]); setShowAsstDD(false); return }
    const q = asstQuery.trim()
    const t = setTimeout(async () => {
      const base = supabase.from('engineers')
        .select('id,first_name,last_name,role,initials')
        .eq('active', true)
        .in('role', ['Assistant', 'Both'])
        .order('first_name')
        .limit(20)
      const { data } = q.length >= 1
        ? await base.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        : await base
      setAsstSuggestions((data || []) as Engineer[])
      setShowAsstDD(q.length >= 1 && (data || []).length > 0)
    }, q.length >= 1 ? 150 : 0)
    return () => clearTimeout(t)
  }, [asstQuery, asstOn])

  function applyClientAutofill(s: typeof clientSuggestions[0]) {
    skipNameSearch.current = true
    const r = s.record
    // If record has _anrFname it came from client_contacts — use those details
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
      artist: labelName ? '' : ((r.artists && r.artists.length > 0 ? r.artists[0] : f.artist) || f.artist),
      is_srs: r.srs_client === true ? true : f.is_srs,
    }))
    setAnrQuery(labelName ? clientName : '')
    setSearchQuery('')
    setShowClientDD(false)
    setClientHighlight(-1)
    setClientEdits({})
    setEditingCard(false)
    setCardSnapshot(null)
  }

  function clearClient() {
    setForm(f => ({ ...f, client_name: '', artist: '', label: '', ordered_by: '', phone: '', email: '', client_db_id: null }))
    setClientArtists([])
    setLabelContacts([])
    setAnrQuery('')
    setSearchQuery('')
    setClientEdits({})
    setEditingCard(false)
    setCardSnapshot(null)
  }

  function startCardEdit() {
    setCardSnapshot({ client_name: form.client_name, email: form.email, phone: form.phone, label: form.label, artist: form.artist })
    setClientEdits({})
    setEditingCard(true)
  }

  function cancelCardEdit() {
    if (cardSnapshot) setForm(f => ({ ...f, ...cardSnapshot }))
    setClientEdits({})
    setEditingCard(false)
    setCardSnapshot(null)
  }

  function saveCardEdit() {
    if (form.client_db_id && Object.keys(clientEdits).length > 0) {
      setShowProfileUpdate(true)
    } else {
      setEditingCard(false)
      setClientEdits({})
      setCardSnapshot(null)
    }
  }

  function exitCardEditMode() {
    setEditingCard(false)
    setClientEdits({})
    setCardSnapshot(null)
    setShowProfileUpdate(false)
  }

  function handleClientFieldEdit(formKey: keyof FormData, value: string) {
    set(formKey, value)
    const colMap: Partial<Record<keyof FormData, string>> = { email: 'email', phone: 'phone', client_name: 'name', label: 'label' }
    const clientColumn = colMap[formKey] ?? null
    if (form.client_db_id && clientColumn) {
      setClientEdits(prev => ({ ...prev, [clientColumn]: value }))
    }
  }

  function applyEng(eng: Engineer | string) {
    engApplied.current = true
    const name = typeof eng === 'string' ? eng : `${eng.first_name} ${eng.last_name}`
    set('engineer_name', name)
    set('engineer_status', 'hold')
    setEngQuery(''); setShowEngDD(false); setEngHighlight(-1); setEngEditing(false); engEditingRef.current = false
  }

  function applyAsst(eng: Engineer | string) {
    asstApplied.current = true
    const name = typeof eng === 'string' ? eng : `${eng.first_name} ${eng.last_name}`
    set('assistant_name', name)
    set('assistant_status', 'hold')
    setAsstQuery(''); setShowAsstDD(false); setAsstHighlight(-1)
  }

  async function handleSave() {
    if (!form.start_date || !form.end_date || !form.location || !form.studio) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(form)
      onClose()
    } catch (err: any) {
      const msg = [err?.message, err?.details].filter(Boolean).join(' — ')
      console.error('[BookingForm] save failed:', err)
      setSaveError(msg || 'Failed to save booking')
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) return
    setSaving(true)
    await onDelete()
    setSaving(false)
    onClose()
  }

  const sectionHead: React.CSSProperties = {
    fontSize: 9, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text3)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
    borderBottom: '1px solid var(--border)', paddingBottom: 7, marginBottom: 12,
  }

  return (
    <div
      style={{
        position: 'fixed', top: 52, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.72)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          width: '100%', maxWidth: 960, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'flex-start',
          gap: 12, flexShrink: 0,
        }}>
          {form.payment_type === 'billing' ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: 'DM Serif Display', fontSize: 34, lineHeight: 1.15,
                color: (form.artist || form.label) ? '#96A9FF' : 'var(--text3)',
              }}>
                {form.artist || form.label || 'New Booking'}
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
                fontFamily: 'DM Serif Display', fontSize: 34, lineHeight: 1.15,
                color: form.client_name ? '#7BBFFF' : 'var(--text3)',
              }}>
                {form.client_name || 'New Booking'}
              </div>
            </div>
          )}
          {form.invoice_num && (
            <div style={{
              fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)',
              border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', flexShrink: 0,
            }}>
              #{form.invoice_num}
            </div>
          )}
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--text3)',
            fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px', flexShrink: 0,
          }}>×</button>
        </div>

        {/* Status chips */}
        <div style={{
          padding: '8px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap',
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

        {/* Body */}
        <div style={{ padding: '18px 20px', flex: 1, overflowY: 'auto' }}>
          {/* Two-column top half */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginBottom: 20 }}>

            {/* LEFT — Session details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={sectionHead}>Session</div>

              {/* Studio + Rate */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div>
                  <label style={fL}>Studio</label>
                  <StudioSelect
                    location={form.location}
                    studio={form.studio}
                    onChange={(location, studio) => setForm(f => ({ ...f, location, studio }))}
                    selectStyle={{ ...inp, width: 'auto', flex: 'none' }}
                  />
                </div>
                <div>
                  <label style={fL}>Rate</label>
                  <div style={{ display: 'flex', gap: 0 }}>
                    <button type="button" onClick={() => set('rate_type', 'hourly')} style={{
                      padding: '4px 8px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700,
                      letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer',
                      borderRadius: '4px 0 0 4px', border: '1px solid var(--border)',
                      background: form.rate_type === 'hourly' ? 'rgba(200,240,78,0.12)' : 'transparent',
                      color: form.rate_type === 'hourly' ? 'var(--accent)' : 'var(--text3)',
                    }}>/ hr</button>
                    <button type="button" onClick={() => set('rate_type', 'daily')} style={{
                      padding: '4px 8px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700,
                      letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer',
                      borderRadius: '0 4px 4px 0', border: '1px solid var(--border)', borderLeft: 'none',
                      background: form.rate_type === 'daily' ? 'rgba(200,240,78,0.12)' : 'transparent',
                      color: form.rate_type === 'daily' ? 'var(--accent)' : 'var(--text3)',
                    }}>/ day</button>
                    <input
                      placeholder="$0"
                      value={form.rate_type === 'hourly' ? form.rate : form.rate_daily}
                      onChange={e => set(form.rate_type === 'hourly' ? 'rate' : 'rate_daily', e.target.value)}
                      onBlur={e => {
                        const f = fmtMoney(e.target.value)
                        const key = form.rate_type === 'hourly' ? 'rate' : 'rate_daily'
                        if (f !== e.target.value) set(key, f)
                      }}
                      style={{ ...inp, width: 80, borderRadius: '0 4px 4px 0', borderLeft: 'none', marginLeft: 6 }}
                    />
                  </div>
                </div>
              </div>

              {/* Session type */}
              <div>
                <label style={fL}>Session Type</label>
                <div style={{ display: 'flex', gap: 5 }}>
                  {Object.entries(SESSION_TYPE_LABELS).map(([k, v]) => (
                    <button key={k} onClick={() => set('session_type', k)} style={{
                      flex: 1, padding: '4px 6px', borderRadius: 4, fontSize: 9,
                      fontFamily: 'DM Mono', cursor: 'pointer',
                      border: form.session_type === k ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: form.session_type === k ? 'rgba(200,240,78,0.08)' : 'var(--surface2)',
                      color: form.session_type === k ? 'var(--accent)' : 'var(--text2)',
                    }}>{v}</button>
                  ))}
                </div>
              </div>

              {/* Dates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={fL}>Start Date</label>
                  <input type="date" value={form.start_date || ''} onChange={e => { set('start_date', e.target.value); if (!multiDay) set('end_date', e.target.value) }} style={inp} />
                </div>
                {multiDay ? (
                  <div>
                    <label style={fL}>End Date</label>
                    <input type="date" value={form.end_date || ''} onChange={e => set('end_date', e.target.value)} style={inp} />
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input type="checkbox" checked={false} onChange={() => setMultiDay(true)} style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                      <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono' }}>Multi-day</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Times */}
              <div>
                <label style={fL}>From – To</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!timeTBD && (
                    <>
                      <TimeInput value={form.from_time} onChange={v => set('from_time', v)} style={{ ...inp, width: 90 }} />
                      <TimeInput value={form.to_time} onChange={v => set('to_time', v)} style={{ ...inp, width: 90 }} />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => { setTimeTBD(t => !t); if (!timeTBD) { set('from_time', ''); set('to_time', '') } }}
                    style={{
                      padding: '4px 14px', borderRadius: 20, fontSize: 10, fontFamily: 'DM Mono',
                      fontWeight: 600, cursor: 'pointer', border: 'none',
                      background: timeTBD ? '#c2410c' : 'var(--surface2)',
                      color: timeTBD ? '#fff' : 'var(--text3)',
                      outline: timeTBD ? '2px solid rgba(194,65,12,0.4)' : '1px solid var(--border)',
                      marginLeft: 0,
                    }}
                  >TBD</button>
                </div>
              </div>

              {/* Engineer + Assistant — side by side */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

                {/* Engineer */}
                <div>
                  <label style={fL}>Engineer</label>
                  <div style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (engOn && form.engineer_name) {
                            engPrevStatus.current = form.engineer_status
                            engEditingRef.current = true
                            setEngEditing(true)
                            setEngQuery(form.engineer_name)
                          } else {
                            const next = !engOn
                            setEngOn(next)
                            if (!next) { set('engineer_name', ''); set('engineer_status', 'not_needed'); setEngQuery('') }
                          }
                        }}
                        style={{
                          padding: '5px 9px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne',
                          fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                          background: engOn ? (ENG_STATUS_COLORS[form.engineer_status] ?? '#f0a24e') + '22' : '#1a1d27',
                          color: engOn ? (ENG_STATUS_COLORS[form.engineer_status] ?? '#f0a24e') : '#8b90a8',
                          border: `1px solid ${engOn ? (ENG_STATUS_COLORS[form.engineer_status] ?? '#f0a24e') + '55' : '#2a2e3d'}`,
                        }}
                      >{engOn && form.engineer_name ? `● ${form.engineer_name}` : engOn ? '● ENG' : '○ ENG'}</button>
                      {engOn && (!form.engineer_name || engEditing) && (
                        <input
                          placeholder="Name…"
                          value={engQuery}
                          onChange={e => setEngQuery(e.target.value)}
                          onBlur={() => {
                            setTimeout(() => {
                              setShowEngDD(false)
                              if (engEditingRef.current) {
                                engEditingRef.current = false
                                if (!engApplied.current) { setEngEditing(false); setEngQuery(''); set('engineer_status', engPrevStatus.current) }
                                engApplied.current = false
                              } else {
                                const q = engQuery.trim()
                                if (!engApplied.current && q) applyEng(q)
                                engApplied.current = false
                              }
                            }, 150)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'ArrowDown') { e.preventDefault(); setEngHighlight(h => Math.min(h + 1, engSuggestions.length - 1)) }
                            else if (e.key === 'ArrowUp') { e.preventDefault(); setEngHighlight(h => Math.max(h - 1, 0)) }
                            else if (e.key === 'Enter') { e.preventDefault(); if (engHighlight >= 0) applyEng(engSuggestions[engHighlight]); else if (engQuery.trim()) applyEng(engQuery.trim()) }
                            else if (e.key === 'Escape') { engApplied.current = true; setEngQuery(''); setShowEngDD(false); setEngEditing(false); set('engineer_status', engPrevStatus.current) }
                          }}
                          style={{ background: '#1a1d27', border: '1px solid #2a2e3d', color: '#e8eaf2', fontFamily: 'DM Mono', fontSize: 11, padding: '5px 8px', borderRadius: 4, flex: 1, minWidth: 0, outline: 'none' }}
                          autoComplete="off"
                        />
                      )}
                      {engOn && form.engineer_name && !engEditing && (
                        <button type="button" onClick={() => set('engineer_status', cycleEng(form.engineer_status))} style={{ padding: '4px 8px', borderRadius: 20, fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer', border: 'none', background: ENG_STATUS_COLORS[form.engineer_status] + '22', color: ENG_STATUS_COLORS[form.engineer_status], outline: `1px solid ${ENG_STATUS_COLORS[form.engineer_status]}55`, flexShrink: 0 }}>
                          {ENG_STATUS_LABELS[form.engineer_status]}
                        </button>
                      )}
                      {engOn && form.engineer_name && !engEditing && (
                        <button type="button" onMouseDown={() => { set('engineer_name', ''); set('engineer_status', 'not_needed'); setEngQuery(''); setEngEditing(false) }} style={{ background: 'none', border: 'none', color: '#4a4f64', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '1px 4px', flexShrink: 0 }}>×</button>
                      )}
                    </div>
                    {showEngDD && engSuggestions.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#13161e', border: '1px solid #2a2e3d', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 }}>
                        {engSuggestions.map((eng, i) => (
                          <div key={eng.id} onMouseDown={() => applyEng(eng)} style={{ padding: '7px 12px', cursor: 'pointer', background: i === engHighlight ? '#1a1d27' : 'transparent', borderBottom: i < engSuggestions.length - 1 ? '1px solid #2a2e3d' : 'none' }}>
                            <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#e8eaf2' }}>{eng.first_name} {eng.last_name}</div>
                            <div style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#4a4f64', marginTop: 1 }}>{eng.initials ?? ''}{eng.initials ? ' · ' : ''}{eng.role}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {engOn && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <label style={{ ...fL, marginBottom: 0, whiteSpace: 'nowrap' }}>Eng. Rate</label>
                      <input
                        type="text"
                        value={form.engineer_rate}
                        onChange={e => set('engineer_rate', e.target.value)}
                        onBlur={e => set('engineer_rate', fmtMoney(e.target.value))}
                        placeholder=""
                        style={{ background: '#1a1d27', border: '1px solid #2a2e3d', color: '#e8eaf2', fontFamily: 'DM Mono', fontSize: 11, padding: '5px 8px', borderRadius: 4, width: 60, outline: 'none' }}
                      />
                    </div>
                  )}
                </div>

                {/* Assistant */}
                <div>
                  <label style={fL}>Assistant</label>
                  <div style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !asstOn
                          setAsstOn(next)
                          if (!next) { set('assistant_name', ''); set('assistant_status', 'not_needed'); setAsstQuery('') }
                        }}
                        style={{
                          padding: '5px 9px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne',
                          fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                          background: asstOn ? 'rgba(240,78,122,0.12)' : '#1a1d27',
                          color: asstOn ? '#f04e7a' : '#8b90a8',
                          border: `1px solid ${asstOn ? 'rgba(240,78,122,0.35)' : '#2a2e3d'}`,
                        }}
                      >{asstOn && form.assistant_name ? `● ${form.assistant_name}` : asstOn ? '● ASST' : '○ ASST'}</button>
                      {asstOn && !form.assistant_name && (
                        <input
                          placeholder="Name…"
                          value={asstQuery}
                          onChange={e => setAsstQuery(e.target.value)}
                          onBlur={() => {
                            const q = asstQuery.trim()
                            setTimeout(() => {
                              setShowAsstDD(false)
                              if (!asstApplied.current && q) applyAsst(q)
                              asstApplied.current = false
                            }, 150)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'ArrowDown') { e.preventDefault(); setAsstHighlight(h => Math.min(h + 1, asstSuggestions.length - 1)) }
                            else if (e.key === 'ArrowUp') { e.preventDefault(); setAsstHighlight(h => Math.max(h - 1, 0)) }
                            else if (e.key === 'Enter') { e.preventDefault(); if (asstHighlight >= 0) applyAsst(asstSuggestions[asstHighlight]); else if (asstQuery.trim()) applyAsst(asstQuery.trim()) }
                            else if (e.key === 'Escape') { setAsstQuery(''); setShowAsstDD(false) }
                          }}
                          style={{ background: '#1a1d27', border: '1px solid #2a2e3d', color: '#e8eaf2', fontFamily: 'DM Mono', fontSize: 11, padding: '5px 8px', borderRadius: 4, flex: 1, minWidth: 0, outline: 'none' }}
                          autoComplete="off"
                        />
                      )}
                      {asstOn && form.assistant_name && (
                        <button type="button" onClick={() => set('assistant_status', cycleEng(form.assistant_status))} style={{ padding: '4px 8px', borderRadius: 20, fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer', border: 'none', background: ENG_STATUS_COLORS[form.assistant_status] + '22', color: ENG_STATUS_COLORS[form.assistant_status], outline: `1px solid ${ENG_STATUS_COLORS[form.assistant_status]}55`, flexShrink: 0 }}>
                          {ENG_STATUS_LABELS[form.assistant_status]}
                        </button>
                      )}
                      {asstOn && form.assistant_name && (
                        <button type="button" onMouseDown={() => { set('assistant_name', ''); set('assistant_status', 'not_needed'); setAsstQuery('') }} style={{ background: 'none', border: 'none', color: '#4a4f64', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '1px 4px', flexShrink: 0 }}>×</button>
                      )}
                    </div>
                    {showAsstDD && asstSuggestions.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#13161e', border: '1px solid #2a2e3d', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 }}>
                        {asstSuggestions.map((eng, i) => (
                          <div key={eng.id} onMouseDown={() => applyAsst(eng)} style={{ padding: '7px 12px', cursor: 'pointer', background: i === asstHighlight ? '#1a1d27' : 'transparent', borderBottom: i < asstSuggestions.length - 1 ? '1px solid #2a2e3d' : 'none' }}>
                            <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#e8eaf2' }}>{eng.first_name} {eng.last_name}</div>
                            <div style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#4a4f64', marginTop: 1 }}>{eng.initials ?? ''}{eng.initials ? ' · ' : ''}{eng.role}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Work Order + Invoice + Invoice # */}
              {(() => {
                const woCanCreate = !!form.studio && !!form.start_date &&
                  !!(form.rate || form.rate_daily) &&
                  !!form.payment_type && !!form.client_name &&
                  !!(form.phone || form.email)
                const woUnlocked = woCanCreate
                const woComplete = woStatus === 'submitted' || woStatus === 'approved'
                const woInProgress = woStatus === 'draft'
                const woColor = woComplete ? '#4ef0a2' : (woInProgress || woCanCreate) ? '#fb923c' : 'var(--text3)'
                const woBorder = woComplete ? 'rgba(78,240,162,0.6)' : (woInProgress || woCanCreate) ? 'rgba(251,146,60,0.6)' : 'var(--border)'
                const woBg = woComplete ? 'rgba(78,240,162,0.1)' : (woInProgress || woCanCreate) ? 'rgba(251,146,60,0.08)' : 'transparent'
                return (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => { if (woUnlocked && booking) setShowWO(true) }}
                  title={woUnlocked ? 'Open work order' : 'Fill in studio, date, rate, payment type, client, and phone/email first'}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 5, fontSize: 12, fontFamily: 'Syne',
                    fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                    cursor: woUnlocked ? 'pointer' : 'default',
                    background: woBg,
                    border: `1px solid ${woBorder}`, color: woColor, whiteSpace: 'nowrap',
                    opacity: woUnlocked ? 1 : 0.45,
                  }}>Work Order</button>
                <button style={{
                  flex: 1, padding: '8px 0', borderRadius: 5, fontSize: 12, fontFamily: 'Syne',
                  fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                  cursor: 'pointer', background: 'transparent',
                  border: '1px solid var(--border)', color: 'var(--text2)', whiteSpace: 'nowrap',
                }}>Invoice{form.invoice_num ? ` #${form.invoice_num}` : ''}</button>
                <div>
                  <label style={fL}>Invoice #</label>
                  <input
                    value={form.invoice_num}
                    onChange={e => set('invoice_num', e.target.value)}
                    style={{ ...inp, width: 80 }}
                  />
                </div>
              </div>
                )
              })()}
            </div>

            {/* RIGHT — Client card */}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div style={sectionHead}>Client</div>

                  {/* SRS + COD / Label billing toggle row */}
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                    {/* SRS toggle */}
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
                        color: form.is_srs ? '#ff3b3b' : '#6b7280',
                        letterSpacing: '0.08em', transition: 'all 0.15s',
                      }}
                    >
                      SRS
                    </button>

                    {/* COD / Label billing toggle */}
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
                      position: 'fixed', inset: 0, zIndex: 200,
                      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{
                        background: '#13161d', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 10, padding: '28px 32px', width: 380, maxWidth: '90vw',
                        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                      }}>
                        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: '#e8eaf0', marginBottom: 10 }}>
                          SRS Referral
                        </div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#8b90a8', lineHeight: 1.6, marginBottom: 24 }}>
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
                              background: 'transparent', color: '#8b90a8',
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
                              background: '#c8f04e', color: '#0d0f14',
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
                        placeholder={isBilling ? 'Search label or client name…' : 'Search client name…'}
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
                            {/* 1. Artist — plain text, no popover */}
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
                              <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ background: '#13161d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '24px 28px', width: 340, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
                                  <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: '#e8eaf0', marginBottom: 8 }}>Update client profile or just this session?</div>
                                  <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: '#8b90a8', lineHeight: 1.6, marginBottom: 20 }}>
                                    Save the new {contactUpdatePrompt.column} back to the contact record, or keep it for this booking only.
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                    <button type="button" onClick={() => setContactUpdatePrompt(null)} style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', fontFamily: 'DM Mono', fontSize: 11, background: 'transparent', color: '#8b90a8' }}>Just this session</button>
                                    <button type="button" onClick={async () => { await supabase.from('client_contacts').update({ [contactUpdatePrompt.column]: contactUpdatePrompt.value }).eq('id', contactUpdatePrompt.contactId); contactUpdatePrompt.onUpdate(); setContactUpdatePrompt(null) }} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'DM Mono', fontSize: 11, fontWeight: 700, background: 'var(--accent)', color: '#0d0f14' }}>Update profile</button>
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

          {/* Notes — full width */}
          <div>
            <label style={fL}>Session Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Notes for this session..."
              style={{ ...inp, height: 120, resize: 'vertical', lineHeight: 1.6 }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
        }}>
          <div>
            {bookingId && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)} style={{
                padding: '6px 14px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono',
                cursor: 'pointer', background: 'transparent',
                border: '1px solid var(--hot)', color: 'var(--hot)',
              }}>Delete</button>
            )}
            {bookingId && confirmDelete && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--hot)' }}>Confirm delete?</span>
                <button onClick={handleDelete} style={{
                  padding: '6px 12px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono',
                  cursor: 'pointer', background: 'var(--hot)', border: 'none', color: '#fff',
                }}>Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} style={{
                  padding: '6px 12px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono',
                  cursor: 'pointer', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)',
                }}>Cancel</button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {saveError && (
              <div style={{ fontSize: 10, color: 'var(--hot)', fontFamily: 'DM Mono', padding: '3px 8px', background: 'rgba(240,78,122,0.1)', borderRadius: 4, border: '1px solid rgba(240,78,122,0.3)' }}>
                {saveError}
              </div>
            )}
            <button onClick={onClose} style={{
              padding: '6px 16px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono',
              cursor: 'pointer', background: 'var(--surface2)',
              border: '1px solid var(--border)', color: 'var(--text2)',
            }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{
              padding: '6px 20px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono',
              cursor: saving ? 'default' : 'pointer', background: '#1e40af',
              border: 'none', color: '#fff', fontWeight: 700, opacity: saving ? 0.6 : 1,
            }}>{saving ? 'Saving...' : 'Save Booking'}</button>
          </div>
        </div>
      </div>

      {/* Profile update dialog — appears when user saves card edits */}
      {showProfileUpdate && (
        <div onClick={e => { e.stopPropagation(); exitCardEditMode() }} style={{ position: 'fixed', top: 52, left: 0, right: 0, bottom: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '20px 24px', maxWidth: 360, width: '100%' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Update client profile?</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'DM Mono', lineHeight: 1.6, marginBottom: 18 }}>
              You edited contact details on this booking. Save those changes to the full client profile too?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => exitCardEditMode()} style={{ padding: '6px 14px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>
                Just this session
              </button>
              <button
                onClick={async () => {
                  if (form.client_db_id) {
                    for (const [col, val] of Object.entries(clientEdits)) {
                      await supabase.from('clients').update({ [col]: val }).eq('id', form.client_db_id)
                    }
                  }
                  exitCardEditMode()
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

      {/* Work order popup */}
      {showWO && (
        <WorkOrderPopup
          booking={booking ?? { id: '', start_date: form.start_date, end_date: form.end_date, location: form.location, studio: form.studio, from_time: form.from_time, to_time: form.to_time, payment_type: form.payment_type, client_name: form.client_name, phone: form.phone, email: form.email, artist: form.artist, label: form.label, ordered_by: form.ordered_by, po: form.po, producer: form.producer, engineer_name: form.engineer_name, assistant_name: form.assistant_name, food_budget: form.food_budget, food_amount: form.food_amount, invoice_num: form.invoice_num, rate: form.rate, rate_daily: form.rate_daily } as any}
          liveForm={liveForm}
          onClose={() => {
            setShowWO(false)
            if (booking) {
              supabase.from('work_orders').select('status').eq('booking_id', booking.id).maybeSingle()
                .then(({ data }) => { if (data) setWoStatus(data.status) })
            }
          }}
          onStatusChange={setWoStatus}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
