'use client'
import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Booking, Client, ClientContact, Engineer } from '@/lib/supabase'
import TimeInput from '@/components/shared/TimeInput'
import { ClientProfile } from '@/components/clients/ClientProfile'

// ─── LOCATIONS ───────────────────────────────────────────────────────────────

const LOCATIONS = [
  { name: 'Paramount', rooms: ['Studio A', 'Studio B', 'Studio C', 'Studio X', 'Studio E'] },
  { name: 'Ameraycan', rooms: ['Studio A', 'Studio B'] },
  { name: 'Encore', rooms: ['Studio A', 'Studio B'] },
  { name: 'Track', rooms: ['North', 'South'] },
]

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

const LABEL_W = 148
const COL_W = 120  // minimum day-column width; forces horizontal scroll when cols × days > viewport
const ZOOM_FIXED = [44, 60, 80, 88, 110, 132] // zoom levels 1–6; level 0 = fit-all
const BUFFER_WEEKS = 2 // weeks of buffer rendered on each side for endless horizontal scroll

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

function getMonday(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  const day = r.getDay()
  r.setDate(r.getDate() - (day === 0 ? 6 : day - 1))
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parse(s: string): Date {
  const [y, m, dd] = s.split('-').map(Number)
  return new Date(y, m - 1, dd)
}

function dayDiff(a: Date, b: Date): number {
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000,
  )
}

function isWeekend(d: Date) {
  const n = d.getDay()
  return n === 0 || n === 6
}

function isToday(d: Date) {
  const t = new Date()
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()
}

