'use client'

// ─── IMPORTS ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import type { Booking, Client, ClientContact, Engineer } from '@/lib/supabase'
import TimeInput from '@/components/shared/TimeInput'
import StudioSelect from '@/components/shared/StudioSelect'
import { ClientProfile } from '@/components/clients/ClientProfile'
import { addArtistToLabel } from '@/lib/roster'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type USFForm = {
  // Booking identity
  status: string
  session_type: string
  payment_type: string
  cod_method: string
  location: string
  studio: string
  start_date: string
  end_date: string
  from_time: string
  to_time: string
  rate: string
  rate_daily: string
  rate_type: 'hourly' | 'daily'
  invoice_num: string

  // Client info
  client_name: string
  artist: string
  label: string
  ordered_by: string
  phone: string
  email: string
  po: string
  producer: string
  food_budget: boolean
  food_amount: string

  // Staff
  engineer_name: string
  engineer_rate: string
  engineer_status: string
  assistant_name: string
  assistant_status: string

  // Booking notes
  notes: string

  // Client DB refs
  client_db_id: string | null
  is_srs: boolean
  anr_contact_id: string | null
  anr_admin_contact_id: string | null

  // WO-specific
  wo_id: string | null
  studios: string[]
  session_notes: string
  payment_status: string
  print_name: string
  signature_data: string
  needs_attention_notes: string
  needs_attention_photos: string[]
}

type StRow = {
  id: string
  studio: string
  date: string
  session_info: string
  from_time: string
  to_time: string
  total_hours: number | null
  rate: string
  rate_daily: string
  row_rate_type: 'hour' | 'day'
  charge: number | null
  sort_order: number
  day_count: number | null
  ot_rate: string
  ot_hours: string
  ot_charge: number | null
  eng_hours: number | null
  eng_rate: string
  eng_charge: number | null
  eng_from_time: string
  eng_to_time: string
  admin_checked: boolean
  admin_locked: boolean
  eng_visible: boolean
}

type EquipRow = {
  id: string
  equipment: string
  date: string
  condition: 'ok' | 'not_ok' | null
}

type RentRow = {
  id: string
  qty: string
  item: string
  supplier: string
  dates_used: string
  rate: string
  charge: string
}

type PayRow = {
  id: string
  payment_type: string
  amount: string
  memo: string
  last_four: string
}

type EquipNote = { id: string; note: string; photo_urls: string[] }

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const STATUS_TOP_COLORS: Record<string, string> = {
  confirmed:  '#22c55e',
  tentative:  '#f97316',
  cancelled:  '#ef4444',
  tour:       '#a855f7',
  tech:       '#6b7280',
  open_hours: '#e2e8f0',
}

const STATUS_LABELS: Record<string, string> = {
  confirmed:  'Confirmed',
  tentative:  'Tentative',
  cancelled:  'Cancelled',
  tour:       'Tour',
  tech:       'Tech',
  open_hours: 'Open Hours',
}

const COLOR_COD = '#7D8FD7'
const COLOR_LABEL = '#96A9FF'

const COD_METHODS = ['Cash', 'Credit Card', 'Zelle', 'Check', 'Venmo']

const SESSION_TYPE_LABELS: Record<string, string> = {
  recording:      'Recording',
  filming:        'Filming',
  event_playback: 'Event / Playback',
}

const ENG_STATUS_COLORS: Record<string, string> = {
  hold:       '#f0a24e',
  confirmed:  '#4ef0a2',
  not_needed: '#4a5568',
}

const ENG_STATUS_LABELS: Record<string, string> = {
  hold:       'Hold',
  confirmed:  'Confirmed',
  not_needed: 'Not needed',
}

const STUDIO_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'X']
const EQUIPMENT_ITEMS = ['Speakers', 'Microphone', 'Console']

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function emptyUSFForm(overrides: Partial<USFForm> = {}): USFForm {
  const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) as Partial<USFForm>
  return {
    status: 'tentative', session_type: 'recording', payment_type: 'COD', cod_method: '',
    location: '', studio: '',
    start_date: fmtDay(new Date()), end_date: fmtDay(new Date()),
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
    wo_id: null,
    studios: [],
    session_notes: '',
    payment_status: 'COD',
    print_name: '',
    signature_data: '',
    needs_attention_notes: '',
    needs_attention_photos: [],
    ...clean,
  }
}

function formatCurrency(val: string): string {
  const num = parseFloat(String(val).replace(/[$,]/g, ''))
  if (isNaN(num)) return ''
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function stripCurrency(val: string): number | null {
  const n = parseFloat(String(val).replace(/[$,]/g, ''))
  return isNaN(n) ? null : n
}

function timeToMins(t: string | null | undefined): number {
  if (!t) return 0
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!m) return 0
  let h = parseInt(m[1])
  const min = parseInt(m[2])
  const ap = m[3]?.toUpperCase()
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + min
}

function calcHours(from: string, to: string): number | null {
  if (!from || !to) return null
  const f = timeToMins(from)
  const t = timeToMins(to)
  let diff = t - f
  if (diff <= 0) diff += 24 * 60
  if (diff >= 24 * 60) return null
  return parseFloat((diff / 60).toFixed(2))
}

