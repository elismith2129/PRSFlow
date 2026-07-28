'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { createWorkOrderForBooking, bookingShouldHaveWorkOrder } from '@/lib/createWorkOrder'
import TimeInput from '@/components/shared/TimeInput'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useUserProfile } from '@/hooks/useUserProfile'
import { SignedImage } from '@/components/shared/SignedImage'
import { ClientPanel, type ClientPanelValue } from '@/components/shared/ClientPanel'
import { seedStudioTimeRows } from '@/lib/seedStudioTimeRows'
import { timeToMins, calcHours, calcCharge, dateRange, isNextDay, toStudioLetter } from '@/lib/time'
import { formatCurrency, stripCurrency } from '@/lib/format'
import { dbResult } from '@/lib/db'
import { STUDIO_LOCATIONS } from '@/lib/studios'

// Convert a studio_time_rows studio value (bare letter 'X', or 'North'/'South')
// into the full room label the calendar filters on ('Studio X', 'North'), within
// a given venue. Falls back to the raw value if no match. (The table stores bare
// letters; the calendar grid matches full room labels — see docs/WO-SPEC.md §4.)
function roomLabelForVenue(venue: string, rawStudio: string): string {
  const raw = (rawStudio ?? '').trim()
  if (!raw) return raw
  const loc = STUDIO_LOCATIONS.find(l => l.name === venue)
  if (!loc) return raw
  if (loc.rooms.includes(raw)) return raw
  const full = `Studio ${raw}`
  if (loc.rooms.includes(full)) return full
  return raw
}

const STUDIO_SHORT: Record<string, string> = {
  Paramount: 'PRS', Ameraycan: 'ARS', Encore: 'ERS', Track: 'TRK',
}

// Session status bar (calendar status) + session type — session-level, shown in
// the WO top. Order/labels mirror the old booking form.
const SESSION_STATUSES: [string, string][] = [
  ['confirmed', 'Confirmed'], ['tentative', 'Tentative'], ['cancelled', 'Cancelled'],
  ['tour', 'Tour'], ['tech', 'Tech'], ['open_hours', 'Open Hours'],
]
// Mirror the booking-form status colors (STATUS_TOP_COLORS). Active pill fills
// with its status color; inactive stays neutral.
const SESSION_STATUS_COLORS: Record<string, string> = {
  confirmed: 'var(--booked)', tentative: 'var(--warm)', cancelled: 'var(--hot)',
  tour: '#a855f7', tech: 'var(--cold)', open_hours: '#e2e8f0',
}
const SESSION_TYPES: [string, string][] = [
  ['recording', 'Recording'], ['filming', 'Filming'], ['event_playback', 'Event / Playback'],
]

// Studio accent colors — mirror the Runner Hub WO header (STUDIO_META) so the
// mobile WO popup matches it. Keyed by venue name (booking.location).
const STUDIO_COLORS: Record<string, string> = {
  paramount: 'var(--accent)',
  ameraycan: 'var(--hot)',
  encore: 'var(--accent2)',
  track: 'var(--warm)',
}

// ─── Local types (editable UI state, strings for all inputs) ─────────────────

type WO = {
  id: string
  wo_number: string
  invoice_number: string
  session_date: string
  studios: string[]
  from_time: string
  to_time: string
  engineer: string
  second_engineer: string
  producer: string
  payment_status: string
  food_budget: boolean
  food_amount: string
  client: string
  artist: string
  label: string
  ordered_by: string
  po_number: string
  phone: string
  email: string
  status: string
  // Session-level fields now owned by the WO (see migration
  // 20260721130000_work_orders_session_fields). session_status is the calendar
  // status bar (Confirmed/Tentative/…); status above is the WO lifecycle
  // (open/completed).
  session_status: string
  session_type: string
  client_id: string | null
  is_srs: boolean
  cod_method: string
  anr_contact_id: string | null
  anr_admin_contact_id: string | null
  session_notes: string
  booking_notes: string
  print_name: string
  signature_data: string
  needs_attention_notes: string
  needs_attention_photos: string[]
}