function initials(name: string | null): string {
  if (!name?.trim()) return ''
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

function cycleEng(s: string): string {
  const c = ['not_needed', 'hold', 'confirmed']
  return c[(c.indexOf(s) + 1) % 3]
}

function genInvoice(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

function fmtTime(t: string): string {
  if (!t) return ''
  const m = t.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
  if (!m) return t
  let h = parseInt(m[1])
  const min = m[2]
  const ap = m[3]?.toUpperCase()
  if (ap) return `${h}${min !== '00' ? ':' + min : ''}${ap === 'AM' ? 'A' : 'P'}`
  const suf = h >= 12 ? 'P' : 'A'
  if (h > 12) h -= 12
  if (h === 0) h = 12
  return `${h}${min !== '00' ? ':' + min : ''}${suf}`
}

function fmtMoney(v: string): string {
  if (!v?.trim()) return ''
  const n = parseFloat(v.replace(/[^0-9.]/g, ''))
  if (isNaN(n)) return v
  return `$${Math.round(n)}`
}

function rangeLabel(start: Date, totalDays: number): string {
  const end = addDays(start, totalDays - 1)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const a = start.toLocaleDateString('en-US', opts)
  const b = end.toLocaleDateString('en-US', opts)
  const y = end.getFullYear()
  if (start.getMonth() === end.getMonth())
    return `${start.toLocaleDateString('en-US', { month: 'long' })} ${start.getDate()}–${end.getDate()}, ${y}`
  return `${a} – ${b}, ${y}`
}

// ─── FORM STATE ──────────────────────────────────────────────────────────────

type FormData = {
  status: string; session_type: string; payment_type: string; cod_method: string
  location: string; studio: string; start_date: string; end_date: string
  from_time: string; to_time: string; rate: string; rate_daily: string; rate_type: 'hourly' | 'daily'; invoice_num: string
  client_name: string; artist: string; label: string; ordered_by: string
  phone: string; email: string; po: string; producer: string
  food_budget: boolean; food_amount: string
  engineer_name: string; engineer_status: string
  assistant_name: string; assistant_status: string
  notes: string
  client_db_id: string | null
}

function emptyForm(overrides: Partial<FormData> = {}): FormData {
  const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) as Partial<FormData>
  return {
    status: 'tentative', session_type: 'recording', payment_type: 'COD', cod_method: '',
    location: '', studio: '',
    start_date: fmt(new Date()), end_date: fmt(new Date()),
    from_time: '', to_time: '', rate: '', rate_daily: '', rate_type: 'hourly', invoice_num: '',
    client_name: '', artist: '', label: '', ordered_by: '',
    phone: '', email: '', po: '', producer: '',
    food_budget: false, food_amount: '',
    engineer_name: '', engineer_status: 'not_needed',
    assistant_name: '', assistant_status: 'not_needed',
    notes: '',
    client_db_id: null,
    ...clean,
  }
}

function bookingToForm(b: Booking): FormData {
  return {
    status: b.status, session_type: b.session_type, payment_type: b.payment_type,
    cod_method: b.cod_method ?? '',
    location: b.location, studio: b.studio,
    start_date: b.start_date, end_date: b.end_date,
    from_time: b.from_time ?? '', to_time: b.to_time ?? '',
    rate: b.rate ?? '', rate_daily: b.rate_daily ?? '',
    rate_type: b.rate_daily ? 'daily' : 'hourly',
    invoice_num: b.invoice_num ?? '',
    client_name: b.client_name ?? '', artist: b.artist ?? '', label: b.label ?? '',
    ordered_by: b.ordered_by ?? '', phone: b.phone ?? '', email: b.email ?? '',
    po: b.po ?? '', producer: b.producer ?? '',
    food_budget: b.food_budget ?? false, food_amount: b.food_amount ?? '',
    engineer_name: b.engineer_name ?? '', engineer_status: b.engineer_status ?? 'not_needed',
    assistant_name: b.assistant_name ?? '', assistant_status: b.assistant_status ?? 'not_needed',
    notes: b.notes ?? '',
    client_db_id: b.client_id ?? null,
  }
}

// ─── LANE ASSIGNMENT ─────────────────────────────────────────────────────────

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

function bookingDateOverlaps(a: Booking, b: Booking): boolean {
  return a.start_date <= b.end_date && b.start_date <= a.end_date
}

function assignLanes(bookings: Booking[]): Map<number, { lane: number; numLanes: number }> {
  if (bookings.length === 0) return new Map()
  const sorted = [...bookings].sort((a, b) => {
    if (a.start_date < b.start_date) return -1
    if (a.start_date > b.start_date) return 1
    const dt = timeToMins(a.from_time) - timeToMins(b.from_time)
    if (dt !== 0) return dt
    if (a.end_date < b.end_date) return -1
    if (a.end_date > b.end_date) return 1
    return 0
  })
  const lanes: number[] = new Array(sorted.length).fill(0)
  for (let i = 0; i < sorted.length; i++) {
    const used = new Set<number>()
    for (let j = 0; j < i; j++) {
      if (bookingDateOverlaps(sorted[i], sorted[j])) used.add(lanes[j])
    }
    let lane = 0
    while (used.has(lane)) lane++
    lanes[i] = lane
  }
  const result = new Map<number, { lane: number; numLanes: number }>()
  for (let i = 0; i < sorted.length; i++) {
    let maxLane = lanes[i]
    for (let j = 0; j < sorted.length; j++) {
      if (i !== j && bookingDateOverlaps(sorted[i], sorted[j])) maxLane = Math.max(maxLane, lanes[j])
    }
    result.set(sorted[i].id, { lane: lanes[i], numLanes: maxLane + 1 })
  }
  return result
}

// ─── BOOKING BLOCK ───────────────────────────────────────────────────────────

function BookingBlock({
  booking, gridStart, totalDays, lane, numLanes, rowH, onClick,
}: {
  booking: Booking; gridStart: Date; totalDays: number
  lane: number; numLanes: number; rowH: number; onClick: () => void
}) {
  const bStart = parse(booking.start_date)
  const bEnd = parse(booking.end_date)
  const gridEnd = addDays(gridStart, totalDays - 1)
  const visStart = bStart < gridStart ? gridStart : bStart
  const visEnd = bEnd > gridEnd ? gridEnd : bEnd
  const offset = dayDiff(gridStart, visStart)
  const dur = dayDiff(visStart, visEnd) + 1
  const left = (offset / totalDays) * 100
  const width = (dur / totalDays) * 100

  const isBilling = booking.payment_type === 'billing'
  const nameColor = isBilling ? COLOR_LABEL : COLOR_COD
  const topColor = STATUS_TOP_COLORS[booking.status] ?? STATUS_TOP_COLORS.confirmed
  const sessionBorder = booking.session_type !== 'recording'

  // Line 1: artist (billing) or client name (COD)
  const primaryName = isBilling
    ? (booking.artist || booking.label || booking.client_name || '')
    : (booking.client_name || '')

  // Line 2: label name — billing only, only when label differs from primaryName
  const labelLine = isBilling && booking.label && booking.label !== primaryName
    ? booking.label : ''

  const timeStr = booking.from_time && booking.to_time
    ? `${fmtTime(booking.from_time)}–${fmtTime(booking.to_time)}`
    : booking.from_time ? fmtTime(booking.from_time) : ''

  const eng = initials(booking.engineer_name)
  const asst = initials(booking.assistant_name)
  const engColor = booking.engineer_status === 'confirmed' ? '#4ef0a2'
    : booking.engineer_status === 'hold' ? '#f0a24e'
    : 'rgba(255,255,255,0.4)'
  const asstColor = booking.assistant_status === 'confirmed' ? '#4ef0a2'
    : booking.assistant_status === 'hold' ? '#f0a24e'
    : 'rgba(255,255,255,0.4)'

  const clickZone = Math.round(Math.min(18, rowH * 0.22))
  const usableH = rowH - clickZone
  const slotH = usableH / numLanes
  const blockTop = lane * slotH + 2
  const blockHeight = slotH - 3
  const micro = blockHeight < 30
  const compact = !micro && blockHeight < 60
  const codLabel = booking.cod_method === 'Credit Card' ? 'CC' : (booking.cod_method ?? '').toUpperCase()

  return (
    <div
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        position: 'absolute', top: blockTop, height: blockHeight,
        left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)`,
        background: '#0d0f14', boxSizing: 'border-box',
        borderTop: `${micro ? 3 : 4}px solid ${topColor}`,
        borderLeft: sessionBorder ? '2px solid rgba(255,255,255,0.55)' : '1px solid rgba(255,255,255,0.08)',
        borderRight: sessionBorder ? '2px solid rgba(255,255,255,0.55)' : '1px solid rgba(255,255,255,0.08)',
        borderBottom: sessionBorder ? '2px solid rgba(255,255,255,0.55)' : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 4,
        padding: micro ? '1px 4px' : compact ? '3px 5px' : '4px 6px',
        cursor: 'pointer', overflow: 'hidden',
        display: 'flex', flexDirection: micro ? 'row' : 'column',
        alignItems: micro ? 'center' : undefined,
        justifyContent: micro ? 'flex-start' : 'space-between',
        gap: micro ? 4 : undefined,
        zIndex: 2, minWidth: 0,
      }}
    >
      {micro ? (
        <>
          <div style={{ color: nameColor, fontSize: 8, fontFamily: 'DM Serif Display', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto', minWidth: 0 }}>
            {primaryName}
          </div>
          {timeStr && (
            <div style={{ fontSize: 7, fontFamily: 'DM Mono', color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {timeStr}
            </div>
          )}
        </>
      ) : compact ? (
        <>
          {/* Row 1: name + inline COD badge + invoice# */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0, overflow: 'hidden' }}>
            <div style={{
              color: nameColor, fontSize: blockHeight >= 48 ? 12 : 10,
              fontFamily: 'DM Serif Display', lineHeight: 1.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              flex: '1 1 0', minWidth: 0,
            }}>
              {primaryName}
            </div>
            {!isBilling && codLabel && (
              <span style={{ fontSize: 7, fontFamily: 'DM Mono', fontWeight: 700, color: '#f87171', flexShrink: 0, lineHeight: 1, letterSpacing: '0.03em' }}>
                {codLabel}
              </span>
            )}
          </div>
          {/* Row 2: time + eng/asst */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', overflow: 'hidden' }}>
            <div style={{ fontSize: 8, fontFamily: 'DM Mono', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
              {timeStr}
            </div>
            {(eng || asst) && (
              <div style={{ display: 'flex', gap: 3, flexShrink: 0, marginLeft: 4 }}>
                {eng  && <div style={{ fontSize: 8, fontFamily: 'DM Mono', color: engColor, whiteSpace: 'nowrap' }}>1ST-{eng}</div>}
                {asst && <div style={{ fontSize: 8, fontFamily: 'DM Mono', color: asstColor, whiteSpace: 'nowrap' }}>2ND-{asst}</div>}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{
            color: nameColor, fontSize: 13, fontFamily: 'DM Serif Display', lineHeight: 1.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {primaryName}
          </div>
          {labelLine && (
            <div style={{
              fontSize: 10, fontFamily: 'DM Mono', lineHeight: 1.2, marginTop: 1,
              color: 'rgba(255,255,255,0.45)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {labelLine}
            </div>
          )}
          {timeStr && (
            <div style={{ fontSize: 9, fontFamily: 'DM Mono', lineHeight: 1.2, marginTop: 2, color: 'rgba(255,255,255,0.4)' }}>
              {timeStr}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 'auto' }}>
            <div>
              {!isBilling && booking.cod_method && (
                <div style={{ fontSize: 8, fontFamily: 'DM Mono', fontWeight: 700, lineHeight: 1.3, color: '#f87171' }}>
                  {booking.cod_method.toUpperCase()}
                </div>
              )}
            </div>
            {(eng || asst) && (
              <div style={{ textAlign: 'right' }}>
                {eng  && <div style={{ fontSize: 8, fontFamily: 'DM Mono', lineHeight: 1.3, color: engColor }}>1ST-{eng}</div>}
                {asst && <div style={{ fontSize: 8, fontFamily: 'DM Mono', lineHeight: 1.3, color: asstColor }}>2ND-{asst}</div>}
              </div>
            )}
          </div>
        </>
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

function BookingForm({
  bookingId, initial, onSave, onDelete, onClose, onDraftChange,
}: {
  bookingId?: number
  initial: FormData
  onSave: (data: FormData) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
  onDraftChange?: (data: FormData) => void
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
  const asstApplied = useRef(false)
  const [clientArtists, setClientArtists] = useState<string[]>([])
  const [showArtistDD, setShowArtistDD] = useState(false)
  const [timeTBD, setTimeTBD] = useState(false)
  const [engOn, setEngOn] = useState(initial.engineer_name !== '')
  const [asstOn, setAsstOn] = useState(initial.assistant_name !== '')
  const [engQuery, setEngQuery] = useState('')
  const [engSuggestions, setEngSuggestions] = useState<Engineer[]>([])
  const [showEngDD, setShowEngDD] = useState(false)
  const [engHighlight, setEngHighlight] = useState(-1)
  const [asstQuery, setAsstQuery] = useState('')
  const [asstSuggestions, setAsstSuggestions] = useState<Engineer[]>([])
  const [showAsstDD, setShowAsstDD] = useState(false)
  const [asstHighlight, setAsstHighlight] = useState(-1)

  function set<K extends keyof FormData>(k: K, v: FormData[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

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
          .select('id,type,name,fname,lname,email,phone,artists')
          .or(`name.ilike.%${q}%,fname.ilike.%${q}%,lname.ilike.%${q}%`)
          .limit(30),
        // Search A&R contacts by name, join to parent client for label name
        supabase
          .from('client_contacts')
          .select('id,client_id,fname,lname,email,phone,clients(id,name,type)')
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
        // For label-type clients, sub = first artist; for individual, no sub
        const sub = c.type === 'label' ? (c.artists && c.artists[0] ? c.artists[0] : '') : ''
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
      artist: (r.artists && r.artists.length > 0 ? r.artists[0] : f.artist) || f.artist,
    }))
    setClientArtists(r.artists && r.artists.length > 0 ? r.artists : [])
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
    setEngQuery(''); setShowEngDD(false); setEngHighlight(-1)
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
                  <select
                    value={form.location && form.studio ? `${form.location}|${form.studio}` : ''}
                    onChange={e => {
                      if (!e.target.value) { setForm(f => ({ ...f, location: '', studio: '' })); return }
                      const [loc, stu] = e.target.value.split('|')
                      setForm(f => ({ ...f, location: loc, studio: stu }))
                    }}
                    style={{ ...inp, width: 'auto' }}
                  >
                    <option value="">Select studio…</option>
                    {LOCATIONS.map(loc => (
                      <optgroup key={loc.name} label={loc.name}>
                        {loc.rooms.map(room => (
                          <option key={room} value={`${loc.name}|${room}`}>{loc.name} {room}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
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
                  <input type="date" value={form.start_date || ''} onChange={e => set('start_date', e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={fL}>End Date</label>
                  <input type="date" value={form.end_date || ''} onChange={e => set('end_date', e.target.value)} style={inp} />
                </div>
              </div>

              {/* Times */}
              <div>
                <label style={fL}>From – To</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!timeTBD && (
                    <>
                      <TimeInput value={form.from_time} onChange={v => set('from_time', v)} placeholder="10:00 AM" style={{ ...inp, width: 90 }} />
                      <TimeInput value={form.to_time} onChange={v => set('to_time', v)} placeholder="10:00 PM" style={{ ...inp, width: 90 }} />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => { setTimeTBD(t => !t); if (!timeTBD) { set('from_time', ''); set('to_time', '') } }}
                    style={{
                      padding: '4px 14px', borderRadius: 20, fontSize: 10, fontFamily: 'DM Mono',
                      fontWeight: 600, cursor: 'pointer', border: 'none',
                      background: timeTBD ? '#c2410c' : 'var(--surface2)',
                      color: timeTBD ? '#fff' : '#c2410c',
                      outline: timeTBD ? '2px solid rgba(194,65,12,0.4)' : '1px solid rgba(194,65,12,0.35)',
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
                          const next = !engOn
                          setEngOn(next)
                          if (!next) { set('engineer_name', ''); set('engineer_status', 'not_needed'); setEngQuery('') }
                        }}
                        style={{
                          padding: '5px 9px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne',
                          fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                          background: engOn ? 'rgba(240,162,78,0.12)' : '#1a1d27',
                          color: engOn ? '#f0a24e' : '#8b90a8',
                          border: `1px solid ${engOn ? 'rgba(240,162,78,0.35)' : '#2a2e3d'}`,
                        }}
                      >{engOn && form.engineer_name ? `● ${form.engineer_name}` : engOn ? '● ENG' : '○ ENG'}</button>
                      {engOn && !form.engineer_name && (
                        <input
                          placeholder="Name…"
                          value={engQuery}
                          onChange={e => setEngQuery(e.target.value)}
                          onBlur={() => {
                            const q = engQuery.trim()
                            setTimeout(() => {
                              setShowEngDD(false)
                              if (!engApplied.current && q) applyEng(q)
                              engApplied.current = false
                            }, 150)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'ArrowDown') { e.preventDefault(); setEngHighlight(h => Math.min(h + 1, engSuggestions.length - 1)) }
                            else if (e.key === 'ArrowUp') { e.preventDefault(); setEngHighlight(h => Math.max(h - 1, 0)) }
                            else if (e.key === 'Enter') { e.preventDefault(); if (engHighlight >= 0) applyEng(engSuggestions[engHighlight]); else if (engQuery.trim()) applyEng(engQuery.trim()) }
                            else if (e.key === 'Escape') { setEngQuery(''); setShowEngDD(false) }
                          }}
                          style={{ background: '#1a1d27', border: '1px solid #2a2e3d', color: '#e8eaf2', fontFamily: 'DM Mono', fontSize: 11, padding: '5px 8px', borderRadius: 4, flex: 1, minWidth: 0, outline: 'none' }}
                          autoComplete="off"
                        />
                      )}
                      {engOn && form.engineer_name && (
                        <button type="button" onClick={() => set('engineer_status', cycleEng(form.engineer_status))} style={{ padding: '4px 8px', borderRadius: 20, fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer', border: 'none', background: ENG_STATUS_COLORS[form.engineer_status] + '22', color: ENG_STATUS_COLORS[form.engineer_status], outline: `1px solid ${ENG_STATUS_COLORS[form.engineer_status]}55`, flexShrink: 0 }}>
                          {ENG_STATUS_LABELS[form.engineer_status]}
                        </button>
                      )}
                      {engOn && form.engineer_name && (
                        <button type="button" onMouseDown={() => { set('engineer_name', ''); set('engineer_status', 'not_needed'); setEngQuery('') }} style={{ background: 'none', border: 'none', color: '#4a4f64', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '1px 4px', flexShrink: 0 }}>×</button>
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
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 4 }}>
                <button style={{
                  flex: 1, padding: '8px 0', borderRadius: 5, fontSize: 12, fontFamily: 'Syne',
                  fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                  cursor: 'pointer', background: 'transparent',
                  border: '1px solid var(--border)', color: 'var(--text2)', whiteSpace: 'nowrap',
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

                  {/* COD / Label billing toggle — exact CRM style */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
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
                          {!editingCard && (
                            <button
                              onClick={startCardEdit}
                              style={{
                                padding: '3px 9px', borderRadius: 4, fontSize: 9, fontFamily: 'Syne',
                                fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                                cursor: 'pointer', flexShrink: 0, marginTop: 1,
                                background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)',
                              }}
                            >Edit</button>
                          )}
                          {!editingCard && (
                            <button
                              onClick={clearClient}
                              title="Remove client"
                              style={{
                                background: 'none', border: 'none', color: 'var(--text3)',
                                cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '1px 2px', flexShrink: 0, marginTop: 1,
                              }}
                            >×</button>
                          )}
                        </div>
                      </div>

                      {/* Card fields */}
                      <div style={{ padding: '10px 14px 12px' }}>
                        {isBilling ? (
                          <>
                            {/* Artist — always editable, autocompletes from client artists */}
                            <div style={{ marginBottom: 8, position: 'relative' }}>
                              <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 2 }}>Artist</div>
                              <input
                                value={form.artist}
                                onChange={e => { set('artist', e.target.value); setShowArtistDD(true) }}
                                onFocus={() => setShowArtistDD(true)}
                                onBlur={() => setShowArtistDD(false)}
                                placeholder="—"
                                style={{ width: '100%', background: 'var(--surface)', border: 'none', borderBottom: '1px solid var(--border)', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '2px 0', lineHeight: 1.5 }}
                              />
                              {showArtistDD && clientArtists.filter(a => !form.artist || a.toLowerCase().includes(form.artist.toLowerCase())).length > 0 && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', marginTop: 2 }}>
                                  {clientArtists
                                    .filter(a => !form.artist || a.toLowerCase().includes(form.artist.toLowerCase()))
                                    .map((a, i) => (
                                      <div
                                        key={i}
                                        onMouseDown={e => { e.preventDefault(); set('artist', a); setShowArtistDD(false) }}
                                        style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text)', background: 'transparent' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                      >{a}</div>
                                    ))}
                                </div>
                              )}
                            </div>
                            <ClientCardField label="A&R Email" value={form.email} fieldKey="email" onEdit={handleClientFieldEdit} editing={editingCard} />
                            <ClientCardField label="A&R Phone" value={form.phone} fieldKey="phone" onEdit={handleClientFieldEdit} editing={editingCard} />
                          </>
                        ) : (
                          <>
                            <ClientCardField label="Email" value={form.email} fieldKey="email" onEdit={handleClientFieldEdit} editing={editingCard} />
                            <ClientCardField label="Phone" value={form.phone} fieldKey="phone" onEdit={handleClientFieldEdit} editing={editingCard} />
                          </>
                        )}

                        {/* Edit mode Save / Cancel */}
                        {editingCard && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                            <button onClick={cancelCardEdit} style={{ flex: 1, padding: '6px 10px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)' }}>Cancel</button>
                            <button onClick={saveCardEdit} style={{ flex: 1, padding: '6px 10px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', background: '#1e40af', border: 'none', color: '#fff', fontWeight: 700 }}>Save</button>
                          </div>
                        )}

                        {/* View full profile */}
                        {!editingCard && (
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
    </div>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

type ViewType = 'day' | 'studio' | 'week' | '2wks' | 'month'

export default function CalendarPage() {
  return <Suspense><CalendarPageInner /></Suspense>
}

function CalendarPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [view, setView] = useState<ViewType>('2wks')
  const [startDate, setStartDate] = useState(() => getMonday(new Date()))
  const [bookings, setBookings] = useState<Booking[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editBooking, setEditBooking] = useState<Booking | null>(null)
  const [formInitial, setFormInitial] = useState<FormData>(() => emptyForm())
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(() => new Set())
  const [locFilter, setLocFilter] = useState('All')
  const [zoomLevel, setZoomLevel] = useState(0) // 0 = fit-all; 1–6 = ZOOM_FIXED steps
  const [gridH, setGridH] = useState(700)
  const gridRef = useRef<HTMLDivElement>(null)
  const lastWheelStep = useRef(0)
  const scrollCorrectionRef = useRef<number | null>(null)
  const shiftingRef = useRef(false)
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const totalDays = view === 'week' ? 7 : 14
  const bufDays = (view === 'week' || view === '2wks') ? BUFFER_WEEKS * 7 : 0
  const totalRenderDays = totalDays + bufDays * 2
  const gridRenderStart = bufDays > 0 ? addDays(startDate, -bufDays) : startDate
  const days = Array.from({ length: totalRenderDays }, (_, i) => addDays(gridRenderStart, i))

  const load = useCallback(async () => {
    const buf = (view === 'week' || view === '2wks') ? BUFFER_WEEKS * 7 : 0
    const total = (view === 'week' ? 7 : 14) + buf * 2
    const renderStart = buf > 0 ? addDays(startDate, -buf) : startDate
    const end = addDays(renderStart, total - 1)
    const { data } = await supabase
      .from('bookings')
      .select('*')
      .lte('start_date', fmt(end))
      .gte('end_date', fmt(renderStart))
    setBookings(data ?? [])
  }, [startDate, view])

  useEffect(() => { load() }, [load])

  // Restore + persist collapse state (restore on mount only, persist on change)
  useEffect(() => {
    try { const s = localStorage.getItem('cal_collapsed_locs'); if (s) setCollapsed(new Set(JSON.parse(s))) } catch {}
    try { const s = localStorage.getItem('cal_collapsed_rooms'); if (s) setCollapsedRooms(new Set(JSON.parse(s))) } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem('cal_collapsed_locs', JSON.stringify(Array.from(collapsed))) } catch {}
  }, [collapsed])
  useEffect(() => {
    try { localStorage.setItem('cal_collapsed_rooms', JSON.stringify(Array.from(collapsedRooms))) } catch {}
  }, [collapsedRooms])

  // Measure grid container height for fit-all zoom
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setGridH(e.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Zoom: keyboard (+/-/0) and Cmd+trackpad scroll
  useEffect(() => {
    const MAX = ZOOM_FIXED.length
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoomLevel(z => Math.min(z + 1, MAX)) }
      if (e.key === '-') { e.preventDefault(); setZoomLevel(z => Math.max(z - 1, 0)) }
      if (e.key === '0') { e.preventDefault(); setZoomLevel(0) }
    }
    function onWheel(e: WheelEvent) {
      if (!e.metaKey) return
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheelStep.current < 200) return
      lastWheelStep.current = now
      if (e.deltaY > 0) setZoomLevel(z => Math.max(z - 1, 0))
      else if (e.deltaY < 0) setZoomLevel(z => Math.min(z + 1, MAX))
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  // Helper: scroll to center a given date (or today by default) in the grid
  function scrollToCenter(centerDate?: Date, smooth?: boolean) {
    const el = gridRef.current
    if (!el) return
    const buf = (view === 'week' || view === '2wks') ? BUFFER_WEEKS * 7 : 0
    if (buf === 0) return
    const d = centerDate ?? new Date()
    const renderStart = addDays(startDate, -buf)
    const colIndex = Math.max(0, dayDiff(renderStart, d))
    const targetX = Math.max(0, LABEL_W + colIndex * COL_W + COL_W / 2 - el.clientWidth / 2)
    if (smooth) el.scrollTo({ left: targetX, behavior: 'smooth' })
    else el.scrollLeft = targetX
  }

  // Center on today (or startDate) whenever startDate/view changes; apply seamless scroll correction
  useEffect(() => {
    shiftingRef.current = false
    const buf = (view === 'week' || view === '2wks') ? BUFFER_WEEKS * 7 : 0
    if (!gridRef.current || buf === 0) return
    if (scrollCorrectionRef.current !== null) {
      const target = scrollCorrectionRef.current
      scrollCorrectionRef.current = null
      gridRef.current.scrollLeft = target
    } else {
      requestAnimationFrame(() => {
        if (!gridRef.current) return
        const today = new Date()
        const isTodayWeek = fmt(startDate) === fmt(getMonday(today))
        scrollToCenter(isTodayWeek ? today : startDate)
      })
    }
  }, [startDate, view]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleGridScroll() {
    if (!gridRef.current) return
    const el = gridRef.current

    // Infinite extension: shift window when nearing edges
    if (bufDays > 0 && !shiftingRef.current) {
      const weekW = 7 * COL_W
      if (el.scrollLeft < weekW) {
        shiftingRef.current = true
        scrollCorrectionRef.current = el.scrollLeft + weekW
        setStartDate(d => addDays(d, -7))
        return
      } else if (el.scrollLeft > el.scrollWidth - el.clientWidth - weekW) {
        shiftingRef.current = true
        scrollCorrectionRef.current = el.scrollLeft - weekW
        setStartDate(d => addDays(d, 7))
        return
      }
    }

    // Post-scroll snap: snap quickly to today-centered only when near the current week
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
    snapTimerRef.current = setTimeout(() => {
      if (!gridRef.current || shiftingRef.current) return
      const buf = (view === 'week' || view === '2wks') ? BUFFER_WEEKS * 7 : 0
      const renderStart = addDays(startDate, -buf)
      const today = new Date()
      const todayCol = dayDiff(renderStart, today)
      const viewCenterCol = (el.scrollLeft + el.clientWidth / 2 - LABEL_W) / COL_W
      if (Math.abs(viewCenterCol - todayCol) <= 7) {
        scrollToCenter(today, true)
      }
    }, 80)
  }

  // Compute row height: fit-all (level 0) or fixed step
  const filteredLocations = locFilter === 'All' ? LOCATIONS : LOCATIONS.filter(l => l.name === locFilter)
  const DAY_HDR_H = 36
  const LOC_HDR_H = 29
  const COLLAPSED_ROOM_H = 22
  const expandedRoomCount = filteredLocations.reduce((s, l) => {
    if (collapsed.has(l.name)) return s
    return s + l.rooms.filter(r => !collapsedRooms.has(`${l.name}|${r}`)).length
  }, 0)
  const indivCollapsedCount = filteredLocations.reduce((s, l) => {
    if (collapsed.has(l.name)) return s
    return s + l.rooms.filter(r => collapsedRooms.has(`${l.name}|${r}`)).length
  }, 0)
  const fitRowH = Math.max(20, Math.floor(
    (gridH - DAY_HDR_H - filteredLocations.length * LOC_HDR_H - indivCollapsedCount * COLLAPSED_ROOM_H) / Math.max(1, expandedRoomCount)
  ))
  const rowH = zoomLevel === 0 ? fitRowH : ZOOM_FIXED[zoomLevel - 1]

  // Restore booking form draft on mount (e.g. user navigated away mid-create)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('cal_form_draft')
      if (!raw) return
      const d = JSON.parse(raw) as { editBooking: Booking | null; formData: FormData }
      setEditBooking(d.editBooking)
      setFormInitial(d.formData)
      setFormOpen(true)
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open booking form when navigated from Start Booking
  useEffect(() => {
    const clientId = searchParams.get('clientId')
    if (!searchParams.get('newBooking') || !clientId) return
    router.replace('/calendar')
    supabase.from('clients').select('id,type,name,fname,lname,email,phone,artists').eq('id', clientId).single()
      .then(({ data: c }) => {
        const initial = emptyForm()
        if (c) {
          const isBilling = c.type === 'label'
          initial.client_db_id = c.id
          initial.payment_type = isBilling ? 'billing' : 'COD'
          initial.client_name = isBilling
            ? `${c.fname || ''} ${c.lname || ''}`.trim()
            : c.name || `${c.fname || ''} ${c.lname || ''}`.trim()
          initial.label = isBilling ? (c.name || '') : ''
          initial.email = c.email || ''
          initial.phone = c.phone || ''
          initial.artist = (c.artists && c.artists.length > 0) ? c.artists[0] : ''
        }
        setEditBooking(null)
        setFormInitial(initial)
        setFormOpen(true)
      })
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  function openNew(location?: string, studio?: string, date?: string) {
    const initial = emptyForm({ location, studio, start_date: date, end_date: date })
    setEditBooking(null)
    setFormInitial(initial)
    setFormOpen(true)
    try { sessionStorage.setItem('cal_form_draft', JSON.stringify({ editBooking: null, formData: initial })) } catch {}
  }

  function openEdit(b: Booking) {
    const initial = bookingToForm(b)
    setEditBooking(b)
    setFormInitial(initial)
    setFormOpen(true)
    try { sessionStorage.setItem('cal_form_draft', JSON.stringify({ editBooking: b, formData: initial })) } catch {}
  }

  async function handleSave(data: FormData) {
    const payload = {
      status: data.status,
      session_type: data.session_type,
      payment_type: data.payment_type,
      cod_method: data.cod_method || null,
      location: data.location,
      studio: data.studio,
      start_date: data.start_date,
      end_date: data.end_date,
      from_time: data.from_time || null,
      to_time: data.to_time || null,
      rate: data.rate || null,
      rate_daily: data.rate_daily || null,
      invoice_num: data.invoice_num || null,
      client_id: data.client_db_id || null,
      client_name: data.client_name || null,
      artist: data.artist || null,
      label: data.label || null,
      ordered_by: data.ordered_by || null,
      phone: data.phone || null,
      email: data.email || null,
      po: data.po || null,
      producer: data.producer || null,
      food_budget: data.food_budget,
      food_amount: data.food_amount || null,
      engineer_name: data.engineer_name || null,
      engineer_status: data.engineer_status,
      assistant_name: data.assistant_name || null,
      assistant_status: data.assistant_status,
      notes: data.notes || null,
    }
    const throwIfError = (error: any) => {
      if (!error) return
      console.error('[CalendarPage] booking save error:', error)
      throw new Error([error.message, error.details].filter(Boolean).join(' — '))
    }
    if (editBooking) {
      const { error } = await supabase.from('bookings').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editBooking.id)
      throwIfError(error)
    } else {
      const { error } = await supabase.from('bookings').insert(payload)
      throwIfError(error)
    }
    try { sessionStorage.removeItem('cal_form_draft') } catch {}
    await load()
  }

  async function handleDelete() {
    if (editBooking) {
      await supabase.from('bookings').delete().eq('id', editBooking.id)
      try { sessionStorage.removeItem('cal_form_draft') } catch {}
      await load()
    }
  }

  function toggleCollapse(loc: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(loc) ? next.delete(loc) : next.add(loc)
      return next
    })
  }

  // ── 2-week / week grid ─────────────────────────────────────────────────────

  function renderGrid() {
    const DAYS = totalRenderDays
    return (
      <div ref={gridRef} onScroll={handleGridScroll} style={{ flex: 1, overflow: 'auto', minHeight: 0, border: '1px solid var(--border)', borderRadius: 6, WebkitOverflowScrolling: 'touch' }}>
        {/* Inner wrapper enforces min-width so columns never compress below COL_W */}
        <div style={{ minWidth: LABEL_W + DAYS * COL_W }}>
        {/* Day header row */}
        <div style={{
          display: 'flex', position: 'sticky', top: 0, zIndex: 10,
          background: 'var(--surface)', borderBottom: '2px solid var(--border)',
        }}>
          <div style={{ width: LABEL_W, flexShrink: 0, borderRight: '1px solid var(--border)', position: 'sticky', left: 0, zIndex: 11, background: 'var(--surface)' }} />
          {days.map((d, i) => {
            const todayFlag = isToday(d)
            const wknd = isWeekend(d)
            const isMonthStart = d.getDate() === 1
            const isWeekStart = d.getDay() === 1 && i > 0
            // inset box-shadow draws a left-edge stripe without affecting layout
            const shadow = isMonthStart
              ? 'inset 2px 0 0 var(--accent)'
              : isWeekStart ? 'inset 2px 0 0 rgba(255,255,255,0.35)' : 'none'
            return (
              <div key={fmt(d)} style={{
                flex: 1, minWidth: COL_W, textAlign: 'center', padding: '5px 2px',
                background: wknd ? 'rgba(255,255,255,0.015)' : 'transparent',
                borderRight: '1px solid var(--border)',
                boxShadow: shadow,
                position: 'relative',
              }}>
                {isMonthStart && (
                  <div style={{
                    position: 'absolute', top: 2, left: 5,
                    fontSize: 6, fontFamily: 'DM Mono', color: 'var(--accent)',
                    letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1,
                  }}>
                    {d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
                  </div>
                )}
                <div style={{
                  fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)',
                  letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: 1.2,
                }}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', margin: '2px auto 0',
                  background: todayFlag ? 'var(--accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontFamily: 'DM Mono', fontWeight: todayFlag ? 700 : 400,
                  color: todayFlag ? '#0d0f14' : wknd ? 'var(--text2)' : 'var(--text)',
                }}>
                  {d.getDate()}
                </div>
              </div>
            )
          })}
        </div>

        {/* Location sections */}
        {filteredLocations.map(loc => (
          <div key={loc.name}>
            {/* Location header — collapsible */}
            <div
              onClick={() => toggleCollapse(loc.name)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 10px', cursor: 'pointer',
                background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
                userSelect: 'none',
                position: 'sticky', left: 0, zIndex: 6,
              }}
            >
              <span style={{
                fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)',
                display: 'inline-block', transition: 'transform 0.15s',
                transform: collapsed.has(loc.name) ? 'rotate(-90deg)' : 'rotate(0deg)',
              }}>▼</span>
              <span style={{
                fontSize: 10, fontFamily: 'Syne', fontWeight: 700,
                color: 'var(--text2)', letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>{loc.name}</span>
              <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
                {loc.rooms.length} rooms
              </span>
            </div>

            {/* Room rows */}
            {!collapsed.has(loc.name) && loc.rooms.map(room => {
              const roomKey = `${loc.name}|${room}`
              const isRoomCollapsed = collapsedRooms.has(roomKey)
              const roomBookings = bookings.filter(b => b.location === loc.name && b.studio === room)
              const laneMap = assignLanes(roomBookings)
              return (
                <div key={room} style={{
                  display: 'flex', borderBottom: '1px solid var(--border)',
                  height: isRoomCollapsed ? COLLAPSED_ROOM_H : rowH,
                }}>
                  {/* Room label — click to collapse/expand */}
                  <div
                    onClick={() => setCollapsedRooms(prev => {
                      const next = new Set(prev)
                      next.has(roomKey) ? next.delete(roomKey) : next.add(roomKey)
                      return next
                    })}
                    style={{
                      width: LABEL_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                      padding: '0 12px', fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)',
                      borderRight: '1px solid var(--border)', cursor: 'pointer', userSelect: 'none',
                      whiteSpace: 'nowrap', overflow: 'hidden',
                      position: 'sticky', left: 0, zIndex: 5, background: 'var(--surface)',
                    }}
                  >
                    <span style={{
                      fontSize: 7, color: 'var(--text3)', flexShrink: 0,
                      display: 'inline-block', transition: 'transform 0.15s',
                      transform: isRoomCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    }}>▼</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{room}</span>
                  </div>

                  {/* Booking area — hidden when room is collapsed */}
                  {!isRoomCollapsed && (
                    <div style={{ flex: 1, position: 'relative' }}>
                      {/* Day cell backgrounds + dbl-click zones */}
                      {days.map((d, i) => {
                        const cellIsMonthStart = d.getDate() === 1
                        const cellIsWeekStart = d.getDay() === 1 && i > 0
                        return (
                          <div
                            key={i}
                            onDoubleClick={() => openNew(loc.name, room, fmt(d))}
                            style={{
                              position: 'absolute', top: 0, bottom: 0,
                              left: `${(i / DAYS) * 100}%`, width: `${(1 / DAYS) * 100}%`,
                              background: isWeekend(d) ? 'rgba(255,255,255,0.012)' : 'transparent',
                              borderRight: '1px solid var(--border)',
                              boxShadow: cellIsMonthStart
                                ? 'inset 2px 0 0 rgba(200,240,78,0.3)'
                                : cellIsWeekStart ? 'inset 2px 0 0 rgba(255,255,255,0.12)' : 'none',
                              cursor: 'crosshair',
                            }}
                          />
                        )
                      })}

                      {/* Booking blocks */}
                      {roomBookings.map(b => {
                        const { lane, numLanes } = laneMap.get(b.id) ?? { lane: 0, numLanes: 1 }
                        return (
                          <BookingBlock
                            key={b.id} booking={b}
                            gridStart={gridRenderStart} totalDays={DAYS}
                            lane={lane} numLanes={numLanes} rowH={rowH}
                            onClick={() => openEdit(b)}
                          />
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        </div>{/* end inner min-width wrapper */}
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px - 48px)', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12,
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        {/* Prev / Today / Next */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => setStartDate(d => addDays(d, -7))}
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text)', borderRadius: 4, padding: '4px 10px',
              fontSize: 14, lineHeight: 1, cursor: 'pointer',
            }}
          >‹</button>
          <button
            onClick={() => {
              const todayMonday = getMonday(new Date())
              if (fmt(startDate) === fmt(todayMonday)) {
                // Already on today's week — just re-center smoothly
                scrollToCenter(new Date(), true)
              } else {
                setStartDate(todayMonday)
              }
            }}
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text2)', borderRadius: 4, padding: '4px 10px',
              fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer',
            }}
          >Today</button>
          <button
            onClick={() => setStartDate(d => addDays(d, 7))}
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text)', borderRadius: 4, padding: '4px 10px',
              fontSize: 14, lineHeight: 1, cursor: 'pointer',
            }}
          >›</button>
        </div>

        {/* Range label */}
        <div style={{ flex: 1, fontSize: 14, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text)' }}>
          {rangeLabel(startDate, totalDays)}
        </div>

        {/* Location filter */}
        <select
          value={locFilter}
          onChange={e => setLocFilter(e.target.value)}
          style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--text2)', borderRadius: 4, padding: '4px 10px',
            fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', outline: 'none',
          }}
        >
          <option value="All">All Locations</option>
          {LOCATIONS.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
        </select>

        {/* View switcher */}
        <div style={{
          display: 'flex', background: 'var(--surface2)',
          borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden',
        }}>
          {(['day', 'studio', 'week', '2wks', 'month'] as ViewType[]).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '4px 12px', fontSize: 10, fontFamily: 'DM Mono',
              cursor: 'pointer', border: 'none',
              background: view === v ? 'var(--border)' : 'transparent',
              color: view === v ? 'var(--accent)' : 'var(--text2)',
              fontWeight: view === v ? 700 : 400,
            }}>
              {v === '2wks' ? '2 Wks' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        {/* Zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <button
            onClick={() => setZoomLevel(z => Math.max(z - 1, 0))}
            title="Zoom out (−)"
            style={{ padding: '4px 9px', fontSize: 14, lineHeight: 1, background: 'transparent', border: 'none', color: zoomLevel === 0 ? 'var(--text3)' : 'var(--text)', cursor: zoomLevel === 0 ? 'default' : 'pointer' }}
          >−</button>
          <span
            onClick={() => setZoomLevel(0)}
            title="Reset to fit all (0)"
            style={{ fontSize: 9, fontFamily: 'DM Mono', color: zoomLevel === 0 ? 'var(--accent)' : 'var(--text2)', minWidth: 26, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
          >{zoomLevel === 0 ? 'Fit' : `${rowH}px`}</span>
          <button
            onClick={() => setZoomLevel(z => Math.min(z + 1, ZOOM_FIXED.length))}
            title="Zoom in (+)"
            style={{ padding: '4px 9px', fontSize: 14, lineHeight: 1, background: 'transparent', border: 'none', color: zoomLevel === ZOOM_FIXED.length ? 'var(--text3)' : 'var(--text)', cursor: zoomLevel === ZOOM_FIXED.length ? 'default' : 'pointer' }}
          >+</button>
        </div>

        {/* New booking */}
        <button
          onClick={() => openNew()}
          style={{
            padding: '6px 16px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono',
            fontWeight: 700, cursor: 'pointer', background: '#1e40af', border: 'none', color: '#fff',
          }}
        >+ New Booking</button>
      </div>

      {/* Calendar content */}
      {(view === '2wks' || view === 'week') && renderGrid()}

      {(view === 'day' || view === 'studio') && (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text3)', fontFamily: 'DM Mono', fontSize: 12,
          border: '1px solid var(--border)', borderRadius: 6,
        }}>
          Studio / Day view — coming next
        </div>
      )}

      {view === 'month' && (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text3)', fontFamily: 'DM Mono', fontSize: 12,
          border: '1px solid var(--border)', borderRadius: 6,
        }}>
          Month view — coming next
        </div>
      )}

      {/* Booking form modal */}
      {formOpen && (
        <BookingForm
          bookingId={editBooking?.id}
          initial={formInitial}
          onSave={handleSave}
          onDelete={editBooking ? handleDelete : undefined}
          onClose={() => { try { sessionStorage.removeItem('cal_form_draft') } catch {} setFormOpen(false); setEditBooking(null) }}
          onDraftChange={(data) => {
            try { sessionStorage.setItem('cal_form_draft', JSON.stringify({ editBooking, formData: data })) } catch {}
          }}
        />
      )}
    </div>
  )
}
