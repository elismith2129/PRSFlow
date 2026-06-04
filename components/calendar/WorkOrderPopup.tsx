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
  legal_signature: string
  legal_name: string
  legal_date: string
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
  charge: number | null
  sort_order: number
  day_count: number | null
  ot_rate: string
  ot_hours: string
  ot_charge: number | null
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
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STUDIO_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'X']
const EQUIPMENT_ITEMS = ['Speakers', 'Microphone', 'Console']

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    status: d.status ?? 'draft',
    session_notes: d.session_notes ?? '',
    legal_signature: d.legal_signature ?? '',
    legal_name: d.legal_name ?? '',
    legal_date: d.legal_date ?? '',
    needs_attention_notes: d.needs_attention_notes ?? '',
    needs_attention_photos: d.needs_attention_photos ?? [],
  }
}

function normalizeStRow(d: any): StRow {
  const dayCount = d.day_count != null ? Number(d.day_count) : null
  const rate = d.rate ?? ''
  // For day-rate rows, always recompute charge from day_count × rate so that
  // rows seeded before the new columns existed (which stored hours × rate) display correctly.
  let charge = d.charge != null ? Number(d.charge) : null
  if (dayCount != null) {
    const rateNum = parseFloat(String(rate).replace(/[^0-9.]/g, ''))
    charge = !isNaN(rateNum) && rateNum > 0 ? parseFloat((dayCount * rateNum).toFixed(2)) : null
  }
  return {
    id: d.id,
    studio: d.studio ?? '',
    date: d.date ?? '',
    session_info: d.session_info ?? '',
    from_time: d.from_time ?? '',
    to_time: d.to_time ?? '',
    total_hours: d.total_hours != null ? Number(d.total_hours) : null,
    rate,
    charge,
    sort_order: d.sort_order ?? 0,
    day_count: dayCount,
    ot_rate: d.ot_rate != null ? String(d.ot_rate) : '',
    ot_hours: d.ot_hours != null ? String(d.ot_hours) : '0',
    ot_charge: d.ot_charge != null ? Number(d.ot_charge) : null,
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

// Shared fields that sync between booking form and WO
export type WOFormSync = {
  client_name: string; artist: string; label: string; ordered_by: string
  po: string; phone: string; email: string; from_time: string; to_time: string
  producer: string; engineer_name: string; assistant_name: string
  payment_type: string; food_budget: boolean; food_amount: string
  invoice_num: string; start_date: string; studio: string; location: string
  rate: string; rate_daily: string
  notes?: string; engineer_status?: string
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
    { id: crypto.randomUUID(), payment_type: '', amount: '' },
  ])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set())
  const woIdRef = useRef<string | null>(null)
  // Track which rows exist in DB (vs. local-only new rows)
  const rentIdsInDb = useRef<Set<string>>(new Set())
  const payIdsInDb = useRef<Set<string>>(new Set())

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
      onStatusChange?.(existing.status ?? 'draft')
      // Fix studios: if DB has empty array but booking has a studio, backfill from booking
      const rawStudios: string[] = existing.studios ?? []
      const studioLetter = booking.studio ? toStudioLetter(booking.studio) : ''
      const studios = rawStudios.length > 0 ? rawStudios : (studioLetter ? [studioLetter] : [])
      if (rawStudios.length === 0 && studios.length > 0) {
        await supabase.from('work_orders').update({ studios }).eq('id', existing.id)
      }
      const seededExisting = applyLiveForm({ ...normalizeWO(existing), studios })
      setWo(seededExisting)
      const [{ data: st }, { data: eq }, { data: rent }, { data: pay }] = await Promise.all([
        supabase.from('studio_time_rows').select('*').eq('work_order_id', existing.id).order('sort_order'),
        supabase.from('equipment_condition_rows').select('*').eq('work_order_id', existing.id),
        supabase.from('rental_rows').select('*').eq('work_order_id', existing.id).order('sort_order'),
        supabase.from('payment_rows').select('*').eq('work_order_id', existing.id).order('recorded_at'),
      ])
      if (st?.length) {
        const isSingleDay = booking.start_date === booking.end_date || !booking.end_date
        const rows = st.map(normalizeStRow)
        if (isSingleDay && liveForm && (liveForm.from_time || liveForm.to_time)) {
          const r = rows[0]
          const from = liveForm.from_time || r.from_time
          const to   = liveForm.to_time   || r.to_time
          const hrs  = calcHours(from, to)
          // Day-rate rows keep their day_count-based charge; only update times for hourly rows
          rows[0] = r.day_count != null
            ? { ...r, from_time: from, to_time: to, total_hours: hrs }
            : { ...r, from_time: from, to_time: to, total_hours: hrs, charge: calcCharge(hrs, r.rate) }
        }
        // Day-rate reconciliation: if the booking date range has grown since the WO was
        // first created, insert rows for any dates not yet covered by existing rows.
        const isDay = booking.rate_type === 'day' || (!booking.rate && !!booking.rate_daily)
        if (isDay) {
          const allDates = dateRange(booking.start_date, booking.end_date)
          const coveredDates = new Set(rows.map(r => r.date))
          const missingDates = allDates.filter(d => !coveredDates.has(d))
          if (missingDates.length > 0) {
            const dayRateNum = parseFloat((booking.rate_daily ?? '').replace(/[^0-9.]/g, ''))
            const missingPayloads = missingDates.map((d, i) => ({
              work_order_id: existing.id,
              studio: studioLetter || booking.studio || '',
              date: d, session_info: '',
              from_time: booking.from_time ?? '', to_time: booking.to_time ?? '',
              total_hours: null,
              rate: booking.rate_daily ?? '',
              charge: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum : null,
              day_count: 1,
              ot_rate: !isNaN(dayRateNum) && dayRateNum > 0 ? dayRateNum / 10 : null,
              ot_hours: 0, ot_charge: null,
              sort_order: rows.length + i,
            }))
            const { data: inserted } = await supabase.from('studio_time_rows').insert(missingPayloads).select('*')
            if (inserted) rows.push(...inserted.map(normalizeStRow))
          }
          rows.sort((a, b) => a.date.localeCompare(b.date))
        }
        setStRows(rows)
      } else {
        // Existing WO has no studio time rows — auto-generate from booking
        const dates = dateRange(booking.start_date, booking.end_date)
        const isDay = booking.rate_type === 'day' || (!booking.rate && !!booking.rate_daily)
        const stPayloads = dates.map((d, i) => {
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
              ot_hours: 0, ot_charge: null,
              sort_order: i,
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
            sort_order: i,
          }
        })
        if (stPayloads.length) {
          const { data: stCreated } = await supabase.from('studio_time_rows').insert(stPayloads).select('*')
          if (stCreated) setStRows(stCreated.map(normalizeStRow))
        }
      }
      if (eq?.length) setEquipRows(eq as EquipRow[])
      if (rent?.length) {
        setRentRows(rent.map(r => ({ id: r.id, qty: String(r.qty ?? ''), item: r.item ?? '', supplier: r.supplier ?? '', dates_used: r.dates_used ?? '', rate: r.rate ?? '', charge: String(r.charge ?? '') })))
        rent.forEach(r => rentIdsInDb.current.add(r.id))
      }
      if (pay?.length) {
        setPayRows(pay.map(p => ({ id: p.id, payment_type: p.payment_type ?? '', amount: String(p.amount ?? '') })))
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
        status: 'draft',
      }
      const { data: created } = await supabase.from('work_orders').insert(woPayload).select('*').single()
      if (!created) { setLoading(false); return }
      woIdRef.current = created.id
      const seededNew = applyLiveForm(normalizeWO(created))
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
            ot_hours: 0, ot_charge: null,
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
          sort_order: i,
        }
      })
      const { data: stCreated } = await supabase.from('studio_time_rows').insert(stPayloads).select('*')
      if (stCreated) setStRows(stCreated.map(normalizeStRow))

      // Auto-generate equipment condition rows
      const eqPayloads = dates.flatMap(d =>
        EQUIPMENT_ITEMS.map(eq => ({ work_order_id: created.id, equipment: eq, date: d, condition: null }))
      )
      const { data: eqCreated } = await supabase.from('equipment_condition_rows').insert(eqPayloads).select('*')
      if (eqCreated) setEquipRows(eqCreated as EquipRow[])

      onStatusChange?.('draft')
    }
    setLoading(false)
  }

  // ── Studio time row updates ─────────────────────────────────────────────────

  function updateStRow(id: string, updates: Partial<StRow>) {
    setStRows(prev => prev.map(r => {
      if (r.id !== id) return r
      const u = { ...r, ...updates }
      if (u.day_count != null) {
        // Day-rate row: charge = day_count × rate; ot_charge = ot_hours × ot_rate
        if ('day_count' in updates || 'rate' in updates) {
          const days = u.day_count ?? 1
          const rate = parseFloat((u.rate ?? '').replace(/[^0-9.]/g, ''))
          u.charge = (!isNaN(rate) && rate > 0) ? parseFloat((days * rate).toFixed(2)) : null
        }
        if ('ot_hours' in updates || 'ot_rate' in updates) {
          const h = parseFloat(u.ot_hours ?? '0') || 0
          const r = parseFloat((u.ot_rate ?? '').replace(/[^0-9.]/g, '')) || 0
          u.ot_charge = h > 0 && r > 0 ? parseFloat((h * r).toFixed(2)) : null
        }
      } else {
        // Hourly row
        if ('from_time' in updates || 'to_time' in updates) {
          u.total_hours = calcHours(u.from_time, u.to_time)
        }
        if ('total_hours' in updates || 'rate' in updates || 'from_time' in updates || 'to_time' in updates) {
          u.charge = calcCharge(u.total_hours, u.rate)
        }
      }
      return u
    }))
  }

  // ── Equipment condition ────────────────────────────────────────────────────

  function toggleEquip(equipment: string, date: string, cond: 'ok' | 'not_ok') {
    setEquipRows(prev => prev.map(r => {
      if (r.equipment !== equipment || r.date !== date) return r
      const next = r.condition === cond ? null : cond
      supabase.from('equipment_condition_rows').update({ condition: next }).eq('id', r.id)
      return { ...r, condition: next }
    }))
  }

  // ── Add studio time row ────────────────────────────────────────────────────

  async function addStRow() {
    const newRow = { work_order_id: woIdRef.current!, studio: '', date: '', session_info: '', from_time: '', to_time: '', total_hours: null, rate: '', charge: null, sort_order: stRows.length }
    const { data } = await supabase.from('studio_time_rows').insert(newRow).select('*').single()
    if (data) setStRows(prev => [...prev, normalizeStRow(data)])
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
      legal_signature: wo.legal_signature || null,
      legal_name: wo.legal_name || null,
      legal_date: wo.legal_date || null,
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

    // Save studio time rows
    await Promise.all(stRows.map(r =>
      supabase.from('studio_time_rows').update({
        studio: r.studio, date: r.date, session_info: r.session_info,
        from_time: r.from_time, to_time: r.to_time,
        total_hours: r.total_hours, rate: r.rate, charge: r.charge,
        sort_order: r.sort_order,
        day_count: r.day_count ?? null,
        ot_rate: r.ot_rate ? parseFloat(r.ot_rate.replace(/[^0-9.]/g, '')) || null : null,
        ot_hours: r.ot_hours ? parseFloat(r.ot_hours) || null : null,
        ot_charge: r.ot_charge ?? null,
      }).eq('id', r.id)
    ))

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
      const payload = { id: p.id, work_order_id: id, payment_type: p.payment_type || null, amount: parseFloat(p.amount) || null }
      return payIdsInDb.current.has(p.id)
        ? supabase.from('payment_rows').update(payload).eq('id', p.id)
        : supabase.from('payment_rows').insert(payload)
    }))

    setSaving(false)
    onSaved?.()
    onClose()
  }

  // ── Derived totals ─────────────────────────────────────────────────────────

  const stTotal = stRows.reduce((s, r) => s + (r.charge ?? 0) + (r.ot_charge ?? 0), 0)
  const isDayRate = booking.rate_type === 'day' || (!booking.rate && !!booking.rate_daily)
  const rentTotal = rentRows.reduce((s, r) => s + (parseFloat(r.charge) || 0), 0)
  const grandTotal = stTotal + rentTotal
  const totalPaid = payRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const balanceDue = grandTotal - totalPaid
  const sessionDates = Array.from(new Set(stRows.map(r => r.date).filter(Boolean))).sort()

  // ── Styles ────────────────────────────────────────────────────────────────

  const inp: React.CSSProperties = {
    background: 'transparent', border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    color: '#f0f0f0', fontFamily: 'DM Mono', fontSize: 11,
    padding: '2px 4px', outline: 'none', width: '100%', lineHeight: 1.5,
  }
  const cellS: React.CSSProperties = {
    padding: '6px 8px', borderRight: '1px solid rgba(255,255,255,0.06)',
    fontSize: 11, fontFamily: 'DM Mono', color: '#f0f0f0',
  }
  const thS: React.CSSProperties = {
    padding: '5px 8px', fontSize: 8, fontFamily: 'Syne', fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a8fa0',
    borderRight: '1px solid rgba(255,255,255,0.06)',
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
              background: wo.status === 'approved' ? 'rgba(200,240,78,0.15)' : wo.status === 'submitted' ? 'rgba(251,146,60,0.15)' : 'rgba(138,143,160,0.12)',
              color: wo.status === 'approved' ? '#c8f04e' : wo.status === 'submitted' ? '#fb923c' : '#8a8fa0',
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
              onClick={() => onClose()}
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

          {/* STUDIO TIME TABLE */}
          <div>
            <div style={sectionTitle}>Studio Time</div>
            <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
              {isDayRate ? (
                <>
                  {/* Day-rate: compact single-row-per-day table */}
                  {/* Header — sticky so it stays visible when body scrolls */}
                  <div style={{ display: 'grid', gridTemplateColumns: '75px 1fr 44px 80px 55px 80px 80px', background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    {['Date', 'Session Info', 'Days', 'Rate', 'OT Hrs', 'OT Rate', 'Total'].map(h => <div key={h} style={thS}>{h}</div>)}
                  </div>
                  {/* Body — scrollable after 5 rows; print override via [data-st-scroll] in globals.css */}
                  <div data-st-scroll="" style={{ overflowY: stRows.length > 5 ? 'auto' : 'visible', maxHeight: stRows.length > 5 ? 200 : undefined }}>
                    {stRows.map(r => {
                      const dayCount = r.day_count ?? 1
                      const rateNum = parseFloat((r.rate ?? '').replace(/[^0-9.]/g, ''))
                      const dayCharge = !isNaN(rateNum) && rateNum > 0 ? dayCount * rateNum : 0
                      const otHrs = parseFloat(r.ot_hours ?? '0') || 0
                      const otRateNum = parseFloat((r.ot_rate ?? '').replace(/[^0-9.]/g, '')) || 0
                      const otCharge = otHrs > 0 && otRateNum > 0 ? otHrs * otRateNum : 0
                      const rowTotal = dayCharge + otCharge
                      return (
                        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '75px 1fr 44px 80px 55px 80px 80px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <div style={{ ...cellS, color: '#8a8fa0', fontSize: 10 }}>{r.date || '—'}</div>
                          <div style={cellS}><input value={r.session_info} onChange={e => updateStRow(r.id, { session_info: e.target.value })} style={inp} placeholder="—" /></div>
                          <div style={cellS}>
                            <input type="number" min="1" step="1" value={dayCount}
                              onChange={e => updateStRow(r.id, { day_count: parseInt(e.target.value) || 1 })}
                              style={{ ...inp, width: 32 }} />
                          </div>
                          <div style={{ ...cellS, color: '#8a8fa0', fontSize: 10 }}>{rateNum > 0 ? `$${rateNum.toLocaleString()}/day` : '—'}</div>
                          <div style={cellS}>
                            <input type="number" min="0" step="0.5" value={r.ot_hours ?? '0'}
                              onChange={e => updateStRow(r.id, { ot_hours: e.target.value })}
                              style={{ ...inp, width: 40 }} />
                          </div>
                          <div style={cellS}>
                            <input value={r.ot_rate ?? ''} onChange={e => updateStRow(r.id, { ot_rate: e.target.value })}
                              style={inp} placeholder="$0/hr" />
                          </div>
                          <div style={{ ...cellS, color: rowTotal > 0 ? '#c8f04e' : '#8a8fa0', fontWeight: 600, borderRight: 'none' }}>
                            {rowTotal > 0 ? `$${rowTotal.toFixed(2)}` : '—'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <>
                  {/* Hourly: original layout */}
                  <div style={{ display: 'grid', gridTemplateColumns: '55px 90px 1fr 72px 72px 55px 90px 80px', background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    {['Studio', 'Date', 'Session Info', 'From', 'To', 'Hrs', 'Rate', 'Charge'].map(h => <div key={h} style={thS}>{h}</div>)}
                  </div>
                  <div data-st-scroll="" style={{ overflowY: stRows.length > 5 ? 'auto' : 'visible', maxHeight: stRows.length > 5 ? 200 : undefined }}>
                    {stRows.map(r => (
                      <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '55px 90px 1fr 72px 72px 55px 90px 80px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={cellS}><input value={r.studio} onChange={e => updateStRow(r.id, { studio: e.target.value })} style={inp} /></div>
                        <div style={cellS}><input value={r.date} onChange={e => updateStRow(r.id, { date: e.target.value })} style={inp} /></div>
                        <div style={cellS}><input value={r.session_info} onChange={e => updateStRow(r.id, { session_info: e.target.value })} style={inp} /></div>
                        <div style={cellS}><TimeInput value={r.from_time} onChange={v => updateStRow(r.id, { from_time: v })} style={inp} /></div>
                        <div style={cellS}><TimeInput value={r.to_time} onChange={v => updateStRow(r.id, { to_time: v })} style={inp} /></div>
                        <div style={{ ...cellS, color: '#8a8fa0', fontSize: 10 }}>{r.total_hours != null ? r.total_hours : '—'}</div>
                        <div style={cellS}><input value={r.rate} onChange={e => updateStRow(r.id, { rate: e.target.value })} style={inp} /></div>
                        <div style={{ ...cellS, color: r.charge != null ? '#c8f04e' : '#8a8fa0', fontWeight: r.charge != null ? 600 : 400, borderRight: 'none' }}>
                          {r.charge != null ? `$${r.charge.toFixed(2)}` : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#1a1e28', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {!isDayRate && <button type="button" onClick={addStRow} style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8a8fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add row</button>}
                {isDayRate && <div />}
                <span style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#f0f0f0', fontWeight: 700 }}>Total: ${stTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* EQUIPMENT CONDITION */}
          <div>
            <div style={sectionTitle}>Equipment Condition</div>
            <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${Math.max(sessionDates.length, 1)}, 1fr)`, background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={thS}>Equipment</div>
                {sessionDates.length > 0
                  ? sessionDates.map(d => <div key={d} style={thS}>{fmtDate(d)}</div>)
                  : <div style={thS}>—</div>}
              </div>
              {EQUIPMENT_ITEMS.map((eq, eqIdx) => (
                <div key={eq} style={{ display: 'grid', gridTemplateColumns: `140px repeat(${Math.max(sessionDates.length, 1)}, 1fr)`, borderBottom: eqIdx < EQUIPMENT_ITEMS.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <div style={{ ...cellS, color: '#f0f0f0', fontWeight: 500 }}>{eq}</div>
                  {sessionDates.length > 0
                    ? sessionDates.map(d => {
                        const row = equipRows.find(r => r.equipment === eq && r.date === d)
                        const cond = row?.condition ?? null
                        return (
                          <div key={d} style={{ ...cellS, display: 'flex', gap: 4, alignItems: 'center', borderRight: 'none' }}>
                            <button type="button" onClick={() => row && toggleEquip(eq, d, 'ok')} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', border: `1px solid ${cond === 'ok' ? '#4ade80' : 'rgba(255,255,255,0.1)'}`, background: cond === 'ok' ? 'rgba(74,222,128,0.12)' : 'transparent', color: cond === 'ok' ? '#4ade80' : '#8a8fa0' }}>OK</button>
                            <button type="button" onClick={() => row && toggleEquip(eq, d, 'not_ok')} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', border: `1px solid ${cond === 'not_ok' ? '#f87171' : 'rgba(255,255,255,0.1)'}`, background: cond === 'not_ok' ? 'rgba(248,113,113,0.12)' : 'transparent', color: cond === 'not_ok' ? '#f87171' : '#8a8fa0' }}>✗</button>
                          </div>
                        )
                      })
                    : <div style={{ ...cellS, color: '#4a4f64', borderRight: 'none' }}>—</div>}
                </div>
              ))}
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
              <div style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#4a4f64', lineHeight: 1.8, padding: '10px 12px', background: '#1a1e28', borderRadius: 5, border: '1px solid rgba(255,255,255,0.05)' }}>
                By signing below, I acknowledge that I am authorized to approve charges for this session. I accept responsibility for all associated costs and understand that payment is due in full at the time of service unless otherwise agreed. I also acknowledge that Paramount Recording is not responsible for any media, personal items, or equipment left behind.
                <br /><br />
                <em>No Tapes, CDs, DVDs, Thumb Drives, Computer Drives or other Recording Media will be released until payment in full is received.</em>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([['Signature', 'legal_signature'], ['Print Name', 'legal_name'], ['Date', 'legal_date']] as [string, keyof WO][]).map(([label, key]) => (
                  <div key={key} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center' }}>
                    <div style={metaLabel}>{label}</div>
                    <input value={String(wo[key] ?? '')} onChange={e => setWo(w => w ? { ...w, [key]: e.target.value } : w)} style={{ ...inp, borderBottom: '1px solid rgba(255,255,255,0.2)' }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Right — Payments + Totals */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={sectionTitle}>Payments</div>
                <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 24px', background: '#1a1e28', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    {['Type', 'Amount', ''].map(h => <div key={h} style={thS}>{h}</div>)}
                  </div>
                  {payRows.map((p, idx) => (
                    <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 24px', borderBottom: idx < payRows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                      <div style={cellS}><input value={p.payment_type} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, payment_type: e.target.value } : x))} placeholder="Cash / CC / Zelle…" style={inp} /></div>
                      <div style={cellS}><input value={p.amount} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, amount: e.target.value } : x))} placeholder="$0.00" style={inp} /></div>
                      <div style={{ ...cellS, borderRight: 'none', padding: '6px 4px' }}>
                        <button type="button" onClick={() => setPayRows(p2 => p2.filter(x => x.id !== p.id))} style={{ background: 'none', border: 'none', color: '#4a4f64', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding: '7px 10px' }}>
                    <button type="button" onClick={() => setPayRows(p => [...p, { id: crypto.randomUUID(), payment_type: '', amount: '' }])} style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8a8fa0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add payment</button>
                  </div>
                </div>
              </div>
              {/* Totals block */}
              <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
                {[
                  { label: 'Studio Total', value: stTotal, color: '#f0f0f0', bold: false },
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
          <button onClick={() => onClose()} disabled={saving} style={{ padding: '7px 16px', borderRadius: 5, fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#8a8fa0' }}>
            Cancel
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
