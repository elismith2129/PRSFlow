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

  // ── Seeder state ─────────────────────────────────────────────────────────
  const [seederStart, setSeederStart] = useState('')
  const [seederEnd, setSeederEnd] = useState('')
  const [seederStudio, setSeederStudio] = useState('')
  const [seederEng, setSeederEng] = useState('')
  const [seederFromTime, setSeederFromTime] = useState('')
  const [seederToTime, setSeederToTime] = useState('')

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

  function addEngRow() {
    const maxOrder = stRows.reduce((max, r) => Math.max(max, r.sort_order ?? -1), -1)
    const lastEng = [...stRows].reverse().find(r => r.eng_rate || (r.eng_hours ?? 0) > 0 || r.eng_from_time) || stRows[stRows.length - 1]
    const newRow: StRow = {
      id: crypto.randomUUID(), studio: '', date: '', session_info: '',
      from_time: '', to_time: '', total_hours: null,
      rate: '', rate_daily: '', row_rate_type: 'hour', ot_rate: '', ot_hours: '', ot_charge: null,
      charge: null, sort_order: maxOrder + 1, day_count: null,
      eng_from_time: lastEng?.eng_from_time || '', eng_to_time: lastEng?.eng_to_time || '',
      eng_rate: lastEng?.eng_rate || '', eng_hours: null, eng_charge: null,
      admin_checked: false, admin_locked: false, eng_visible: true,
    }
    setStRows(prev => [...prev, newRow])
  }

  function toggleRowRateType(id: string) {
    setStRows(prev => prev.map(r => {
      if (r.id !== id) return r
      if (r.row_rate_type === 'hour') {
        const rateNum = parseFloat(r.rate.replace(/[^0-9.]/g, '')) || 0
        const existingDailyNum = parseFloat(r.rate_daily.replace(/[^0-9.]/g, '')) || 0
        const autoDaily = rateNum > 0 ? parseFloat((rateNum * 10).toFixed(2)) : 0
        const finalDaily = (!existingDailyNum || Math.abs(existingDailyNum - autoDaily) < 0.01)
          ? (autoDaily > 0 ? String(autoDaily) : r.rate_daily) : r.rate_daily
        const dailyNum = parseFloat(finalDaily.replace(/[^0-9.]/g, '')) || 0
        const otRate = r.ot_rate || (dailyNum > 0 ? String(parseFloat((dailyNum / 10).toFixed(2))) : '')
        const otRateNum = parseFloat(otRate.replace(/[^0-9.]/g, '')) || 0
        const actual = calcHours(r.from_time, r.to_time) ?? 0
        const otHrs = Math.max(0, parseFloat(actual.toFixed(2)) - 12)
        return { ...r, row_rate_type: 'day' as const, rate_daily: finalDaily, charge: dailyNum > 0 ? dailyNum : null, ot_hours: String(otHrs), ot_rate: otRate, ot_charge: otHrs > 0 && otRateNum > 0 ? parseFloat((otHrs * otRateNum).toFixed(2)) : null }
      } else {
        const dailyNum = parseFloat(r.rate_daily.replace(/[^0-9.]/g, '')) || 0
        const autoRate = dailyNum > 0 ? parseFloat((dailyNum / 10).toFixed(2)) : 0
        const existingRateNum = parseFloat(r.rate.replace(/[^0-9.]/g, '')) || 0
        const finalRate = (!existingRateNum || Math.abs(existingRateNum - autoRate) < 0.01)
          ? (autoRate > 0 ? String(autoRate) : r.rate) : r.rate
        const finalRateNum = parseFloat(finalRate.replace(/[^0-9.]/g, '')) || 0
        const hrs = r.total_hours ?? calcHours(r.from_time, r.to_time) ?? null
        return { ...r, row_rate_type: 'hour' as const, rate: finalRate, charge: hrs != null && hrs > 0 && finalRateNum > 0 ? parseFloat((hrs * finalRateNum).toFixed(2)) : null, ot_hours: '0', ot_charge: null }
      }
    }))
  }

  async function handleToggleLock(rowId: string, currentLocked: boolean) {
    const newLocked = !currentLocked
    await supabase.from('studio_time_rows').update({ admin_checked: newLocked, admin_locked: newLocked }).eq('id', rowId)
    setStRows(prev => prev.map(r => r.id === rowId ? { ...r, admin_checked: newLocked, admin_locked: newLocked } : r))
    if (!newLocked) setPendingLockedEdits(p => { const n = { ...p }; delete n[rowId]; return n })
  }

  async function clearEngRow(id: string) {
    await supabase.from('studio_time_rows').update({
      eng_from_time: null, eng_to_time: null, eng_rate: null, eng_hours: null, eng_charge: null, eng_visible: false,
    }).eq('id', id)
    setStRows(prev => prev.map(r => r.id === id ? { ...r, eng_from_time: '', eng_to_time: '', eng_rate: '', eng_hours: null, eng_charge: null, eng_visible: false } : r))
    setConfirmClearEngId(null)
  }

  async function upsertEquipNote(key: string, equipment: string, date: string, updates: { note?: string; photo_urls?: string[] }) {
    const woId = woIdRef.current
    if (!woId) return
    const current = equipNotes[key]
    const merged = { note: current?.note ?? '', photo_urls: current?.photo_urls ?? [], ...updates }
    if (current?.id) {
      await supabase.from('equipment_condition_notes').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', current.id)
      setEquipNotes(prev => ({ ...prev, [key]: { ...prev[key], ...updates } }))
    } else {
      const { data } = await supabase.from('equipment_condition_notes').insert({
        work_order_id: woId, equipment, date, note: merged.note, photo_urls: merged.photo_urls,
      }).select('id').single()
      if (data) setEquipNotes(prev => ({ ...prev, [key]: { id: data.id, note: merged.note, photo_urls: merged.photo_urls } }))
    }
  }

  async function uploadEquipNotePhoto(file: File) {
    const pending = pendingNoteKey.current
    if (!pending || !woIdRef.current) return
    setNoteUploading(true)
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `equip-notes/${woIdRef.current}/${pending.equipment.toLowerCase()}_${pending.date}_${Date.now()}.${ext}`
    const { data, error } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
    if (!error && data) {
      const { data: { publicUrl } } = supabase.storage.from('checklist-photos').getPublicUrl(data.path)
      const currentPhotos = equipNotes[pending.key]?.photo_urls ?? []
      await upsertEquipNote(pending.key, pending.equipment, pending.date, { photo_urls: [...currentPhotos, publicUrl] })
    }
    setNoteUploading(false)
    if (equipNoteFileRef.current) equipNoteFileRef.current.value = ''
    pendingNoteKey.current = null
  }

  async function handleComplete() {
    if (!resolvedWoId) return
    setCompleting(true)
    const newStatus = woStatus === 'completed' ? 'open' : 'completed'
    await supabase.from('work_orders').update({ status: newStatus }).eq('id', resolvedWoId)
    setWoStatus(newStatus)
    setCompleting(false)
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

  // Escape to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // ── Derived totals ───────────────────────────────────────────────────────────
  const stTotal = stRows.reduce((s, r) => s + (r.charge ?? 0) + (r.ot_charge ?? 0), 0)
  const engTotal = stRows.reduce((s, r) => {
    const engRateDisplay = r.eng_rate || form.engineer_rate || ''
    const rate = parseFloat(engRateDisplay.replace(/[^0-9.]/g, '')) || 0
    if (!rate) return s
    const engHrs = calcHours(r.eng_from_time || r.from_time, r.eng_to_time || r.to_time) ?? r.eng_hours ?? 0
    return s + (engHrs > 0 ? parseFloat((engHrs * rate).toFixed(2)) : 0)
  }, 0)
  const rentTotal = rentRows.reduce((s, r) => s + (parseFloat(r.charge) || 0), 0)
  const grandTotal = stTotal + engTotal + rentTotal
  const totalPaid = payRows.reduce((s, r) => s + (stripCurrency(r.amount) ?? 0), 0)
  const balanceDue = grandTotal - totalPaid
  const sessionDates = Array.from(new Set(stRows.map(r => r.date).filter(Boolean))).sort()
  const isCompleted = woStatus === 'completed'

  // Layout constants
  const fL: React.CSSProperties = {
    fontSize: 9, color: 'var(--text3)', letterSpacing: '0.08em',
    textTransform: 'uppercase', marginBottom: 3, display: 'block',
  }
  const inp: React.CSSProperties = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11,
    padding: '4px 8px', borderRadius: 4, width: '100%', outline: 'none',
  }
  const sectionHead: React.CSSProperties = {
    fontSize: 9, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text3)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
    borderBottom: '1px solid var(--border)', paddingBottom: 7, marginBottom: 12,
  }
  const sectionTitle: React.CSSProperties = {
    fontFamily: 'Syne', fontWeight: 700, fontSize: 10, color: '#8a8fa0',
    letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10,
  }
  const tInp: React.CSSProperties = {
    background: 'transparent', border: 'none',
    color: '#f0f0f0', fontFamily: 'DM Mono', fontSize: 11,
    padding: '1px 0', outline: 'none', width: '100%', lineHeight: 1.4,
  }
  const cellS: React.CSSProperties = {
    padding: '4px 8px', fontSize: 11, fontFamily: 'DM Mono', color: '#f0f0f0',
    display: 'flex', alignItems: 'center',
  }
  const thS: React.CSSProperties = {
    padding: '4px 8px', fontSize: 8, fontFamily: 'Syne', fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a8fa0',
  }
  const metaLabel: React.CSSProperties = {
    fontSize: 9, fontFamily: 'Syne', fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a8fa0',
  }

  const headerNameColor = form.payment_type === 'COD' ? '#7D8FD7' : '#96A9FF'

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 900, maxHeight: '90vh', overflowY: 'auto', background: '#0d0f14', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}
      >
        {/* ── Header ── */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, background: '#0d0f14', zIndex: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 22, lineHeight: 1.2, color: headerNameColor, wordBreak: 'break-word' }}>
              {form.payment_type === 'billing'
                ? (form.artist || form.label || form.client_name || 'New Session')
                : (form.client_name || 'New Session')}
            </div>
            {form.payment_type === 'billing' && form.client_name && (
              <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text2)', marginTop: 2 }}>{form.client_name}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {woStatus && (
              <span style={{
                fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em',
                padding: '4px 10px', borderRadius: 4,
                background: woStatus === 'open' ? 'rgba(249,115,22,0.15)' : 'rgba(20,184,166,0.15)',
                color: woStatus === 'open' ? '#F97316' : '#14B8A6',
                border: `1px solid ${woStatus === 'open' ? 'rgba(249,115,22,0.4)' : 'rgba(20,184,166,0.4)'}`,
              }}>
                {woStatus === 'open' ? 'OPEN' : 'COMPLETED'}
              </span>
            )}
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text3)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
        </div>

        {/* ── Status chips ── */}
        <div style={{ padding: '8px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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

        {/* ── Body ── */}
        <div style={{ padding: '18px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 24 }}>

            {/* LEFT — Client card */}
            {(() => {
              const isBilling = form.payment_type === 'billing'
              const hasClient = isBilling ? !!(form.label || form.client_name) : !!form.client_name
              const cardNameColor = isBilling ? '#96A9FF' : '#7BBFFF'
              const badgeBg = isBilling ? 'rgba(150,169,255,0.12)' : 'rgba(123,191,255,0.12)'
              const badgeColor = isBilling ? '#96A9FF' : '#7BBFFF'
              const badgeBorder = isBilling ? 'rgba(150,169,255,0.3)' : 'rgba(123,191,255,0.3)'
              const badgeLabel = isBilling ? 'LABEL/BILLING' : 'COD'
              const displayName = isBilling ? (form.client_name || form.label) : form.client_name

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div style={sectionHead}>Client</div>

                  {/* SRS + COD/Label toggle */}
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => { if (!form.is_srs) setShowSrsModal(true); else set('is_srs', false) }}
                      style={{
                        padding: '7px 16px', borderRadius: 6,
                        border: form.is_srs ? '1px solid rgba(255,59,59,0.4)' : '1px solid rgba(255,255,255,0.12)',
                        cursor: 'pointer', fontFamily: 'DM Mono', fontSize: 11, fontWeight: 700,
                        background: form.is_srs ? 'rgba(255,59,59,0.12)' : 'transparent',
                        color: form.is_srs ? '#ff3b3b' : '#6b7280',
                        letterSpacing: '0.08em', transition: 'all 0.15s',
                      }}
                    >SRS</button>
                    <div style={{ display: 'flex', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
                      {(['COD', 'billing'] as const).map(m => (
                        <button key={m} type="button" onClick={() => { if (m !== form.payment_type) clearClient(); set('payment_type', m) }} style={{
                          padding: '7px 28px', borderRadius: 6, border: 'none', cursor: 'pointer',
                          fontFamily: 'DM Mono', fontSize: 11, fontWeight: 500,
                          background: form.payment_type === m ? 'var(--surface2)' : 'transparent',
                          color: form.payment_type === m ? (m === 'COD' ? '#7BBFFF' : '#96A9FF') : 'var(--text2)',
                          transition: 'all 0.15s', letterSpacing: '0.04em',
                        }}>{m === 'COD' ? 'COD' : 'Label/Billing'}</button>
                      ))}
                    </div>
                  </div>

                  {/* SRS modal */}
                  {showSrsModal && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ background: '#13161d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '28px 32px', width: 380, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
                        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: '#e8eaf0', marginBottom: 10 }}>SRS Referral</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 12, color: '#8b90a8', lineHeight: 1.6, marginBottom: 24 }}>
                          Apply this to the client&apos;s profile so all future bookings are automatically flagged as SRS?
                        </div>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                          <button type="button" onClick={() => { set('is_srs', true); setShowSrsModal(false) }} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', fontFamily: 'DM Mono', fontSize: 11, background: 'transparent', color: '#8b90a8' }}>Just this session</button>
                          <button type="button" onClick={async () => { set('is_srs', true); if (form.client_db_id) await supabase.from('clients').update({ srs_client: true }).eq('id', form.client_db_id); setShowSrsModal(false) }} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'DM Mono', fontSize: 11, fontWeight: 700, background: '#c8f04e', color: '#0d0f14' }}>Apply to profile</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Search input — no client attached */}
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
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 }}>
                          {clientSuggestions.map((s, i) => (
                            <div key={i} onMouseDown={() => applyClientAutofill(s)} style={{ padding: '8px 12px', cursor: 'pointer', background: i === clientHighlight ? 'var(--surface2)' : 'transparent', borderBottom: i < clientSuggestions.length - 1 ? '1px solid var(--border)' : 'none' }}>
                              <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text)' }}>{s.label}</div>
                              {s.sub && <div style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#96A9FF', marginTop: 1 }}>{s.sub}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Client card — client is attached */}
                  {hasClient && (
                    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {/* Card header */}
                      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: 'DM Serif Display', fontSize: 17, lineHeight: 1.2, color: cardNameColor, wordBreak: 'break-word' }}>{displayName}</div>
                            {form.label && form.label !== displayName && (
                              <div style={{ fontSize: 12, fontFamily: 'DM Mono', color: cardNameColor, marginTop: 3, opacity: 0.75 }}>{form.label}</div>
                            )}
                          </div>
                          <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', padding: '3px 7px', borderRadius: 3, flexShrink: 0, marginTop: 2, background: badgeBg, color: badgeColor, border: `1px solid ${badgeBorder}` }}>{badgeLabel}</span>
                        </div>
                      </div>

                      {/* Card fields */}
                      <div style={{ padding: '10px 14px 12px' }}>
                        {isBilling ? (
                          <>
                            {/* Artist */}
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
                                  {clientArtists.filter(a => !form.artist || a.toLowerCase().includes(form.artist.toLowerCase())).map((a, i) => (
                                    <div key={i} onMouseDown={e => { e.preventDefault(); set('artist', a); setShowArtistDD(false) }}
                                      style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text)', background: 'transparent' }}
                                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    >{a}</div>
                                  ))}
                                  {form.artist.trim().length >= 2 && !clientArtists.some(a => a.toLowerCase() === form.artist.trim().toLowerCase()) && form.client_db_id && (() => {
                                    const clientId = form.client_db_id
                                    return (
                                      <div onMouseDown={async e => { e.preventDefault(); const updated = await addArtistToLabel(clientId, form.artist.trim(), clientArtists); setClientArtists(updated); setShowArtistDD(false) }}
                                        style={{ padding: '7px 10px', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', borderTop: clientArtists.filter(a => !form.artist || a.toLowerCase().includes(form.artist.toLowerCase())).length > 0 ? '1px solid var(--border)' : undefined, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Don&apos;t see this artist? Add &ldquo;{form.artist.trim()}&rdquo;
                                      </div>
                                    )
                                  })()}
                                </div>
                              )}
                            </div>

                            {/* A&R */}
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
                                            <div key={c.id} onMouseDown={e => { e.preventDefault(); setAnrQuery(name); set('ordered_by', name); set('client_name', name); set('anr_contact_id', c.id); setAnrContact(c); setAnrEmail(c.email || ''); setAnrPhone(c.phone || ''); set('email', c.email || ''); set('phone', c.phone || ''); setShowAnrDD(false) }}
                                              style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text)', background: 'transparent', borderBottom: i < labelContacts.length - 1 ? '1px solid var(--border)' : 'none' }}
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
                                              e.preventDefault(); if (!clientId) return
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

                            {/* Admin */}
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
                                            <div key={c.id} onMouseDown={e => { e.preventDefault(); setAdminQuery(name); set('anr_admin_contact_id', c.id); setAdminContact(c); setAdminEmail(c.email || ''); setAdminPhone(c.phone || ''); setShowAdminDD(false) }}
                                              style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text)', background: 'transparent', borderBottom: i < labelAdminContacts.length - 1 ? '1px solid var(--border)' : 'none' }}
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
                                              e.preventDefault(); if (!clientId) return
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

                            {/* Contact update prompt */}
                            {contactUpdatePrompt && (
                              <div style={{ position: 'fixed', inset: 0, zIndex: 40000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ background: '#13161d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '24px 28px', width: 340, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
                                  <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: '#e8eaf0', marginBottom: 8 }}>Update client profile or just this session?</div>
                                  <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: '#8b90a8', lineHeight: 1.6, marginBottom: 20 }}>Save the new {contactUpdatePrompt.column} back to the contact record, or keep it for this booking only.</div>
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
                            <ClientCardField label="Email" value={form.email} fieldKey="email" onEdit={handleClientFieldEdit as (k: string, v: string) => void} editing={true} />
                            <ClientCardField label="Phone" value={form.phone} fieldKey="phone" onEdit={handleClientFieldEdit as (k: string, v: string) => void} editing={true} />
                          </>
                        )}

                        {/* View full profile */}
                        <button
                          onClick={() => form.client_db_id && setShowProfile(true)}
                          style={{ marginTop: 10, width: '100%', padding: '6px 10px', borderRadius: 4, background: 'transparent', border: '1px solid var(--border)', color: form.client_db_id ? 'var(--text2)' : 'var(--text3)', fontFamily: 'DM Mono', fontSize: 10, cursor: form.client_db_id ? 'pointer' : 'default', textAlign: 'center' }}
                        >
                          {form.client_db_id ? 'View full profile →' : 'No profile linked'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* COD method */}
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

            {/* RIGHT — Invoice # */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={sectionHead}>Invoice</div>
              <div>
                <label style={fL}>Invoice #</label>
                <input value={form.invoice_num} onChange={e => set('invoice_num', e.target.value)} placeholder="—" style={inp} />
              </div>
            </div>
          </div>

          {/* ── SEEDER BAR ── */}
          {!['tour', 'tech', 'open_hours'].includes(form.session_type) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '10px 0', marginTop: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', flexShrink: 0 }}>Seed Rows</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: 'var(--text3)' }}>From</span>
                <input type="date" value={seederStart} onChange={e => setSeederStart(e.target.value)} style={{ ...inp, width: 110 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: 'var(--text3)' }}>To</span>
                <input type="date" value={seederEnd} onChange={e => setSeederEnd(e.target.value)} style={{ ...inp, width: 110 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: 'var(--text3)' }}>Studio</span>
                <select value={seederStudio} onChange={e => setSeederStudio(e.target.value)} style={{ ...inp, width: 60 }}>
                  <option value="">—</option>
                  {STUDIO_LETTERS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: 'var(--text3)' }}>Eng</span>
                <input value={seederEng} onChange={e => setSeederEng(e.target.value)} placeholder="name" style={{ ...inp, width: 90 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: 'var(--text3)' }}>From</span>
                <TimeInput value={seederFromTime} onChange={v => setSeederFromTime(v)} style={{ ...inp, width: 80 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: 'var(--text3)' }}>To</span>
                <TimeInput value={seederToTime} onChange={v => setSeederToTime(v)} style={{ ...inp, width: 80 }} />
              </div>
              <button
                type="button"
                onClick={() => handleSeedRows(seederStart, seederEnd, seederStudio, seederFromTime, seederToTime, seederEng)}
                disabled={!seederStart}
                style={{ padding: '5px 14px', borderRadius: 5, border: 'none', cursor: seederStart ? 'pointer' : 'default', background: seederStart ? '#c8f04e' : 'rgba(200,240,78,0.3)', color: '#0d0f14', fontFamily: 'Syne', fontWeight: 700, fontSize: 10, flexShrink: 0 }}
              >+ Seed Rows</button>
            </div>
          )}

          {/* ── STUDIO TIME TABLE ── */}
          {!['tour', 'tech', 'open_hours'].includes(form.session_type) && (
            <div style={{ marginTop: 20 }}>
              <div style={sectionTitle}>Studio Time</div>
              <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '70px 65px 1fr 66px 66px 40px 52px 76px 50px 70px 68px 76px 40px 24px', background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  {['Studio', 'Date', 'Session Info', 'From', 'To', 'Hrs', 'Type', 'Rate', 'OT Hrs', 'OT Rate', 'OT Chg', 'Total', '', ''].map((h, i) => <div key={i} style={thS}>{h}</div>)}
                </div>
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {stRows.map(r => {
                    const isEngOnly = r.studio === ''
                    const isDayRow = r.row_rate_type === 'day'
                    const engName = form.engineer_name || ''
                    const engRateDisplay = r.eng_rate || form.engineer_rate || ''
                    const engRateNum = parseFloat((engRateDisplay ?? '').replace(/[^0-9.]/g, '')) || 0
                    const engHrs = calcHours(r.eng_from_time || r.from_time, r.eng_to_time || r.to_time)
                    const engCharge = engHrs != null && engHrs > 0 && engRateNum > 0 ? parseFloat((engHrs * engRateNum).toFixed(2)) : null
                    const rowTotal = (r.charge ?? 0) + (r.ot_charge ?? 0)
                    const toggleStyle = (active: boolean): React.CSSProperties => ({
                      fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, padding: '2px 5px',
                      borderRadius: 3, border: 'none', cursor: 'pointer',
                      background: active ? '#c8f04e' : 'rgba(255,255,255,0.06)',
                      color: active ? '#0d0f14' : '#8a8fa0',
                    })
                    const rowHrs = r.total_hours ?? calcHours(r.from_time, r.to_time)
                    const otHrsNum = parseFloat(r.ot_hours ?? '0') || 0
                    return (
                      <div key={r.id}>
                        {!isEngOnly && <div style={{ display: 'grid', gridTemplateColumns: '70px 65px 1fr 66px 66px 40px 52px 76px 50px 70px 68px 76px 40px 24px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: r.admin_locked ? 'rgba(20,184,166,0.04)' : undefined }}>
                          <div style={cellS}><input value={r.studio} onChange={e => handleStRowChange(r.id, { studio: e.target.value })} style={tInp} placeholder="—" /></div>
                          <div key={r.id + '-date'} style={{ ...cellS, color: '#8a8fa0', fontSize: 10, position: 'relative', cursor: 'pointer' }}>
                            <span style={{ pointerEvents: 'none' }}>{shortDate(r.date)}</span>
                            <input
                              type="date"
                              value={r.date || ''}
                              onChange={e => {
                                const newDate = e.target.value
                                setStRows(prev => prev
                                  .map(row => row.id === r.id ? { ...row, date: newDate } : row)
                                  .sort((a, b) => (a.date || 'zzzz').localeCompare(b.date || 'zzzz'))
                                  .map((row, i) => ({ ...row, sort_order: i }))
                                )
                              }}
                              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                            />
                          </div>
                          <div
                            style={{ ...cellS, cursor: 'pointer', overflow: 'hidden' }}
                            onClick={e => {
                              e.stopPropagation()
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              setSiPopoverRowId(r.id)
                              setSiPopoverText(r.session_info || '')
                              setSiPopoverPos({ top: rect.bottom + 4, left: rect.left })
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', color: r.session_info ? '#f0f0f0' : '#4a4f60', fontSize: 11 }}>
                              {r.session_info || '—'}
                            </span>
                          </div>
                          {siPopoverRowId === r.id && siPopoverPos && (
                            <>
                              <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setSiPopoverRowId(null)} />
                              <div style={{ position: 'fixed', top: siPopoverPos.top, left: siPopoverPos.left, width: 280, zIndex: 200, background: '#1a1e28', border: '1px solid #c8f04e', borderRadius: 8, padding: 12 }} onClick={e => e.stopPropagation()}>
                                <textarea
                                  value={siPopoverText}
                                  onChange={e => setSiPopoverText(e.target.value)}
                                  autoFocus
                                  rows={4}
                                  style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'vertical', color: '#f0f0f0', fontFamily: 'DM Mono', fontSize: 11, lineHeight: 1.5, marginBottom: 8, boxSizing: 'border-box' }}
                                  placeholder="Session notes…"
                                />
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button onClick={() => { handleStRowChange(r.id, { session_info: siPopoverText }); setSiPopoverRowId(null) }} style={{ flex: 1, background: '#c8f04e', color: '#0d0f14', border: 'none', borderRadius: 5, padding: '5px 0', fontFamily: 'Syne', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>Save</button>
                                  <button onClick={() => setSiPopoverRowId(null)} style={{ flex: 1, background: 'rgba(255,255,255,0.07)', color: '#8a8fa0', border: 'none', borderRadius: 5, padding: '5px 0', fontFamily: 'Syne', fontSize: 11, cursor: 'pointer' }}>Close</button>
                                </div>
                              </div>
                            </>
                          )}
                          <div style={cellS}><TimeInput value={r.from_time} onChange={v => handleStRowChange(r.id, { from_time: v })} style={tInp} /></div>
                          <div style={cellS}><TimeInput value={r.to_time} onChange={v => handleStRowChange(r.id, { to_time: v })} style={tInp} /></div>
                          <div style={{ ...cellS, color: '#8a8fa0', fontSize: 10 }}>{rowHrs != null ? `${rowHrs}h` : '—'}</div>
                          <div style={{ ...cellS, gap: 2, padding: '3px 4px' }}>
                            <button style={toggleStyle(isDayRow)} onClick={() => !isDayRow && toggleRowRateType(r.id)}>Day</button>
                            <button style={toggleStyle(!isDayRow)} onClick={() => isDayRow && toggleRowRateType(r.id)}>Hr</button>
                          </div>
                          <div style={cellS}>
                            {isDayRow
                              ? <input value={r.rate_daily} onChange={e => handleStRowChange(r.id, { rate_daily: e.target.value })} style={tInp} placeholder="$0/day" />
                              : <input value={r.rate} onChange={e => handleStRowChange(r.id, { rate: e.target.value })} style={tInp} placeholder="$0/hr" />
                            }
                          </div>
                          <div style={cellS}>
                            {isDayRow
                              ? <span style={{ fontSize: 10, color: '#8a8fa0' }}>{otHrsNum > 0 ? `${otHrsNum}h` : '—'}</span>
                              : <input value={r.ot_hours ?? ''} onChange={e => handleStRowChange(r.id, { ot_hours: e.target.value })} style={tInp} placeholder="0" />
                            }
                          </div>
                          <div style={cellS}>
                            <input value={r.ot_rate ?? ''} onChange={e => handleStRowChange(r.id, { ot_rate: e.target.value })} style={tInp} placeholder="$0" />
                          </div>
                          <div style={{ ...cellS, color: (r.ot_charge ?? 0) > 0 ? '#c8f04e' : '#8a8fa0', fontSize: 10 }}>
                            {(r.ot_charge ?? 0) > 0 ? `$${r.ot_charge!.toFixed(2)}` : '—'}
                          </div>
                          <div style={{ ...cellS, color: rowTotal > 0 ? '#c8f04e' : '#8a8fa0', fontWeight: rowTotal > 0 ? 600 : 400 }}>
                            {rowTotal > 0 ? `$${rowTotal.toFixed(2)}` : '—'}
                          </div>
                          <div style={{ ...cellS, justifyContent: 'center', padding: '3px 4px', pointerEvents: 'auto' }}>
                            <button
                              type="button"
                              onClick={() => handleToggleLock(r.id, r.admin_locked)}
                              style={{ fontSize: 8, fontFamily: 'DM Mono', fontWeight: 700, padding: '2px 5px', borderRadius: 3, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', background: r.admin_locked ? '#14B8A6' : 'rgba(255,255,255,0.06)', color: r.admin_locked ? '#0d0f14' : '#6B7280' }}
                            >{r.admin_locked ? '🔒' : '✓'}</button>
                          </div>
                          <div style={{ ...cellS, justifyContent: 'center', padding: '3px 2px', pointerEvents: 'auto' }}>
                            {confirmDeleteRowId === r.id ? (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                <span style={{ fontSize: 7, color: '#f97316', fontFamily: 'DM Mono', whiteSpace: 'nowrap' }}>Del?</span>
                                <div style={{ display: 'flex', gap: 3 }}>
                                  <button type="button" onClick={() => handleDeleteStRow(r.id)} style={{ fontSize: 8, fontFamily: 'DM Mono', color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>Y</button>
                                  <button type="button" onClick={() => setConfirmDeleteRowId(null)} style={{ fontSize: 8, fontFamily: 'DM Mono', color: '#8a8fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>N</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setConfirmDeleteRowId(r.id)} style={{ fontSize: 13, fontFamily: 'DM Mono', color: '#4a4f60', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                            )}
                          </div>
                        </div>}
                        {!isEngOnly && pendingLockedEdits[r.id] && (
                          <div style={{ padding: '5px 12px', background: 'rgba(20,184,166,0.08)', borderBottom: '1px solid rgba(20,184,166,0.2)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: 'DM Mono', color: '#14B8A6' }}>
                            <span>Editing a locked row —</span>
                            <button type="button" onClick={() => { handleToggleLock(r.id, true); setPendingLockedEdits(p => { const n = { ...p }; delete n[r.id]; return n }) }} style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid #14B8A6', background: 'rgba(20,184,166,0.15)', color: '#14B8A6', fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer' }}>Update</button>
                            <button type="button" onClick={() => { const orig = pendingLockedEdits[r.id]; setStRows(prev => prev.map(row => row.id === r.id ? orig : row)); setPendingLockedEdits(p => { const n = { ...p }; delete n[r.id]; return n }) }} style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#8a8fa0', fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer' }}>Revert</button>
                          </div>
                        )}
                        {(r.studio === '' || !!form.engineer_name || !!r.eng_rate) && r.eng_visible !== false && (
                          <>
                            <div style={{ display: 'grid', gridTemplateColumns: '70px 65px 1fr 66px 66px 40px 52px 76px 50px 70px 68px 76px 40px 24px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(200,240,78,0.03)' }}>
                              <div style={{ ...cellS, color: '#8a8fa0', fontSize: 9, fontStyle: 'italic' }}>Eng</div>
                              <div key={r.id + '-eng-date'} style={{ ...cellS, color: '#8a8fa0', fontSize: 10, position: 'relative', cursor: isEngOnly ? 'pointer' : 'default' }}>
                                <span style={{ pointerEvents: 'none' }}>{shortDate(r.date)}</span>
                                {isEngOnly && (
                                  <input
                                    type="date"
                                    value={r.date || ''}
                                    onChange={e => {
                                      const newDate = e.target.value
                                      setStRows(prev => prev
                                        .map(row => row.id === r.id ? { ...row, date: newDate } : row)
                                        .sort((a, b) => (a.date || 'zzzz').localeCompare(b.date || 'zzzz'))
                                        .map((row, i) => ({ ...row, sort_order: i }))
                                      )
                                    }}
                                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                                  />
                                )}
                              </div>
                              <div style={{ ...cellS, color: '#8a8fa0', fontSize: 10 }}>{engName}</div>
                              <div style={cellS}><TimeInput value={r.eng_from_time || r.from_time} onChange={v => handleStRowChange(r.id, { eng_from_time: v })} style={tInp} /></div>
                              <div style={cellS}><TimeInput value={r.eng_to_time || r.to_time} onChange={v => handleStRowChange(r.id, { eng_to_time: v })} style={tInp} /></div>
                              <div style={{ ...cellS, color: '#8a8fa0', fontSize: 10 }}>{engHrs != null ? `${engHrs}h` : '—'}</div>
                              <div style={cellS} />
                              <div style={cellS}>
                                <input value={r.eng_rate || engRateDisplay} onChange={e => handleStRowChange(r.id, { eng_rate: e.target.value })} style={{ ...tInp, width: 64 }} />
                              </div>
                              <div style={cellS} />
                              <div style={cellS} />
                              <div style={cellS} />
                              <div style={{ ...cellS, color: engCharge != null ? '#c8f04e' : '#8a8fa0', fontWeight: engCharge != null ? 600 : 400 }}>
                                {engCharge != null ? `$${engCharge.toFixed(2)}` : '—'}
                              </div>
                              <div style={{ ...cellS, justifyContent: 'center', padding: '3px 4px', pointerEvents: 'auto' }}>
                                <button type="button" onClick={() => handleToggleLock(r.id, r.admin_locked)} style={{ fontSize: 8, fontFamily: 'DM Mono', fontWeight: 700, padding: '2px 5px', borderRadius: 3, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', background: r.admin_locked ? '#14B8A6' : 'rgba(255,255,255,0.06)', color: r.admin_locked ? '#0d0f14' : '#6B7280' }}>{r.admin_locked ? '🔒' : '✓'}</button>
                              </div>
                              <div style={{ ...cellS, justifyContent: 'center', padding: '3px 2px', pointerEvents: 'auto' }}>
                                <button type="button" onClick={() => setConfirmClearEngId(r.id)} style={{ fontSize: 13, fontFamily: 'DM Mono', color: '#4a4f60', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                              </div>
                            </div>
                            {confirmClearEngId === r.id && (
                              <div style={{ padding: '5px 12px', background: 'rgba(249,115,22,0.08)', borderBottom: '1px solid rgba(249,115,22,0.2)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: 'DM Mono', color: '#f97316' }}>
                                <span>Delete engineer row?</span>
                                <button type="button" onClick={() => isEngOnly ? handleDeleteStRow(r.id) : clearEngRow(r.id)} style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid #f97316', background: 'rgba(249,115,22,0.15)', color: '#f97316', fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer' }}>Y</button>
                                <button type="button" onClick={() => setConfirmClearEngId(null)} style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#8a8fa0', fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer' }}>N</button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#1a1e28', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <button type="button" onClick={handleAddStRow} style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8a8fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add Studio Time</button>
                    <button type="button" onClick={addEngRow} style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#c8f04e88', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add Eng</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#f0f0f0' }}>Studio: ${stTotal.toFixed(2)}</span>
                    {engTotal > 0 && <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#c8f04e' }}>Eng: ${engTotal.toFixed(2)}</span>}
                    {engTotal > 0 && <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#f0f0f0', fontWeight: 700 }}>Total: ${(stTotal + engTotal).toFixed(2)}</span>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── EQUIPMENT CONDITION ── */}
          {!['tour', 'tech', 'open_hours'].includes(form.session_type) && (
            <div data-no-print="" style={{ marginTop: 20 }}>
              <div style={sectionTitle}>Equipment Condition</div>
              <input ref={equipNoteFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadEquipNotePhoto(f) }} />
              <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflowX: 'auto' }}>
                <div style={{ minWidth: `${130 + Math.max(sessionDates.length, 1) * 90}px` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${Math.max(sessionDates.length, 1)}, 90px)`, background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ ...thS, position: 'sticky', left: 0, background: '#1a1e28', zIndex: 1 }}>Equipment</div>
                    {sessionDates.length > 0
                      ? sessionDates.map(d => <div key={d} style={thS}>{fmtDate(d)}</div>)
                      : <div style={thS}>—</div>}
                  </div>
                  {EQUIPMENT_ITEMS.map(eq => {
                    const openDate = openNoteKey?.startsWith(`${eq}||`) ? openNoteKey.split('||')[1] : null
                    return (
                      <div key={eq}>
                        <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${Math.max(sessionDates.length, 1)}, 90px)`, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <div style={{ ...cellS, color: '#f0f0f0', fontWeight: 500, position: 'sticky', left: 0, background: '#1a1e28', zIndex: 1 }}>{eq}</div>
                          {sessionDates.length > 0
                            ? sessionDates.map(d => {
                                const key = `${eq}||${d}`
                                const row = equipRows.find(r => r.equipment === eq && r.date === d)
                                const cond = row?.condition ?? null
                                const hasNote = !!(equipNotes[key]?.note || (equipNotes[key]?.photo_urls?.length ?? 0) > 0)
                                return (
                                  <div key={d} style={{ ...cellS, display: 'flex', gap: 4, alignItems: 'center' }}>
                                    <button type="button" onClick={() => row && handleEquipChange(eq, d, 'ok')} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', border: `1px solid ${cond === 'ok' ? '#14B8A6' : 'rgba(255,255,255,0.1)'}`, background: cond === 'ok' ? 'rgba(20,184,166,0.12)' : 'transparent', color: cond === 'ok' ? '#14B8A6' : '#8a8fa0' }}>OK</button>
                                    <button type="button" onClick={() => row && handleEquipChange(eq, d, 'not_ok')} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', border: `1px solid ${cond === 'not_ok' ? '#EF4444' : 'rgba(255,255,255,0.1)'}`, background: cond === 'not_ok' ? 'rgba(239,68,68,0.12)' : 'transparent', color: cond === 'not_ok' ? '#EF4444' : '#8a8fa0' }}>✗</button>
                                    {cond === 'not_ok' && hasNote && <span style={{ width: 6, height: 6, borderRadius: 3, background: '#F97316', display: 'inline-block', flexShrink: 0 }} />}
                                  </div>
                                )
                              })
                            : <div style={{ ...cellS, color: '#4a4f64' }}>—</div>}
                        </div>
                        {openDate && (
                          <div style={{ padding: '8px 12px', background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#F97316', marginBottom: 6 }}>{eq} — {openDate}</div>
                            <textarea
                              value={equipNotes[`${eq}||${openDate}`]?.note ?? ''}
                              onChange={e => {
                                const k = `${eq}||${openDate}`
                                setEquipNotes(prev => ({ ...prev, [k]: { ...(prev[k] ?? { id: '', photo_urls: [] }), note: e.target.value } }))
                              }}
                              onBlur={e => upsertEquipNote(`${eq}||${openDate}`, eq, openDate, { note: e.target.value })}
                              placeholder="Note about this issue…"
                              style={{ width: '100%', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: '#f0f0f0', fontFamily: 'DM Mono', fontSize: 10, padding: '5px 7px', resize: 'none', outline: 'none', boxSizing: 'border-box', minHeight: 56 }}
                            />
                            {(equipNotes[`${eq}||${openDate}`]?.photo_urls?.length ?? 0) > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                                {equipNotes[`${eq}||${openDate}`].photo_urls.map((url, i) => (
                                  <a key={i} href={url} target="_blank" rel="noreferrer">
                                    <img src={url} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)', display: 'block' }} />
                                  </a>
                                ))}
                              </div>
                            )}
                            <button type="button" disabled={noteUploading} onClick={() => { pendingNoteKey.current = { key: `${eq}||${openDate}`, equipment: eq, date: openDate }; equipNoteFileRef.current?.click() }} style={{ marginTop: 6, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, color: noteUploading ? '#4a4f64' : '#8a8fa0', background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, cursor: noteUploading ? 'not-allowed' : 'pointer', padding: '3px 10px' }}>
                              {noteUploading ? 'Uploading…' : '+ Photo'}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── RENTALS ── */}
          {!['tour', 'tech', 'open_hours'].includes(form.session_type) && (
            <div style={{ marginTop: 20 }}>
              <div style={sectionTitle}>Rentals</div>
              <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 120px 110px 65px 80px 24px', background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  {['Qty', 'Item', 'Supplier', 'Date(s) Used', 'Rate', 'Charge', ''].map(h => <div key={h} style={thS}>{h}</div>)}
                </div>
                {rentRows.map((r, idx) => (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 120px 110px 65px 80px 24px', borderBottom: idx < rentRows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                    <div style={cellS}><input value={r.qty} onChange={e => handleRentChange(r.id, { qty: e.target.value })} style={tInp} /></div>
                    <div style={cellS}><input value={r.item} onChange={e => handleRentChange(r.id, { item: e.target.value })} style={tInp} /></div>
                    <div style={cellS}><input value={r.supplier} onChange={e => handleRentChange(r.id, { supplier: e.target.value })} style={tInp} /></div>
                    <div style={cellS}><input value={r.dates_used} onChange={e => handleRentChange(r.id, { dates_used: e.target.value })} style={tInp} /></div>
                    <div style={cellS}><input value={r.rate} onChange={e => handleRentChange(r.id, { rate: e.target.value })} style={tInp} /></div>
                    <div style={cellS}><input value={r.charge} onChange={e => handleRentChange(r.id, { charge: e.target.value })} placeholder="$0.00" style={tInp} /></div>
                    <div style={{ ...cellS, padding: '6px 4px' }}>
                      <button type="button" onClick={() => handleRentDelete(r.id)} style={{ background: 'none', border: 'none', color: '#4a4f64', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#1a1e28', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <button type="button" onClick={handleAddRent} style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8a8fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add row</button>
                  <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#f0f0f0', fontWeight: 700 }}>Total: ${rentTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── PAYMENTS + NOTES (2-col) ── */}
          {!['tour', 'tech', 'open_hours'].includes(form.session_type) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginTop: 20 }}>

              {/* Left — Session Notes + COD signature */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div style={sectionTitle}>Session Notes</div>
                  <textarea value={form.session_notes} onChange={e => set('session_notes', e.target.value)}
                    style={{ width: '100%', minHeight: 90, background: '#1a1e28', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 5, color: '#f0f0f0', fontFamily: 'DM Mono', fontSize: 11, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }} />
                </div>
                {form.payment_type === 'COD' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#4a4f64', lineHeight: 1.8, padding: '10px 12px', background: '#1a1e28', borderRadius: 5, border: '1px solid rgba(255,255,255,0.05)' }}>
                      By signing below, I acknowledge that I am authorized to approve charges for this session. I accept responsibility for all associated costs and understand that payment is due in full at the time of service unless otherwise agreed. I also acknowledge that Paramount Recording is not responsible for any media, personal items, or equipment left behind.
                      <br /><br />
                      <em>No Tapes, CDs, DVDs, Thumb Drives, Computer Drives or other Recording Media will be released until payment in full is received.</em>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center' }}>
                      <div style={metaLabel}>Date</div>
                      <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#f0f0f0' }}>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center' }}>
                      <div style={metaLabel}>Print Name</div>
                      <input value={form.print_name} onChange={e => set('print_name', e.target.value)} style={{ ...tInp, borderBottom: '1px solid rgba(255,255,255,0.2)' }} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={metaLabel}>Signature</div>
                        <button type="button" onClick={clearAdminSignature} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '2px 8px', color: '#8a8fa0', fontSize: 10, cursor: 'pointer', fontFamily: 'DM Mono' }}>Clear</button>
                      </div>
                      <canvas
                        ref={adminCanvasRef}
                        width={700}
                        height={200}
                        onMouseDown={startAdminDraw}
                        onMouseMove={continueAdminDraw}
                        onMouseUp={endAdminDraw}
                        onMouseLeave={endAdminDraw}
                        onTouchStart={startAdminDraw}
                        onTouchMove={continueAdminDraw}
                        onTouchEnd={endAdminDraw}
                        style={{ width: '100%', height: 100, background: '#0d0f14', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', display: 'block', touchAction: 'none', cursor: 'crosshair' }}
                      />
                      {form.signature_data && <div style={{ fontSize: 9, color: '#4a4f64', fontFamily: 'DM Mono', marginTop: 4 }}>Signature captured ✓</div>}
                    </div>
                  </div>
                )}
              </div>

              {/* Right — Payments + Totals */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div style={sectionTitle}>Payments</div>
                  <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
                    {payRows.map((p, idx) => {
                      const needsLast4 = p.payment_type === 'Credit Card' || p.payment_type === 'Debit Card'
                      return (
                        <div key={p.id} style={{ display: 'grid', gridTemplateColumns: needsLast4 ? '130px 80px 1fr 70px 24px' : '130px 80px 1fr 24px', borderBottom: idx < payRows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', alignItems: 'center' }}>
                          <div style={cellS}>
                            <select value={p.payment_type} onChange={e => handlePayChange(p.id, { payment_type: e.target.value, last_four: '' })} style={{ ...tInp, background: 'transparent', cursor: 'pointer' }}>
                              <option value="">— type —</option>
                              {['Cash', 'Zelle', 'Credit Card', 'Debit Card', 'Check', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div style={cellS}><input value={p.amount} onChange={e => handlePayChange(p.id, { amount: e.target.value })} onBlur={e => handlePayChange(p.id, { amount: formatCurrency(e.target.value) })} placeholder="0.00" style={tInp} /></div>
                          <div style={cellS}><input value={p.memo} onChange={e => handlePayChange(p.id, { memo: e.target.value })} placeholder="memo" style={tInp} /></div>
                          {needsLast4 && (
                            <div style={cellS}><input value={p.last_four} onChange={e => handlePayChange(p.id, { last_four: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="last 4" maxLength={4} style={tInp} /></div>
                          )}
                          <div style={{ ...cellS, padding: '6px 4px' }}>
                            <button type="button" onClick={() => handlePayDelete(p.id)} style={{ background: 'none', border: 'none', color: '#4a4f64', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                          </div>
                        </div>
                      )
                    })}
                    <div style={{ padding: '7px 10px' }}>
                      <button type="button" onClick={handleAddPay} style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8a8fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add payment</button>
                    </div>
                  </div>
                </div>
                <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
                  {[
                    { label: 'Studio Total', value: stTotal, color: '#f0f0f0', bold: false },
                    ...(engTotal > 0 ? [{ label: 'Eng Total', value: engTotal, color: '#c8f04e', bold: false }] : []),
                    { label: 'Rentals Total', value: rentTotal, color: '#f0f0f0', bold: false },
                    { label: 'Grand Total', value: grandTotal, color: '#f0f0f0', bold: true },
                    { label: 'Total Paid', value: totalPaid, color: '#14B8A6', bold: false },
                    { label: 'Balance Due', value: balanceDue, color: balanceDue > 0 ? '#EF4444' : '#14B8A6', bold: true },
                  ].map(({ label, value, color, bold }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8a8fa0' }}>{label}</span>
                      <span style={{ fontSize: bold ? 13 : 11, fontFamily: 'DM Mono', color, fontWeight: bold ? 700 : 400 }}>${value.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── NEEDS ATTENTION / RUNNER NOTES ── */}
          {!['tour', 'tech', 'open_hours'].includes(form.session_type) && (
            <div data-no-print="" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20, marginTop: 20 }}>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 10, color: '#f97316', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
                Needs Attention / Runner Notes
              </div>
              <textarea
                value={form.needs_attention_notes}
                onChange={e => set('needs_attention_notes', e.target.value)}
                placeholder="Internal notes only — never appears on the PDF export…"
                style={{ width: '100%', minHeight: 80, background: '#1a1e28', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 5, color: '#f0f0f0', fontFamily: 'DM Mono', fontSize: 11, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
              />
              {form.needs_attention_photos?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {form.needs_attention_photos.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'block', flexShrink: 0 }}>
                      <img src={url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '2px solid rgba(249,115,22,0.4)', display: 'block' }} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>{/* end body */}

        {/* ── FOOTER ── */}
        <div style={{ position: 'sticky', bottom: 0, background: '#0d0f14', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
          {/* Left — Delete */}
          <div>
            {bookingId && (
              <button
                type="button"
                onClick={() => { if (confirmDelete) handleDelete(); else setConfirmDelete(true) }}
                style={{ padding: '7px 16px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', border: `1px solid ${confirmDelete ? 'transparent' : 'rgba(239,68,68,0.5)'}`, background: confirmDelete ? '#EF4444' : 'transparent', color: confirmDelete ? '#fff' : '#EF4444' }}
              >
                {confirmDelete ? 'Confirm Delete' : 'Delete'}
              </button>
            )}
          </div>
          {/* Right — actions */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={printWithFilename} style={{ padding: '7px 16px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#8a8fa0' }}>
              Export PDF
            </button>
            <button type="button" onClick={printWithFilename} style={{ padding: '7px 16px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#8a8fa0' }}>
              Print
            </button>
            <button type="button" onClick={onClose} style={{ padding: '7px 16px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#8a8fa0' }}>
              Cancel
            </button>
            {isCompleted && (
              <button type="button" onClick={handleComplete} disabled={completing} style={{ padding: '7px 18px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: completing ? 'default' : 'pointer', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#8a8fa0', opacity: completing ? 0.7 : 1 }}>
                {completing ? 'Re-opening…' : 'Re-open WO'}
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{ padding: '7px 22px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', background: saving ? 'rgba(200,240,78,0.5)' : '#c8f04e', border: 'none', color: '#0d0f14', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : 'Close & Save'}
            </button>
          </div>
        </div>

      </div>

      {/* Client profile popup */}
      {showProfile && form.client_db_id && (
        <ClientProfilePopup clientId={form.client_db_id} onClose={() => setShowProfile(false)} />
      )}

      {/* Profile update dialog */}
      {showProfileUpdate && (
        <div onClick={e => { e.stopPropagation(); exitCardEditMode() }} style={{ position: 'fixed', inset: 0, zIndex: 30000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '20px 24px', maxWidth: 360, width: '100%' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Update client profile?</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'DM Mono', lineHeight: 1.6, marginBottom: 18 }}>You edited contact details on this booking. Save those changes to the full client profile too?</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => exitCardEditMode()} style={{ padding: '6px 14px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer' }}>Just this session</button>
              <button onClick={async () => { if (form.client_db_id) { for (const [col, val] of Object.entries(clientEdits)) { await supabase.from('clients').update({ [col]: val }).eq('id', form.client_db_id) } } exitCardEditMode() }} style={{ padding: '6px 14px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', background: '#1e40af', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Update profile</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
