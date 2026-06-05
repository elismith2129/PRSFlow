'use client'
import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Booking, Client, ClientContact, Engineer } from '@/lib/supabase'
import TimeInput from '@/components/shared/TimeInput'
import StudioSelect from '@/components/shared/StudioSelect'
import { ClientProfile } from '@/components/clients/ClientProfile'
import { WorkOrderPopup, type WOFormSync } from '@/components/calendar/WorkOrderPopup'
import { STUDIO_LOCATIONS, parseLocation } from '@/lib/studios'
import { addArtistToLabel } from '@/lib/roster'

// ─── LOCATIONS ───────────────────────────────────────────────────────────────

const LOCATIONS = STUDIO_LOCATIONS

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
const ZOOM_FIXED = [60, 80, 88, 110, 132] // zoom levels 1–5; level 0 = fit-all (≈44px)
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

function getSunday(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  r.setDate(r.getDate() - r.getDay())
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
  engineer_name: string; engineer_rate: string; engineer_status: string
  assistant_name: string; assistant_status: string
  notes: string
  client_db_id: string | null
  is_srs: boolean
  anr_contact_id: string | null
  anr_admin_contact_id: string | null
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

function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  const d = new Date(s)
  while (d <= e) { dates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1) }
  return dates
}

function bookingToForm(b: Booking): FormData {
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

function assignLanes(bookings: Booking[]): Map<string, { lane: number; numLanes: number }> {
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
  const result = new Map<string, { lane: number; numLanes: number }>()
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

  const slotH = rowH / numLanes
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
        borderLeft: sessionBorder ? '2px solid rgba(200,240,78,0.7)' : '1px solid rgba(255,255,255,0.08)',
        borderRight: sessionBorder ? '2px solid rgba(200,240,78,0.7)' : '1px solid rgba(255,255,255,0.08)',
        borderBottom: sessionBorder ? '2px solid rgba(200,240,78,0.7)' : '1px solid rgba(255,255,255,0.08)',
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
            <div style={{ fontSize: 7, fontFamily: 'DM Mono', color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', flexShrink: 0 }}>
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
            <div style={{ fontSize: 8, fontFamily: 'DM Mono', color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
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
            <div style={{ fontSize: 9, fontFamily: 'DM Mono', lineHeight: 1.2, marginTop: 2, color: 'rgba(255,255,255,0.85)' }}>
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

function BookingForm({
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

// ─── DAY VIEW ────────────────────────────────────────────────────────────────

const DAY_STATUS_BG: Record<string, string> = {
  confirmed:  '#1e40af',
  tentative:  '#c2410c',
  cancelled:  '#b91c1c',
  tour:       '#6d28d9',
  tech:       '#374151',
  open_hours: '#111827',
}

function DayView({
  dayViewDate,
  setDayViewDate,
  locFilter,
  onOpenEdit,
}: {
  dayViewDate: Date
  setDayViewDate: (d: Date) => void
  locFilter: string
  onOpenEdit: (b: Booking) => void
}) {
  const [dayBookings, setDayBookings] = useState<Booking[]>([])
  const [miniMonthStart, setMiniMonthStart] = useState(
    () => new Date(dayViewDate.getFullYear(), dayViewDate.getMonth(), 1)
  )

  const dateStr = fmt(dayViewDate)
  const todayStr = fmt(new Date())

  useEffect(() => {
    supabase.from('bookings').select('*')
      .lte('start_date', dateStr)
      .gte('end_date', dateStr)
      .then(({ data }) => setDayBookings(data ?? []))
  }, [dateStr])

  // Sync mini calendar month when day nav crosses a month boundary
  const monthKey = `${dayViewDate.getFullYear()}-${dayViewDate.getMonth()}`
  useEffect(() => {
    setMiniMonthStart(new Date(dayViewDate.getFullYear(), dayViewDate.getMonth(), 1))
  }, [monthKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build mini calendar grid
  const miniCells: (Date | null)[] = []
  const firstWeekday = miniMonthStart.getDay()
  const daysInMonth = new Date(miniMonthStart.getFullYear(), miniMonthStart.getMonth() + 1, 0).getDate()
  for (let i = 0; i < firstWeekday; i++) miniCells.push(null)
  for (let d = 1; d <= daysInMonth; d++)
    miniCells.push(new Date(miniMonthStart.getFullYear(), miniMonthStart.getMonth(), d))

  const filteredLocs = locFilter === 'All' ? LOCATIONS : LOCATIONS.filter(l => l.name === locFilter)
  const allStudios = filteredLocs.flatMap(loc => loc.rooms.map(room => ({ loc: loc.name, room })))

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

      {/* ── LEFT: mini month calendar ──────────────────────────────────── */}
      <div style={{
        width: 216, flexShrink: 0, overflowY: 'auto',
        background: 'var(--surface)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        padding: '16px 14px',
      }}>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button
            onClick={() => setMiniMonthStart(new Date(miniMonthStart.getFullYear(), miniMonthStart.getMonth() - 1, 1))}
            style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
          >‹</button>
          <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 12, color: 'var(--text)', letterSpacing: '0.04em' }}>
            {miniMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button
            onClick={() => setMiniMonthStart(new Date(miniMonthStart.getFullYear(), miniMonthStart.getMonth() + 1, 1))}
            style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
          >›</button>
        </div>

        {/* Weekday labels */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
          {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 9, fontFamily: 'DM Mono', color: 'var(--text3)', padding: '2px 0' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px 0' }}>
          {miniCells.map((cell, i) => {
            if (!cell) return <div key={`e-${i}`} />
            const cellStr = fmt(cell)
            const isSelected = cellStr === dateStr
            const isTodayCell = cellStr === todayStr
            return (
              <div key={cellStr} onClick={() => setDayViewDate(cell)}
                style={{ textAlign: 'center', cursor: 'pointer', padding: '2px 0' }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', margin: '0 auto',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontFamily: 'DM Mono',
                  background: isSelected ? '#c8f04e' : isTodayCell ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: isSelected ? '#0d0f14' : 'var(--text2)',
                  fontWeight: isSelected || isTodayCell ? 700 : 400,
                  outline: isTodayCell && !isSelected ? '1px solid rgba(255,255,255,0.2)' : 'none',
                }}>
                  {cell.getDate()}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── RIGHT: date header + studio cards ─────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
            {dayViewDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => setDayViewDate(addDays(dayViewDate, -1))}
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>‹</button>
            <button onClick={() => setDayViewDate(new Date())}
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer' }}>Today</button>
            <button onClick={() => setDayViewDate(addDays(dayViewDate, 1))}
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>›</button>
          </div>
        </div>

        {/* Studio cards grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {allStudios.map(({ loc, room }) => {
              const cards = dayBookings
                .filter(b => b.location === loc && b.studio === room)
                .sort((a, b) => timeToMins(a.from_time) - timeToMins(b.from_time))
              return (
                <div key={`${loc}|${room}`} style={{
                  background: 'var(--surface)', borderRadius: 6, overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}>
                  {/* Card header */}
                  <div style={{ padding: '6px 10px', background: 'var(--surface2)', borderBottom: cards.length > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                    <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 11, color: '#c8f04e', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {loc} {room}
                    </span>
                  </div>

                  {/* Booking blocks */}
                  {cards.map(b => {
                    const isBilling = b.payment_type === 'billing'
                    const nameColor = isBilling ? '#96A9FF' : '#7BBFFF'
                    const displayName = isBilling
                      ? (b.artist && b.label ? `${b.label} / ${b.artist}` : b.artist || b.label || b.client_name || '')
                      : (b.client_name || '')
                    const timeStr = b.from_time && b.to_time
                      ? `${fmtTime(b.from_time)}–${fmtTime(b.to_time)}`
                      : b.from_time ? fmtTime(b.from_time) : ''
                    const eng = b.engineer_name ? `1ST-${initials(b.engineer_name)}` : ''
                    const asst = b.assistant_name ? `2ND-${initials(b.assistant_name)}` : ''
                    const codLabel = !isBilling && b.cod_method ? `COD ${b.cod_method.toUpperCase()}` : null
                    const hasSessionBorder = b.session_type !== 'recording'

                    return (
                      <div key={b.id} onClick={() => onOpenEdit(b)} style={{
                        padding: '7px 10px', cursor: 'pointer',
                        background: '#0d0f14',
                        borderTop: `3px solid ${STATUS_TOP_COLORS[b.status] ?? STATUS_TOP_COLORS.confirmed}`,
                        borderLeft: hasSessionBorder ? '3px solid rgba(200,240,78,0.7)' : '1px solid rgba(255,255,255,0.08)',
                        borderRight: '1px solid rgba(255,255,255,0.08)',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                      }}>
                        {/* Name */}
                        <div style={{ fontFamily: 'DM Mono', fontSize: 11, fontWeight: 700, color: nameColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {displayName}
                        </div>
                        {/* Time */}
                        {timeStr && (
                          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                            {timeStr}
                          </div>
                        )}
                        {/* COD method */}
                        {codLabel && (
                          <div style={{ fontFamily: 'DM Mono', fontSize: 9, fontWeight: 700, color: '#f87171', marginTop: 2 }}>
                            {codLabel}
                          </div>
                        )}
                        {/* Notes */}
                        {b.notes && (
                          <div style={{ fontFamily: 'DM Mono', fontSize: 9, color: 'rgba(255,255,255,0.7)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {b.notes.toUpperCase()}
                          </div>
                        )}
                        {/* Invoice + engineer */}
                        {(b.invoice_num || eng || asst) && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                            <span style={{ fontFamily: 'DM Mono', fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
                              {b.invoice_num ? `#${b.invoice_num}` : ''}
                            </span>
                            <span style={{ fontFamily: 'DM Mono', fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
                              {[eng, asst].filter(Boolean).join(' ')}
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── STUDIO VIEW ─────────────────────────────────────────────────────────────

function StudioView({
  locFilter,
  onOpenEdit,
  onOpenNew,
}: {
  locFilter: string
  onOpenEdit: (b: Booking) => void
  onOpenNew: (location?: string, studio?: string, date?: string) => void
}) {
  const [loc, room] = locFilter.includes('|') ? locFilter.split('|') : ['', '']
  const [monthStart, setMonthStart] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [studioBookings, setStudioBookings] = useState<Booking[]>([])

  const year = monthStart.getFullYear()
  const month = monthStart.getMonth()

  useEffect(() => {
    if (!loc || !room) return
    const start = fmt(new Date(year, month, 1))
    const end = fmt(new Date(year, month + 1, 0))
    supabase.from('bookings').select('*')
      .eq('location', loc)
      .eq('studio', room)
      .lte('start_date', end)
      .gte('end_date', start)
      .then(({ data }) => setStudioBookings(data ?? []))
  }, [year, month, loc, room])

  // Build month grid cells
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  const numWeeks = cells.length / 7
  const todayStr = fmt(new Date())

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
          <span style={{ color: '#c8f04e', textTransform: 'uppercase' }}>{loc} {room}</span>
          <span style={{ color: 'var(--text3)', margin: '0 8px' }}>—</span>
          {monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => setMonthStart(new Date(year, month - 1, 1))}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
          >‹</button>
          <button
            onClick={() => { const t = new Date(); setMonthStart(new Date(t.getFullYear(), t.getMonth(), 1)) }}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer' }}
          >Today</button>
          <button
            onClick={() => setMonthStart(new Date(year, month + 1, 1))}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
          >›</button>
        </div>
      </div>

      {/* Weekday labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{
            textAlign: 'center', padding: '5px 0',
            fontFamily: 'DM Mono', fontSize: 10, color: 'var(--text3)',
            letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>{d}</div>
        ))}
      </div>

      {/* Month grid */}
      <div style={{
        flex: 1, display: 'grid',
        gridTemplateRows: `repeat(${numWeeks}, minmax(80px, auto))`,
        gridTemplateColumns: 'repeat(7, 1fr)',
        overflow: 'auto',
        alignContent: 'start',
      }}>
        {cells.map((cell, i) => {
          if (!cell) return (
            <div key={`empty-${i}`} style={{
              borderRight: i % 7 < 6 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              background: 'rgba(0,0,0,0.15)',
              minHeight: 80,
            }} />
          )
          const cellStr = fmt(cell)
          const isTodayCell = cellStr === todayStr
          const cellBookings = studioBookings
            .filter(b => b.start_date <= cellStr && b.end_date >= cellStr)
            .sort((a, b) => timeToMins(a.from_time) - timeToMins(b.from_time))
          return (
            <div
              key={cellStr}
              onDoubleClick={() => onOpenNew(loc, room, cellStr)}
              style={{
                borderRight: i % 7 < 6 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                padding: '4px 5px',
                background: isTodayCell ? 'rgba(200,240,78,0.04)' : 'transparent',
              }}
            >
              {/* Date number */}
              <div style={{
                width: 22, height: 22, borderRadius: '50%', marginBottom: 2,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isTodayCell ? '#c8f04e' : 'transparent',
                color: isTodayCell ? '#0d0f14' : 'var(--text3)',
                fontSize: 11, fontFamily: 'DM Mono', fontWeight: isTodayCell ? 700 : 400,
              }}>
                {cell.getDate()}
              </div>
              {/* Booking blocks */}
              {cellBookings.map(b => {
                const isBilling = b.payment_type === 'billing'
                const nameColor = isBilling ? '#96A9FF' : '#7BBFFF'
                const displayName = isBilling
                  ? (b.artist && b.label ? `${b.label} / ${b.artist}` : b.artist || b.label || b.client_name || '')
                  : (b.client_name || '')
                const timeStr = b.from_time && b.to_time
                  ? `${fmtTime(b.from_time)}–${fmtTime(b.to_time)}`
                  : b.from_time ? fmtTime(b.from_time) : ''
                const codLabel = !isBilling && b.cod_method
                  ? (b.cod_method === 'Credit Card' ? 'CC' : b.cod_method.toUpperCase())
                  : null
                const eng = b.engineer_name ? `1ST-${initials(b.engineer_name)}` : ''
                const asst = b.assistant_name ? `2ND-${initials(b.assistant_name)}` : ''
                const engColor = b.engineer_status === 'confirmed' ? '#4ef0a2'
                  : b.engineer_status === 'hold' ? '#f0a24e' : 'rgba(255,255,255,0.4)'
                const asstColor = b.assistant_status === 'confirmed' ? '#4ef0a2'
                  : b.assistant_status === 'hold' ? '#f0a24e' : 'rgba(255,255,255,0.4)'
                return (
                  <div
                    key={b.id}
                    onClick={e => { e.stopPropagation(); onOpenEdit(b) }}
                    style={{
                      marginBottom: 3, padding: '5px 7px', borderRadius: 3,
                      background: '#0d0f14',
                      cursor: 'pointer',
                      borderTop: `3px solid ${STATUS_TOP_COLORS[b.status] ?? STATUS_TOP_COLORS.confirmed}`,
                      borderLeft: b.session_type !== 'recording' ? '2px solid rgba(200,240,78,0.7)' : '1px solid rgba(255,255,255,0.08)',
                      borderRight: '1px solid rgba(255,255,255,0.08)',
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {/* Name */}
                    <div style={{ fontFamily: 'DM Mono', fontSize: 11, fontWeight: 700, color: nameColor, wordBreak: 'break-word' }}>
                      {displayName}
                    </div>
                    {/* Time */}
                    {timeStr && (
                      <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                        {timeStr}
                      </div>
                    )}
                    {/* COD method + engineer/assistant row */}
                    {(codLabel || eng || asst) && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                        <span style={{ fontFamily: 'DM Mono', fontSize: 9, fontWeight: 700, color: '#f87171' }}>
                          {codLabel ?? ''}
                        </span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {eng  && <span style={{ fontFamily: 'DM Mono', fontSize: 9, color: engColor }}>{eng}</span>}
                          {asst && <span style={{ fontFamily: 'DM Mono', fontSize: 9, color: asstColor }}>{asst}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
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
  const [startDate, setStartDate] = useState(() => getSunday(new Date()))
  const [bookings, setBookings] = useState<Booking[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editBooking, setEditBooking] = useState<Booking | null>(null)
  const [formInitial, setFormInitial] = useState<FormData>(() => emptyForm())
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(() => new Set())
  const [locFilter, setLocFilter] = useState('All')
  const [dayViewDate, setDayViewDate] = useState<Date>(() => new Date())
  const [zoomLevel, setZoomLevel] = useState(0) // 0 = fit-all; 1–6 = ZOOM_FIXED steps
  const [gridH, setGridH] = useState(700)
  const [gridW, setGridW] = useState(1200)
  const gridRef = useRef<HTMLDivElement>(null)
  const lastWheelStep = useRef(0)
  const scrollCorrectionRef = useRef<number | null>(null)
  const shiftingRef = useRef(false)


  const totalDays = view === 'month'
    ? new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate()
    : view === 'week' ? 7 : 14
  const bufDays = BUFFER_WEEKS * 7  // same buffer for all grid views
  const totalRenderDays = totalDays + bufDays * 2
  const gridRenderStart = addDays(startDate, -bufDays)
  const days = Array.from({ length: totalRenderDays }, (_, i) => addDays(gridRenderStart, i))

  // Column width fills the viewport for the canonical window; month uses a smaller fixed size
  const usableW = Math.max(gridW - LABEL_W, 400)
  const colW = view === 'week'
    ? Math.max(80, Math.floor(usableW / 7))
    : view === '2wks'
    ? Math.max(60, Math.floor(usableW / 14))
    : Math.max(44, Math.floor(usableW / totalDays))

  const load = useCallback(async () => {
    const buf = BUFFER_WEEKS * 7
    const total = totalDays + buf * 2
    const renderStart = addDays(startDate, -buf)
    const end = addDays(renderStart, total - 1)
    const { data } = await supabase
      .from('bookings')
      .select('*')
      .lte('start_date', fmt(end))
      .gte('end_date', fmt(renderStart))
    setBookings(data ?? [])
  }, [startDate, view])

  useEffect(() => { load() }, [load])

  // Keep loadRef current so the subscription callback always calls the latest load
  // (load changes identity when startDate/view changes from navigation)
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])

  // Subscribe to bookings — re-render calendar blocks on any insert/update/delete
  useEffect(() => {
    const channel = supabase
      .channel('calendar-bookings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        loadRef.current()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Restore collapse state on mount (client only — must be useEffect to avoid SSR hydration mismatch)
  useEffect(() => {
    try { const s = localStorage.getItem('cal_collapsed_locs'); if (s) setCollapsed(new Set(JSON.parse(s))) } catch {}
    try { const s = localStorage.getItem('cal_collapsed_rooms'); if (s) setCollapsedRooms(new Set(JSON.parse(s))) } catch {}
  }, [])

  // Persist collapse state — skip the very first render so the restore above isn't immediately overwritten
  const skipFirstCollapsed = useRef(true)
  const skipFirstRooms = useRef(true)
  useEffect(() => {
    if (skipFirstCollapsed.current) { skipFirstCollapsed.current = false; return }
    try { localStorage.setItem('cal_collapsed_locs', JSON.stringify(Array.from(collapsed))) } catch {}
  }, [collapsed])
  useEffect(() => {
    if (skipFirstRooms.current) { skipFirstRooms.current = false; return }
    try { localStorage.setItem('cal_collapsed_rooms', JSON.stringify(Array.from(collapsedRooms))) } catch {}
  }, [collapsedRooms])

  // Synchronous initial measurement — fires before useEffect so colW is correct when scroll effect runs
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const { height, width } = el.getBoundingClientRect()
    if (height > 0) setGridH(height)
    if (width > 0) setGridW(width)
  }, [])

  // Ongoing resize tracking
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    let pendingRaf = 0
    const ro = new ResizeObserver(([e]) => {
      cancelAnimationFrame(pendingRaf)
      const { height, width } = e.contentRect
      pendingRaf = requestAnimationFrame(() => {
        if (height > 0) setGridH(height)
        if (width > 0) setGridW(width)
      })
    })
    ro.observe(el)
    return () => { ro.disconnect(); cancelAnimationFrame(pendingRaf) }
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

  // Scroll to put startDate (Sunday) at the left edge whenever startDate/view changes
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    if (scrollCorrectionRef.current !== null) {
      // Infinite-scroll correction: consume stored target, don't block handler
      shiftingRef.current = false
      const target = scrollCorrectionRef.current
      scrollCorrectionRef.current = null
      el.scrollLeft = target
    } else {
      // View/date switch: block scroll handler until rAF sets the correct position,
      // preventing transitional scroll events (from content-width change) from
      // triggering infinite scroll with a stale scrollLeft value.
      shiftingRef.current = true
      const target = bufDays * colW
      requestAnimationFrame(() => {
        if (el) el.scrollLeft = target
        shiftingRef.current = false
      })
    }
  }, [startDate, view]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleGridScroll() {
    if (!gridRef.current) return
    const el = gridRef.current

    // Infinite extension: shift window when nearing edges
    if (bufDays > 0 && !shiftingRef.current) {
      const weekW = 7 * colW
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
  }

  // Compute row height: fit-all (level 0) or fixed step
  const filteredLocations = locFilter === 'All'
    ? LOCATIONS
    : locFilter.includes('|')
      ? LOCATIONS.filter(l => l.name === locFilter.split('|')[0])
      : LOCATIONS.filter(l => l.name === locFilter)
  const DAY_HDR_H = 30
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
    const leadId = searchParams.get('leadId')
    if (!searchParams.get('newBooking') || !clientId) return
    router.replace('/calendar')
    const clientQ = supabase.from('clients').select('id,type,name,fname,lname,email,phone,artists').eq('id', clientId).single()
    const leadQ = leadId
      ? supabase.from('leads').select('quote,rate_daily,location,session_date,session_start,session_end,fname,lname,artist_name,email,phone,notes').eq('id', parseInt(leadId, 10)).single()
      : Promise.resolve({ data: null as any, error: null })
    Promise.all([clientQ, leadQ]).then(([{ data: c }, { data: l }]) => {
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
        if (!isBilling) initial.artist = (c.artists && c.artists.length > 0) ? c.artists[0] : ''
      }
      if (l) {
        if (l.session_date) { initial.start_date = l.session_date; initial.end_date = l.session_date }
        if (l.session_start) initial.from_time = l.session_start
        if (l.session_end) initial.to_time = l.session_end
        if (l.rate_daily) { initial.rate_daily = l.rate_daily; initial.rate_type = 'daily' }
        else if (l.quote) { initial.rate = l.quote; initial.rate_type = 'hourly' }
        if (l.location) {
          const loc = parseLocation(l.location)
          initial.location = loc.venue
          initial.studio = loc.studio
        }
        // A&R name + contact info stored on the lead for billing leads
        const anrName = `${l.fname || ''} ${l.lname || ''}`.trim()
        if (anrName && initial.payment_type === 'billing') {
          initial.ordered_by = anrName
          initial.client_name = anrName
        }
        if (l.email && initial.payment_type === 'billing') initial.email = l.email
        if (l.phone && initial.payment_type === 'billing') initial.phone = l.phone
        // Use the specific artist from the lead rather than the roster's first entry
        if (l.artist_name) initial.artist = l.artist_name
        if (l.notes) initial.notes = l.notes
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
      rate_type: data.rate_type === 'daily' ? 'day' : 'hour',
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
      engineer_rate: data.engineer_rate || null,
      engineer_status: data.engineer_status,
      assistant_name: data.assistant_name || null,
      assistant_status: data.assistant_status,
      notes: data.notes || null,
      is_srs: data.is_srs,
      // TODO: calculate srs_fee_amount from studio_time table once WO digitization is complete
      srs_fee_amount: data.is_srs ? null : null,
      anr_contact_id: data.anr_contact_id || null,
      anr_admin_contact_id: data.anr_admin_contact_id || null,
    }
    const throwIfError = (error: any) => {
      if (!error) return
      console.error('[CalendarPage] booking save error:', error)
      throw new Error([error.message, error.details].filter(Boolean).join(' — '))
    }
    if (editBooking) {
      const { error } = await supabase.from('bookings').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editBooking.id)
      throwIfError(error)
      // Create srs_log entry if this booking is newly flagged as SRS (wasn't before)
      if (data.is_srs && !editBooking.is_srs) {
        await supabase.from('srs_log').insert({ booking_id: editBooking.id, paid: false })
      }
      // Remove srs_log entry if SRS was toggled off
      if (!data.is_srs && editBooking.is_srs) {
        await supabase.from('srs_log').delete().eq('booking_id', editBooking.id)
      }
      // Sync studio_time_rows when booking is saved (date range and rate)
      {
        const { data: woRows } = await supabase.from('work_orders').select('id')
          .eq('booking_id', editBooking.id).order('created_at', { ascending: false }).limit(1)
        const woId = woRows?.[0]?.id
        if (woId) {
          // Day-rate only: sync date range (add/remove rows)
          if (payload.rate_type === 'day') {
            const newDates = dateRange(data.start_date, data.end_date)
            const { data: existingStRows } = await supabase.from('studio_time_rows')
              .select('id, date, created_at').eq('work_order_id', woId).order('created_at', { ascending: true })

            // Dedup: keep earliest row per date
            const keepByDate: Record<string, string> = {}
            const dupeIds: string[] = []
            for (const r of existingStRows ?? []) {
              if (keepByDate[r.date]) dupeIds.push(r.id)
              else keepByDate[r.date] = r.id
            }
            if (dupeIds.length > 0) await supabase.from('studio_time_rows').delete().in('id', dupeIds)

            const newDateSet = new Set(newDates)
            const coveredDates = new Set(Object.keys(keepByDate))

            // Delete rows for dates no longer in the booking range
            const toRemove = Array.from(coveredDates).filter(d => !newDateSet.has(d)).map(d => keepByDate[d]).filter(Boolean)
            if (toRemove.length > 0) await supabase.from('studio_time_rows').delete().in('id', toRemove)

            // Insert rows for new dates
            const missingDates = newDates.filter(d => !coveredDates.has(d))
            if (missingDates.length > 0) {
              const dayRateNum = parseFloat((payload.rate_daily ?? '').replace(/[^0-9.]/g, ''))
              const studio = payload.studio?.match(/Studio\s+([A-Z])/i)?.[1]?.toUpperCase() ?? payload.studio ?? ''
              await supabase.from('studio_time_rows').upsert(missingDates.map((d, i) => ({
                work_order_id: woId,
                studio,
                date: d, session_info: '',
                from_time: payload.from_time ?? '', to_time: payload.to_time ?? '',
                total_hours: null,
                rate: payload.rate_daily ?? '',
                charge: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum : null,
                day_count: 1,
                ot_rate: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum / 10 : null,
                ot_hours: 0, ot_charge: null,
                sort_order: coveredDates.size + i,
              })), { onConflict: 'work_order_id,date', ignoreDuplicates: true })
            }
          }

        }
      }
    } else {
      const { data: inserted, error } = await supabase.from('bookings').insert(payload).select('id').single()
      throwIfError(error)
      if (data.is_srs && inserted) {
        await supabase.from('srs_log').insert({ booking_id: inserted.id, paid: false })
      }
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
        <div style={{ minWidth: LABEL_W + DAYS * colW }}>
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
                flex: 1, minWidth: colW, textAlign: 'center', padding: '2px 2px',
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
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
              {/* Sticky label cell — always visible in the left column */}
              <div
                onClick={() => toggleCollapse(loc.name)}
                style={{
                  width: LABEL_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px', cursor: 'pointer', userSelect: 'none',
                  background: 'var(--surface2)',
                  position: 'sticky', left: 0, zIndex: 6,
                }}
              >
                <span style={{
                  fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)',
                  display: 'inline-block', transition: 'transform 0.15s', flexShrink: 0,
                  transform: collapsed.has(loc.name) ? 'rotate(-90deg)' : 'rotate(0deg)',
                }}>▼</span>
                <span style={{
                  fontSize: 10, fontFamily: 'Syne', fontWeight: 700,
                  color: 'var(--text2)', letterSpacing: '0.06em', textTransform: 'uppercase',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{loc.name}</span>
              </div>
              {/* Separator band fills the rest of the row */}
              <div onClick={() => toggleCollapse(loc.name)} style={{ flex: 1, cursor: 'pointer' }} />
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
            onClick={() => {
              if (view === 'month') setStartDate(d => addDays(d, -totalDays))
              else setStartDate(d => addDays(d, -7))
            }}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
          >‹</button>
          <button
            onClick={() => {
              const t = new Date()
              if (view === 'day') {
                setDayViewDate(t)
              } else {
                const thisSunday = getSunday(t)
                if (fmt(startDate) === fmt(thisSunday)) {
                  // Already on this week — force scroll reset
                  const el = gridRef.current
                  if (el) el.scrollLeft = bufDays * colW
                } else {
                  setStartDate(thisSunday)
                }
              }
            }}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer' }}
          >Today</button>
          <button
            onClick={() => {
              if (view === 'month') setStartDate(d => addDays(d, totalDays))
              else setStartDate(d => addDays(d, 7))
            }}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 10px', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
          >›</button>
        </div>

        {/* Range label */}
        <div style={{ flex: 1, fontSize: 14, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text)' }}>
          {rangeLabel(startDate, totalDays)}
        </div>

        {/* "All" pill — only shown when a specific studio is selected */}
        {locFilter.includes('|') && (
          <button
            onClick={() => { setLocFilter('All'); setView('2wks') }}
            style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 10, fontFamily: 'DM Mono',
              fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)',
              background: 'var(--surface2)', color: 'var(--text2)',
              letterSpacing: '0.04em',
            }}
          >All</button>
        )}

        {/* Location filter */}
        <select
          value={locFilter}
          onChange={e => {
            const val = e.target.value
            setLocFilter(val)
            if (val.includes('|')) setView('studio')
            else if (view === 'studio') setView('day')
          }}
          style={{
            background: locFilter.includes('|') ? 'rgba(200,240,78,0.08)' : 'var(--surface2)',
            border: locFilter.includes('|') ? '1px solid rgba(200,240,78,0.4)' : '1px solid var(--border)',
            color: locFilter.includes('|') ? 'var(--accent)' : 'var(--text2)',
            borderRadius: 4, padding: '4px 10px',
            fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', outline: 'none',
          }}
        >
          <option value="All">All Locations</option>
          {LOCATIONS.map(l => (
            <optgroup key={l.name} label={l.name}>
              <option value={l.name}>All {l.name}</option>
              {l.rooms.map(room => (
                <option key={room} value={`${l.name}|${room}`}>{room}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* View switcher */}
        <div style={{
          display: 'flex', background: 'var(--surface2)',
          borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden',
        }}>
          {(['day', 'week', '2wks', 'month'] as ViewType[]).map(v => (
            <button key={v} onClick={() => {
              const today = new Date()
              const thisSunday = getSunday(today)
              if (v === 'day') setDayViewDate(today)
              const alreadyHere = view === v && fmt(startDate) === fmt(thisSunday)
              setStartDate(thisSunday)
              setView(v)
              // If state won't change, force scroll directly (React won't re-run the effect)
              if (alreadyHere) {
                const el = gridRef.current
                if (el) el.scrollLeft = bufDays * colW
              }
            }} style={{
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
      {(view === '2wks' || view === 'week' || view === 'month') && renderGrid()}

      {view === 'day' && (
        <DayView
          dayViewDate={dayViewDate}
          setDayViewDate={setDayViewDate}
          locFilter={locFilter}
          onOpenEdit={openEdit}
        />
      )}

      {view === 'studio' && (
        <StudioView
          locFilter={locFilter}
          onOpenEdit={openEdit}
          onOpenNew={openNew}
        />
      )}

      {/* Booking form modal */}
      {formOpen && (
        <BookingForm
          bookingId={editBooking?.id}
          booking={editBooking ?? undefined}
          initial={formInitial}
          onSave={handleSave}
          onDelete={editBooking ? handleDelete : undefined}
          onClose={() => { try { sessionStorage.removeItem('cal_form_draft') } catch {} setFormOpen(false); setEditBooking(null) }}
          onDraftChange={(data) => {
            try { sessionStorage.setItem('cal_form_draft', JSON.stringify({ editBooking, formData: data })) } catch {}
          }}
          onSaved={undefined}
        />
      )}
    </div>
  )
}
