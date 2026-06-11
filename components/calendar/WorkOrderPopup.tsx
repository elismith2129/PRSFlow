'use client'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import TimeInput from '@/components/shared/TimeInput'

// ─── Local types (editable UI state, strings for all inputs) ─────────────────

type WO = {
  id: string
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
  session_notes: string
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

// ─── Constants ────────────────────────────────────────────────────────────────

const STUDIO_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'X']
const EQUIPMENT_ITEMS = ['Speakers', 'Microphone', 'Console']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLocalToday(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
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
  if (diff <= 0) diff += 24 * 60  // overnight session or same time → wrap to next day
  if (diff >= 24 * 60) return null  // exact 24h means same start/end time, skip
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

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// "Studio A" → "A", "Studio X" → "X", "North" → "North"
function toStudioLetter(s: string): string {
  const m = s.match(/Studio\s+([A-Z])/i)
  return m ? m[1].toUpperCase() : s.trim()
}

function normalizeWO(d: any): WO {
  return {
    id: d.id,
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
    session_notes: d.session_notes ?? '',
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

type EquipNote = { id: string; note: string; photo_urls: string[] }

// ─── Component ────────────────────────────────────────────────────────────────

// Shared fields that sync between booking form and WO
export type WOFormSync = {
  client_name: string; artist: string; label: string; ordered_by: string
  po: string; phone: string; email: string; from_time: string; to_time: string
  producer: string; engineer_name: string; assistant_name: string
  payment_type: string; food_budget: boolean; food_amount: string
  invoice_num: string; start_date: string; end_date: string; studio: string; location: string
  rate: string; rate_daily: string; rate_type?: string
  notes?: string; engineer_status?: string; engineer_rate?: string
}

export function WorkOrderPopup({
  booking,
  liveForm,
  onClose,
  onStatusChange,
  onFormSync,
  onSaved,
}: {
  booking: Booking
  liveForm?: WOFormSync
  onClose: () => void
  onStatusChange?: (status: string) => void
  onFormSync?: (updates: Partial<WOFormSync>) => void
  onSaved?: () => void
}) {
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
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null)
  const [confirmClearEngId, setConfirmClearEngId] = useState<string | null>(null)
  const [pendingLockedEdits, setPendingLockedEdits] = useState<Record<string, StRow>>({})
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set())
  const [equipNotes, setEquipNotes] = useState<Record<string, EquipNote>>({})
  const [openNoteKey, setOpenNoteKey] = useState<string | null>(null)
  const [noteUploading, setNoteUploading] = useState(false)
  const woIdRef = useRef<string | null>(null)
  const [resolvedWoId, setResolvedWoId] = useState<string | null>(null)
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
    }
  }

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
    const { data: rows } = await supabase
      .from('work_orders')
      .select('*')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: false })
      .limit(1)
    const existing = rows?.[0] ?? null

    if (existing) {
      woIdRef.current = existing.id
      setResolvedWoId(existing.id)
      onStatusChange?.(existing.status ?? 'open')
      // Fix studios: if DB has empty array but booking has a studio, backfill from booking
      const rawStudios: string[] = existing.studios ?? []
      const studioLetter = booking.studio ? toStudioLetter(booking.studio) : ''
      const studios = rawStudios.length > 0 ? rawStudios : (studioLetter ? [studioLetter] : [])
      if (rawStudios.length === 0 && studios.length > 0) {
        await supabase.from('work_orders').update({ studios }).eq('id', existing.id)
      }
      const seededExisting = applyLiveForm({ ...normalizeWO(existing), studios })
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
              total_hours: null,
              rate: booking.rate_daily ?? '',
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
              total_hours: null,
              rate: booking.rate_daily ?? '',
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
        setPayRows(pay.map(p => ({ id: p.id, payment_type: p.payment_type ?? '', amount: String(p.amount ?? ''), memo: p.memo ?? '', last_four: p.last_four ?? '' })))
        pay.forEach(p => payIdsInDb.current.add(p.id))
      }
    } else {
      // Create new WO from booking data
      const dates = dateRange(booking.start_date, booking.end_date)
      const studioLetter = booking.studio ? toStudioLetter(booking.studio) : ''
      const woPayload = {
        booking_id: booking.id,
        invoice_number: booking.invoice_num ?? '',
        session_date: booking.start_date,
        studios: studioLetter ? [studioLetter] : [],
        from_time: booking.from_time ?? '',
        to_time: booking.to_time ?? '',
        engineer: booking.engineer_name ?? '',
        second_engineer: booking.assistant_name ?? '',
        producer: booking.producer ?? '',
        payment_status: booking.payment_type === 'billing' ? 'Billing' : 'COD',
        food_budget: booking.food_budget ?? false,
        food_amount: booking.food_amount ? parseFloat(booking.food_amount) : null,
        client: booking.client_name ?? '',
        artist: booking.artist ?? '',
        label: booking.label ?? '',
        ordered_by: booking.ordered_by ?? '',
        po_number: booking.po ?? '',
        phone: booking.phone ?? '',
        email: booking.email ?? '',
        session_notes: booking.notes ?? '',
        status: 'open',
      }
      const { data: created } = await supabase.from('work_orders').insert(woPayload).select('*').single()
      if (!created) { setLoading(false); return }
      woIdRef.current = created.id
      setResolvedWoId(created.id)
      const seededNew = applyLiveForm(normalizeWO(created))
      adminInitialSigRef.current = seededNew.signature_data ?? ''
      setWo(seededNew)

      // Auto-generate studio time rows (one per date)
      const isDay = booking.rate_type === 'day' || (!booking.rate && !!booking.rate_daily)
      const stPayloads = dates.map((d, i) => {
        if (isDay) {
          const dayRateNum = parseFloat((booking.rate_daily ?? '').replace(/[^0-9.]/g, ''))
          return {
            work_order_id: created.id,
            studio: studioLetter || booking.studio || '',
            date: d, session_info: '',
            from_time: booking.from_time ?? '', to_time: booking.to_time ?? '',
            total_hours: null,
            rate: booking.rate_daily ?? '',
            charge: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum : null,
            day_count: 1,
            ot_rate: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum / 10 : null,
            sort_order: i,
          }
        }
        const hrs = calcHours(booking.from_time ?? '', booking.to_time ?? '')
        return {
          work_order_id: created.id,
          studio: studioLetter || booking.studio || '',
          date: d, session_info: '',
          from_time: booking.from_time ?? '', to_time: booking.to_time ?? '',
          total_hours: hrs,
          rate: booking.rate ?? '',
          charge: calcCharge(hrs, booking.rate ?? ''),
          ot_rate: parseFloat((booking.rate ?? '').replace(/[^0-9.]/g, '')) || null,
          sort_order: i,
        }
      })
      const { data: stCreated } = await supabase.from('studio_time_rows').insert(stPayloads).select('*')
      if (stCreated) {
        const createdRows = stCreated.map(normalizeStRow)
        originalStRowsRef.current = createdRows
        setStRows(createdRows)
      }

      // Auto-generate equipment condition rows
      const eqPayloads = dates.flatMap(d =>
        EQUIPMENT_ITEMS.map(eq => ({ work_order_id: created.id, equipment: eq, date: d, condition: null }))
      )
      const { data: eqCreated } = await supabase.from('equipment_condition_rows').insert(eqPayloads).select('*')
      if (eqCreated) setEquipRows(eqCreated as EquipRow[])

      onStatusChange?.('open')
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
      const { data: { publicUrl } } = supabase.storage.from('checklist-photos').getPublicUrl(data.path)
      const currentPhotos = equipNotes[pending.key]?.photo_urls ?? []
      await upsertEquipNote(pending.key, pending.equipment, pending.date, { photo_urls: [...currentPhotos, publicUrl] })
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

  // ── Save + close ──────────────────────────────────────────────────────────

  async function handleClose() {
    if (!wo || !woIdRef.current) { onClose(); return }
    setSaving(true)
    const id = woIdRef.current

    await supabase.from('work_orders').update({
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
      print_name: wo.print_name || null,
      signature_data: wo.signature_data || null,
      needs_attention_notes: wo.needs_attention_notes || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    await supabase.from('bookings').update({
      from_time: stRows[0]?.from_time || null,
      to_time: stRows[0]?.to_time || null,
      client_name: wo.client || null,
      engineer_name: wo.engineer || null,
      assistant_name: wo.second_engineer || null,
      producer: wo.producer || null,
      phone: wo.phone || null,
      email: wo.email || null,
      notes: wo.session_notes || null,
      invoice_num: wo.invoice_number || null,
      ordered_by: wo.ordered_by || null,
      payment_type: wo.payment_status === 'Billing' ? 'billing' : 'COD',
    }).eq('id', booking.id)

    // Save studio time rows — insert new rows, update existing
    const originalStIds = new Set(originalStRowsRef.current.map(r => r.id))
    await Promise.all(stRows.map(r => {
      const payload = {
        studio: r.studio, date: r.date, session_info: r.session_info,
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
    }))

    // Upsert rental rows that have content
    const rentToSave = rentRows.filter(r => r.item || r.charge)
    await Promise.all(rentToSave.map(r => {
      const payload = { id: r.id, work_order_id: id, qty: parseInt(r.qty) || null, item: r.item || null, supplier: r.supplier || null, dates_used: r.dates_used || null, rate: r.rate || null, charge: parseFloat(r.charge) || null }
      return rentIdsInDb.current.has(r.id)
        ? supabase.from('rental_rows').update(payload).eq('id', r.id)
        : supabase.from('rental_rows').insert(payload)
    }))

    // Upsert payment rows that have content
    const payToSave = payRows.filter(p => p.payment_type || p.amount)
    await Promise.all(payToSave.map(p => {
      const payload = { id: p.id, work_order_id: id, payment_type: p.payment_type || null, amount: parseFloat(p.amount) || null, memo: p.memo || null, last_four: p.last_four || null }
      return payIdsInDb.current.has(p.id)
        ? supabase.from('payment_rows').update(payload).eq('id', p.id)
        : supabase.from('payment_rows').insert(payload)
    }))

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
  const totalPaid = payRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const balanceDue = grandTotal - totalPaid
  const sessionDates = Array.from(new Set(stRows.map(r => r.date).filter(Boolean))).sort()

  // ── Styles ────────────────────────────────────────────────────────────────

  const inp: React.CSSProperties = {
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
  function shortDate(d: string) {
    if (!d) return '—'
    const parts = d.split('-')
    if (parts.length < 3) return d
    return `${parseInt(parts[1], 10)}-${parseInt(parts[2], 10)}`
  }
  const sectionTitle: React.CSSProperties = {
    fontFamily: 'Syne', fontWeight: 700, fontSize: 10, color: '#8a8fa0',
    letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10,
  }
  const metaLabel: React.CSSProperties = {
    fontSize: 9, fontFamily: 'Syne', fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a8fa0',
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 10010, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#f0f0f0', fontFamily: 'DM Mono', fontSize: 12 }}>Loading work order…</div>
    </div>,
    document.body
  )

  if (!wo) return null

  const woId = woIdRef.current
  const isCompleted = wo.status === 'completed'

  return createPortal(
    <div
      data-wo-portal=""
      style={{ position: 'fixed', inset: 0, zIndex: 10010, background: 'rgba(0,0,0,0.75)', overflowY: 'auto' }}
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minHeight: '100%', padding: '20px 16px', boxSizing: 'border-box' }}
        onClick={e => { if (e.target === e.currentTarget) handleClose() }}
      >
      <div
        style={{ background: '#13161d', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 10, width: '100%', maxWidth: 920, minWidth: 780, marginBottom: 20, alignSelf: 'flex-start' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── STICKY HEADER ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', position: 'sticky', top: 0, background: '#13161d', zIndex: 10, borderRadius: '10px 10px 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: '#f0f0f0' }}>
              Work Order{wo.invoice_number ? ` — #${wo.invoice_number}` : ''}
            </span>
            <span style={{
              fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 10,
              background: wo.status === 'completed' ? 'rgba(20,184,166,0.15)' : 'rgba(138,143,160,0.12)',
              color: wo.status === 'completed' ? '#14B8A6' : '#8a8fa0',
            }}>{wo.status}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {woId && (
              <>
                <button
                  onClick={() => printWithFilename()}
                  style={{ padding: '5px 13px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#8a8fa0' }}
                >
                  Export PDF
                </button>
                <button
                  onClick={() => printWithFilename()}
                  style={{ padding: '5px 13px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#8a8fa0' }}
                >
                  Print
                </button>
              </>
            )}
            <button
              onClick={() => handleCancel()}
              disabled={saving}
              style={{ padding: '5px 13px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#8a8fa0' }}
            >
              Cancel
            </button>
            <button
              onClick={handleClose}
              disabled={saving}
              style={{ padding: '5px 13px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', background: saving ? 'rgba(200,240,78,0.5)' : 'rgba(200,240,78,0.12)', border: '1px solid rgba(200,240,78,0.3)', color: saving ? '#8a8fa0' : '#c8f04e' }}
            >
              {saving ? 'Saving…' : 'Close & Save'}
            </button>
          </div>
        </div>

        {/* ── SCROLLABLE BODY ──────────────────────────────────────────────── */}
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* BRANDING */}
          <div style={{ textAlign: 'center', paddingBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15, color: '#f0f0f0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Paramount Recording Group</div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: '#8a8fa0', marginTop: 3 }}>Paramount · Encore · Ameraycan · Wilder · Track · Enterprise</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: '#8a8fa0' }}>Recording Studios (323) 465-4000</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: '#8a8fa0' }}>Invoice #</span>
                <input value={wo.invoice_number} onChange={e => { setDirtyFields(prev => new Set(prev).add('invoice_number')); setWo(w => w ? { ...w, invoice_number: e.target.value } : w) }} style={{ ...inp, width: 90, borderBottom: '1px solid rgba(255,255,255,0.2)' }} />
              </div>
            </div>
          </div>

          {/* META — two columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>

            {/* Left column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {([
                ['Session Date', 'session_date'],
                ['Engineer', 'engineer'],
                ['Assistant', 'second_engineer'],
                ['Producer', 'producer'],
              ] as [string, keyof WO][]).map(([label, key]) => (
                <div key={key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center' }}>
                  <div style={metaLabel}>{label}</div>
                  <input value={String(wo[key] ?? '')} onChange={e => { setDirtyFields(prev => new Set(prev).add(key as string)); setWo(w => w ? { ...w, [key]: e.target.value } : w) }} style={inp} />
                </div>
              ))}
              {/* Location — read-only, shown above studios */}
              {booking.location && (
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center' }}>
                  <div style={metaLabel}>Location</div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: '#f0f0f0', padding: '2px 4px' }}>{booking.location}</div>
                </div>
              )}
              {/* Studios multi-select */}
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center' }}>
                <div style={metaLabel}>Studios</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {STUDIO_LETTERS.map(s => {
                    const on = wo.studios.includes(s)
                    return (
                      <button key={s} type="button" onClick={() => setWo(w => {
                        if (!w) return w
                        return { ...w, studios: on ? w.studios.filter(x => x !== s) : [...w.studios, s] }
                      })} style={{ width: 26, height: 24, borderRadius: 4, border: `1px solid ${on ? '#c8f04e' : 'rgba(255,255,255,0.12)'}`, background: on ? 'rgba(200,240,78,0.12)' : 'transparent', color: on ? '#c8f04e' : '#8a8fa0', fontFamily: 'Syne', fontWeight: 700, fontSize: 10, cursor: 'pointer' }}>
                        {s}
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* Payment status */}
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center' }}>
                <div style={metaLabel}>Payment</div>
                <div style={{ display: 'flex', gap: 12 }}>
                  {['COD', 'Billing'].map(p => (
                    <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input type="radio" checked={wo.payment_status === p} onChange={() => { setDirtyFields(prev => new Set(prev).add('payment_status')); setWo(w => w ? { ...w, payment_status: p } : w) }} style={{ accentColor: '#c8f04e', cursor: 'pointer' }} />
                      <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: wo.payment_status === p ? '#f0f0f0' : '#8a8fa0' }}>{p}</span>
                    </label>
                  ))}
                </div>
              </div>
              {/* Food budget */}
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center' }}>
                <div style={metaLabel}>Food Budget</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" onClick={() => { setDirtyFields(prev => new Set(prev).add('food_budget')); setWo(w => w ? { ...w, food_budget: !w.food_budget } : w) }} style={{ padding: '2px 10px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', border: `1px solid ${wo.food_budget ? '#c8f04e' : 'rgba(255,255,255,0.12)'}`, background: wo.food_budget ? 'rgba(200,240,78,0.12)' : 'transparent', color: wo.food_budget ? '#c8f04e' : '#8a8fa0' }}>
                    {wo.food_budget ? 'Yes' : 'No'}
                  </button>
                  {wo.food_budget && <input value={wo.food_amount} onChange={e => { setDirtyFields(prev => new Set(prev).add('food_amount')); setWo(w => w ? { ...w, food_amount: e.target.value } : w) }} placeholder="$0.00" style={{ ...inp, width: 70 }} />}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {([
                ['Client', 'client'],
                ['Artist', 'artist'],
                ['Label', 'label'],
                ['Ordered By', 'ordered_by'],
                ['PO #', 'po_number'],
                ['Phone', 'phone'],
                ['Email', 'email'],
              ] as [string, keyof WO][]).map(([label, key]) => (
                <div key={key} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, alignItems: 'center' }}>
                  <div style={metaLabel}>{label}</div>
                  <input value={String(wo[key] ?? '')} onChange={e => { setDirtyFields(prev => new Set(prev).add(key as string)); setWo(w => w ? { ...w, [key]: e.target.value } : w) }} style={inp} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }} />

          {/* STUDIO TIME TABLE — unified per-row Day/Hr toggle */}
          <div>
            <div style={sectionTitle}>Studio Time</div>
            <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
              {/* Header: Studio | Date | Session Info | From | To | Hrs | Type | Rate | OT Hrs | OT Rate | OT Chg | Total | Lock | Del */}
              <div style={{ display: 'grid', gridTemplateColumns: '70px 65px 1fr 66px 66px 40px 52px 76px 50px 70px 68px 76px 40px 24px', background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {['Studio', 'Date', 'Session Info', 'From', 'To', 'Hrs', 'Type', 'Rate', 'OT Hrs', 'OT Rate', 'OT Chg', 'Total', '', ''].map((h, i) => <div key={i} style={thS}>{h}</div>)}
              </div>
              <div data-st-scroll="" style={{ maxHeight: 420, overflowY: 'auto' }}>
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
                        {/* Studio */}
                        <div style={cellS}><input value={r.studio} onChange={e => updateStRow(r.id, { studio: e.target.value })} style={inp} placeholder="—" /></div>
                        {/* Date — transparent overlay opens native picker, auto-sorts on pick */}
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
                          <span data-si-input="" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', color: r.session_info ? '#f0f0f0' : '#4a4f60', fontSize: 11 }}>
                            {r.session_info || '—'}
                          </span>
                          {r.session_info && <span data-si-print="" style={{ display: 'none' }}>{r.session_info}</span>}
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
                                <button onClick={() => { updateStRow(r.id, { session_info: siPopoverText }); setSiPopoverRowId(null) }} style={{ flex: 1, background: '#c8f04e', color: '#0d0f14', border: 'none', borderRadius: 5, padding: '5px 0', fontFamily: 'Syne', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>Save</button>
                                <button onClick={() => setSiPopoverRowId(null)} style={{ flex: 1, background: 'rgba(255,255,255,0.07)', color: '#8a8fa0', border: 'none', borderRadius: 5, padding: '5px 0', fontFamily: 'Syne', fontSize: 11, cursor: 'pointer' }}>Close</button>
                              </div>
                            </div>
                          </>
                        )}
                        {/* From / To */}
                        <div style={cellS}><TimeInput value={r.from_time} onChange={v => updateStRow(r.id, { from_time: v })} style={inp} /></div>
                        <div style={cellS}><TimeInput value={r.to_time} onChange={v => updateStRow(r.id, { to_time: v })} style={inp} /></div>
                        {/* Total Hrs — always auto-calc */}
                        <div style={{ ...cellS, color: '#8a8fa0', fontSize: 10 }}>{rowHrs != null ? `${rowHrs}h` : '—'}</div>
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
                            ? <span style={{ fontSize: 10, color: '#8a8fa0' }}>{otHrsNum > 0 ? `${otHrsNum}h` : '—'}</span>
                            : <input value={r.ot_hours ?? ''} onChange={e => updateStRow(r.id, { ot_hours: e.target.value })} style={inp} placeholder="0" />
                          }
                        </div>
                        {/* OT Rate — editable (auto-populated but overridable) */}
                        <div style={cellS}>
                          <input value={r.ot_rate ?? ''} onChange={e => updateStRow(r.id, { ot_rate: e.target.value })} style={inp} placeholder="$0" />
                        </div>
                        {/* OT Charge — computed read-only */}
                        <div style={{ ...cellS, color: (r.ot_charge ?? 0) > 0 ? '#c8f04e' : '#8a8fa0', fontSize: 10 }}>
                          {(r.ot_charge ?? 0) > 0 ? `$${r.ot_charge!.toFixed(2)}` : '—'}
                        </div>
                        {/* Total Charge = charge + OT charge */}
                        <div style={{ ...cellS, color: rowTotal > 0 ? '#c8f04e' : '#8a8fa0', fontWeight: rowTotal > 0 ? 600 : 400 }}>
                          {rowTotal > 0 ? `$${rowTotal.toFixed(2)}` : '—'}
                        </div>
                        {/* Lock pill — always clickable even when WO is completed */}
                        <div style={{ ...cellS, justifyContent: 'center', padding: '3px 4px', pointerEvents: 'auto' }}>
                          <button
                            type="button"
                            onClick={() => handleToggleLock(r.id, r.admin_locked)}
                            style={{
                              fontSize: 8, fontFamily: 'DM Mono', fontWeight: 700, padding: '2px 5px',
                              borderRadius: 3, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                              background: r.admin_locked ? '#14B8A6' : 'rgba(255,255,255,0.06)',
                              color: r.admin_locked ? '#0d0f14' : '#6B7280',
                            }}
                          >{r.admin_locked ? '🔒' : '✓'}</button>
                        </div>
                        {/* Delete row */}
                        <div style={{ ...cellS, justifyContent: 'center', padding: '3px 2px', pointerEvents: 'auto' }}>
                          {confirmDeleteRowId === r.id ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                              <span style={{ fontSize: 7, color: '#f97316', fontFamily: 'DM Mono', whiteSpace: 'nowrap' }}>Del?</span>
                              <div style={{ display: 'flex', gap: 3 }}>
                                <button type="button" onClick={() => deleteStRow(r.id)} style={{ fontSize: 8, fontFamily: 'DM Mono', color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>Y</button>
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
                          <button
                            type="button"
                            onClick={() => { handleToggleLock(r.id, true); setPendingLockedEdits(p => { const n = { ...p }; delete n[r.id]; return n }) }}
                            style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid #14B8A6', background: 'rgba(20,184,166,0.15)', color: '#14B8A6', fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer' }}
                          >Update</button>
                          <button
                            type="button"
                            onClick={() => { const orig = pendingLockedEdits[r.id]; setStRows(prev => prev.map(row => row.id === r.id ? orig : row)); setPendingLockedEdits(p => { const n = { ...p }; delete n[r.id]; return n }) }}
                            style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#8a8fa0', fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer' }}
                          >Revert</button>
                        </div>
                      )}
                      {(r.studio === '' || !!wo?.engineer || !!r.eng_rate) && r.eng_visible !== false && (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '70px 65px 1fr 66px 66px 40px 52px 76px 50px 70px 68px 76px 40px 24px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(200,240,78,0.03)' }}>
                            <div style={{ ...cellS, color: '#8a8fa0', fontSize: 9, fontStyle: 'italic' }}>Eng</div>
                            {/* Date picker — uses r.date for eng-only rows; shared with main row for studio rows */}
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
                            <div style={cellS}><TimeInput value={r.eng_from_time || r.from_time} onChange={v => updateStRow(r.id, { eng_from_time: v })} style={inp} /></div>
                            <div style={cellS}><TimeInput value={r.eng_to_time || r.to_time} onChange={v => updateStRow(r.id, { eng_to_time: v })} style={inp} /></div>
                            <div style={{ ...cellS, color: '#8a8fa0', fontSize: 10 }}>{engHrs != null ? `${engHrs}h` : '—'}</div>
                            <div style={cellS} />
                            <div style={cellS}>
                              <input value={r.eng_rate || engRateDisplay} onChange={e => updateStRow(r.id, { eng_rate: e.target.value })} style={{ ...inp, width: 64 }} />
                            </div>
                            <div style={cellS} />
                            <div style={cellS} />
                            <div style={cellS} />
                            <div style={{ ...cellS, color: engCharge != null ? '#c8f04e' : '#8a8fa0', fontWeight: engCharge != null ? 600 : 400 }}>
                              {engCharge != null ? `$${engCharge.toFixed(2)}` : '—'}
                            </div>
                            {/* Eng lock */}
                            <div style={{ ...cellS, justifyContent: 'center', padding: '3px 4px', pointerEvents: 'auto' }}>
                              <button type="button" onClick={() => handleToggleLock(r.id, r.admin_locked)} style={{ fontSize: 8, fontFamily: 'DM Mono', fontWeight: 700, padding: '2px 5px', borderRadius: 3, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', background: r.admin_locked ? '#14B8A6' : 'rgba(255,255,255,0.06)', color: r.admin_locked ? '#0d0f14' : '#6B7280' }}>{r.admin_locked ? '🔒' : '✓'}</button>
                            </div>
                            {/* Eng delete × */}
                            <div style={{ ...cellS, justifyContent: 'center', padding: '3px 2px', pointerEvents: 'auto' }}>
                              <button type="button" onClick={() => setConfirmClearEngId(r.id)} style={{ fontSize: 13, fontFamily: 'DM Mono', color: '#4a4f60', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                            </div>
                          </div>
                          {confirmClearEngId === r.id && (
                            <div style={{ padding: '5px 12px', background: 'rgba(249,115,22,0.08)', borderBottom: '1px solid rgba(249,115,22,0.2)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: 'DM Mono', color: '#f97316' }}>
                              <span>Delete engineer row?</span>
                              <button type="button" onClick={() => isEngOnly ? deleteStRow(r.id) : clearEngRow(r.id)} style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid #f97316', background: 'rgba(249,115,22,0.15)', color: '#f97316', fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer' }}>Y</button>
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
                  <button type="button" onClick={addStRow} style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8a8fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add Studio Time</button>
                  <button type="button" onClick={addEngRow} style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#c8f04e88', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add Eng</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                  <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#f0f0f0' }}>Studio: ${stTotal.toFixed(2)}</span>
                  {engTotal > 0 && (
                    <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#c8f04e' }}>Eng: ${engTotal.toFixed(2)}</span>
                  )}
                  {engTotal > 0 && (
                    <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#f0f0f0', fontWeight: 700 }}>Total: ${(stTotal + engTotal).toFixed(2)}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* EQUIPMENT CONDITION — excluded from PDF via data-no-print */}
          <div data-no-print="">
            <div style={sectionTitle}>Equipment Condition</div>
            {/* hidden file input for note photos */}
            <input ref={equipNoteFileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadEquipNotePhoto(f) }} />
            <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflowX: 'auto' }}>
              <div style={{ minWidth: `${130 + Math.max(sessionDates.length, 1) * 90}px` }}>
                {/* Header — equipment name cell sticky */}
                <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${Math.max(sessionDates.length, 1)}, 90px)`, background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ ...thS, position: 'sticky', left: 0, background: '#1a1e28', zIndex: 1 }}>Equipment</div>
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
                        <div style={{ ...cellS, color: '#f0f0f0', fontWeight: 500, position: 'sticky', left: 0, background: '#1a1e28', zIndex: 1 }}>{eq}</div>
                        {sessionDates.length > 0
                          ? sessionDates.map(d => {
                              const key = `${eq}||${d}`
                              const row = equipRows.find(r => r.equipment === eq && r.date === d)
                              const cond = row?.condition ?? null
                              const hasNote = !!(equipNotes[key]?.note || (equipNotes[key]?.photo_urls?.length ?? 0) > 0)
                              return (
                                <div key={d} style={{ ...cellS, display: 'flex', gap: 4, alignItems: 'center', borderRight: 'none' }}>
                                  <button type="button" onClick={() => row && toggleEquip(eq, d, 'ok')} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', border: `1px solid ${cond === 'ok' ? '#4ade80' : 'rgba(255,255,255,0.1)'}`, background: cond === 'ok' ? 'rgba(74,222,128,0.12)' : 'transparent', color: cond === 'ok' ? '#4ade80' : '#8a8fa0' }}>OK</button>
                                  <button type="button" onClick={() => row && toggleEquip(eq, d, 'not_ok')} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', border: `1px solid ${cond === 'not_ok' ? '#f87171' : 'rgba(255,255,255,0.1)'}`, background: cond === 'not_ok' ? 'rgba(248,113,113,0.12)' : 'transparent', color: cond === 'not_ok' ? '#f87171' : '#8a8fa0' }}>✗</button>
                                  {cond === 'not_ok' && hasNote && (
                                    <span style={{ width: 6, height: 6, borderRadius: 3, background: '#f0a24e', display: 'inline-block', flexShrink: 0 }} />
                                  )}
                                </div>
                              )
                            })
                          : <div style={{ ...cellS, color: '#4a4f64', borderRight: 'none' }}>—</div>}
                      </div>
                      {/* Note area — inline below the equipment row when a Not OK cell is open */}
                      {openDate && (
                        <div style={{ padding: '8px 12px', background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#f0a24e', marginBottom: 6 }}>
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
                          <button
                            type="button"
                            disabled={noteUploading}
                            onClick={() => { pendingNoteKey.current = { key: `${eq}||${openDate}`, equipment: eq, date: openDate }; equipNoteFileRef.current?.click() }}
                            style={{ marginTop: 6, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, color: noteUploading ? '#4a4f64' : '#8a8fa0', background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, cursor: noteUploading ? 'not-allowed' : 'pointer', padding: '3px 10px' }}
                          >
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

          {/* RENTALS */}
          <div>
            <div style={sectionTitle}>Rentals</div>
            <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 120px 110px 65px 80px 24px', background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {['Qty', 'Item', 'Supplier', "Date(s) Used", 'Rate', 'Charge', ''].map(h => <div key={h} style={thS}>{h}</div>)}
              </div>
              {rentRows.map((r, idx) => (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 120px 110px 65px 80px 24px', borderBottom: idx < rentRows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <div style={cellS}><input value={r.qty} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, qty: e.target.value } : x))} style={inp} /></div>
                  <div style={cellS}><input value={r.item} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, item: e.target.value } : x))} style={inp} /></div>
                  <div style={cellS}><input value={r.supplier} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, supplier: e.target.value } : x))} style={inp} /></div>
                  <div style={cellS}><input value={r.dates_used} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, dates_used: e.target.value } : x))} style={inp} /></div>
                  <div style={cellS}><input value={r.rate} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, rate: e.target.value } : x))} style={inp} /></div>
                  <div style={cellS}><input value={r.charge} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, charge: e.target.value } : x))} placeholder="$0.00" style={inp} /></div>
                  <div style={{ ...cellS, borderRight: 'none', padding: '6px 4px' }}>
                    <button type="button" onClick={() => setRentRows(p => p.filter(x => x.id !== r.id))} style={{ background: 'none', border: 'none', color: '#4a4f64', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#1a1e28', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <button type="button" onClick={() => setRentRows(p => [...p, { id: crypto.randomUUID(), qty: '', item: '', supplier: '', dates_used: '', rate: '', charge: '' }])} style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8a8fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add row</button>
                <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#f0f0f0', fontWeight: 700 }}>Total: ${rentTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }} />

          {/* BOTTOM TWO COLUMNS */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>

            {/* Left — Notes + Legal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={sectionTitle}>Session Notes</div>
                <textarea value={wo.session_notes} onChange={e => setWo(w => w ? { ...w, session_notes: e.target.value } : w)}
                  style={{ width: '100%', minHeight: 90, background: '#1a1e28', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 5, color: '#f0f0f0', fontFamily: 'DM Mono', fontSize: 11, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }} />
              </div>
              {wo.payment_status === 'COD' && (
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
                    <input value={wo.print_name} onChange={e => setWo(w => w ? { ...w, print_name: e.target.value } : w)} style={{ ...inp, borderBottom: '1px solid rgba(255,255,255,0.2)' }} />
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
                    {wo.signature_data && <div style={{ fontSize: 9, color: '#4a4f64', fontFamily: 'DM Mono', marginTop: 4 }}>Signature captured ✓</div>}
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
                          <select value={p.payment_type} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, payment_type: e.target.value, last_four: '' } : x))} style={{ ...inp, background: 'transparent', cursor: 'pointer' }}>
                            <option value="">— type —</option>
                            {['Cash', 'Zelle', 'Credit Card', 'Debit Card', 'Check', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div style={cellS}><input value={p.amount} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, amount: e.target.value } : x))} placeholder="0.00" style={inp} /></div>
                        <div style={cellS}><input value={p.memo} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, memo: e.target.value } : x))} placeholder="memo" style={inp} /></div>
                        {needsLast4 && (
                          <div style={cellS}><input value={p.last_four} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, last_four: e.target.value.replace(/\D/g, '').slice(0, 4) } : x))} placeholder="last 4" maxLength={4} style={inp} /></div>
                        )}
                        <div style={{ ...cellS, borderRight: 'none', padding: '6px 4px' }}>
                          <button type="button" onClick={() => setPayRows(p2 => p2.filter(x => x.id !== p.id))} style={{ background: 'none', border: 'none', color: '#4a4f64', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ padding: '7px 10px' }}>
                    <button type="button" onClick={() => setPayRows(p => [...p, { id: crypto.randomUUID(), payment_type: '', amount: '', memo: '', last_four: '' }])} style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8a8fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add payment</button>
                  </div>
                </div>
              </div>
              {/* Totals block */}
              <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
                {[
                  { label: 'Studio Total', value: stTotal, color: '#f0f0f0', bold: false },
                  ...(engTotal > 0 ? [{ label: 'Eng Total', value: engTotal, color: '#c8f04e', bold: false }] : []),
                  { label: 'Rentals Total', value: rentTotal, color: '#f0f0f0', bold: false },
                  { label: 'Grand Total', value: grandTotal, color: '#f0f0f0', bold: true },
                  { label: 'Total Paid', value: totalPaid, color: '#4ade80', bold: false },
                  { label: 'Balance Due', value: balanceDue, color: balanceDue > 0 ? '#f87171' : '#4ade80', bold: true },
                ].map(({ label, value, color, bold }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8a8fa0' }}>{label}</span>
                    <span style={{ fontSize: bold ? 13 : 11, fontFamily: 'DM Mono', color, fontWeight: bold ? 700 : 400 }}>${value.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* NEEDS ATTENTION — internal only, never printed */}
          <div data-no-print="" style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20 }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 10, color: '#f97316', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              Needs Attention / Runner Notes
            </div>
            <textarea
              value={wo.needs_attention_notes}
              onChange={e => setWo(w => w ? { ...w, needs_attention_notes: e.target.value } : w)}
              placeholder="Internal notes only — never appears on the PDF export…"
              style={{ width: '100%', minHeight: 80, background: '#1a1e28', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 5, color: '#f0f0f0', fontFamily: 'DM Mono', fontSize: 11, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
            />
            {wo.needs_attention_photos?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {wo.needs_attention_photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'block', flexShrink: 0 }}>
                    <img src={url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '2px solid rgba(249,115,22,0.4)', display: 'block' }} />
                  </a>
                ))}
              </div>
            )}
          </div>

        </div>{/* end body */}

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button onClick={() => printWithFilename()} style={{ padding: '7px 16px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#8a8fa0' }}>
            Export PDF
          </button>
          <button onClick={() => handleCancel()} disabled={saving} style={{ padding: '7px 16px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#8a8fa0' }}>
            Cancel
          </button>
          <button
            onClick={handleComplete}
            disabled={completing}
            style={{ padding: '7px 18px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: completing ? 'default' : 'pointer', background: isCompleted ? 'rgba(255,255,255,0.08)' : completing ? 'rgba(20,184,166,0.5)' : '#14B8A6', border: isCompleted ? '1px solid rgba(255,255,255,0.12)' : 'none', color: isCompleted ? '#8a8fa0' : '#0d0f14', opacity: completing ? 0.7 : 1 }}
          >
            {completing ? (isCompleted ? 'Re-opening…' : 'Completing…') : isCompleted ? 'Re-open WO' : 'Complete WO'}
          </button>
          <button onClick={handleClose} disabled={saving} style={{ padding: '7px 22px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', background: saving ? 'rgba(200,240,78,0.5)' : '#c8f04e', border: 'none', color: '#0d0f14', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Close & Save'}
          </button>
        </div>

      </div>
      </div>
    </div>,
    document.body
  )
}