type StRow = {
  id: string
  studio: string
  location: string
  eng_name: string
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

// ─── Constants ────────────────────────────────────────────────────────────────

const EQUIPMENT_ITEMS = ['Speakers', 'Microphone', 'Console']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLocalToday(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function normalizeWO(d: any): WO {
  return {
    id: d.id,
    wo_number: d.wo_number ?? '',
    invoice_number: d.invoice_number ?? '',
    session_date: d.session_date ?? '',
    studios: d.studios ?? [],
    from_time: d.from_time ?? '',
    to_time: d.to_time ?? '',
    engineer: d.engineer ?? '',
    second_engineer: d.second_engineer ?? '',
    producer: d.producer ?? '',
    payment_status: d.payment_status ?? 'COD',
    food_budget: d.food_budget ?? false,
    food_amount: d.food_amount != null ? String(d.food_amount) : '',
    client: d.client ?? '',
    artist: d.artist ?? '',
    label: d.label ?? '',
    ordered_by: d.ordered_by ?? '',
    po_number: d.po_number ?? '',
    phone: d.phone ?? '',
    email: d.email ?? '',
    status: d.status ?? 'open',
    session_status: d.session_status ?? '',
    session_type: d.session_type ?? '',
    client_id: d.client_id ?? null,
    is_srs: d.is_srs ?? false,
    cod_method: d.cod_method ?? '',
    anr_contact_id: d.anr_contact_id ?? null,
    anr_admin_contact_id: d.anr_admin_contact_id ?? null,
    session_notes: d.session_notes ?? '',
    booking_notes: d.booking_notes ?? '',
    print_name: d.print_name ?? '',
    signature_data: d.signature_data ?? '',
    needs_attention_notes: d.needs_attention_notes ?? '',
    needs_attention_photos: d.needs_attention_photos ?? [],
  }
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
    // OT hours auto-derived from session times (max(0, actual - 12))
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
    id: d.id, studio: d.studio ?? '', location: d.location ?? '', eng_name: d.eng_name ?? '', date: d.date ?? '', session_info: d.session_info ?? '',
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

type EquipNote = { id: string; note: string; photo_urls: string[] }

// ─── Component ────────────────────────────────────────────────────────────────

// Shared fields that sync between booking form and WO
export type WOFormSync = {
  client_name: string; artist: string; label: string; ordered_by: string
  po: string; phone: string; email: string; from_time: string; to_time: string
  producer: string; engineer_name: string; assistant_name: string
  payment_type: string; food_budget: boolean; food_amount: string
  invoice_num: string; start_date: string; end_date: string; studio: string; location: string
  rate: string; rate_daily: string; rate_type?: 'hourly' | 'daily'
  notes?: string; engineer_status?: string; engineer_rate?: string
}

export function WorkOrderPopup({
  booking,
  liveForm,
  onClose,
  onStatusChange,
  onFormSync,
  onSaved,
  onDelete,
  inline,
}: {
  booking: Booking
  liveForm?: WOFormSync
  onClose: () => void
  onStatusChange?: (status: string) => void
  onFormSync?: (updates: Partial<WOFormSync>) => void
  onSaved?: () => void
  onDelete?: () => void
  inline?: boolean
}) {
  // Mobile gets a full-screen sheet; never applies when rendered inline (USF embed).
  const isMobileRaw = useIsMobile()
  const isMobile = isMobileRaw && !inline
  const { profile } = useUserProfile()
  // Tech is read-only on WOs everywhere (calendar, wo-hub, LocationStrip): hide
  // all write controls. RLS also blocks tech writes, so this is a UX guard.
  const readOnly = profile?.role === 'tech'
  const [wo, setWo] = useState<WO | null>(null)
  const [stRows, setStRows] = useState<StRow[]>([])
  const [equipRows, setEquipRows] = useState<EquipRow[]>([])
  const [rentRows, setRentRows] = useState<RentRow[]>([
    { id: crypto.randomUUID(), qty: '', item: '', supplier: '', dates_used: '', rate: '', charge: '' },
    { id: crypto.randomUUID(), qty: '', item: '', supplier: '', dates_used: '', rate: '', charge: '' },
  ])
  const [payRows, setPayRows] = useState<PayRow[]>([
    { id: crypto.randomUUID(), payment_type: '', amount: '', memo: '', last_four: '' },
  ])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [showEngRows, setShowEngRows] = useState(false)
  // Seed panel (bulk row generation — see docs/WO-SPEC.md §6)
  const [seedOpen, setSeedOpen] = useState(false)
  const [seedBusy, setSeedBusy] = useState(false)
  // Engineers roster for per-row engineer datalist (reference data; fetched once
  // per modal open — modal lifetime is minutes, realtime not needed here).
  const [engRoster, setEngRoster] = useState<string[]>([])
  const [seed, setSeed] = useState({
    studio: '', start: '', end: '', from: '', to: '',
    rateType: 'day' as 'day' | 'hour', rate: '',
    engOn: false, engName: '', engRate: '',
  })
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null)
  const [confirmDeleteSession, setConfirmDeleteSession] = useState(false)
  // Non-session block (Tour/Tech/Open Hours) simple date fields
  const [blockStart, setBlockStart] = useState(booking.start_date || '')
  const [blockEnd, setBlockEnd] = useState(booking.end_date || booking.start_date || '')
  const [confirmClearEngId, setConfirmClearEngId] = useState<string | null>(null)
  const [pendingLockedEdits, setPendingLockedEdits] = useState<Record<string, StRow>>({})
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set())
  const [equipNotes, setEquipNotes] = useState<Record<string, EquipNote>>({})
  const [openNoteKey, setOpenNoteKey] = useState<string | null>(null)
  const [noteUploading, setNoteUploading] = useState(false)
  const woIdRef = useRef<string | null>(null)
  // The WO's canonical primary booking (work_orders.booking_id). The card that
  // opened the WO may be a secondary room-card; the projection must always write
  // the primary here, not whichever card was clicked.
  const primaryBookingIdRef = useRef<string>(booking.id)
  const [resolvedWoId, setResolvedWoId] = useState<string | null>(null)
  const [woMissing, setWoMissing] = useState<string | null>(null)
  const [siPopoverRowId, setSiPopoverRowId] = useState<string | null>(null)
  const [siPopoverText, setSiPopoverText] = useState('')
  const [siPopoverPos, setSiPopoverPos] = useState<{ top: number; left: number } | null>(null)
  // Track which rows exist in DB (vs. local-only new rows)
  const rentIdsInDb = useRef<Set<string>>(new Set())
  const payIdsInDb = useRef<Set<string>>(new Set())
  const equipNoteFileRef = useRef<HTMLInputElement>(null)
  const pendingNoteKey = useRef<{ key: string; equipment: string; date: string } | null>(null)
  const adminCanvasRef = useRef<HTMLCanvasElement>(null)
  const adminIsDrawingRef = useRef(false)
  const adminInitialSigRef = useRef('')
  const originalStRowsRef = useRef<StRow[]>([])
  const deletedRowsRef = useRef<StRow[]>([])

  // Map liveForm fields onto WO state — seeds WO from current booking form values on open
  function applyLiveForm(base: WO): WO {
    if (!liveForm) return base
    // lv: use live value when it is present (non-null, non-undefined, non-empty string)
    const lv = (live: string | null | undefined, fallback: string) =>
      (live !== undefined && live !== '' && live !== null) ? live : fallback
    const studioLetter = liveForm.studio ? toStudioLetter(liveForm.studio) : ''
    return {
      ...base,
      client:         lv(liveForm.client_name,    base.client),
      artist:         lv(liveForm.artist,          base.artist),
      label:          lv(liveForm.label,           base.label),
      ordered_by:     lv(liveForm.ordered_by,      base.ordered_by),
      po_number:      lv(liveForm.po,              base.po_number),
      phone:          lv(liveForm.phone,           base.phone),
      email:          lv(liveForm.email,           base.email),
      from_time:      lv(liveForm.from_time,       base.from_time),
      to_time:        lv(liveForm.to_time,         base.to_time),
      producer:       lv(liveForm.producer,        base.producer),
      engineer:       lv(liveForm.engineer_name,   base.engineer),
      second_engineer:lv(liveForm.assistant_name,  base.second_engineer),
      payment_status: liveForm.payment_type === 'billing' ? 'Billing' : liveForm.payment_type === 'COD' ? 'COD' : base.payment_status,
      food_budget:    liveForm.food_budget ?? base.food_budget,
      food_amount:    lv(liveForm.food_amount,     base.food_amount),
      invoice_number: lv(liveForm.invoice_num,     base.invoice_number),
      session_date:   lv(liveForm.start_date,      base.session_date),
      studios: base.studios.length > 0 ? base.studios : studioLetter ? [studioLetter] : [],
      // Session-level fields: prefer the WO's own value, else fall back to the booking.
      session_status: base.session_status || (booking as any).status || 'tentative',
      session_type:   base.session_type   || (booking as any).session_type || 'recording',
      client_id:      base.client_id      ?? (booking as any).client_id ?? null,
      is_srs:         base.is_srs || !!(booking as any).is_srs,
      cod_method:     base.cod_method     || (booking as any).cod_method || '',
      anr_contact_id: base.anr_contact_id ?? ((booking as any).anr_contact_id ?? null),
      anr_admin_contact_id: base.anr_admin_contact_id ?? ((booking as any).anr_admin_contact_id ?? null),
    }
  }

  useEffect(() => {
    supabase.from('engineers').select('first_name,last_name').eq('active', true).order('first_name')
      .then(({ data }) => setEngRoster((data ?? []).map((e: any) => `${e.first_name || ''} ${e.last_name || ''}`.trim()).filter(Boolean)))
  }, [])

  useEffect(() => { initWO() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Push booking form edits into the WO in real time, but skip any WO field
  // the user has manually edited (those are tracked in dirtyFields).
  // dirtyFields is reset to empty on every mount, so each fresh WO open starts clean.
  useEffect(() => {
    if (!liveForm || !wo) return
    setWo(prev => {
      if (!prev) return prev
      const updates: Partial<WO> = {}
      const fieldMap: Array<[string, keyof WO]> = [
        ['client_name', 'client'],
        ['artist',       'artist'],
        ['label',        'label'],
        ['ordered_by',   'ordered_by'],
        ['po',           'po_number'],
        ['phone',        'phone'],
        ['email',        'email'],
        ['from_time',    'from_time'],
        ['to_time',      'to_time'],
        ['producer',     'producer'],
        ['engineer_name','engineer'],
        ['assistant_name','second_engineer'],
        ['food_amount',  'food_amount'],
        ['invoice_num',  'invoice_number'],
        ['start_date',   'session_date'],
      ]
      for (const [liveKey, woKey] of fieldMap) {
        const val = (liveForm as any)[liveKey]
        if (val && !dirtyFields.has(woKey)) {
          (updates as any)[woKey] = val
        }
      }
      // payment_type → payment_status requires special mapping
      if (!dirtyFields.has('payment_status')) {
        if (liveForm.payment_type === 'billing') updates.payment_status = 'Billing'
        else if (liveForm.payment_type === 'COD') updates.payment_status = 'COD'
      }
      // food_budget is boolean — don't use truthy check
      if (!dirtyFields.has('food_budget')) updates.food_budget = liveForm.food_budget
      return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev
    })
  }, [liveForm]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live date range sync: when start_date or end_date changes, insert rows for new dates
  // and delete rows for removed dates, then reload stRows. Applies to both day-rate and hourly.
  useEffect(() => {
    if (!wo || !liveForm || !woIdRef.current) return
    const isDayRate = liveForm.rate_type === 'daily' || !!liveForm.rate_daily
    const newStart = liveForm.start_date
    const newEnd = liveForm.end_date || liveForm.start_date
    if (!newStart) return
    ;(async () => {
      const allDates = dateRange(newStart, newEnd)
      const { data: freshRows } = await supabase.from('studio_time_rows')
        .select('id, date').eq('work_order_id', woIdRef.current!)
      const coveredDates = new Set((freshRows ?? []).map((r: any) => r.date))
      const newDateSet = new Set(allDates)

      // Delete rows for dates no longer in range; preserve rows with blank date (manually added)
      const toDelete = (freshRows ?? []).filter((r: any) => r.date && !newDateSet.has(r.date)).map((r: any) => r.id)
      if (toDelete.length > 0) await supabase.from('studio_time_rows').delete().in('id', toDelete)

      // Insert rows for new dates
      const missing = allDates.filter(d => !coveredDates.has(d))
      if (missing.length > 0) {
        const rateRaw = isDayRate ? (liveForm.rate_daily || liveForm.rate || '') : (liveForm.rate || '')
        const rateNum = parseFloat(rateRaw.replace(/[^0-9.]/g, ''))
        const studio = liveForm.studio ? toStudioLetter(liveForm.studio) : (booking.studio ? toStudioLetter(booking.studio) : '')
        const fromTime = liveForm.from_time || booking.from_time || ''
        const toTime = liveForm.to_time || booking.to_time || ''
        await supabase.from('studio_time_rows').insert(missing.map((d, i) => ({
          work_order_id: woIdRef.current!,
          studio, date: d, session_info: '',
          from_time: fromTime, to_time: toTime,
          total_hours: isDayRate ? null : calcHours(fromTime, toTime),
          rate: rateRaw,
          rate_daily: isDayRate ? rateRaw : null,
          row_rate_type: isDayRate ? 'day' : 'hour',
          charge: isDayRate
            ? (!isNaN(rateNum) && rateNum > 0 ? rateNum : null)
            : calcCharge(calcHours(fromTime, toTime), rateRaw),
          day_count: isDayRate ? 1 : null,
          ot_rate: isDayRate ? (!isNaN(rateNum) && rateNum > 0 ? rateNum / 10 : null) : (rateNum || null),
          sort_order: coveredDates.size + i,
        })))
      }

      if (toDelete.length > 0 || missing.length > 0) {
        const { data: reloaded } = await supabase.from('studio_time_rows')
          .select('*').eq('work_order_id', woIdRef.current!).order('date')
        setStRows((reloaded ?? []).map(normalizeStRow))
      }
    })()
  }, [liveForm?.start_date, liveForm?.end_date]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-show eng sub-rows when any row already has eng data
  useEffect(() => {
    if (!showEngRows && stRows.some(r => !!r.eng_rate)) {
      setShowEngRows(true)
    }
  }, [stRows]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time subscription: work_orders status updates only
  useEffect(() => {
    if (!resolvedWoId) return

    const woChannel = supabase
      .channel(`admin-wo-status-${resolvedWoId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'work_orders',
        filter: `id=eq.${resolvedWoId}`,
      }, (payload) => {
        const updated = payload.new as any
        setWo(prev => prev ? { ...prev, status: updated.status ?? prev.status } : prev)
        onStatusChange?.(updated.status ?? 'open')
      })
      .subscribe()

    return () => {
      supabase.removeChannel(woChannel)
    }
  }, [resolvedWoId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function initWO() {
    // Resolve the WO. Prefer the card's work_order_id link (a secondary room-card
    // has no work_orders row of its own, only the shared WO), else fall back to
    // the booking_id lookup for the primary/legacy path.
    const woLink = (booking as any).work_order_id as string | null | undefined
    const { data: rows } = woLink
      ? await supabase.from('work_orders').select('*').eq('id', woLink).limit(1)
      : await supabase.from('work_orders').select('*').eq('booking_id', booking.id)
          .order('created_at', { ascending: false }).limit(1)
    let existing = rows?.[0] ?? null

    // Adopt-first; if no WO exists yet, fall back to the single canonical creator
    // (createWorkOrderForBooking) so admin has a real in-app retry path when save-time
    // WO creation failed. This popup no longer has its own create logic — it calls the
    // same function the booking-save path uses. (The runner WO page never creates.)
    if (!existing) {
      if (!booking.id) {
        setWoMissing('No booking selected — save the booking first.')
        setLoading(false)
        return
      }
      if (!bookingShouldHaveWorkOrder(booking)) {
        setWoMissing('This booking type does not use a work order.')
        setLoading(false)
        return
      }
      try {
        await createWorkOrderForBooking(booking)
      } catch (e: any) {
        setWoMissing('Work order missing — could not be created.' + (e?.message ? ' (' + e.message + ')' : '') + ' Contact office.')
        setLoading(false)
        return
      }
      const { data: refetch } = await supabase
        .from('work_orders')
        .select('*')
        .eq('booking_id', booking.id)
        .order('created_at', { ascending: false })
        .limit(1)
      existing = refetch?.[0] ?? null
      if (!existing) {
        setWoMissing('Work order missing — contact office.')
        setLoading(false)
        return
      }
    }

    if (existing) {
      woIdRef.current = existing.id
      primaryBookingIdRef.current = existing.booking_id ?? booking.id
      setResolvedWoId(existing.id)
      onStatusChange?.(existing.status ?? 'open')
      // Fix studios: if DB has empty array but booking has a studio, backfill from booking
      const rawStudios: string[] = existing.studios ?? []
      const studioLetter = booking.studio ? toStudioLetter(booking.studio) : ''
      const studios = rawStudios.length > 0 ? rawStudios : (studioLetter ? [studioLetter] : [])
      if (rawStudios.length === 0 && studios.length > 0) {
        await supabase.from('work_orders').update({ studios }).eq('id', existing.id)
      }
      // Fall back the session-level fields to the booking when the WO's own are
      // empty (older WOs created before these columns existed). This runs even
      // when there's no liveForm (calendar-opened), so the status bar / session
      // type / client always reflect the real session instead of opening blank.
      const base: WO = { ...normalizeWO(existing), studios }
      base.session_status = base.session_status || (booking as any).status || 'tentative'
      base.session_type = base.session_type || (booking as any).session_type || 'recording'
      base.client_id = base.client_id ?? ((booking as any).client_id ?? null)
      base.is_srs = base.is_srs || !!(booking as any).is_srs
      base.cod_method = base.cod_method || (booking as any).cod_method || ''
      base.anr_contact_id = base.anr_contact_id ?? ((booking as any).anr_contact_id || null)
      base.anr_admin_contact_id = base.anr_admin_contact_id ?? ((booking as any).anr_admin_contact_id || null)
      const seededExisting = applyLiveForm(base)
      adminInitialSigRef.current = seededExisting.signature_data ?? ''
      setWo(seededExisting)
      const [{ data: st }, { data: eq }, { data: rent }, { data: pay }, { data: eqNotes }] = await Promise.all([
        supabase.from('studio_time_rows').select('*').eq('work_order_id', existing.id).order('sort_order'),
        supabase.from('equipment_condition_rows').select('*').eq('work_order_id', existing.id),
        supabase.from('rental_rows').select('*').eq('work_order_id', existing.id).order('sort_order'),
        supabase.from('payment_rows').select('*').eq('work_order_id', existing.id).order('recorded_at'),
        supabase.from('equipment_condition_notes').select('*').eq('work_order_id', existing.id),
      ])
      if (st?.length) {
        const isSingleDay = booking.start_date === booking.end_date || !booking.end_date
        const rows = st.map(normalizeStRow)
        if (isSingleDay && liveForm && (liveForm.from_time || liveForm.to_time)) {
          const r = rows[0]
          const from = r.from_time || liveForm.from_time
          const to   = r.to_time   || liveForm.to_time
          const hrs  = calcHours(from, to)
          // Day-rate rows keep their day_count-based charge; only update times for hourly rows
          rows[0] = r.day_count != null
            ? { ...r, from_time: from, to_time: to, total_hours: hrs }
            : { ...r, from_time: from, to_time: to, total_hours: hrs, charge: calcCharge(hrs, r.rate) }
        }
        // Day-rate reconciliation: always use DB as source of truth — never in-memory rows.
        // This prevents duplicates from concurrent initWO calls (e.g. WO popup remounts).
        const isDay = booking.rate_type === 'day' || (!booking.rate && !!booking.rate_daily)
        if (isDay) {
          // 1. Fresh DB read — ignore in-memory rows entirely
          const { data: freshSt } = await supabase.from('studio_time_rows')
            .select('id, date, created_at')
            .eq('work_order_id', existing.id)
            .order('created_at', { ascending: true })

          // 2. Dedup: keep the earliest row per date, delete later duplicates
          const keepByDate: Record<string, string> = {}
          const dupeIds: string[] = []
          for (const r of freshSt ?? []) {
            if (keepByDate[r.date]) dupeIds.push(r.id)
            else keepByDate[r.date] = r.id
          }
          if (dupeIds.length > 0) {
            await supabase.from('studio_time_rows').delete().in('id', dupeIds)
          }

          // 3. Insert rows for dates not yet in DB
          const allDates = dateRange(booking.start_date, booking.end_date)
          const coveredDates = new Set(Object.keys(keepByDate))
          const missingDates = allDates.filter(d => !coveredDates.has(d))
          if (missingDates.length > 0) {
            const dayRateNum = parseFloat((booking.rate_daily ?? '').replace(/[^0-9.]/g, ''))
            await supabase.from('studio_time_rows').insert(missingDates.map((d, i) => ({
              work_order_id: existing.id,
              studio: studioLetter || booking.studio || '',
              date: d, session_info: '',
              from_time: booking.from_time ?? '', to_time: booking.to_time ?? '',
              total_hours: null as number | null,
              rate: booking.rate_daily ?? '',
              rate_daily: booking.rate_daily ?? '',
              row_rate_type: 'day',
              charge: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum : null,
              day_count: 1,
              ot_rate: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum / 10 : null,
              sort_order: coveredDates.size + i,
            })))
          }

          // 4. Reload all rows fresh from DB — never merge in-memory arrays
          const { data: reloaded } = await supabase.from('studio_time_rows')
            .select('*').eq('work_order_id', existing.id).order('date')
          const reloadedRows = (reloaded ?? []).map(normalizeStRow)
          originalStRowsRef.current = reloadedRows
          setStRows(reloadedRows)
        } else {
          originalStRowsRef.current = rows
          setStRows(rows)
        }
      } else {
        // Existing WO has no studio time rows — fresh DB check before insert to prevent race-condition dupes
        const dates = dateRange(booking.start_date, booking.end_date)
        const { data: freshCheck } = await supabase.from('studio_time_rows')
          .select('date').eq('work_order_id', existing.id)
        const existingDateSet = new Set((freshCheck ?? []).map((r: any) => r.date))
        const isDay = booking.rate_type === 'day' || (!booking.rate && !!booking.rate_daily)
        const stPayloads = dates.filter(d => !existingDateSet.has(d)).map((d, i) => {
          if (isDay) {
            const dayRateNum = parseFloat((booking.rate_daily ?? '').replace(/[^0-9.]/g, ''))
            return {
              work_order_id: existing.id,
              studio: studioLetter || booking.studio || '',
              date: d, session_info: '',
              from_time: booking.from_time ?? '', to_time: booking.to_time ?? '',
              total_hours: null as number | null,
              rate: booking.rate_daily ?? '',
              rate_daily: booking.rate_daily ?? '',
              row_rate_type: 'day',
              charge: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum : null,
              day_count: 1,
              ot_rate: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum / 10 : null,
              sort_order: existingDateSet.size + i,
            }
          }
          const hrs = calcHours(booking.from_time ?? '', booking.to_time ?? '')
          return {
            work_order_id: existing.id,
            studio: studioLetter || booking.studio || '',
            date: d, session_info: '',
            from_time: booking.from_time ?? '', to_time: booking.to_time ?? '',
            total_hours: hrs,
            rate: booking.rate ?? '',
            row_rate_type: 'hour',
            charge: calcCharge(hrs, booking.rate ?? ''),
            ot_rate: parseFloat((booking.rate ?? '').replace(/[^0-9.]/g, '')) || null,
            sort_order: existingDateSet.size + i,
          }
        })
        if (stPayloads.length) {
          await supabase.from('studio_time_rows').insert(stPayloads)
        }
        const { data: reloaded } = await supabase.from('studio_time_rows')
          .select('*').eq('work_order_id', existing.id).order('sort_order')
        const reloadedRows2 = (reloaded ?? []).map(normalizeStRow)
        originalStRowsRef.current = reloadedRows2
        setStRows(reloadedRows2)
      }
      if (eq?.length) setEquipRows(eq as EquipRow[])
      if (eqNotes?.length) {
        const map: Record<string, EquipNote> = {}
        for (const n of eqNotes) map[`${n.equipment}||${n.date}`] = { id: n.id, note: n.note ?? '', photo_urls: n.photo_urls ?? [] }
        setEquipNotes(map)
      }
      if (rent?.length) {
        setRentRows(rent.map(r => ({ id: r.id, qty: String(r.qty ?? ''), item: r.item ?? '', supplier: r.supplier ?? '', dates_used: r.dates_used ?? '', rate: r.rate ?? '', charge: String(r.charge ?? '') })))
        rent.forEach(r => rentIdsInDb.current.add(r.id))
      }
      if (pay?.length) {
        setPayRows(pay.map(p => ({ id: p.id, payment_type: p.payment_type ?? '', amount: p.amount != null ? formatCurrency(String(p.amount)) : '', memo: p.memo ?? '', last_four: p.last_four ?? '' })))
        pay.forEach(p => payIdsInDb.current.add(p.id))
      }
    }
    setLoading(false)
  }

  // ── Admin canvas signature ──────────────────────────────────────────────────

  useEffect(() => {
    if (loading) return
    const canvas = adminCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = '#e8eaf2'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (adminInitialSigRef.current) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      img.src = adminInitialSigRef.current
    }
  }, [loading])

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
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    }
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
    setWo(w => w ? { ...w, signature_data: canvas.toDataURL('image/png') } : w)
  }

  function clearAdminSignature() {
    const canvas = adminCanvasRef.current; if (!canvas) return
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setWo(w => w ? { ...w, signature_data: '' } : w)
  }

  // ── Studio time row updates ─────────────────────────────────────────────────

  function updateStRow(id: string, updates: Partial<StRow>) {
    const row = stRows.find(r => r.id === id)
    if (row?.admin_locked && !pendingLockedEdits[id]) {
      setPendingLockedEdits(p => ({ ...p, [id]: { ...row } }))
    }
    setStRows(prev => prev.map(r => {
      if (r.id !== id) return r
      const u = { ...r, ...updates }

      // Total hours always auto-calc from times (both rate types)
      if ('from_time' in updates || 'to_time' in updates || 'row_rate_type' in updates) {
        u.total_hours = calcHours(u.from_time, u.to_time)
      }

      if (u.row_rate_type === 'day') {
        // Charge = rate_daily (flat, OT is separate)
        if ('rate_daily' in updates || 'row_rate_type' in updates) {
          const rn = parseFloat((u.rate_daily ?? '').replace(/[^0-9.]/g, ''))
          u.charge = !isNaN(rn) && rn > 0 ? rn : null
          // OT rate auto-calc: 10% of day rate
          if (!('ot_rate' in updates)) {
            u.ot_rate = rn > 0 ? String(parseFloat((rn * 0.10).toFixed(2))) : u.ot_rate
          }
        }
        // OT hours auto-derived from times (Total Hrs - 12 when > 12)
        if ('from_time' in updates || 'to_time' in updates || 'row_rate_type' in updates) {
          const actual = u.total_hours ?? 0
          u.ot_hours = String(Math.max(0, parseFloat(actual.toFixed(2)) - 12))
        }
      } else {
        // Hourly: charge = total_hours × rate
        if ('total_hours' in updates || 'rate' in updates || 'from_time' in updates || 'to_time' in updates || 'row_rate_type' in updates) {
          u.charge = calcCharge(u.total_hours, u.rate)
        }
        // OT rate auto-calc: same as rate
        if ('rate' in updates || 'row_rate_type' in updates) {
          if (!('ot_rate' in updates)) u.ot_rate = u.rate
        }
      }

      // OT charge = OT hrs × OT rate (both rate types)
      if ('ot_hours' in updates || 'ot_rate' in updates || 'from_time' in updates || 'to_time' in updates || 'rate' in updates || 'rate_daily' in updates || 'row_rate_type' in updates) {
        const h = parseFloat(u.ot_hours ?? '0') || 0
        const rn = parseFloat((u.ot_rate ?? '').replace(/[^0-9.]/g, '')) || 0
        u.ot_charge = h > 0 && rn > 0 ? parseFloat((h * rn).toFixed(2)) : null
      }

      // Eng charge
      if ('eng_hours' in updates || 'eng_rate' in updates || 'from_time' in updates || 'to_time' in updates || 'eng_from_time' in updates || 'eng_to_time' in updates) {
        const ef = u.eng_from_time || u.from_time
        const et = u.eng_to_time   || u.to_time
        const eh = calcHours(ef, et) ?? (u.eng_hours != null ? Number(u.eng_hours) : null)
        const er = parseFloat((u.eng_rate ?? '').replace(/[^0-9.]/g, ''))
        u.eng_charge = eh != null && eh > 0 && !isNaN(er) && er > 0 ? parseFloat((eh * er).toFixed(2)) : null
      }
      return u
    }))
  }

  // Toggle a row between 'hour' and 'day' rate type, auto-deriving the companion rate
  function toggleRowRateType(id: string) {
    setStRows(prev => prev.map(r => {
      if (r.id !== id) return r
      if (r.row_rate_type === 'hour') {
        // Hour → Day: set rate_daily = rate × 10 unless rate_daily was manually overridden
        const rateNum = parseFloat(r.rate.replace(/[^0-9.]/g, '')) || 0
        const existingDailyNum = parseFloat(r.rate_daily.replace(/[^0-9.]/g, '')) || 0
        const autoDaily = rateNum > 0 ? parseFloat((rateNum * 10).toFixed(2)) : 0
        const finalDaily = (!existingDailyNum || Math.abs(existingDailyNum - autoDaily) < 0.01)
          ? (autoDaily > 0 ? String(autoDaily) : r.rate_daily)
          : r.rate_daily
        const dailyNum = parseFloat(finalDaily.replace(/[^0-9.]/g, '')) || 0
        const otRate = r.ot_rate || (dailyNum > 0 ? String(parseFloat((dailyNum / 10).toFixed(2))) : '')
        const otRateNum = parseFloat(otRate.replace(/[^0-9.]/g, '')) || 0
        const actual = calcHours(r.from_time, r.to_time) ?? 0
        const otHrs = Math.max(0, parseFloat(actual.toFixed(2)) - 12)
        return {
          ...r,
          row_rate_type: 'day' as const,
          rate_daily: finalDaily,
          charge: dailyNum > 0 ? dailyNum : null,
          ot_hours: String(otHrs),
          ot_rate: otRate,
          ot_charge: otHrs > 0 && otRateNum > 0 ? parseFloat((otHrs * otRateNum).toFixed(2)) : null,
        }
      } else {
        // Day → Hour: set rate = rate_daily ÷ 10 unless rate was manually overridden
        const dailyNum = parseFloat(r.rate_daily.replace(/[^0-9.]/g, '')) || 0
        const autoRate = dailyNum > 0 ? parseFloat((dailyNum / 10).toFixed(2)) : 0
        const existingRateNum = parseFloat(r.rate.replace(/[^0-9.]/g, '')) || 0
        const finalRate = (!existingRateNum || Math.abs(existingRateNum - autoRate) < 0.01)
          ? (autoRate > 0 ? String(autoRate) : r.rate)
          : r.rate
        const finalRateNum = parseFloat(finalRate.replace(/[^0-9.]/g, '')) || 0
        const hrs = r.total_hours ?? calcHours(r.from_time, r.to_time) ?? null
        return {
          ...r,
          row_rate_type: 'hour' as const,
          rate: finalRate,
          charge: hrs != null && hrs > 0 && finalRateNum > 0 ? parseFloat((hrs * finalRateNum).toFixed(2)) : null,
          ot_hours: '0',
          ot_charge: null,
        }
      }
    }))
  }

  // ── Equipment condition ────────────────────────────────────────────────────

  function toggleEquip(equipment: string, date: string, cond: 'ok' | 'not_ok') {
    const key = `${equipment}||${date}`
    const currentCond = equipRows.find(r => r.equipment === equipment && r.date === date)?.condition
    const nextCond: 'ok' | 'not_ok' | null = currentCond === cond ? null : cond
    setEquipRows(prev => prev.map(r => {
      if (r.equipment !== equipment || r.date !== date) return r
      supabase.from('equipment_condition_rows').update({ condition: nextCond }).eq('id', r.id)
      return { ...r, condition: nextCond }
    }))
    if (nextCond === 'not_ok') setOpenNoteKey(key)
    else setOpenNoteKey(prev => prev === key ? null : prev)
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
      // Store the storage PATH — checklist-photos is private; reads sign on demand.
      const currentPhotos = equipNotes[pending.key]?.photo_urls ?? []
      await upsertEquipNote(pending.key, pending.equipment, pending.date, { photo_urls: [...currentPhotos, data.path] })
    }
    setNoteUploading(false)
    if (equipNoteFileRef.current) equipNoteFileRef.current.value = ''
    pendingNoteKey.current = null
  }

  // ── Add studio time row ────────────────────────────────────────────────────

  function addStRow() {
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
      charge = totalHours != null && !isNaN(rateNum) && rateNum > 0
        ? parseFloat((totalHours * rateNum).toFixed(2)) : null
    } else {
      const rateNum = parseFloat((rateDailyStr || rateStr).replace(/[^0-9.]/g, ''))
      charge = !isNaN(rateNum) && rateNum > 0 ? rateNum : null
    }

    const newRow: StRow = {
      id: crypto.randomUUID(),
      studio: last?.studio || '',
      location: last?.location || '',
      eng_name: last?.eng_name || '',
      date: '',
      session_info: '',
      from_time: fromTime,
      to_time: toTime,
      total_hours: totalHours,
      rate: rateStr,
      rate_daily: rateDailyStr || '',
      row_rate_type: rowRateType,
      ot_rate: last?.ot_rate || '',
      ot_hours: '0',
      ot_charge: null,
      charge,
      sort_order: maxOrder + 1,
      day_count: null,
      eng_hours: null,
      eng_rate: '',
      eng_charge: null,
      eng_from_time: '',
      eng_to_time: '',
      admin_checked: false,
      admin_locked: false,
      eng_visible: true,
    }
    setStRows(prev => [...prev, newRow])
    if (last?.eng_rate || (last?.eng_hours ?? 0) > 0) setShowEngRows(true)
  }

  function addEngRow() {
    const engMaxOrder = stRows.reduce((max, r) => Math.max(max, r.sort_order ?? -1), -1)
    const lastEng = [...stRows].reverse().find(r => r.eng_rate || (r.eng_hours ?? 0) > 0 || r.eng_from_time) || stRows[stRows.length - 1]
    const newRow: StRow = {
      id: crypto.randomUUID(),
      studio: '',
      location: '',
      eng_name: '',
      date: '',
      session_info: '',
      from_time: '',
      to_time: '',
      total_hours: null,
      rate: '',
      rate_daily: '',
      row_rate_type: 'hour',
      ot_rate: '',
      ot_hours: '',
      ot_charge: null,
      charge: null,
      sort_order: engMaxOrder + 1,
      day_count: null,
      eng_from_time: lastEng?.eng_from_time || '',
      eng_to_time: lastEng?.eng_to_time || '',
      eng_rate: lastEng?.eng_rate || '',
      eng_hours: null,
      eng_charge: null,
      admin_checked: false,
      admin_locked: false,
      eng_visible: true,
    }
    setStRows(prev => [...prev, newRow])
  }

  async function deleteStRow(id: string) {
    const row = stRows.find(r => r.id === id)
    if (row) deletedRowsRef.current = [...deletedRowsRef.current, row]
    await supabase.from('studio_time_rows').delete().eq('id', id)
    setStRows(prev => prev.filter(r => r.id !== id))
    setConfirmDeleteRowId(null)
    setConfirmClearEngId(null)
  }

  async function clearEngRow(id: string) {
    await supabase.from('studio_time_rows').update({
      eng_from_time: null, eng_to_time: null, eng_rate: null, eng_hours: null, eng_charge: null, eng_visible: false,
    }).eq('id', id)
    setStRows(prev => prev.map(r => r.id === id ? { ...r, eng_from_time: '', eng_to_time: '', eng_rate: '', eng_hours: null, eng_charge: null, eng_visible: false } : r))
    setConfirmClearEngId(null)
  }

  // ── Print with filename ───────────────────────────────────────────────────

  function printWithFilename() {
    const slug = (s: string) => (s || '').trim().replace(/\s+/g, '_')
    const inv = `_${wo?.invoice_number || 'INV#'}`
    const name = wo?.payment_status === 'Billing'
      ? [slug(wo.label), wo.artist ? slug(wo.artist) : ''].filter(Boolean).join('_') + inv
      : slug(wo?.client ?? '') + inv
    const prev = document.title
    document.title = name || prev
    window.print()
    document.title = prev
  }

  // ── Per-row admin lock ────────────────────────────────────────────────────

  async function handleToggleLock(rowId: string, currentLocked: boolean) {
    const newLocked = !currentLocked
    await supabase.from('studio_time_rows').update({
      admin_checked: newLocked,
      admin_locked: newLocked,
    }).eq('id', rowId)
    setStRows(prev => prev.map(r => r.id === rowId
      ? { ...r, admin_checked: newLocked, admin_locked: newLocked }
      : r
    ))
    if (!newLocked) {
      setPendingLockedEdits(p => { const n = { ...p }; delete n[rowId]; return n })
    }
  }

  // ── Projection (Step 5b): one WO → one booking card per room-run ────────────
  // Splits the WO's dated studio rows into segments of consecutive same-room days.
  // Segment 0 updates the primary booking; extra segments become secondary cards
  // (same work_order_id) so a session that moves rooms shows a card in each room.
  async function projectBookingCards(woId: string) {
    const primaryId = primaryBookingIdRef.current
    const venue = booking.location || ''
    const dated = stRows.filter(r => r.date && r.studio).sort((a, b) => a.date.localeCompare(b.date))

    if (dated.length === 0) {
      await supabase.from('bookings').update({ work_order_id: woId }).eq('id', primaryId)
      return
    }

    // Build segments (new segment on room change OR non-consecutive date).
    type Seg = { studio: string; location: string; start: string; end: string; from: string; to: string }
    const segs: Seg[] = []
    for (const r of dated) {
      const last = segs[segs.length - 1]
      const rLoc = r.location || venue
      if (last && last.studio === r.studio && last.location === rLoc && isNextDay(last.end, r.date)) {
        last.end = r.date
      } else {
        segs.push({ studio: r.studio, location: rLoc, start: r.date, end: r.date, from: r.from_time, to: r.to_time })
      }
    }

    // Session/client fields mirrored onto every card (schedule fields added per segment).
    const sessionFields: Record<string, any> = {
      status: wo.session_status || 'tentative',
      session_type: wo.session_type || 'recording',
      payment_type: wo.payment_status === 'Billing' ? 'billing' : 'COD',
      cod_method: wo.cod_method || null,
      client_id: wo.client_id,
      client_name: wo.client || null,
      artist: wo.artist || null,
      label: wo.label || null,
      ordered_by: wo.ordered_by || null,
      phone: wo.phone || null,
      email: wo.email || null,
      producer: wo.producer || null,
      engineer_name: wo.engineer || null,
      assistant_name: wo.second_engineer || null,
      is_srs: wo.is_srs,
      invoice_num: wo.invoice_number || null,
      po: wo.po_number || null,
      notes: wo.session_notes || null,
      anr_contact_id: wo.anr_contact_id,
      anr_admin_contact_id: wo.anr_admin_contact_id,
      work_order_id: woId,
      wo_number: wo.wo_number || null,
    }
    const scheduleFor = (seg: Seg) => ({
      location: seg.location || venue || undefined,
      studio: roomLabelForVenue(seg.location || venue, seg.studio),
      start_date: seg.start,
      end_date: seg.end,
      from_time: seg.from || null,
      to_time: seg.to || null,
    })

    // Segment 0 → the primary booking card.
    await supabase.from('bookings').update({ ...sessionFields, ...scheduleFor(segs[0]) }).eq('id', primaryId)

    // Extra segments → secondary cards (match existing by room+start, else insert).
    const { data: existing } = await supabase.from('bookings')
      .select('id, studio, start_date').eq('work_order_id', woId).neq('id', primaryId)
    const kept = new Set<string>()
    for (let i = 1; i < segs.length; i++) {
      const seg = segs[i]
      const room = roomLabelForVenue(seg.location || venue, seg.studio)
      const match = (existing ?? []).find(b => b.studio === room && b.start_date === seg.start && !kept.has(b.id))
      const payload = { ...sessionFields, ...scheduleFor(seg), engineer_status: 'not_needed', assistant_status: 'not_needed' }
      if (match) {
        await supabase.from('bookings').update(payload).eq('id', match.id)
        kept.add(match.id)
      } else {
        const { data: ins } = await supabase.from('bookings').insert(payload).select('id').single()
        if (ins) kept.add(ins.id)
      }
    }

    // Delete secondary cards that no longer correspond to a segment.
    const stale = (existing ?? []).filter(b => !kept.has(b.id))
    if (stale.length > 0) await supabase.from('bookings').delete().in('id', stale.map(b => b.id))
  }

  // ── Complete WO ───────────────────────────────────────────────────────────

  async function handleComplete() {
    if (!woIdRef.current || !wo) return
    setCompleting(true)
    const newStatus = wo.status === 'completed' ? 'open' : 'completed'
    const now = new Date().toISOString()
    await supabase.from('work_orders').update({
      status: newStatus,
      admin_approved_at: newStatus === 'completed' ? now : null,
    }).eq('id', woIdRef.current)
    setWo(prev => prev ? { ...prev, status: newStatus } : prev)
    onStatusChange?.(newStatus)
    setCompleting(false)
  }

  // ── Non-session block save (Tour / Tech / Open Hours) ──────────────────────
  // A block is a simple calendar event with a title + times, no work-order body.
  // We persist those fields onto the booking card and leave the (dormant) WO row.
  const BLOCK_STATUSES = ['tour', 'tech', 'open_hours']
  async function handleBlockSave() {
    if (!wo) { onClose(); return }
    setSaving(true)
    // Keep the WO's own header fields roughly in sync (harmless if dormant).
    if (woIdRef.current) {
      await supabase.from('work_orders').update({
        session_status: wo.session_status || null,
        client: wo.client || null,
        from_time: wo.from_time || null,
        to_time: wo.to_time || null,
        updated_at: new Date().toISOString(),
      }).eq('id', woIdRef.current)
    }
    const { error: blockErr } = await supabase.from('bookings').update({
      status: wo.session_status,
      client_name: wo.client || null,
      from_time: wo.from_time || null,
      to_time: wo.to_time || null,
      start_date: blockStart || booking.start_date,
      end_date: blockEnd || blockStart || booking.end_date,
    }).eq('id', primaryBookingIdRef.current)
    setSaving(false)
    if (!dbResult('Saving block', blockErr)) return
    onSaved?.()
    onClose()
  }

  // ── Save + close ──────────────────────────────────────────────────────────

  async function handleClose() {
    if (!wo || !woIdRef.current) { onClose(); return }
    // Tour/Tech/Open-Hours → save as a simple block, skip the WO body + projection.
    if (BLOCK_STATUSES.includes(wo.session_status)) { await handleBlockSave(); return }
    setSaving(true)
    const id = woIdRef.current

    const { error: woSaveErr } = await supabase.from('work_orders').update({
      invoice_number: wo.invoice_number || null,
      session_date: wo.session_date || null,
      studios: wo.studios,
      from_time: wo.from_time || null,
      to_time: wo.to_time || null,
      engineer: wo.engineer || null,
      second_engineer: wo.second_engineer || null,
      producer: wo.producer || null,
      payment_status: wo.payment_status,
      food_budget: wo.food_budget,
      food_amount: wo.food_amount ? parseFloat(wo.food_amount) : null,
      client: wo.client || null,
      artist: wo.artist || null,
      label: wo.label || null,
      ordered_by: wo.ordered_by || null,
      po_number: wo.po_number || null,
      phone: wo.phone || null,
      email: wo.email || null,
      session_notes: wo.session_notes || null,
      booking_notes: wo.booking_notes || null,
      print_name: wo.print_name || null,
      signature_data: wo.signature_data || null,
      needs_attention_notes: wo.needs_attention_notes || null,
      // Session-level fields now owned by the WO
      session_status: wo.session_status || null,
      session_type: wo.session_type || null,
      client_id: wo.client_id,
      is_srs: wo.is_srs,
      cod_method: wo.cod_method || null,
      anr_contact_id: wo.anr_contact_id,
      anr_admin_contact_id: wo.anr_admin_contact_id,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (!dbResult('Saving work order', woSaveErr)) { setSaving(false); return }

    const { error: bkSyncErr } = await supabase.from('bookings').update({
      from_time: stRows[0]?.from_time || null,
      to_time: stRows[0]?.to_time || null,
      client_name: wo.client || null,
      artist: wo.artist || null,
      label: wo.label || null,
      client_id: wo.client_id,
      engineer_name: wo.engineer || null,
      assistant_name: wo.second_engineer || null,
      producer: wo.producer || null,
      phone: wo.phone || null,
      email: wo.email || null,
      notes: wo.session_notes || null,
      invoice_num: wo.invoice_number || null,
      ordered_by: wo.ordered_by || null,
      payment_type: wo.payment_status === 'Billing' ? 'billing' : 'COD',
      cod_method: wo.cod_method || null,
      is_srs: wo.is_srs,
      // Only write status/session_type when they hold a real value — never blank
      // the calendar card (an empty status renders as no color / "open hours").
      ...(wo.session_status ? { status: wo.session_status } : {}),
      ...(wo.session_type ? { session_type: wo.session_type } : {}),
      anr_contact_id: wo.anr_contact_id,
      anr_admin_contact_id: wo.anr_admin_contact_id,
    }).eq('id', primaryBookingIdRef.current)
    dbResult('Syncing booking card', bkSyncErr)

    // Save studio time rows — insert new rows, update existing
    const originalStIds = new Set(originalStRowsRef.current.map(r => r.id))
    await Promise.all(stRows.map(r => {
      const payload = {
        studio: r.studio, location: r.location || null, eng_name: r.eng_name || null, date: r.date, session_info: r.session_info,
        from_time: r.from_time, to_time: r.to_time,
        total_hours: r.total_hours, rate: r.rate, rate_daily: r.rate_daily || null,
        row_rate_type: r.row_rate_type,
        charge: r.charge,
        sort_order: r.sort_order,
        day_count: r.day_count ?? null,
        ot_rate: r.ot_rate ? parseFloat(r.ot_rate.replace(/[^0-9.]/g, '')) || null : null,
        ot_hours: r.ot_hours ? parseFloat(r.ot_hours) || null : null,
        ot_charge: r.ot_charge ?? null,
        eng_hours: r.eng_hours ?? null,
        eng_rate: r.eng_rate || null,
        eng_charge: r.eng_charge ?? null,
        eng_from_time: r.eng_from_time || null,
        eng_to_time: r.eng_to_time || null,
        admin_checked: r.admin_checked,
        admin_locked: r.admin_locked,
        eng_visible: r.eng_visible,
      }
      return originalStIds.has(r.id)
        ? supabase.from('studio_time_rows').update(payload).eq('id', r.id)
        : supabase.from('studio_time_rows').insert({ ...payload, id: r.id, work_order_id: id })
    })).then(results => {
      const failed = results.filter(r => r?.error)
      if (failed.length > 0) dbResult(`Saving ${failed.length} studio-time row(s)`, failed[0].error)
    })

    // Upsert rental rows that have content
    const rentToSave = rentRows.filter(r => r.item || r.charge)
    await Promise.all(rentToSave.map(r => {
      const payload = { id: r.id, work_order_id: id, qty: parseInt(r.qty) || null, item: r.item || null, supplier: r.supplier || null, dates_used: r.dates_used || null, rate: r.rate || null, charge: parseFloat(r.charge) || null }
      return rentIdsInDb.current.has(r.id)
        ? supabase.from('rental_rows').update(payload).eq('id', r.id)
        : supabase.from('rental_rows').insert(payload)
    })).then(results => {
      const failed = results.filter(r => r?.error)
      if (failed.length > 0) dbResult(`Saving ${failed.length} rental row(s)`, failed[0].error)
    })

    // Upsert payment rows that have content
    const payToSave = payRows.filter(p => p.payment_type || p.amount)
    await Promise.all(payToSave.map(p => {
      const payload = { id: p.id, work_order_id: id, payment_type: p.payment_type || null, amount: stripCurrency(p.amount), memo: p.memo || null, last_four: p.last_four || null }
      return payIdsInDb.current.has(p.id)
        ? supabase.from('payment_rows').update(payload).eq('id', p.id)
        : supabase.from('payment_rows').insert(payload)
    })).then(results => {
      const failed = results.filter(r => r?.error)
      if (failed.length > 0) dbResult(`Saving ${failed.length} payment row(s)`, failed[0].error)
    })

    // ── Projection (Step 5b): one WO → one booking card per room-run ──
    if (booking.id) {
      try {
        await projectBookingCards(id)
      } catch (err) {
        console.error('WO→booking projection failed:', err)
      }
    }

    originalStRowsRef.current = stRows
    deletedRowsRef.current = []
    setSaving(false)
    onSaved?.()
    onClose()
  }

  async function handleCancel() {
    const originalIds = new Set(originalStRowsRef.current.map(r => r.id))
    const added = stRows.filter(r => !originalIds.has(r.id))
    if (added.length) {
      await supabase.from('studio_time_rows').delete().in('id', added.map(r => r.id))
    }
    if (deletedRowsRef.current.length > 0) {
      await Promise.all(deletedRowsRef.current.map(r =>
        supabase.from('studio_time_rows').insert({
          id: r.id,
          work_order_id: woIdRef.current!,
          studio: r.studio, date: r.date, session_info: r.session_info,
          from_time: r.from_time, to_time: r.to_time,
          total_hours: r.total_hours, rate: r.rate,
          rate_daily: r.rate_daily || null,
          row_rate_type: r.row_rate_type,
          charge: r.charge,
          sort_order: r.sort_order,
          day_count: r.day_count ?? null,
          ot_rate: r.ot_rate ? parseFloat(r.ot_rate.replace(/[^0-9.]/g, '')) || null : null,
          ot_hours: r.ot_hours ? parseFloat(r.ot_hours) || null : null,
          ot_charge: r.ot_charge ?? null,
          eng_hours: r.eng_hours ?? null,
          eng_rate: r.eng_rate || null,
          eng_charge: r.eng_charge ?? null,
          eng_from_time: r.eng_from_time || null,
          eng_to_time: r.eng_to_time || null,
          admin_checked: r.admin_checked,
          admin_locked: r.admin_locked,
          eng_visible: r.eng_visible,
        })
      ))
      deletedRowsRef.current = []
    }
    setStRows(originalStRowsRef.current)
    onClose()
  }

  // ── Derived totals ─────────────────────────────────────────────────────────

  const stTotal = stRows.reduce((s, r) => s + (r.charge ?? 0) + (r.ot_charge ?? 0), 0)
  const engTotal = stRows.reduce((s, r) => {
    const engRateDisplay = r.eng_rate || liveForm?.engineer_rate || (booking as any)?.engineer_rate || ''
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

  // ── Styles ────────────────────────────────────────────────────────────────

  const inp: React.CSSProperties = {
    background: 'transparent', border: 'none',
    color: '#f0f0f0', fontFamily: 'Inter', fontSize: 11,
    padding: '1px 0', outline: 'none', width: '100%', lineHeight: 1.4,
  }
  const cellS: React.CSSProperties = {
    padding: '4px 8px', fontSize: 11, fontFamily: 'Inter', color: '#f0f0f0',
    display: 'flex', alignItems: 'center',
  }
  const thS: React.CSSProperties = {
    padding: '4px 8px', fontSize: 8, fontFamily: 'Syne', fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text2)',
  }
  function shortDate(d: string) {
    if (!d) return '—'
    const parts = d.split('-')
    if (parts.length < 3) return d
    return `${parseInt(parts[1], 10)}-${parseInt(parts[2], 10)}`
  }
  const metaLabel: React.CSSProperties = {
    fontSize: 9, fontFamily: 'Syne', fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text2)',
  }

  // ── Client panel wiring ─────────────────────────────────────────────────────
  // Map the WO's client fields onto the shared ClientPanel value, and route the
  // panel's patches back into WO state (marking each as a manual/dirty edit so
  // the liveForm sync won't clobber it).
  const clientValue: ClientPanelValue = {
    payment_type: wo?.payment_status === 'Billing' ? 'billing' : 'COD',
    cod_method: wo?.cod_method ?? '',
    client_name: wo?.client ?? '',
    artist: wo?.artist ?? '',
    label: wo?.label ?? '',
    ordered_by: wo?.ordered_by ?? '',
    phone: wo?.phone ?? '',
    email: wo?.email ?? '',
    client_db_id: wo?.client_id ?? null,
    is_srs: wo?.is_srs ?? false,
    anr_contact_id: wo?.anr_contact_id ?? null,
    anr_admin_contact_id: wo?.anr_admin_contact_id ?? null,
  }

  // ClientPanelValue key → WO key (for dirty tracking + state writes)
  const CLIENT_KEY_MAP: Record<keyof ClientPanelValue, keyof WO> = {
    payment_type: 'payment_status', cod_method: 'cod_method', client_name: 'client',
    artist: 'artist', label: 'label', ordered_by: 'ordered_by', phone: 'phone',
    email: 'email', client_db_id: 'client_id', is_srs: 'is_srs',
    anr_contact_id: 'anr_contact_id', anr_admin_contact_id: 'anr_admin_contact_id',
  }

  function handleClientChange(patch: Partial<ClientPanelValue>) {
    setWo(w => {
      if (!w) return w
      const next: WO = { ...w }
      for (const [k, v] of Object.entries(patch) as [keyof ClientPanelValue, any][]) {
        if (k === 'payment_type') next.payment_status = v === 'billing' ? 'Billing' : 'COD'
        else (next as any)[CLIENT_KEY_MAP[k]] = v
      }
      return next
    })
    setDirtyFields(prev => {
      const n = new Set(prev)
      for (const k of Object.keys(patch) as (keyof ClientPanelValue)[]) n.add(CLIENT_KEY_MAP[k] as string)
      return n
    })
  }

  // ── Seed panel: bulk-append studio_time_rows for a date range ────────────────
  async function handleSeed() {
    if (!woIdRef.current || !seed.start) return
    setSeedBusy(true)
    try {
      const dates = dateRange(seed.start, seed.end || seed.start)
      await seedStudioTimeRows({
        workOrderId: woIdRef.current,
        studio: seed.studio ? toStudioLetter(seed.studio) : '',
        dates,
        fromTime: seed.from,
        toTime: seed.to,
        rateType: seed.rateType,
        rate: seed.rateType === 'hour' ? seed.rate : '',
        rateDaily: seed.rateType === 'day' ? seed.rate : '',
        engRate: seed.engOn && seed.engRate ? seed.engRate : undefined,
      })
      // If an engineer was named in the seed, set it on the WO (the engineer name
      // is WO-level; the per-row eng rate is seeded above).
      if (seed.engOn && seed.engName.trim()) {
        setDirtyFields(prev => new Set(prev).add('engineer'))
        setWo(w => w ? { ...w, engineer: seed.engName.trim() } : w)
      }
      const { data: reloaded } = await supabase.from('studio_time_rows')
        .select('*').eq('work_order_id', woIdRef.current).order('date')
      setStRows((reloaded ?? []).map(normalizeStRow))
      originalStRowsRef.current = (reloaded ?? []).map(normalizeStRow)
      setSeed(s => ({ ...s, start: '', end: '' }))
      setSeedOpen(false)
    } finally {
      setSeedBusy(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={inline
      ? { position: 'static', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }
      : { position: 'fixed', top: isMobile ? 0 : 52, left: 0, right: 0, bottom: 0, zIndex: 10010, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#f0f0f0', fontFamily: 'Inter', fontSize: 12 }}>Loading work order…</div>
    </div>
  )

  if (woMissing) return (
    <div style={inline
      ? { position: 'static', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }
      : { position: 'fixed', top: isMobile ? 0 : 52, left: 0, right: 0, bottom: 0, zIndex: 10010, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 360, padding: 24, background: 'var(--surface)', border: '1px solid rgba(240,78,122,0.35)', borderRadius: 12, textAlign: 'center' }}>
        <div style={{ color: '#f04e7a', fontFamily: 'Inter', fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>{woMissing}</div>
        <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '7px 18px', fontFamily: 'Inter', fontSize: 11, cursor: 'pointer' }}>Close</button>
      </div>
    </div>
  )

  if (!wo) return null

  const woId = woIdRef.current
  const isCompleted = wo.status === 'completed'
  // Tour/Tech/Open-Hours → render the simplified "block" view (title + times only).
  const isBlock = BLOCK_STATUSES.includes(wo.session_status)
  const accent = STUDIO_COLORS[(booking.location || '').toLowerCase()] || 'var(--accent)'
  // Runner-style section card (mobile only) — var(--surface) surface, var(--border) border,
  // radius 12, matching app/runner/[studio]/wo/[id]/page.tsx section cards.
  const mCard: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, boxSizing: 'border-box' }
  const mCardOrange: React.CSSProperties = { background: 'var(--surface)', border: '1px solid rgba(249,115,22,0.35)', borderRadius: 12, padding: 14, boxSizing: 'border-box' }

  return (
    <div
      data-wo-portal=""
      style={inline
        ? { position: 'static', background: 'transparent' }
        : isMobile
        ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10010, background: 'var(--bg)' }
        : { position: 'fixed', top: 52, left: 0, right: 0, bottom: 0, zIndex: 10010, background: 'rgba(0,0,0,0.75)', overflowY: 'auto' }}
      onClick={inline || isMobile ? undefined : e => { if (e.target === e.currentTarget) handleClose() }}
    >
      {isMobile && (
        <style>{`[data-wo-portal] input:not([type="checkbox"]):not([type="radio"]), [data-wo-portal] select, [data-wo-portal] textarea { min-height: 44px; }`}</style>
      )}
      <div
        style={isMobile
          ? { display: 'flex', flexDirection: 'column', height: '100dvh', padding: 0, boxSizing: 'border-box' }
          : { display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minHeight: '100%', padding: '20px 16px', boxSizing: 'border-box' }}
        onClick={inline || isMobile ? undefined : e => { if (e.target === e.currentTarget) { readOnly ? onClose() : handleClose() } }}
      >
      <div
        style={isMobile
          ? { background: 'var(--bg)', border: 'none', borderRadius: 0, width: '100vw', height: '100dvh', maxWidth: 'none', minWidth: 0, margin: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
          : { background: 'var(--surface2)', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 10, width: '100%', maxWidth: 920, minWidth: 780, marginBottom: 20, alignSelf: 'flex-start' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── HEADER ────────────────────────────────────────────────────────── */}
        {isMobile ? (
          /* Mobile: matches the Runner Hub WO header (back arrow + title + sub) */
          <div style={{ background: 'var(--surface)', borderBottom: `3px solid ${accent}`, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10, flexShrink: 0 }}>
            <button onClick={() => handleCancel()} disabled={saving} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: saving ? 'default' : 'pointer', fontSize: 18, padding: '0 4px', flexShrink: 0 }}>←</button>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'Syne, sans-serif' }}>
                Work Order{wo.wo_number ? ` · ${wo.wo_number}` : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'Inter', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(booking.client_name || wo.client || '—')} · {(booking.start_date || wo.session_date || '')}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', position: 'sticky', top: 0, background: 'var(--surface2)', zIndex: 10, borderRadius: '10px 10px 0 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: '#f0f0f0' }}>
                Work Order{wo.wo_number ? ` · ${wo.wo_number}` : ''}
              </span>
              <StatusBadge status={wo.status} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {woId && (
                <>
                  <button
                    onClick={() => printWithFilename()}
                    style={{ padding: '5px 13px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text2)' }}
                  >
                    Export PDF
                  </button>
                  <button
                    onClick={() => printWithFilename()}
                    style={{ padding: '5px 13px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text2)' }}
                  >
                    Print
                  </button>
                </>
              )}
              {!readOnly && onDelete && (
                confirmDeleteSession ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 4 }}>
                    <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text2)' }}>Delete session?</span>
                    <button onClick={() => { setConfirmDeleteSession(false); onDelete() }} style={{ padding: '5px 12px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', background: 'var(--hot)', border: 'none', color: 'var(--bg)' }}>Delete</button>
                    <button onClick={() => setConfirmDeleteSession(false)} style={{ padding: '5px 12px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text2)' }}>Keep</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteSession(true)}
                    disabled={saving}
                    style={{ padding: '5px 13px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', background: 'transparent', border: '1px solid rgba(240,78,122,0.35)', color: 'var(--hot)' }}
                  >
                    Delete
                  </button>
                )
              )}
              {!readOnly && (
              <>
              <button
                onClick={() => handleCancel()}
                disabled={saving}
                style={{ padding: '5px 13px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text2)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleClose}
                disabled={saving}
                style={{ padding: '5px 13px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', background: saving ? 'rgba(var(--accent-rgb),0.5)' : 'rgba(var(--accent-rgb),0.12)', border: '1px solid rgba(var(--accent-rgb),0.3)', color: saving ? 'var(--text2)' : 'var(--accent)' }}
              >
                {saving ? 'Saving…' : 'Close & Save'}
              </button>
              </>
              )}
              {readOnly && (
                <button
                  onClick={onClose}
                  style={{ padding: '5px 13px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text2)' }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── SCROLLABLE BODY ──────────────────────────────────────────────── */}
        <div style={isMobile
          ? { padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }
          : { padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* SESSION INFO — mobile only, read-only (mirrors the Runner WO card).
              The editable booking-form fields live in the META section below,
              which is hidden on mobile. */}
          {isMobile && (() => {
            const sessionRows: [string, any][] = [
              [wo.payment_status === 'Billing' ? 'Label / A&R' : 'Client',
                wo.payment_status === 'Billing'
                  ? [booking.label || wo.label, booking.client_name || wo.client].filter(Boolean).join(' / ')
                  : (booking.client_name || wo.client)],
              ['Artist', booking.artist || wo.artist],
              ['Engineer', booking.engineer_name || wo.engineer],
              ['Date', booking.start_date || wo.session_date],
              ['Time', [booking.from_time, booking.to_time].filter(Boolean).join(' – ')],
              ['Studio', booking.studio || (wo.studios ?? []).join(', ')],
            ]
            return (
              <div style={mCard}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 10 }}>Session Info</div>
                {sessionRows.filter(([, v]) => v).map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
                    <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'Inter', minWidth: 60 }}>{l}</span>
                    <span style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'Inter' }}>{v}</span>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* BRANDING — hidden on mobile + for block events (letterhead) */}
          <div style={{ textAlign: 'center', paddingBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.07)', display: (isMobile || isBlock) ? 'none' : 'block' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15, color: '#f0f0f0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Paramount Recording Group</div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--text2)', marginTop: 3 }}>Paramount · Encore · Ameraycan · Wilder · Track · Enterprise</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--text2)' }}>Recording Studios (323) 465-4000</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--text2)' }}>Invoice #</span>
                <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: '#f0f0f0', minWidth: 60 }}>{wo.invoice_number || '—'}</span>
              </div>
            </div>
          </div>

          {/* SESSION-LEVEL TOP — status bar + session type + billing + client panel.
              No per-day schedule here (studios / dates / times / rates / engineers
              live ONLY in the Studio Time table — see docs/WO-SPEC.md §3). Hidden on
              mobile; the read-only SESSION INFO card above replaces it there. */}
          <div style={isMobile ? { display: 'none' } : { display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Status bar — colored per booking-form status */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SESSION_STATUSES.map(([val, lbl]) => {
                const on = wo.session_status === val
                const c = SESSION_STATUS_COLORS[val] ?? 'var(--accent)'
                return (
                  <button key={val} type="button" disabled={readOnly}
                    onClick={() => { setDirtyFields(prev => new Set(prev).add('session_status')); setWo(w => w ? { ...w, session_status: val } : w) }}
                    style={{ padding: '7px 18px', borderRadius: 20, fontSize: 11, fontFamily: 'Inter', fontWeight: 700, cursor: readOnly ? 'default' : 'pointer', border: `1px solid ${on ? c : 'var(--border)'}`, background: on ? c : 'transparent', color: on ? (val === 'open_hours' ? '#0d0f14' : '#0d0f14') : 'var(--text2)', transition: 'all 0.15s' }}>
                    {lbl}
                  </button>
                )
              })}
            </div>

            {/* BLOCK view — Tour/Tech/Open-Hours: just a title + dates + times */}
            {isBlock && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'Inter' }}>
                  {SESSION_STATUSES.find(([v]) => v === wo.session_status)?.[1]} block — no work order or billing, just a calendar event.
                </div>
                <div>
                  <div style={{ ...metaLabel, marginBottom: 6 }}>Title</div>
                  <input value={wo.client} onChange={e => { setDirtyFields(prev => new Set(prev).add('client')); setWo(w => w ? { ...w, client: e.target.value } : w) }} placeholder="Name this block" style={inp} />
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...metaLabel, marginBottom: 6 }}>Start date</div>
                    <input type="date" value={blockStart} onChange={e => setBlockStart(e.target.value)} style={inp} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...metaLabel, marginBottom: 6 }}>End date</div>
                    <input type="date" value={blockEnd} onChange={e => setBlockEnd(e.target.value)} style={inp} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...metaLabel, marginBottom: 6 }}>From</div>
                    <TimeInput value={wo.from_time} onChange={v => { setDirtyFields(prev => new Set(prev).add('from_time')); setWo(w => w ? { ...w, from_time: v } : w) }} style={inp} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...metaLabel, marginBottom: 6 }}>To</div>
                    <TimeInput value={wo.to_time} onChange={v => { setDirtyFields(prev => new Set(prev).add('to_time')); setWo(w => w ? { ...w, to_time: v } : w) }} style={inp} />
                  </div>
                </div>
              </div>
            )}

            {/* Two columns: left = session-level card, right = client panel */}
            {!isBlock && (
            <div style={{ display: 'grid', gridTemplateColumns: '0.85fr 1fr', gap: 20, alignItems: 'stretch' }}>

              {/* Left — session type + billing, in a defined panel */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div style={{ ...metaLabel, marginBottom: 8 }}>Session Type</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {SESSION_TYPES.map(([val, lbl]) => {
                      const on = wo.session_type === val
                      return (
                        <button key={val} type="button" disabled={readOnly}
                          onClick={() => { setDirtyFields(prev => new Set(prev).add('session_type')); setWo(w => w ? { ...w, session_type: val } : w) }}
                          style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontFamily: 'Inter', fontWeight: 600, cursor: readOnly ? 'default' : 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'rgba(var(--accent-rgb),0.12)' : 'transparent', color: on ? 'var(--accent)' : 'var(--text2)' }}>
                          {lbl}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <div style={{ ...metaLabel, marginBottom: 6 }}>Invoice #</div>
                  <input value={wo.invoice_number} onChange={e => { setDirtyFields(prev => new Set(prev).add('invoice_number')); setWo(w => w ? { ...w, invoice_number: e.target.value } : w) }} style={{ ...inp, fontFamily: 'DM Mono' }} />
                </div>
                <div>
                  <div style={{ ...metaLabel, marginBottom: 6 }}>PO #</div>
                  <input value={wo.po_number} onChange={e => { setDirtyFields(prev => new Set(prev).add('po_number')); setWo(w => w ? { ...w, po_number: e.target.value } : w) }} style={inp} />
                </div>
                <div>
                  <div style={{ ...metaLabel, marginBottom: 6 }}>Food Budget</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button type="button" onClick={() => { setDirtyFields(prev => new Set(prev).add('food_budget')); setWo(w => w ? { ...w, food_budget: !w.food_budget } : w) }} style={{ padding: '4px 14px', borderRadius: 4, fontSize: 10, fontFamily: 'Inter', cursor: 'pointer', border: `1px solid ${wo.food_budget ? 'var(--accent)' : 'rgba(255,255,255,0.12)'}`, background: wo.food_budget ? 'rgba(var(--accent-rgb),0.12)' : 'transparent', color: wo.food_budget ? 'var(--accent)' : 'var(--text2)' }}>
                      {wo.food_budget ? 'Yes' : 'No'}
                    </button>
                    {wo.food_budget && <input value={wo.food_amount} onChange={e => { setDirtyFields(prev => new Set(prev).add('food_amount')); setWo(w => w ? { ...w, food_amount: e.target.value } : w) }} style={{ ...inp, width: 90 }} />}
                  </div>
                </div>

                {/* Booking notes — internal/ops notes about the booking; never printed */}
                <div data-no-print="" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  <div style={{ ...metaLabel, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    Booking Notes
                    <span style={{ fontSize: 8, fontFamily: 'Inter', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warm)', border: '1px solid var(--warm)', borderRadius: 3, padding: '1px 5px', textTransform: 'uppercase' }}>Internal only</span>
                  </div>
                  <textarea
                    value={wo.booking_notes}
                    disabled={readOnly}
                    onChange={e => { setDirtyFields(prev => new Set(prev).add('booking_notes')); setWo(w => w ? { ...w, booking_notes: e.target.value } : w) }}
                    placeholder="Ops notes about the booking — arrival, payment, past experience… never on the invoice."
                    style={{ ...inp, minHeight: 120, flex: 1, resize: 'vertical', fontFamily: 'Inter', lineHeight: 1.5, padding: '8px 10px' }}
                  />
                </div>
              </div>

              {/* Right — client panel */}
              <ClientPanel value={clientValue} onChange={handleClientChange} readOnly={readOnly} />
            </div>
            )}
          </div>

          {/* Everything below the top is session-only — hidden for block events. */}
          {!isBlock && (<>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }} />

          {/* SEED — bulk-append studio-time rows for a date range (WO-SPEC §6) */}
          {!readOnly && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <button type="button" onClick={() => setSeedOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface2)', border: 'none', cursor: 'pointer', color: 'var(--text2)' }}>
                <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>+ Seed — add multiple days</span>
                <span style={{ fontSize: 10 }}>{seedOpen ? '▲' : '▼'}</span>
              </button>
              {seedOpen && (
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--border)' }}>
                  {/* Note: plain <div> wrappers, NOT <label> — a <label> forwards
                      clicks to its first control, which broke the Day/Hr toggle. */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={metaLabel}>Studio</span>
                      <input value={seed.studio} onChange={e => setSeed(s => ({ ...s, studio: e.target.value }))} style={inp} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={metaLabel}>Start date</span>
                      <input type="date" value={seed.start} onChange={e => setSeed(s => ({ ...s, start: e.target.value }))} style={inp} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={metaLabel}>End date</span>
                      <input type="date" value={seed.end} onChange={e => setSeed(s => ({ ...s, end: e.target.value }))} style={inp} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={metaLabel}>From</span>
                      <TimeInput value={seed.from} onChange={v => setSeed(s => ({ ...s, from: v }))} style={inp} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={metaLabel}>To</span>
                      <TimeInput value={seed.to} onChange={v => setSeed(s => ({ ...s, to: v }))} style={inp} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={metaLabel}>Rate</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                          {(['day', 'hour'] as const).map(rt => (
                            <button key={rt} type="button" onClick={() => setSeed(s => ({ ...s, rateType: rt }))} style={{ padding: '4px 10px', fontSize: 10, fontFamily: 'Inter', fontWeight: 700, border: 'none', cursor: 'pointer', background: seed.rateType === rt ? 'var(--accent)' : 'transparent', color: seed.rateType === rt ? 'var(--bg)' : 'var(--text2)' }}>{rt === 'day' ? 'Day' : 'Hr'}</button>
                          ))}
                        </div>
                        <input value={seed.rate} onChange={e => setSeed(s => ({ ...s, rate: e.target.value }))} style={{ ...inp, width: 64 }} />
                      </div>
                    </div>
                  </div>

                  {/* Engineer — off by default; toggle on to add a name + rate */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={metaLabel}>Engineer</span>
                      <button type="button" onClick={() => setSeed(s => ({ ...s, engOn: !s.engOn }))} style={{ padding: '4px 18px', borderRadius: 4, fontSize: 10, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer', border: `1px solid ${seed.engOn ? 'var(--accent)' : 'var(--border)'}`, background: seed.engOn ? 'rgba(var(--accent-rgb),0.12)' : 'transparent', color: seed.engOn ? 'var(--accent)' : 'var(--text2)' }}>
                        {seed.engOn ? 'Yes' : 'No'}
                      </button>
                    </div>
                    {seed.engOn && (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '0 1 220px' }}>
                          <span style={metaLabel}>Engineer name</span>
                          <input value={seed.engName} onChange={e => setSeed(s => ({ ...s, engName: e.target.value }))} style={inp} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 80 }}>
                          <span style={metaLabel}>Eng rate</span>
                          <input value={seed.engRate} onChange={e => setSeed(s => ({ ...s, engRate: e.target.value }))} style={inp} />
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'Inter' }}>Appends one row per day; dates already in the table are skipped.</span>
                    <button type="button" disabled={seedBusy || !seed.start} onClick={handleSeed} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, border: 'none', cursor: seedBusy || !seed.start ? 'default' : 'pointer', background: seed.start ? 'var(--accent)' : 'rgba(255,255,255,0.08)', color: seed.start ? 'var(--bg)' : 'var(--text3)' }}>
                      {seedBusy ? 'Adding…' : 'Add rows'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STUDIO TIME TABLE — unified per-row Day/Hr toggle */}
          <div style={isMobile ? mCard : undefined}>
            <SectionHeader title="Studio Time" />
            <datalist id="wo-eng-roster">
              {engRoster.map(n => <option key={n} value={n} />)}
            </datalist>
            <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflowX: isMobile ? 'auto' : 'hidden', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
              {/* Header: Studio | Date | Session Info | From | To | Hrs | Type | Rate | OT Hrs | OT Rate | OT Chg | Total | Lock | Del */}
              <div style={{ display: 'grid', gridTemplateColumns: '70px 65px 1fr 66px 66px 40px 52px 76px 50px 70px 68px 76px 40px 24px', background: 'var(--surface2)', borderBottom: '1px solid rgba(255,255,255,0.07)', minWidth: isMobile ? 880 : undefined }}>
                {['Studio', 'Date', 'Session Info', 'From', 'To', 'Hrs', 'Type', 'Rate', 'OT Hrs', 'OT Rate', 'OT Chg', 'Total', '', ''].map((h, i) => <div key={i} style={thS}>{h}</div>)}
              </div>
              <div data-st-scroll="" style={{ maxHeight: 420, overflowY: 'auto', minWidth: isMobile ? 880 : undefined }}>
                {stRows.map(r => {
                  const isEngOnly = r.studio === ''
                  const isDayRow = r.row_rate_type === 'day'
                  const engName = wo?.engineer || liveForm?.engineer_name || booking.engineer_name || ''
                  const engRateDisplay = r.eng_rate || liveForm?.engineer_rate || (booking as any).engineer_rate || ''
                  const engRateNum = parseFloat((engRateDisplay ?? '').replace(/[^0-9.]/g, '')) || 0
                  const engHrs = calcHours(r.eng_from_time || r.from_time, r.eng_to_time || r.to_time)
                  const engCharge = engHrs != null && engHrs > 0 && engRateNum > 0 ? parseFloat((engHrs * engRateNum).toFixed(2)) : null
                  const rowTotal = (r.charge ?? 0) + (r.ot_charge ?? 0)
                  const toggleStyle = (active: boolean): React.CSSProperties => ({
                    fontSize: 9, fontFamily: 'Inter', fontWeight: 700, padding: '2px 5px',
                    borderRadius: 3, border: 'none', cursor: 'pointer',
                    background: active ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                    color: active ? 'var(--bg)' : 'var(--text2)',
                  })
                  const rowHrs = r.total_hours ?? calcHours(r.from_time, r.to_time)
                  const otHrsNum = parseFloat(r.ot_hours ?? '0') || 0
                  return (
                    <div key={r.id}>
                      {!isEngOnly && <div style={{ display: 'grid', gridTemplateColumns: '70px 65px 1fr 66px 66px 40px 52px 76px 50px 70px 68px 76px 40px 24px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: r.admin_locked ? 'rgba(20,184,166,0.04)' : undefined }}>
                        {/* Studio */}
                        <div style={cellS}>
                          <select
                            value={`${r.location || booking.location || ''}|${toStudioLetter(r.studio)}`}
                            onChange={e => {
                              const [loc, room] = e.target.value.split('|')
                              updateStRow(r.id, { location: loc === (booking.location || '') ? '' : loc, studio: room })
                            }}
                            style={{ ...inp, padding: '2px 2px', fontSize: 10 }}
                          >
                            {!STUDIO_LOCATIONS.some(l => l.name === (r.location || booking.location)) && (
                              <option value={`${r.location || booking.location || ''}|${toStudioLetter(r.studio)}`}>{toStudioLetter(r.studio) || '—'}</option>
                            )}
                            {STUDIO_LOCATIONS.map(l => l.rooms.map(room => {
                              const letter = toStudioLetter(room)
                              return <option key={`${l.name}|${letter}`} value={`${l.name}|${letter}`}>{STUDIO_SHORT[l.name] ?? l.name} {letter}</option>
                            }))}
                          </select>
                        </div>
                        {/* Date — transparent overlay opens native picker, auto-sorts on pick */}
                        <div key={r.id + '-date'} style={{ ...cellS, color: 'var(--text2)', fontSize: 10, position: 'relative', cursor: 'pointer' }}>
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
                        {/* Session Info — click to edit via popover */}
                        <div
                          data-si-cell=""
                          style={{ ...cellS, cursor: 'pointer', overflow: 'hidden' }}
                          onClick={e => {
                            e.stopPropagation()
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                            setSiPopoverRowId(r.id)
                            setSiPopoverText(r.session_info || '')
                            setSiPopoverPos({ top: rect.bottom + 4, left: rect.left })
                          }}
                        >
                          <span data-si-input="" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', color: r.session_info ? '#f0f0f0' : 'var(--text3)', fontSize: 11 }}>
                            {r.session_info || '—'}
                          </span>
                          {r.session_info && <span data-si-print="" style={{ display: 'none' }}>{r.session_info}</span>}
                        </div>
                        {siPopoverRowId === r.id && siPopoverPos && (
                          <>
                            <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setSiPopoverRowId(null)} />
                            <div style={{ position: 'fixed', top: siPopoverPos.top, left: siPopoverPos.left, width: 280, zIndex: 200, background: 'var(--surface2)', border: '1px solid var(--accent)', borderRadius: 8, padding: 12 }} onClick={e => e.stopPropagation()}>
                              <textarea
                                value={siPopoverText}
                                onChange={e => setSiPopoverText(e.target.value)}
                                autoFocus
                                rows={4}
                                style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'vertical', color: '#f0f0f0', fontFamily: 'Inter', fontSize: 11, lineHeight: 1.5, marginBottom: 8, boxSizing: 'border-box' }}
                                placeholder="Session notes…"
                              />
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => { updateStRow(r.id, { session_info: siPopoverText }); setSiPopoverRowId(null) }} style={{ flex: 1, background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 5, padding: '5px 0', fontFamily: 'Syne', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>Save</button>
                                <button onClick={() => setSiPopoverRowId(null)} style={{ flex: 1, background: 'rgba(255,255,255,0.07)', color: 'var(--text2)', border: 'none', borderRadius: 5, padding: '5px 0', fontFamily: 'Syne', fontSize: 11, cursor: 'pointer' }}>Close</button>
                              </div>
                            </div>
                          </>
                        )}
                        {/* From / To */}
                        <div style={cellS}><TimeInput value={r.from_time} onChange={v => updateStRow(r.id, { from_time: v })} style={inp} /></div>
                        <div style={cellS}><TimeInput value={r.to_time} onChange={v => updateStRow(r.id, { to_time: v })} style={inp} /></div>
                        {/* Total Hrs — always auto-calc */}
                        <div style={{ ...cellS, color: 'var(--text2)', fontSize: 10 }}>{rowHrs != null ? `${rowHrs}h` : '—'}</div>
                        {/* Rate Type toggle */}
                        <div style={{ ...cellS, gap: 2, padding: '3px 4px' }}>
                          <button style={toggleStyle(isDayRow)} onClick={() => !isDayRow && toggleRowRateType(r.id)}>Day</button>
                          <button style={toggleStyle(!isDayRow)} onClick={() => isDayRow && toggleRowRateType(r.id)}>Hr</button>
                        </div>
                        {/* Rate */}
                        <div style={cellS}>
                          {isDayRow
                            ? <input value={r.rate_daily} onChange={e => updateStRow(r.id, { rate_daily: e.target.value })} style={inp} placeholder="$0/day" />
                            : <input value={r.rate} onChange={e => updateStRow(r.id, { rate: e.target.value })} style={inp} placeholder="$0/hr" />
                          }
                        </div>
                        {/* OT Hrs — day: auto display; hourly: editable */}
                        <div style={cellS}>
                          {isDayRow
                            ? <span style={{ fontSize: 10, color: 'var(--text2)' }}>{otHrsNum > 0 ? `${otHrsNum}h` : '—'}</span>
                            : <input value={r.ot_hours ?? ''} onChange={e => updateStRow(r.id, { ot_hours: e.target.value })} style={inp} placeholder="0" />
                          }
                        </div>
                        {/* OT Rate — editable (auto-populated but overridable) */}
                        <div style={cellS}>
                          <input value={r.ot_rate ?? ''} onChange={e => updateStRow(r.id, { ot_rate: e.target.value })} style={inp} placeholder="$0" />
                        </div>
                        {/* OT Charge — computed read-only */}
                        <div style={{ ...cellS, color: (r.ot_charge ?? 0) > 0 ? 'var(--accent)' : 'var(--text2)', fontSize: 10 }}>
                          {(r.ot_charge ?? 0) > 0 ? `$${r.ot_charge!.toFixed(2)}` : '—'}
                        </div>
                        {/* Total Charge = charge + OT charge */}
                        <div style={{ ...cellS, color: rowTotal > 0 ? 'var(--accent)' : 'var(--text2)', fontWeight: rowTotal > 0 ? 600 : 400 }}>
                          {rowTotal > 0 ? `$${rowTotal.toFixed(2)}` : '—'}
                        </div>
                        {/* Lock pill — always clickable even when WO is completed */}
                        <div style={{ ...cellS, justifyContent: 'center', padding: '3px 4px', pointerEvents: 'auto' }}>
                          <button
                            type="button"
                            onClick={() => handleToggleLock(r.id, r.admin_locked)}
                            style={{
                              fontSize: 8, fontFamily: 'Inter', fontWeight: 700, padding: '2px 5px',
                              borderRadius: 3, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                              background: r.admin_locked ? 'var(--booked)' : 'rgba(255,255,255,0.06)',
                              color: r.admin_locked ? 'var(--bg)' : 'var(--cold)',
                            }}
                          >{r.admin_locked ? '🔒' : '✓'}</button>
                        </div>
                        {/* Delete row — confirm pops open to the LEFT of the ×, next
                            to the cursor (the × is at the far-right edge). */}
                        <div style={{ ...cellS, justifyContent: 'center', padding: '3px 2px', pointerEvents: 'auto', position: 'relative' }}>
                          {!readOnly && (
                            <>
                              <button type="button" onClick={() => setConfirmDeleteRowId(confirmDeleteRowId === r.id ? null : r.id)} style={{ fontSize: 13, fontFamily: 'Inter', color: confirmDeleteRowId === r.id ? 'var(--hot)' : 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                              {confirmDeleteRowId === r.id && (
                                <>
                                  <div onClick={() => setConfirmDeleteRowId(null)} style={{ position: 'fixed', inset: 0, zIndex: 190 }} />
                                  <div style={{ position: 'absolute', right: '130%', top: '50%', transform: 'translateY(-50%)', zIndex: 191, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', border: '1px solid var(--hot)', borderRadius: 6, padding: '5px 9px', whiteSpace: 'nowrap', boxShadow: '0 6px 20px rgba(0,0,0,0.45)' }}>
                                    <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'Inter' }}>Delete row?</span>
                                    <button type="button" onClick={() => deleteStRow(r.id)} style={{ fontSize: 10, fontFamily: 'Inter', fontWeight: 700, color: 'var(--bg)', background: 'var(--hot)', border: 'none', borderRadius: 4, cursor: 'pointer', padding: '3px 10px' }}>Delete</button>
                                    <button type="button" onClick={() => setConfirmDeleteRowId(null)} style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text2)', background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 4, cursor: 'pointer', padding: '3px 10px' }}>Cancel</button>
                                  </div>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>}
                      {!isEngOnly && pendingLockedEdits[r.id] && (
                        <div style={{ padding: '5px 12px', background: 'rgba(20,184,166,0.08)', borderBottom: '1px solid rgba(20,184,166,0.2)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: 'Inter', color: 'var(--booked)' }}>
                          <span>Editing a locked row —</span>
                          <button
                            type="button"
                            onClick={() => { handleToggleLock(r.id, true); setPendingLockedEdits(p => { const n = { ...p }; delete n[r.id]; return n }) }}
                            style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid var(--booked)', background: 'rgba(20,184,166,0.15)', color: 'var(--booked)', fontSize: 9, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer' }}
                          >Update</button>
                          <button
                            type="button"
                            onClick={() => { const orig = pendingLockedEdits[r.id]; setStRows(prev => prev.map(row => row.id === r.id ? orig : row)); setPendingLockedEdits(p => { const n = { ...p }; delete n[r.id]; return n }) }}
                            style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--text2)', fontSize: 9, fontFamily: 'Inter', cursor: 'pointer' }}
                          >Revert</button>
                        </div>
                      )}
                      {(r.studio === '' || !!wo?.engineer || !!r.eng_rate) && r.eng_visible !== false && (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '70px 65px 1fr 66px 66px 40px 52px 76px 50px 70px 68px 76px 40px 24px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(var(--accent-rgb),0.03)' }}>
                            <div style={{ ...cellS, color: 'var(--text2)', fontSize: 9, fontStyle: 'italic' }}>Eng</div>
                            {/* Date picker — uses r.date for eng-only rows; shared with main row for studio rows */}
                            <div key={r.id + '-eng-date'} style={{ ...cellS, color: 'var(--text2)', fontSize: 10, position: 'relative', cursor: isEngOnly ? 'pointer' : 'default' }}>
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
                            <div style={{ ...cellS, padding: '2px 3px' }}>
                              <input
                                list="wo-eng-roster"
                                value={r.eng_name || ''}
                                onChange={e => updateStRow(r.id, { eng_name: e.target.value })}
                                placeholder={engName || 'Engineer…'}
                                style={{ ...inp, fontSize: 10, color: 'var(--accent)' }}
                              />
                            </div>
                            <div style={cellS}><TimeInput value={r.eng_from_time || r.from_time} onChange={v => updateStRow(r.id, { eng_from_time: v })} style={inp} /></div>
                            <div style={cellS}><TimeInput value={r.eng_to_time || r.to_time} onChange={v => updateStRow(r.id, { eng_to_time: v })} style={inp} /></div>
                            <div style={{ ...cellS, color: 'var(--text2)', fontSize: 10 }}>{engHrs != null ? `${engHrs}h` : '—'}</div>
                            <div style={cellS} />
                            <div style={cellS}>
                              <input value={r.eng_rate || engRateDisplay} onChange={e => updateStRow(r.id, { eng_rate: e.target.value })} style={{ ...inp, width: 64 }} />
                            </div>
                            <div style={cellS} />
                            <div style={cellS} />
                            <div style={cellS} />
                            <div style={{ ...cellS, color: engCharge != null ? 'var(--accent)' : 'var(--text2)', fontWeight: engCharge != null ? 600 : 400 }}>
                              {engCharge != null ? `$${engCharge.toFixed(2)}` : '—'}
                            </div>
                            {/* Eng lock */}
                            <div style={{ ...cellS, justifyContent: 'center', padding: '3px 4px', pointerEvents: 'auto' }}>
                              <button type="button" onClick={() => handleToggleLock(r.id, r.admin_locked)} style={{ fontSize: 8, fontFamily: 'Inter', fontWeight: 700, padding: '2px 5px', borderRadius: 3, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', background: r.admin_locked ? 'var(--booked)' : 'rgba(255,255,255,0.06)', color: r.admin_locked ? 'var(--bg)' : 'var(--cold)' }}>{r.admin_locked ? '🔒' : '✓'}</button>
                            </div>
                            {/* Eng delete × */}
                            <div style={{ ...cellS, justifyContent: 'center', padding: '3px 2px', pointerEvents: 'auto' }}>
                              {!readOnly && <button type="button" onClick={() => setConfirmClearEngId(r.id)} style={{ fontSize: 13, fontFamily: 'Inter', color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>}
                            </div>
                          </div>
                          {confirmClearEngId === r.id && (
                            <div style={{ padding: '5px 12px', background: 'rgba(249,115,22,0.08)', borderBottom: '1px solid rgba(249,115,22,0.2)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: 'Inter', color: 'var(--warm)' }}>
                              <span>Delete engineer row?</span>
                              <button type="button" onClick={() => isEngOnly ? deleteStRow(r.id) : clearEngRow(r.id)} style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid var(--warm)', background: 'rgba(249,115,22,0.15)', color: 'var(--warm)', fontSize: 9, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer' }}>Y</button>
                              <button type="button" onClick={() => setConfirmClearEngId(null)} style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'var(--text2)', fontSize: 9, fontFamily: 'Inter', cursor: 'pointer' }}>N</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--surface2)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {!readOnly ? (
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <button type="button" onClick={addStRow} style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add Studio Time</button>
                  <button type="button" onClick={addEngRow} style={{ fontSize: 10, fontFamily: 'Inter', color: '#c8f04e88', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add Eng</button>
                </div>
                ) : <div />}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                  <span style={{ fontSize: 11, fontFamily: 'Inter', color: '#f0f0f0' }}>Studio: ${stTotal.toFixed(2)}</span>
                  {engTotal > 0 && (
                    <span style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--accent)' }}>Eng: ${engTotal.toFixed(2)}</span>
                  )}
                  {engTotal > 0 && (
                    <span style={{ fontSize: 11, fontFamily: 'Inter', color: '#f0f0f0', fontWeight: 700 }}>Total: ${(stTotal + engTotal).toFixed(2)}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* EQUIPMENT CONDITION — excluded from PDF via data-no-print */}
          <div data-no-print="" style={isMobile ? mCard : undefined}>
            <SectionHeader title="Equipment Condition" />
            {/* hidden file input for note photos */}
            <input ref={equipNoteFileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadEquipNotePhoto(f) }} />
            <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflowX: 'auto' }}>
              <div style={{ minWidth: `${130 + Math.max(sessionDates.length, 1) * 90}px` }}>
                {/* Header — equipment name cell sticky */}
                <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${Math.max(sessionDates.length, 1)}, 90px)`, background: 'var(--surface2)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ ...thS, position: 'sticky', left: 0, background: 'var(--surface2)', zIndex: 1 }}>Equipment</div>
                  {sessionDates.length > 0
                    ? sessionDates.map(d => <div key={d} style={thS}>{fmtDate(d)}</div>)
                    : <div style={thS}>—</div>}
                </div>
                {/* Equipment rows */}
                {EQUIPMENT_ITEMS.map(eq => {
                  const openDate = openNoteKey?.startsWith(`${eq}||`) ? openNoteKey.split('||')[1] : null
                  return (
                    <div key={eq}>
                      <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${Math.max(sessionDates.length, 1)}, 90px)`, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ ...cellS, color: '#f0f0f0', fontWeight: 500, position: 'sticky', left: 0, background: 'var(--surface2)', zIndex: 1 }}>{eq}</div>
                        {sessionDates.length > 0
                          ? sessionDates.map(d => {
                              const key = `${eq}||${d}`
                              const row = equipRows.find(r => r.equipment === eq && r.date === d)
                              const cond = row?.condition ?? null
                              const hasNote = !!(equipNotes[key]?.note || (equipNotes[key]?.photo_urls?.length ?? 0) > 0)
                              return (
                                <div key={d} style={{ ...cellS, display: 'flex', gap: 4, alignItems: 'center', borderRight: 'none' }}>
                                  <button type="button" onClick={() => row && toggleEquip(eq, d, 'ok')} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', border: `1px solid ${cond === 'ok' ? 'var(--booked)' : 'rgba(255,255,255,0.1)'}`, background: cond === 'ok' ? 'rgba(20,184,166,0.12)' : 'transparent', color: cond === 'ok' ? 'var(--booked)' : 'var(--text2)' }}>OK</button>
                                  <button type="button" onClick={() => row && toggleEquip(eq, d, 'not_ok')} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', border: `1px solid ${cond === 'not_ok' ? 'var(--hot)' : 'rgba(255,255,255,0.1)'}`, background: cond === 'not_ok' ? 'rgba(239,68,68,0.12)' : 'transparent', color: cond === 'not_ok' ? 'var(--hot)' : 'var(--text2)' }}>✗</button>
                                  {cond === 'not_ok' && hasNote && (
                                    <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--warm)', display: 'inline-block', flexShrink: 0 }} />
                                  )}
                                </div>
                              )
                            })
                          : <div style={{ ...cellS, color: 'var(--text3)', borderRight: 'none' }}>—</div>}
                      </div>
                      {/* Note area — inline below the equipment row when a Not OK cell is open */}
                      {openDate && (
                        <div style={{ padding: '8px 12px', background: 'var(--surface2)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--warm)', marginBottom: 6 }}>
                            {eq} — {openDate}
                          </div>
                          <textarea
                            value={equipNotes[`${eq}||${openDate}`]?.note ?? ''}
                            onChange={e => {
                              const k = `${eq}||${openDate}`
                              setEquipNotes(prev => ({ ...prev, [k]: { ...(prev[k] ?? { id: '', photo_urls: [] }), note: e.target.value } }))
                            }}
                            onBlur={e => upsertEquipNote(`${eq}||${openDate}`, eq, openDate, { note: e.target.value })}
                            placeholder="Note about this issue…"
                            style={{ width: '100%', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: '#f0f0f0', fontFamily: 'Inter', fontSize: 10, padding: '5px 7px', resize: 'none', outline: 'none', boxSizing: 'border-box', minHeight: 56 }}
                          />
                          {(equipNotes[`${eq}||${openDate}`]?.photo_urls?.length ?? 0) > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                              {equipNotes[`${eq}||${openDate}`].photo_urls.map((url, i) => (
                                <SignedImage key={i} path={url} link alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)', display: 'block' }} />
                              ))}
                            </div>
                          )}
                          {!readOnly && (
                          <button
                            type="button"
                            disabled={noteUploading}
                            onClick={() => { pendingNoteKey.current = { key: `${eq}||${openDate}`, equipment: eq, date: openDate }; equipNoteFileRef.current?.click() }}
                            style={{ marginTop: 6, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, color: noteUploading ? 'var(--text3)' : 'var(--text2)', background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, cursor: noteUploading ? 'not-allowed' : 'pointer', padding: '3px 10px' }}
                          >
                            {noteUploading ? 'Uploading…' : '+ Photo'}
                          </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* RENTALS */}
          <div style={isMobile ? mCard : undefined}>
            <SectionHeader title="Rentals" />
            <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflowX: isMobile ? 'auto' : 'hidden', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 120px 110px 65px 80px 24px', background: 'var(--surface2)', borderBottom: '1px solid rgba(255,255,255,0.07)', minWidth: isMobile ? 540 : undefined }}>
                {['Qty', 'Item', 'Supplier', "Date(s) Used", 'Rate', 'Charge', ''].map(h => <div key={h} style={thS}>{h}</div>)}
              </div>
              {rentRows.map((r, idx) => (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 120px 110px 65px 80px 24px', borderBottom: idx < rentRows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', minWidth: isMobile ? 540 : undefined }}>
                  <div style={cellS}><input value={r.qty} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, qty: e.target.value } : x))} style={inp} /></div>
                  <div style={cellS}><input value={r.item} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, item: e.target.value } : x))} style={inp} /></div>
                  <div style={cellS}><input value={r.supplier} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, supplier: e.target.value } : x))} style={inp} /></div>
                  <div style={cellS}><input value={r.dates_used} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, dates_used: e.target.value } : x))} style={inp} /></div>
                  <div style={cellS}><input value={r.rate} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, rate: e.target.value } : x))} style={inp} /></div>
                  <div style={cellS}><input value={r.charge} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, charge: e.target.value } : x))} placeholder="$0.00" style={inp} /></div>
                  <div style={{ ...cellS, borderRight: 'none', padding: '6px 4px' }}>
                    {!readOnly && <button type="button" onClick={() => setRentRows(p => p.filter(x => x.id !== r.id))} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--surface2)', borderTop: '1px solid rgba(255,255,255,0.06)', minWidth: isMobile ? 540 : undefined }}>
                {!readOnly ? <button type="button" onClick={() => setRentRows(p => [...p, { id: crypto.randomUUID(), qty: '', item: '', supplier: '', dates_used: '', rate: '', charge: '' }])} style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add row</button> : <span />}
                <span style={{ fontSize: 11, fontFamily: 'Inter', color: '#f0f0f0', fontWeight: 700 }}>Total: ${rentTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', display: isMobile ? 'none' : 'block' }} />

          {/* BOTTOM TWO COLUMNS */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 20 : 28 }}>

            {/* Left — Notes + Legal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, ...(isMobile ? mCard : {}) }}>
              <div>
                <SectionHeader title="Session Notes" />
                <textarea value={wo.session_notes} onChange={e => setWo(w => w ? { ...w, session_notes: e.target.value } : w)}
                  style={{ width: '100%', minHeight: 90, background: 'var(--surface2)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 5, color: '#f0f0f0', fontFamily: 'Inter', fontSize: 11, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }} />
              </div>
              {wo.payment_status === 'COD' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 9, fontFamily: 'Inter', color: 'var(--text3)', lineHeight: 1.8, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 5, border: '1px solid rgba(255,255,255,0.05)' }}>
                    By signing below, I acknowledge that I am authorized to approve charges for this session. I accept responsibility for all associated costs and understand that payment is due in full at the time of service unless otherwise agreed. I also acknowledge that Paramount Recording is not responsible for any media, personal items, or equipment left behind.
                    <br /><br />
                    <em>No Tapes, CDs, DVDs, Thumb Drives, Computer Drives or other Recording Media will be released until payment in full is received.</em>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center' }}>
                    <div style={metaLabel}>Date</div>
                    <span style={{ fontSize: 11, fontFamily: 'Inter', color: '#f0f0f0' }}>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center' }}>
                    <div style={metaLabel}>Print Name</div>
                    <input value={wo.print_name} onChange={e => setWo(w => w ? { ...w, print_name: e.target.value } : w)} style={{ ...inp, borderBottom: '1px solid rgba(255,255,255,0.2)' }} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={metaLabel}>Signature</div>
                      {!readOnly && <button type="button" onClick={clearAdminSignature} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '2px 8px', color: 'var(--text2)', fontSize: 10, cursor: 'pointer', fontFamily: 'Inter' }}>Clear</button>}
                    </div>
                    {!readOnly && (
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
                      style={{ width: '100%', height: 100, background: 'var(--bg)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', display: 'block', touchAction: 'none', cursor: 'crosshair' }}
                    />
                    )}
                    {wo.signature_data && <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'Inter', marginTop: 4 }}>Signature captured ✓</div>}
                  </div>
                </div>
              )}
            </div>

            {/* Right — Payments + Totals */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, ...(isMobile ? mCard : {}) }}>
              <div>
                <SectionHeader title="Payments" />
                <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
                  {payRows.map((p, idx) => {
                    const needsLast4 = p.payment_type === 'Credit Card' || p.payment_type === 'Debit Card'
                    return (
                      <div key={p.id} style={{ display: 'grid', gridTemplateColumns: needsLast4 ? '130px 80px 1fr 70px 24px' : '130px 80px 1fr 24px', borderBottom: idx < payRows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', alignItems: 'center' }}>
                        <div style={cellS}>
                          <select value={p.payment_type} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, payment_type: e.target.value, last_four: '' } : x))} style={{ ...inp, background: 'transparent', cursor: 'pointer' }}>
                            <option value="">— type —</option>
                            {['Cash', 'Zelle', 'Credit Card', 'Debit Card', 'Check', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div style={cellS}><input value={p.amount} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, amount: e.target.value } : x))} onBlur={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, amount: formatCurrency(e.target.value) } : x))} placeholder="0.00" style={inp} /></div>
                        <div style={cellS}><input value={p.memo} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, memo: e.target.value } : x))} placeholder="memo" style={inp} /></div>
                        {needsLast4 && (
                          <div style={cellS}><input value={p.last_four} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, last_four: e.target.value.replace(/\D/g, '').slice(0, 4) } : x))} placeholder="last 4" maxLength={4} style={inp} /></div>
                        )}
                        <div style={{ ...cellS, borderRight: 'none', padding: '6px 4px' }}>
                          {!readOnly && <button type="button" onClick={() => setPayRows(p2 => p2.filter(x => x.id !== p.id))} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>}
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ padding: '7px 10px' }}>
                    {!readOnly && <button type="button" onClick={() => setPayRows(p => [...p, { id: crypto.randomUUID(), payment_type: '', amount: '', memo: '', last_four: '' }])} style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add payment</button>}
                  </div>
                </div>
              </div>
              {/* Totals block */}
              <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
                {[
                  { label: 'Studio Total', value: stTotal, color: '#f0f0f0', bold: false },
                  ...(engTotal > 0 ? [{ label: 'Eng Total', value: engTotal, color: 'var(--accent)', bold: false }] : []),
                  { label: 'Rentals Total', value: rentTotal, color: '#f0f0f0', bold: false },
                  { label: 'Grand Total', value: grandTotal, color: '#f0f0f0', bold: true },
                  { label: 'Total Paid', value: totalPaid, color: 'var(--booked)', bold: false },
                  { label: 'Balance Due', value: balanceDue, color: balanceDue > 0 ? 'var(--hot)' : 'var(--booked)', bold: true },
                ].map(({ label, value, color, bold }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text2)' }}>{label}</span>
                    <span style={{ fontSize: bold ? 13 : 11, fontFamily: 'Inter', color, fontWeight: bold ? 700 : 400 }}>${value.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* NEEDS ATTENTION — internal only, never printed */}
          <div data-no-print="" style={isMobile ? mCardOrange : { borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20 }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 10, color: 'var(--warm)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              Needs Attention / Runner Notes
            </div>
            <textarea
              value={wo.needs_attention_notes}
              onChange={e => setWo(w => w ? { ...w, needs_attention_notes: e.target.value } : w)}
              placeholder="Internal notes only — never appears on the PDF export…"
              style={{ width: '100%', minHeight: 80, background: 'var(--surface2)', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 5, color: '#f0f0f0', fontFamily: 'Inter', fontSize: 11, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
            />
            {wo.needs_attention_photos?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {wo.needs_attention_photos.map((url, i) => (
                  <SignedImage key={i} path={url} link linkStyle={{ display: 'block', flexShrink: 0 }} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '2px solid rgba(249,115,22,0.4)', display: 'block' }} />
                ))}
              </div>
            )}
          </div>

          {/* COMPLETE WO — mobile secondary action (the footer is Cancel/Save only
              on mobile; the footer Complete button is hidden there). */}
          {isMobile && !readOnly && (
            <button
              onClick={handleComplete}
              disabled={completing}
              style={{ width: '100%', minHeight: 48, borderRadius: 12, padding: '13px 0', fontFamily: 'Syne', fontWeight: 700, fontSize: 13, letterSpacing: '0.02em', textTransform: 'uppercase', cursor: completing ? 'default' : 'pointer', background: isCompleted ? 'rgba(255,255,255,0.06)' : completing ? 'rgba(20,184,166,0.5)' : 'var(--booked)', border: isCompleted ? '1px solid var(--border)' : 'none', color: isCompleted ? 'var(--text2)' : 'var(--bg)', opacity: completing ? 0.7 : 1 }}
            >
              {completing ? (isCompleted ? 'Re-opening…' : 'Completing…') : isCompleted ? 'Re-open WO' : 'Complete WO'}
            </button>
          )}
          </>)}

        </div>{/* end body */}

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: isMobile ? 'stretch' : 'flex-end', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? 8 : 10, padding: isMobile ? '12px 16px calc(12px + env(safe-area-inset-bottom)) 16px' : '14px 20px', borderTop: isMobile ? '1px solid var(--border)' : '1px solid rgba(255,255,255,0.07)', flexShrink: 0, background: isMobile ? 'var(--bg)' : 'var(--surface2)' }}>
          <button onClick={() => printWithFilename()} style={{ padding: '7px 16px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text2)', ...(isMobile ? { display: 'none' } : {}) }}>
            Export PDF
          </button>
          {!readOnly && (
          <>
          <button onClick={() => handleCancel()} disabled={saving} style={{ padding: '7px 16px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text2)', ...(isMobile ? { flex: '1 1 0', minHeight: 48, fontSize: 13, borderRadius: 12, padding: '13px 0', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', letterSpacing: '0.02em' } : {}) }}>
            Cancel
          </button>
          <button
            onClick={handleComplete}
            disabled={completing}
            style={{ padding: '7px 18px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: completing ? 'default' : 'pointer', background: isCompleted ? 'rgba(255,255,255,0.08)' : completing ? 'rgba(20,184,166,0.5)' : 'var(--booked)', border: isCompleted ? '1px solid rgba(255,255,255,0.12)' : 'none', color: isCompleted ? 'var(--text2)' : 'var(--bg)', opacity: completing ? 0.7 : 1, ...(isMobile ? { display: 'none' } : {}) }}
          >
            {completing ? (isCompleted ? 'Re-opening…' : 'Completing…') : isCompleted ? 'Re-open WO' : 'Complete WO'}
          </button>
          <button onClick={handleClose} disabled={saving} style={{ padding: '7px 22px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', background: saving ? 'rgba(var(--accent-rgb),0.5)' : 'var(--accent)', border: 'none', color: 'var(--bg)', opacity: saving ? 0.7 : 1, ...(isMobile ? { flex: '2 1 0', minHeight: 48, fontSize: 13, fontWeight: 800, borderRadius: 12, padding: '13px 0', letterSpacing: '0.02em' } : {}) }}>
            {saving ? 'Saving…' : 'Close & Save'}
          </button>
          </>
          )}
          {readOnly && (
            <button onClick={onClose} style={{ padding: '7px 22px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text2)', ...(isMobile ? { flex: '1 1 0', minHeight: 48, fontSize: 13, borderRadius: 12, padding: '13px 0', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', letterSpacing: '0.02em' } : {}) }}>
              Close
            </button>
          )}
        </div>

      </div>
      </div>
    </div>
  )
}