function calcCharge(hours: number | null, rate: string): number | null {
  if (!hours || !rate) return null
  const r = parseFloat(rate.replace(/[^0-9.]/g, ''))
  if (isNaN(r) || r === 0) return null
  return parseFloat((hours * r).toFixed(2))
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  const d = new Date(s)
  while (d <= e) {
    dates.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

function fmtDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function toStudioLetter(s: string): string {
  const m = s.match(/Studio\s+([A-Z])/i)
  return m ? m[1].toUpperCase() : s.trim()
}

function shortDate(d: string): string {
  if (!d) return '—'
  const parts = d.split('-')
  if (parts.length < 3) return d
  return `${parseInt(parts[1], 10)}-${parseInt(parts[2], 10)}`
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

function normalizeStRow(d: any): StRow {
  const dayCount = d.day_count != null ? Number(d.day_count) : null
  const rowRateType: 'hour' | 'day' = d.row_rate_type === 'day' ? 'day' : 'hour'
  const rate = d.rate ?? ''
  const rateDailyRaw = d.rate_daily != null ? String(d.rate_daily) : ''
  const totalHours = d.total_hours != null ? Number(d.total_hours) : null
  const otRateStr = d.ot_rate != null ? String(d.ot_rate) : ''

  let charge: number | null
  let otHoursStr: string
  let otCharge: number | null

  if (rowRateType === 'day') {
    const rateNum = parseFloat(String(rateDailyRaw || rate).replace(/[^0-9.]/g, ''))
    charge = !isNaN(rateNum) && rateNum > 0 ? rateNum : (d.charge != null ? Number(d.charge) : null)
    const actualHours = calcHours(d.from_time ?? '', d.to_time ?? '') ?? 0
    const autoOt = Math.max(0, parseFloat(actualHours.toFixed(2)) - 12)
    const otRateNum = parseFloat(otRateStr.replace(/[^0-9.]/g, '')) || 0
    otHoursStr = String(autoOt)
    otCharge = autoOt > 0 && otRateNum > 0 ? parseFloat((autoOt * otRateNum).toFixed(2)) : null
  } else {
    const rateNum = parseFloat(String(rate).replace(/[^0-9.]/g, ''))
    charge = (totalHours != null && totalHours > 0 && !isNaN(rateNum) && rateNum > 0)
      ? parseFloat((totalHours * rateNum).toFixed(2))
      : (d.charge != null ? Number(d.charge) : null)
    otHoursStr = d.ot_hours != null ? String(d.ot_hours) : '0'
    otCharge = d.ot_charge != null ? Number(d.ot_charge) : null
  }

  const engFromTime = d.eng_from_time ?? d.from_time ?? ''
  const engToTime   = d.eng_to_time   ?? d.to_time   ?? ''
  const engRate = d.eng_rate != null ? String(d.eng_rate) : ''
  const engHours = calcHours(engFromTime, engToTime) ?? (d.eng_hours != null ? Number(d.eng_hours) : null)
  let engCharge = null as number | null
  if (engHours != null && engHours > 0 && engRate) {
    const erNum = parseFloat(engRate.replace(/[^0-9.]/g, ''))
    engCharge = !isNaN(erNum) && erNum > 0 ? parseFloat((engHours * erNum).toFixed(2)) : null
  }

  return {
    id: d.id, studio: d.studio ?? '', date: d.date ?? '', session_info: d.session_info ?? '',
    from_time: d.from_time ?? '', to_time: d.to_time ?? '',
    total_hours: totalHours,
    rate, rate_daily: rateDailyRaw, row_rate_type: rowRateType,
    charge, sort_order: d.sort_order ?? 0, day_count: dayCount,
    ot_rate: rowRateType === 'hour' ? (otRateStr || rate) : otRateStr,
    ot_hours: otHoursStr,
    ot_charge: otCharge,
    eng_hours: engHours,
    eng_rate: engRate,
    eng_charge: engCharge,
    eng_from_time: engFromTime,
    eng_to_time: engToTime,
    admin_checked: d.admin_checked ?? false,
    admin_locked: d.admin_locked ?? false,
    eng_visible: d.eng_visible ?? true,
  }
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────
// Exact copies from BookingForm.tsx

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

// ─── MAIN COMPONENT SKELETON ──────────────────────────────────────────────────

export function UnifiedSessionForm({ bookingId, onClose }: { bookingId: string | null; onClose: () => void }) {
  // ── Form state ───────────────────────────────────────────────────────────
  const [form, setForm] = useState<USFForm>(emptyUSFForm())
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [woStatus, setWoStatus] = useState<string | null>(null)

  // ── Studio time rows ─────────────────────────────────────────────────────
  const [stRows, setStRows] = useState<StRow[]>([])
  const originalStRowsRef = useRef<StRow[]>([])
  const deletedRowsRef = useRef<StRow[]>([])
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null)
  const [confirmClearEngId, setConfirmClearEngId] = useState<string | null>(null)
  const [pendingLockedEdits, setPendingLockedEdits] = useState<Record<string, StRow>>({})
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set())
  const [siPopoverRowId, setSiPopoverRowId] = useState<string | null>(null)
  const [siPopoverText, setSiPopoverText] = useState('')
  const [siPopoverPos, setSiPopoverPos] = useState<{ top: number; left: number } | null>(null)

  // ── Equipment rows ───────────────────────────────────────────────────────
  const [equipRows, setEquipRows] = useState<EquipRow[]>([])
  const [equipNotes, setEquipNotes] = useState<Record<string, EquipNote>>({})
  const [openNoteKey, setOpenNoteKey] = useState<string | null>(null)
  const [noteUploading, setNoteUploading] = useState(false)
  const equipNoteFileRef = useRef<HTMLInputElement>(null)
  const pendingNoteKey = useRef<{ key: string; equipment: string; date: string } | null>(null)

  // ── Rental rows ──────────────────────────────────────────────────────────
  const [rentRows, setRentRows] = useState<RentRow[]>([
    { id: crypto.randomUUID(), qty: '', item: '', supplier: '', dates_used: '', rate: '', charge: '' },
    { id: crypto.randomUUID(), qty: '', item: '', supplier: '', dates_used: '', rate: '', charge: '' },
  ])
  const rentIdsInDb = useRef<Set<string>>(new Set())

  // ── Payment rows ─────────────────────────────────────────────────────────
  const [payRows, setPayRows] = useState<PayRow[]>([
    { id: crypto.randomUUID(), payment_type: '', amount: '', memo: '', last_four: '' },
  ])
  const payIdsInDb = useRef<Set<string>>(new Set())

  // ── WO refs ──────────────────────────────────────────────────────────────
  const woIdRef = useRef<string | null>(null)
  const [resolvedWoId, setResolvedWoId] = useState<string | null>(null)

  // ── Canvas signature ─────────────────────────────────────────────────────
  const adminCanvasRef = useRef<HTMLCanvasElement>(null)
  const adminIsDrawingRef = useRef(false)
  const adminInitialSigRef = useRef('')

  // ── Client search state ──────────────────────────────────────────────────
  const [clientSuggestions, setClientSuggestions] = useState<Array<{id: string; label: string; sub: string; isLabel: boolean; record: any}>>([])
  const [showClientDD, setShowClientDD] = useState(false)
  const [clientHighlight, setClientHighlight] = useState(-1)
  const [searchQuery, setSearchQuery] = useState('')
  const [clientEdits, setClientEdits] = useState<Record<string, string>>({})
  const [showProfileUpdate, setShowProfileUpdate] = useState(false)
  const [editingCard, setEditingCard] = useState(false)
  const [cardSnapshot, setCardSnapshot] = useState<Partial<USFForm> | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const nameDebounce = useRef<ReturnType<typeof setTimeout>>()
  const skipNameSearch = useRef(false)
  const [contactUpdatePrompt, setContactUpdatePrompt] = useState<{
    contactId: string; column: 'email' | 'phone'; value: string; onUpdate: () => void
  } | null>(null)

  // ── Artist roster state ──────────────────────────────────────────────────
  const [clientArtists, setClientArtists] = useState<string[]>([])
  const [showArtistDD, setShowArtistDD] = useState(false)

  // ── Label contact state ──────────────────────────────────────────────────
  const [labelContacts, setLabelContacts] = useState<ClientContact[]>([])
  const [labelAdminContacts, setLabelAdminContacts] = useState<ClientContact[]>([])
  const [anrQuery, setAnrQuery] = useState('')
  const [anrContact, setAnrContact] = useState<ClientContact | null>(null)
  const [showAnrDD, setShowAnrDD] = useState(false)
  const [anrHighlight, setAnrHighlight] = useState(-1)
  const [anrEmail, setAnrEmail] = useState('')
  const [anrPhone, setAnrPhone] = useState('')
  const [adminQuery, setAdminQuery] = useState('')
  const [adminContact, setAdminContact] = useState<ClientContact | null>(null)
  const [showAdminDD, setShowAdminDD] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPhone, setAdminPhone] = useState('')

  // ── Session options state ────────────────────────────────────────────────
  const [timeTBD, setTimeTBD] = useState(false)
  const [multiDay, setMultiDay] = useState(false)
  const [showSrsModal, setShowSrsModal] = useState(false)

  // ── Engineer search state ────────────────────────────────────────────────
  const [engOn, setEngOn] = useState(false)
  const [engQuery, setEngQuery] = useState('')
  const [engSuggestions, setEngSuggestions] = useState<Engineer[]>([])
  const [showEngDD, setShowEngDD] = useState(false)
  const [engHighlight, setEngHighlight] = useState(-1)
  const [engEditing, setEngEditing] = useState(false)
  const engApplied = useRef(false)
  const engEditingRef = useRef(false)
  const engPrevStatus = useRef<string>('')

  // ── Assistant search state ───────────────────────────────────────────────
  const [asstOn, setAsstOn] = useState(false)
  const [asstQuery, setAsstQuery] = useState('')
  const [asstSuggestions, setAsstSuggestions] = useState<Engineer[]>([])
  const [showAsstDD, setShowAsstDD] = useState(false)
  const [asstHighlight, setAsstHighlight] = useState(-1)
  const asstApplied = useRef(false)

  // ── Draft timer ──────────────────────────────────────────────────────────
  const draftTimer = useRef<ReturnType<typeof setTimeout>>()

  // ─── Effects ────────────────────────────────────────────────────────────────

  // Load booking + WO data when bookingId is provided
  useEffect(() => {
    if (!bookingId) { setLoading(false); return }
    setLoading(true)
    ;(async () => {
      const { data: bk } = await supabase.from('bookings').select('*').eq('id', bookingId).single()
      if (!bk) { setLoading(false); return }
      const booking = bk as any
      const rateType: 'hourly' | 'daily' = booking.rate_type === 'day' ? 'daily' : booking.rate_type === 'hour' ? 'hourly' : (booking.rate_daily ? 'daily' : 'hourly')
      setForm(emptyUSFForm({
        status: booking.status ?? 'tentative',
        session_type: booking.session_type ?? 'recording',
        payment_type: booking.payment_type ?? 'COD',
        cod_method: booking.cod_method ?? '',
        location: booking.location ?? '',
        studio: booking.studio ?? '',
        start_date: booking.start_date ?? '',
        end_date: booking.end_date ?? booking.start_date ?? '',
        from_time: booking.from_time ?? '',
        to_time: booking.to_time ?? '',
        rate: booking.rate ?? '',
        rate_daily: booking.rate_daily ?? '',
        rate_type: rateType,
        invoice_num: booking.invoice_num ?? '',
        client_name: booking.client_name ?? '',
        artist: booking.artist ?? '',
        label: booking.label ?? '',
        ordered_by: booking.ordered_by ?? '',
        phone: booking.phone ?? '',
        email: booking.email ?? '',
        po: booking.po ?? '',
        producer: booking.producer ?? '',
        food_budget: booking.food_budget ?? false,
        food_amount: booking.food_amount ?? '',
        engineer_name: booking.engineer_name ?? '',
        engineer_rate: booking.engineer_rate ?? '',
        engineer_status: booking.engineer_status ?? 'not_needed',
        assistant_name: booking.assistant_name ?? '',
        assistant_status: booking.assistant_status ?? 'not_needed',
        notes: booking.notes ?? '',
        client_db_id: booking.client_id ?? null,
        is_srs: booking.is_srs ?? false,
        anr_contact_id: booking.anr_contact_id ?? null,
        anr_admin_contact_id: booking.anr_admin_contact_id ?? null,
      }))
      setEngOn(!!booking.engineer_name)
      setAsstOn(!!booking.assistant_name)
      setMultiDay(!!booking.end_date && booking.start_date !== booking.end_date)

      const { data: woRows } = await supabase.from('work_orders').select('*')
        .eq('booking_id', bookingId).order('created_at', { ascending: false }).limit(1)
      const wo = woRows?.[0] ?? null

      if (wo) {
        woIdRef.current = wo.id
        setResolvedWoId(wo.id)
        setWoStatus(wo.status ?? 'open')
        adminInitialSigRef.current = wo.signature_data ?? ''
        setForm(f => ({
          ...f,
          wo_id: wo.id,
          studios: wo.studios ?? [],
          session_notes: wo.session_notes ?? '',
          payment_status: wo.payment_status ?? 'COD',
          print_name: wo.print_name ?? '',
          signature_data: wo.signature_data ?? '',
          needs_attention_notes: wo.needs_attention_notes ?? '',
          needs_attention_photos: wo.needs_attention_photos ?? [],
        }))

        const [{ data: st }, { data: eq }, { data: rent }, { data: pay }, { data: eqNotes }] = await Promise.all([
          supabase.from('studio_time_rows').select('*').eq('work_order_id', wo.id).order('sort_order'),
          supabase.from('equipment_condition_rows').select('*').eq('work_order_id', wo.id),
          supabase.from('rental_rows').select('*').eq('work_order_id', wo.id).order('sort_order'),
          supabase.from('payment_rows').select('*').eq('work_order_id', wo.id).order('recorded_at'),
          supabase.from('equipment_condition_notes').select('*').eq('work_order_id', wo.id),
        ])

        if (st?.length) {
          const rows = (st as any[]).map(normalizeStRow)
          originalStRowsRef.current = rows
          setStRows(rows)
        } else {
          originalStRowsRef.current = []
        }

        if (eq?.length) setEquipRows(eq as EquipRow[])

        if (eqNotes?.length) {
          const map: Record<string, EquipNote> = {}
          for (const n of eqNotes as any[]) {
            map[`${n.equipment}||${n.date}`] = { id: n.id, note: n.note ?? '', photo_urls: n.photo_urls ?? [] }
          }
          setEquipNotes(map)
        }

        if (rent?.length) {
          setRentRows((rent as any[]).map(r => ({ id: r.id, qty: String(r.qty ?? ''), item: r.item ?? '', supplier: r.supplier ?? '', dates_used: r.dates_used ?? '', rate: r.rate ?? '', charge: String(r.charge ?? '') })))
          ;(rent as any[]).forEach(r => rentIdsInDb.current.add(r.id))
        }

        if (pay?.length) {
          setPayRows((pay as any[]).map(p => ({ id: p.id, payment_type: p.payment_type ?? '', amount: p.amount != null ? formatCurrency(String(p.amount)) : '', memo: p.memo ?? '', last_four: p.last_four ?? '' })))
          ;(pay as any[]).forEach(p => payIdsInDb.current.add(p.id))
        }
      }

      setLoading(false)
    })()
  }, [bookingId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load label roster + contacts for billing bookings
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
      setLabelContacts(all.filter(c => c.contact_type !== 'admin'))
      setLabelAdminContacts(all.filter(c => c.contact_type === 'admin'))
      setClientArtists((client?.artists as string[]) || [])
      if (form.anr_contact_id) {
        const found = all.find(c => c.id === form.anr_contact_id)
        if (found) { setAnrContact(found); setAnrEmail(found.email || ''); setAnrPhone(found.phone || '') }
      }
      if (form.anr_admin_contact_id) {
        const found = all.filter(c => c.contact_type === 'admin').find(c => c.id === form.anr_admin_contact_id)
        if (found) { setAdminContact(found); setAdminQuery(`${found.fname || ''} ${found.lname || ''}`.trim()); setAdminEmail(found.email || ''); setAdminPhone(found.phone || '') }
      }
    })
  }, [form.client_db_id, form.payment_type]) // eslint-disable-line react-hooks/exhaustive-deps

  // Client name search debounce
  useEffect(() => {
    if (skipNameSearch.current) { skipNameSearch.current = false; return }
    const q = searchQuery.trim()
    if (q.length < 2) { setClientSuggestions([]); setShowClientDD(false); return }
    clearTimeout(nameDebounce.current)
    nameDebounce.current = setTimeout(async () => {
      const [{ data: cd }, { data: ctd }] = await Promise.all([
        supabase.from('clients').select('id,type,name,fname,lname,email,phone,artists,srs_client')
          .or(`name.ilike.%${q}%,fname.ilike.%${q}%,lname.ilike.%${q}%`).limit(30),
        supabase.from('client_contacts').select('id,client_id,fname,lname,email,phone,clients(id,name,type,srs_client)')
          .or(`fname.ilike.%${q}%,lname.ilike.%${q}%`).limit(20),
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
        results.push({ id: ct.client_id, label: personName, sub: parentClient.type === 'label' ? parentClient.name : '', isLabel: parentClient.type === 'label', record: { ...parentClient, _anrFname: ct.fname, _anrLname: ct.lname, _anrEmail: ct.email, _anrPhone: ct.phone } })
      }
      for (const c of (cd || []) as any[]) {
        const personName = `${c.fname || ''} ${c.lname || ''}`.trim()
        const displayName = personName || c.name || ''
        const key = `client-${c.id}`
        if (seen.has(key)) continue
        seen.add(key)
        results.push({ id: c.id, label: displayName, sub: '', isLabel: c.type === 'label', record: c })
      }
      setClientSuggestions(results)
      setShowClientDD(results.length > 0)
    }, 200)
    return () => clearTimeout(nameDebounce.current)
  }, [searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Engineer search debounce
  useEffect(() => {
    if (!engOn) { setEngSuggestions([]); setShowEngDD(false); return }
    const q = engQuery.trim()
    const t = setTimeout(async () => {
      const base = supabase.from('engineers').select('id,first_name,last_name,role,initials').eq('active', true).in('role', ['Engineer', 'Both']).order('first_name').limit(20)
      const { data } = q.length >= 1 ? await base.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`) : await base
      setEngSuggestions((data || []) as Engineer[])
      setShowEngDD(q.length >= 1 && (data || []).length > 0)
    }, q.length >= 1 ? 150 : 0)
    return () => clearTimeout(t)
  }, [engQuery, engOn]) // eslint-disable-line react-hooks/exhaustive-deps

  // Assistant search debounce
  useEffect(() => {
    if (!asstOn) { setAsstSuggestions([]); setShowAsstDD(false); return }
    const q = asstQuery.trim()
    const t = setTimeout(async () => {
      const base = supabase.from('engineers').select('id,first_name,last_name,role,initials').eq('active', true).in('role', ['Assistant', 'Both']).order('first_name').limit(20)
      const { data } = q.length >= 1 ? await base.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`) : await base
      setAsstSuggestions((data || []) as Engineer[])
      setShowAsstDD(q.length >= 1 && (data || []).length > 0)
    }, q.length >= 1 ? 150 : 0)
    return () => clearTimeout(t)
  }, [asstQuery, asstOn]) // eslint-disable-line react-hooks/exhaustive-deps

  // Canvas signature initialization
  useEffect(() => {
    if (loading) return
    const canvas = adminCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = '#e8eaf2'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    if (adminInitialSigRef.current) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      img.src = adminInitialSigRef.current
    }
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live date range sync — stRows expand/contract when booking dates change
  useEffect(() => {
    if (!woIdRef.current || !form.start_date) return
    const woId = woIdRef.current
    ;(async () => {
      const newEnd = form.end_date || form.start_date
      const allDates = dateRange(form.start_date, newEnd)
      const { data: freshRows } = await supabase.from('studio_time_rows').select('id, date').eq('work_order_id', woId)
      const coveredDates = new Set((freshRows ?? []).map((r: any) => r.date))
      const newDateSet = new Set(allDates)
      const toDelete = (freshRows ?? []).filter((r: any) => r.date && !newDateSet.has(r.date)).map((r: any) => r.id)
      if (toDelete.length > 0) await supabase.from('studio_time_rows').delete().in('id', toDelete)
      const missing = allDates.filter(d => !coveredDates.has(d))
      if (missing.length > 0) {
        const isDayRate = form.rate_type === 'daily' || !!form.rate_daily
        const rateRaw = isDayRate ? (form.rate_daily || form.rate || '') : (form.rate || '')
        const rateNum = parseFloat(rateRaw.replace(/[^0-9.]/g, ''))
        const studioLetter = form.studio ? toStudioLetter(form.studio) : ''
        await supabase.from('studio_time_rows').insert(missing.map((d, i) => ({
          work_order_id: woId,
          studio: studioLetter, date: d, session_info: '',
          from_time: form.from_time, to_time: form.to_time,
          total_hours: isDayRate ? null : calcHours(form.from_time, form.to_time),
          rate: rateRaw,
          charge: isDayRate ? (!isNaN(rateNum) && rateNum > 0 ? rateNum : null) : calcCharge(calcHours(form.from_time, form.to_time), rateRaw),
          day_count: isDayRate ? 1 : null,
          ot_rate: isDayRate ? (!isNaN(rateNum) && rateNum > 0 ? rateNum / 10 : null) : (rateNum || null),
          sort_order: coveredDates.size + i,
        })))
      }
      if (toDelete.length > 0 || missing.length > 0) {
        const { data: reloaded } = await supabase.from('studio_time_rows').select('*').eq('work_order_id', woId).order('date')
        setStRows((reloaded ?? []).map(normalizeStRow))
      }
    })()
  }, [form.start_date, form.end_date]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time WO status subscription
  useEffect(() => {
    if (!resolvedWoId) return
    const ch = supabase.channel(`usf-wo-status-${resolvedWoId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'work_orders', filter: `id=eq.${resolvedWoId}` }, (payload) => {
        setWoStatus((payload.new as any).status ?? 'open')
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [resolvedWoId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-set eng_visible for rows loaded with eng data but eng_visible false
  useEffect(() => {
    setStRows(prev => {
      const needsUpdate = prev.some(r => !r.eng_visible && (r.eng_rate || (r.eng_hours ?? 0) > 0))
      if (!needsUpdate) return prev
      return prev.map(r => (!r.eng_visible && (r.eng_rate || (r.eng_hours ?? 0) > 0)) ? { ...r, eng_visible: true } : r)
    })
  }, [stRows.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Form field setter ───────────────────────────────────────────────────────

  function set<K extends keyof USFForm>(k: K, v: USFForm[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  // ─── Client handlers ─────────────────────────────────────────────────────────

  function applyClientAutofill(s: typeof clientSuggestions[0]) {
    skipNameSearch.current = true
    const r = s.record
    const isAnrContact = !!r._anrFname
    const anrName = isAnrContact ? `${r._anrFname || ''} ${r._anrLname || ''}`.trim() : `${r.fname || ''} ${r.lname || ''}`.trim()
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

  function handleClientFieldEdit(formKey: keyof USFForm, value: string) {
    set(formKey, value as any)
    const colMap: Partial<Record<keyof USFForm, string>> = { email: 'email', phone: 'phone', client_name: 'name', label: 'label' }
    const clientColumn = colMap[formKey] ?? null
    if (form.client_db_id && clientColumn) {
      setClientEdits(prev => ({ ...prev, [clientColumn]: value }))
    }
  }

  // ─── Engineer / Assistant handlers ───────────────────────────────────────────

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

  // ─── Canvas signature handlers ────────────────────────────────────────────────

  function getAdminCanvasPos(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) {
    const rect = canvas.getBoundingClientRect()
    let clientX: number, clientY: number
    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX; clientY = e.touches[0].clientY
    } else if ('changedTouches' in e && (e as React.TouchEvent).changedTouches.length > 0) {
      clientX = (e as React.TouchEvent).changedTouches[0].clientX
      clientY = (e as React.TouchEvent).changedTouches[0].clientY
    } else {
      clientX = (e as React.MouseEvent).clientX; clientY = (e as React.MouseEvent).clientY
    }
    return { x: (clientX - rect.left) * (canvas.width / rect.width), y: (clientY - rect.top) * (canvas.height / rect.height) }
  }

  function startAdminDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = adminCanvasRef.current; if (!canvas) return
    adminIsDrawingRef.current = true
    const ctx = canvas.getContext('2d')!
    ctx.strokeStyle = '#e8eaf2'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    const pos = getAdminCanvasPos(e, canvas)
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
  }

  function continueAdminDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!adminIsDrawingRef.current) return
    const canvas = adminCanvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const pos = getAdminCanvasPos(e, canvas)
    ctx.lineTo(pos.x, pos.y); ctx.stroke()
  }

  function endAdminDraw() {
    if (!adminIsDrawingRef.current) return
    adminIsDrawingRef.current = false
    const canvas = adminCanvasRef.current; if (!canvas) return
    set('signature_data', canvas.toDataURL('image/png'))
  }

  function clearAdminSignature() {
    const canvas = adminCanvasRef.current; if (!canvas) return
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    set('signature_data', '')
  }

  // ─── Studio time row handlers ─────────────────────────────────────────────────

  function handleStRowChange(id: string, updates: Partial<StRow>) {
    const row = stRows.find(r => r.id === id)
    if (row?.admin_locked && !pendingLockedEdits[id]) {
      setPendingLockedEdits(p => ({ ...p, [id]: { ...row } }))
    }
    setStRows(prev => prev.map(r => {
      if (r.id !== id) return r
      const u = { ...r, ...updates }
      if ('from_time' in updates || 'to_time' in updates || 'row_rate_type' in updates) {
        u.total_hours = calcHours(u.from_time, u.to_time)
      }
      if (u.row_rate_type === 'day') {
        if ('rate_daily' in updates || 'row_rate_type' in updates) {
          const rn = parseFloat((u.rate_daily ?? '').replace(/[^0-9.]/g, ''))
          u.charge = !isNaN(rn) && rn > 0 ? rn : null
          if (!('ot_rate' in updates)) u.ot_rate = rn > 0 ? String(parseFloat((rn * 0.10).toFixed(2))) : u.ot_rate
        }
        if ('from_time' in updates || 'to_time' in updates || 'row_rate_type' in updates) {
          const actual = u.total_hours ?? 0
          u.ot_hours = String(Math.max(0, parseFloat(actual.toFixed(2)) - 12))
        }
      } else {
        if ('total_hours' in updates || 'rate' in updates || 'from_time' in updates || 'to_time' in updates || 'row_rate_type' in updates) {
          u.charge = calcCharge(u.total_hours, u.rate)
        }
        if ('rate' in updates || 'row_rate_type' in updates) {
          if (!('ot_rate' in updates)) u.ot_rate = u.rate
        }
      }
      if ('ot_hours' in updates || 'ot_rate' in updates || 'from_time' in updates || 'to_time' in updates || 'rate' in updates || 'rate_daily' in updates || 'row_rate_type' in updates) {
        const h = parseFloat(u.ot_hours ?? '0') || 0
        const rn = parseFloat((u.ot_rate ?? '').replace(/[^0-9.]/g, '')) || 0
        u.ot_charge = h > 0 && rn > 0 ? parseFloat((h * rn).toFixed(2)) : null
      }
      if ('eng_hours' in updates || 'eng_rate' in updates || 'from_time' in updates || 'to_time' in updates || 'eng_from_time' in updates || 'eng_to_time' in updates) {
        const ef = u.eng_from_time || u.from_time
        const et = u.eng_to_time || u.to_time
        const eh = calcHours(ef, et) ?? (u.eng_hours != null ? Number(u.eng_hours) : null)
        const er = parseFloat((u.eng_rate ?? '').replace(/[^0-9.]/g, ''))
        u.eng_charge = eh != null && eh > 0 && !isNaN(er) && er > 0 ? parseFloat((eh * er).toFixed(2)) : null
      }
      return u
    }))
  }

  function handleAddStRow() {
    const maxOrder = stRows.reduce((max, r) => Math.max(max, r.sort_order ?? -1), -1)
    const last = [...stRows].reverse().find(r => !!(r.studio || r.date)) ?? stRows[stRows.length - 1]
    const rowRateType = last?.row_rate_type || 'hour'
    const fromTime = last?.from_time || ''
    const toTime = last?.to_time || ''
    const rateStr = last?.rate || ''
    const rateDailyStr = last?.rate_daily || ''
    let totalHours: number | null = null
    let charge: number | null = null
    if (rowRateType === 'hour') {
      totalHours = calcHours(fromTime, toTime)
      const rateNum = parseFloat(rateStr.replace(/[^0-9.]/g, ''))
      charge = totalHours != null && !isNaN(rateNum) && rateNum > 0 ? parseFloat((totalHours * rateNum).toFixed(2)) : null
    } else {
      const rateNum = parseFloat((rateDailyStr || rateStr).replace(/[^0-9.]/g, ''))
      charge = !isNaN(rateNum) && rateNum > 0 ? rateNum : null
    }
    const newRow: StRow = {
      id: crypto.randomUUID(), studio: last?.studio || '', date: '', session_info: '',
      from_time: fromTime, to_time: toTime, total_hours: totalHours,
      rate: rateStr, rate_daily: rateDailyStr, row_rate_type: rowRateType,
      ot_rate: last?.ot_rate || '', ot_hours: '0', ot_charge: null, charge,
      sort_order: maxOrder + 1, day_count: null,
      eng_hours: null, eng_rate: '', eng_charge: null, eng_from_time: '', eng_to_time: '',
      admin_checked: false, admin_locked: false, eng_visible: true,
    }
    setStRows(prev => [...prev, newRow])
  }

  async function handleDeleteStRow(id: string) {
    const row = stRows.find(r => r.id === id)
    if (row) deletedRowsRef.current = [...deletedRowsRef.current, row]
    await supabase.from('studio_time_rows').delete().eq('id', id)
    setStRows(prev => prev.filter(r => r.id !== id))
    setConfirmDeleteRowId(null)
    setConfirmClearEngId(null)
  }

  function handleToggleEng(id: string) {
    setStRows(prev => prev.map(r => r.id === id ? { ...r, eng_visible: !r.eng_visible } : r))
  }

  // ─── Equipment handlers ───────────────────────────────────────────────────────

  function handleEquipChange(equipment: string, date: string, cond: 'ok' | 'not_ok') {
    const currentCond = equipRows.find(r => r.equipment === equipment && r.date === date)?.condition
    const nextCond: 'ok' | 'not_ok' | null = currentCond === cond ? null : cond
    setEquipRows(prev => prev.map(r => {
      if (r.equipment !== equipment || r.date !== date) return r
      supabase.from('equipment_condition_rows').update({ condition: nextCond }).eq('id', r.id)
      return { ...r, condition: nextCond }
    }))
    const key = `${equipment}||${date}`
    if (nextCond === 'not_ok') setOpenNoteKey(key)
    else setOpenNoteKey(prev => prev === key ? null : prev)
  }

  // ─── Rental row handlers ──────────────────────────────────────────────────────

  function handleRentChange(id: string, updates: Partial<RentRow>) {
    setRentRows(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r))
  }

  function handleRentDelete(id: string) {
    setRentRows(prev => prev.filter(r => r.id !== id))
  }

  function handleAddRent() {
    setRentRows(prev => [...prev, { id: crypto.randomUUID(), qty: '', item: '', supplier: '', dates_used: '', rate: '', charge: '' }])
  }

  // ─── Payment row handlers ─────────────────────────────────────────────────────

  function handlePayChange(id: string, updates: Partial<PayRow>) {
    setPayRows(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
  }

  function handlePayDelete(id: string) {
    setPayRows(prev => prev.filter(p => p.id !== id))
  }

  function handleAddPay() {
    setPayRows(prev => [...prev, { id: crypto.randomUUID(), payment_type: '', amount: '', memo: '', last_four: '' }])
  }

  // ─── Seeder handler ───────────────────────────────────────────────────────────

  function handleSeedRows(
    seederStart: string, seederEnd: string, seederStudio: string,
    seederFromTime: string, seederToTime: string, seederEng: string
  ) {
    const dates = dateRange(seederStart, seederEnd)
    const maxOrder = stRows.reduce((max, r) => Math.max(max, r.sort_order ?? -1), -1)
    const isDayRate = form.rate_type === 'daily'
    const rateStr = isDayRate ? form.rate_daily : form.rate
    const rateNum = parseFloat((rateStr || '').replace(/[^0-9.]/g, ''))
    const newRows: StRow[] = dates.map((date, i) => {
      const totalHours = isDayRate ? null : calcHours(seederFromTime, seederToTime)
      const charge = isDayRate
        ? (!isNaN(rateNum) && rateNum > 0 ? rateNum : null)
        : calcCharge(totalHours, rateStr || '')
      return {
        id: crypto.randomUUID(),
        studio: seederStudio ? toStudioLetter(seederStudio) : '',
        date,
        session_info: seederEng ? `Eng: ${seederEng}` : '',
        from_time: seederFromTime,
        to_time: seederToTime,
        total_hours: totalHours,
        rate: isDayRate ? '' : (rateStr || ''),
        rate_daily: isDayRate ? (rateStr || '') : '',
        row_rate_type: isDayRate ? 'day' : 'hour',
        ot_rate: isDayRate ? (!isNaN(rateNum) && rateNum > 0 ? String(parseFloat((rateNum / 10).toFixed(2))) : '') : (rateStr || ''),
        ot_hours: '0',
        ot_charge: null,
        charge,
        sort_order: maxOrder + 1 + i,
        day_count: isDayRate ? 1 : null,
        eng_hours: null,
        eng_rate: '',
        eng_charge: null,
        eng_from_time: seederFromTime,
        eng_to_time: seederToTime,
        admin_checked: false,
        admin_locked: false,
        eng_visible: false,
      }
    })
    setStRows(prev => [...prev, ...newRows])
  }

  // ─── Print ────────────────────────────────────────────────────────────────────

  function printWithFilename() {
    const slug = (s: string) => (s || '').trim().replace(/\s+/g, '_')
    const inv = `_${form.invoice_num || 'INV#'}`
    const name = form.payment_type === 'billing'
      ? [slug(form.label), form.artist ? slug(form.artist) : ''].filter(Boolean).join('_') + inv
      : slug(form.client_name ?? '') + inv
    const prev = document.title
    document.title = name || prev
    window.print()
    document.title = prev
  }

  // ─── Close & Save ─────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!bookingId) return
    setSaving(true)
    setSaveError(null)
    try {
      let woId = woIdRef.current

      const woPayload = {
        booking_id: bookingId,
        invoice_number: form.invoice_num || null,
        session_date: form.start_date || null,
        studios: form.studios,
        from_time: stRows[0]?.from_time || form.from_time || null,
        to_time: stRows[0]?.to_time || form.to_time || null,
        engineer: form.engineer_name || null,
        second_engineer: form.assistant_name || null,
        producer: form.producer || null,
        payment_status: form.payment_type === 'billing' ? 'Billing' : 'COD',
        food_budget: form.food_budget,
        food_amount: form.food_amount ? parseFloat(form.food_amount) : null,
        client: form.client_name || null,
        artist: form.artist || null,
        label: form.label || null,
        ordered_by: form.ordered_by || null,
        po_number: form.po || null,
        phone: form.phone || null,
        email: form.email || null,
        session_notes: form.session_notes || null,
        print_name: form.print_name || null,
        signature_data: form.signature_data || null,
        needs_attention_notes: form.needs_attention_notes || null,
        updated_at: new Date().toISOString(),
      }

      if (woId) {
        await supabase.from('work_orders').update(woPayload).eq('id', woId)
      } else {
        const { data: created } = await supabase.from('work_orders')
          .insert({ ...woPayload, status: 'open' }).select('id').single()
        if (created) {
          woId = created.id
          woIdRef.current = created.id
          setResolvedWoId(created.id)
          setForm(f => ({ ...f, wo_id: created.id }))
        }
      }

      if (woId && stRows.length > 0) {
        const originalStIds = new Set(originalStRowsRef.current.map(r => r.id))
        await Promise.all(stRows.map(r => {
          const payload = {
            studio: r.studio, date: r.date, session_info: r.session_info,
            from_time: r.from_time, to_time: r.to_time,
            total_hours: r.total_hours, rate: r.rate, rate_daily: r.rate_daily || null,
            row_rate_type: r.row_rate_type, charge: r.charge, sort_order: r.sort_order,
            day_count: r.day_count ?? null,
            ot_rate: r.ot_rate ? parseFloat(r.ot_rate.replace(/[^0-9.]/g, '')) || null : null,
            ot_hours: r.ot_hours ? parseFloat(r.ot_hours) || null : null,
            ot_charge: r.ot_charge ?? null,
            eng_hours: r.eng_hours ?? null, eng_rate: r.eng_rate || null,
            eng_charge: r.eng_charge ?? null,
            eng_from_time: r.eng_from_time || null, eng_to_time: r.eng_to_time || null,
            admin_checked: r.admin_checked, admin_locked: r.admin_locked, eng_visible: r.eng_visible,
          }
          return originalStIds.has(r.id)
            ? supabase.from('studio_time_rows').update(payload).eq('id', r.id)
            : supabase.from('studio_time_rows').insert({ ...payload, id: r.id, work_order_id: woId! })
        }))
        originalStRowsRef.current = stRows
        deletedRowsRef.current = []
      }

      if (woId) {
        const rentToSave = rentRows.filter(r => r.item || r.charge)
        await Promise.all(rentToSave.map(r => {
          const payload = { id: r.id, work_order_id: woId!, qty: parseInt(r.qty) || null, item: r.item || null, supplier: r.supplier || null, dates_used: r.dates_used || null, rate: r.rate || null, charge: parseFloat(r.charge) || null }
          return rentIdsInDb.current.has(r.id)
            ? supabase.from('rental_rows').update(payload).eq('id', r.id)
            : supabase.from('rental_rows').insert(payload)
        }))

        const payToSave = payRows.filter(p => p.payment_type || p.amount)
        await Promise.all(payToSave.map(p => {
          const payload = { id: p.id, work_order_id: woId!, payment_type: p.payment_type || null, amount: stripCurrency(p.amount), memo: p.memo || null, last_four: p.last_four || null }
          return payIdsInDb.current.has(p.id)
            ? supabase.from('payment_rows').update(payload).eq('id', p.id)
            : supabase.from('payment_rows').insert(payload)
        }))
      }

      // Sync booking row — derive dates/studio from stRows when present
      const stDates = stRows.map(r => r.date).filter(Boolean).sort()
      const earliestDate = stDates[0] || form.start_date
      const latestDate = stDates[stDates.length - 1] || form.end_date || form.start_date
      const studioCounts: Record<string, number> = {}
      for (const r of stRows) { if (r.studio) studioCounts[r.studio] = (studioCounts[r.studio] || 0) + 1 }
      const mostCommonStudio = Object.entries(studioCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || stRows[0]?.studio || toStudioLetter(form.studio)

      await supabase.from('bookings').update({
        status: form.status,
        start_date: earliestDate,
        end_date: latestDate,
        studio: mostCommonStudio || null,
        client_name: form.client_name || null,
        payment_type: form.payment_type,
        artist: form.artist || null,
        label: form.label || null,
        ordered_by: form.ordered_by || null,
        phone: form.phone || null,
        email: form.email || null,
        engineer_name: form.engineer_name || null,
        engineer_rate: form.engineer_rate || null,
        engineer_status: form.engineer_status || null,
        assistant_name: form.assistant_name || null,
        assistant_status: form.assistant_status || null,
        invoice_num: form.invoice_num || null,
        notes: form.notes || null,
        session_type: form.session_type,
        from_time: form.from_time || stRows[0]?.from_time || null,
        to_time: form.to_time || stRows[0]?.to_time || null,
        rate: form.rate || null,
        rate_daily: form.rate_daily || null,
        producer: form.producer || null,
        po: form.po || null,
        food_budget: form.food_budget,
        food_amount: form.food_amount || null,
        is_srs: form.is_srs,
        anr_contact_id: form.anr_contact_id,
        anr_admin_contact_id: form.anr_admin_contact_id,
      }).eq('id', bookingId)

      setSaving(false)
      onClose()
    } catch (err: any) {
      const msg = [err?.message, err?.details].filter(Boolean).join(' — ')
      setSaveError(msg || 'Failed to save')
      setSaving(false)
    }
  }

  // ─── Delete ───────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!bookingId) return
    setSaving(true)
    await supabase.from('bookings').update({ deleted_at: new Date().toISOString() }).eq('id', bookingId)
    if (woIdRef.current) {
      await supabase.from('work_orders').delete().eq('id', woIdRef.current)
    }
    setSaving(false)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 8, padding: 24, color: 'var(--text)', fontFamily: 'DM Mono' }}>
        UnifiedSessionForm placeholder
        <br />
        bookingId: {bookingId ?? '(none)'}
        <br />
        <button onClick={onClose} style={{ marginTop: 16, padding: '6px 16px', borderRadius: 4, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>Close</button>
      </div>
    </div>
  )
}
