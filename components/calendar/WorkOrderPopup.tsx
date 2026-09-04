'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { createWorkOrderForBooking, bookingShouldHaveWorkOrder } from '@/lib/createWorkOrder'
import TimeInput from '@/components/shared/TimeInput'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { statusFillClass } from '@/components/carved'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useUserProfile } from '@/hooks/useUserProfile'
import { SignedImage } from '@/components/shared/SignedImage'
import { ClientPanel, type ClientPanelValue } from '@/components/shared/ClientPanel'
import { seedStudioTimeRows } from '@/lib/seedStudioTimeRows'
import { timeToMins, calcHours, calcCharge, dateRange, isNextDay, toStudioLetter, getLocalToday, opsToday } from '@/lib/time'
import { formatCurrency, stripCurrency, longDate } from '@/lib/format'
import { computeWoTotals, engChargeForRow, cardFeeOfCharged, cardTotalForBase, DAY_HOUR_RATIO } from '@/lib/woTotals'
import {
  findMissingTimes, missingTimesMessage, woNeedsTimes, problemsDetail, confirmStartProblem,
  findMissingEngRates, missingEngRatesMessage,
  findDuplicateStaffLines, duplicateStaffMessage,
} from '@/lib/woValidation'
import { enterInvoicePipeline, downloadPackage } from '@/lib/billing'
import { dbResult } from '@/lib/db'
import { signedPhotoUrl } from '@/lib/photos'
import { STUDIO_LOCATIONS, STUDIO_SHORT, roomCode } from '@/lib/studios'
import { WoHistoryModal } from '@/components/calendar/WoHistoryModal'
import { woAuditView, diffWoForSave, buildWoSnapshot, logWoActivity } from '@/lib/woActivity'

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

// STUDIO_SHORT moved to lib/studios.ts (2026-08-13) — the PDF needs the same
// map, and a venue code that prints on a client's paperwork may not have two
// definitions. Imported below with the other studio helpers.

// Session status bar (calendar status) + session type — session-level, shown in
// the WO top. Order/labels mirror the old booking form.
const SESSION_STATUSES: [string, string][] = [
  ['confirmed', 'Confirmed'], ['tentative', 'Tentative'], ['cancelled', 'Cancelled'],
  // 'Open Hrs' not 'Open Hours' (2026-08-26): seven pills have to share one
  // line — Lockout's arrival wrapped the seg to a second row.
  ['tour', 'Tour'], ['tech', 'Tech'], ['open_hours', 'Open Hrs'],
  // Rent-only monthly lockout — full WO (rent is invoiced) but invisible to
  // every daily-ops surface because they all select status='confirmed'.
  ['lockout', 'Lockout'],
]
// Mirror the booking-form status colors (STATUS_TOP_COLORS). Active pill fills
// with its status color; inactive stays neutral.
const SESSION_STATUS_COLORS: Record<string, string> = {
  confirmed: 'var(--c-st-booked)', tentative: 'var(--c-st-warm)', cancelled: 'var(--c-st-hot)',
  tour: 'var(--c-st-uncon)', tech: 'var(--c-fg-3)', open_hours: 'var(--c-fg-2)',
  lockout: 'var(--c-st-booked)',
}
const SESSION_TYPES: [string, string][] = [
  ['recording', 'Recording'], ['filming', 'Filming'], ['event_playback', 'Event / Playback'],
]

// ─── REMOVED: per-studio accent colours on the mobile WO header ──────────────
// This map used to tint the mobile header's bottom border by venue:
//   paramount → --accent, ameraycan → --hot, encore → --accent2, track → --warm
//
// Two problems. `--hot` is the LEAD TEMPERATURE colour (#EF4444) and is used
// everywhere else for danger, errors and cancelled sessions — so every
// Ameraycan work order opened with a 3px red bar under its header and read as
// though something had gone wrong. And per-studio colour coding was already
// deliberately removed across the runner pages, admin sections, LocationStrip
// and dashboard; this survived only because its comment claimed to mirror the
// Runner Hub header, which had itself moved to a neutral 1px border in that
// same pass. The comment was stale, not the design.
//
// The header now uses var(--c-wash2), matching the runner. Don't reintroduce
// venue colours here without reintroducing them everywhere — and if you do,
// don't borrow a colour that already carries meaning.

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
  /**
   * This billing package can be sent WITHOUT a PO (migration 20260811150000).
   *
   * Lives on the work order, not the client (ruling 2026-08-11) — a client who
   * normally requires a PO can waive it on one job, and the exception belongs on
   * the job. Read by lib/billing's Awaiting-PO derivation, nowhere else.
   */
  no_po_needed: boolean
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
  /**
   * ACTUAL vs BILLED (Eli, 2026-09-01): when the client really arrived/left.
   * Read by NOTHING that computes money — billed is always the booked times,
   * so these cannot move an invoice. Stored for utilization reporting.
   */
  actual_from_time: string
  actual_to_time: string
  admin_checked: boolean
  admin_locked: boolean
  eng_visible: boolean
  eng_role: 'engineer' | 'assistant' // 1ST vs 2ND — every session has one or the other
  // Runner submit state: 'in_progress' | 'submitted' | 'approved'. Carried in
  // state for the status dots + the Submit/Update-submission button label, but
  // deliberately NOT part of the save payload (stPayloads) — a save must never
  // clobber a status the runner or admin set through their own act.
  status: string
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
  /** 3% card surcharge slice of `amount` (COD + Credit/Debit only; migration
   *  20260826160000). Auto-derived from the charged amount — amount is what
   *  hit the card, fee_amount is the fee inside it. Cleared = waived. */
  fee_amount: string
}

/** Payment types that carry the 3% COD card surcharge. */
const CARD_PAY_TYPES = ['Credit Card', 'Debit Card']

/** Food-budget expense report row (wo_expenses, 2026-08-24) — the paper
    sheet's Date · Place of Business · Amount (incl. tip) + receipt photo. */
type WoExpense = {
  id: string
  work_order_id: string
  date: string
  place: string
  amount: string
  receipt_path: string | null
  sort_order: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EQUIPMENT_ITEMS = ['Speakers', 'Microphone', 'Console']

// The studio-time table's 14 columns at their minimum widths:
// 58+58+150+66+66+38+48+68+44+62+60+74+34+22. Kept as a named constant because
// the header grid and the row scroller must agree on it — see the note at the
// header. Every cell in this table stays typeable (the standing rule for the
// admin view), and that is what costs the width.
const ST_MINW = 848

// Height of the studio-time bin on admin desktop — the ONE number to change if
// the days bin should show more or fewer days at rest.
//
// There is a real tension recorded here. The old single-column table capped at
// 420px (~5 day blocks at ~86px) and Eli wanted ~8, which is ~690px. The
// two-column layout cannot spend 690px on the bin: the pinned itemized total,
// the rentals bin and payments/totals all sit UNDER it in the same column and
// the ruling is that they never scroll away. 322 keeps all four on screen on a
// 900px-tall display and shows ~3–4 days at rest.
//
// This is why the scroll indicator is not optional. A capped bin that doesn't
// announce what's below it is how a billable day gets missed — see ScrollHints.
const ST_BIN_H = 322

// Half-hour presets for the day sheet's time-well dropdown (type OR pick —
// Eli, 2026-08-16; the well still smart-parses typed input via TimeInput).
const TIME_OPTS: string[] = (() => {
  const out: string[] = []
  for (let h = 0; h < 24; h++) for (const m of [0, 30]) {
    const hr12 = h % 12 === 0 ? 12 : h % 12
    out.push(`${hr12}:${m === 0 ? '00' : '30'} ${h < 12 ? 'AM' : 'PM'}`)
  }
  return out
})()

// ─── Scroll indicators (RULING 2026-08-18, admin desktop) ────────────────────
// A bin that scrolls MUST announce it. The two bins on the numbers column (days
// and rentals) scroll independently, so a day can sit below the fold with
// nothing on screen saying so — which is how a billable day gets missed.
//
// Both hints are LIVE, not decorative: the fade and the "↓ N more" pill render
// only while content actually remains below, and disappear at the bottom. N is
// counted from the DOM (children whose bottom edge is past the visible edge),
// so it can't drift from what is really there.
//
// Layout only — it reads scroll positions and renders two absolutely-positioned
// overlays. It never touches rows, totals or saves.
function ScrollHints({ targetRef, unit }: {
  targetRef: React.RefObject<HTMLDivElement | null>
  unit: string
}) {
  const [more, setMore] = useState(0)
  useEffect(() => {
    const el = targetRef.current
    if (!el) return
    const measure = () => {
      const bottom = el.scrollTop + el.clientHeight
      // Nothing left below → no fade, no pill (the ruling: hide at the bottom).
      if (el.scrollHeight - bottom <= 2) { setMore(0); return }
      let n = 0
      for (const c of Array.from(el.children) as HTMLElement[]) {
        if (c.offsetTop + c.offsetHeight > bottom + 2) n++
      }
      setMore(Math.max(n, 1))
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    // Rows are added, deleted and resized while the WO is open, so the hint has
    // to re-measure on content change as well as on scroll.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(measure) : null
    mo?.observe(el, { childList: true, subtree: true, characterData: true, attributes: true })
    return () => { el.removeEventListener('scroll', measure); ro?.disconnect(); mo?.disconnect() }
  }, [targetRef])
  if (more <= 0) return null
  return (
    <>
      <div aria-hidden style={{
        position: 'absolute', left: 0, right: 6, bottom: 0, height: 34,
        background: 'linear-gradient(transparent, var(--c-bg))',
        pointerEvents: 'none', borderRadius: '0 0 12px 12px',
      }} />
      <div style={{
        position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
        pointerEvents: 'none', background: 'var(--c-wash2)', color: 'var(--c-fg-2)',
        borderRadius: 99, padding: '3px 11px', whiteSpace: 'nowrap',
        fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
      }}>
        ↓ {more} more {unit}{more === 1 ? '' : 's'}
      </div>
    </>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────


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
    no_po_needed: d.no_po_needed ?? false,
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
    actual_from_time: d.actual_from_time ?? '',
    actual_to_time: d.actual_to_time ?? '',
    admin_checked: d.admin_checked ?? false,
    admin_locked: d.admin_locked ?? false,
    eng_visible: d.eng_visible ?? true,
    status: d.status ?? 'in_progress',
    // Assistant is the default role everywhere — an engineer is the exception.
    // Stored rows keep whatever they were saved with; this only decides the
    // fallback for a row with no role recorded.
    eng_role: d.eng_role === 'engineer' ? 'engineer' : 'assistant',
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
  leadId,
  inline,
  mode = 'admin',
  runnerStudio,
  runnerStudioLabel,
}: {
  booking: Booking
  liveForm?: WOFormSync
  onClose: () => void
  onStatusChange?: (status: string) => void
  onFormSync?: (updates: Partial<WOFormSync>) => void
  onSaved?: () => void
  onDelete?: () => void
  // Set only when this WO was opened from a CRM lead's "Start Booking". The lead
  // is marked booked once the session is actually SAVED — not when the WO opens —
  // so backing out of a Work Order leaves the lead in the pipeline.
  leadId?: number | null
  inline?: boolean
  /**
   * RUNNER MODE (spec §15, Eli 2026-08-14/15): the runner work order IS this
   * component — there is no second work order. Runner mode is FIELD-LEVEL
   * locking, not read-only: the office's fields (client block, rates, any day
   * admin has locked) go read-only; times, staff, OT hours, equipment
   * condition, song titles, payments (COD at the desk) and notes stay live.
   * Hide nothing — runners keep totals and payments. The terminal act is
   * SUBMIT (today's rows → 'submitted'), never Complete WO.
   */
  mode?: 'admin' | 'runner'
  /** Studio key ('paramount'…) — required in runner mode for the wo_flag rows. */
  runnerStudio?: string
  /** Studio display label ('Paramount'…) — used in the flag's source label. */
  runnerStudioLabel?: string
}) {
  const runner = mode === 'runner'
  // Mobile gets a full-screen sheet; never applies when rendered inline (USF embed).
  // Runner mode is phone-first by definition — it always takes the mobile layout
  // (full-screen sheet, read-only Session Info card, no META/branding), even on
  // a tablet or desktop, because the locked-top presentation IS the runner UI.
  const isMobileRaw = useIsMobile()
  const isMobile = (isMobileRaw || runner) && !inline
  const { profile } = useUserProfile()
  // Tech is read-only on WOs everywhere (calendar, wo-hub, LocationStrip): hide
  // all write controls. RLS also blocks tech writes, so this is a UX guard.
  //
  // Imported WordPress history (migration 20260826150000): a booking stamped
  // imported_at whose start date is past is read-only history for EVERY role —
  // viewable, never editable, and it must never grow a work order or invoice
  // number. Imported rows dated today or later stay writable so the existing
  // promote-on-touch path (open → WO created → real session) keeps working.
  // "Past" means FULLY past: a multi-day import still running today (started
  // yesterday, ends tomorrow) is a live session that needs promoting, not
  // history — so the lock keys on end_date, falling back to start_date.
  const importedPast =
    !!(booking as any).imported_at &&
    !!booking.start_date &&
    ((booking.end_date || booking.start_date) < getLocalToday())
  const readOnly = profile?.role === 'tech' || importedPast
  const [wo, setWo] = useState<WO | null>(null)
  const [stRows, setStRows] = useState<StRow[]>([])
  const [equipRows, setEquipRows] = useState<EquipRow[]>([])
  const [rentRows, setRentRows] = useState<RentRow[]>([
    { id: crypto.randomUUID(), qty: '', item: '', supplier: '', dates_used: '', rate: '', charge: '' },
    { id: crypto.randomUUID(), qty: '', item: '', supplier: '', dates_used: '', rate: '', charge: '' },
  ])
  const [payRows, setPayRows] = useState<PayRow[]>([
    { id: crypto.randomUUID(), payment_type: '', amount: '', memo: '', last_four: '', fee_amount: '' },
  ])
  // Food-budget expense report (2026-08-24 — the paper sheet, live). Rows write
  // IMMEDIATELY (equip-note pattern), not through the WO's batched save: the
  // runner logs receipts mid-session and a failed batched save must never take
  // the receipt log down with it.
  const [expenses, setExpenses] = useState<WoExpense[]>([])
  const [showExpenses, setShowExpenses] = useState(false)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [rcptUploading, setRcptUploading] = useState<string | null>(null)
  // The Rcpt button IS the thumbnail once a photo exists (Eli, 2026-09-02):
  // signed URLs per attached receipt, resolved only while the panel is open.
  // Keyed by expense id; a re-upload re-signs because the path changes.
  const [rcptThumbs, setRcptThumbs] = useState<Record<string, string>>({})
  const expenseFileRef = useRef<HTMLInputElement | null>(null)
  const pendingExpenseId = useRef<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [completing, setCompleting] = useState(false)
  // Rows blocking Complete because they're missing times (RULING 2026-08-10).
  // Cleared on the next Complete attempt, not on edit — the banner should stay
  // put while you go and fix the rows it just named.
  const [timeErrorRows, setTimeErrorRows] = useState<Set<string>>(new Set())
  const [timeErrorMsg, setTimeErrorMsg] = useState<string | null>(null)
  const [showEngRows, setShowEngRows] = useState(false)
  // Seed panel (bulk row generation — see docs/WO-SPEC.md §6)
  const [seedOpen, setSeedOpen] = useState(false)
  const [seedBusy, setSeedBusy] = useState(false)
  // Engineers roster for per-row engineer datalist (reference data; fetched once
  // per modal open — modal lifetime is minutes, realtime not needed here).
  const [engRoster, setEngRoster] = useState<string[]>([])
  /**
   * SEED IS A LIST OF GROUPS (Eli, 2026-09-04). One seed used to describe one
   * shape, so a WO needing "Studio B Sep 10–23 day rate" AND "Studio A Sep
   * 12–14 hourly" meant seeding, waiting, re-opening and seeding again. Each
   * group is an independent set of rows; Add rows applies them in order.
   *
   * The studio PREFILLS from the room this work order is for — the seed panel
   * is opened from a WO that already knows its room, so asking again was a
   * blank field with exactly one right answer.
   */
  type SeedGroup = {
    id: string
    studio: string; start: string; end: string; from: string; to: string
    rateType: 'day' | 'hour'; rate: string
    engOn: boolean; engName: string; engRate: string; engRole: 'engineer' | 'assistant'
  }
  const newSeedGroup = useCallback((from?: SeedGroup): SeedGroup => ({
    id: crypto.randomUUID(),
    // A second group usually varies ONE thing (the room, or the dates), so it
    // inherits the previous group rather than starting blank.
    studio: from?.studio ?? (booking.studio ? toStudioLetter(booking.studio) : ''),
    start: '', end: '',
    from: from?.from ?? '', to: from?.to ?? '',
    rateType: from?.rateType ?? 'day', rate: from?.rate ?? '',
    engOn: from?.engOn ?? false, engName: from?.engName ?? '',
    engRate: from?.engRate ?? '', engRole: from?.engRole ?? 'assistant',
  }), [booking.studio])
  const [seedGroups, setSeedGroups] = useState<SeedGroup[]>(() => [{
    id: crypto.randomUUID(),
    studio: booking.studio ? toStudioLetter(booking.studio) : '',
    start: '', end: '', from: '', to: '',
    rateType: 'day', rate: '',
    engOn: false, engName: '', engRate: '', engRole: 'assistant',
  }])
  const patchSeed = useCallback((id: string, patch: Partial<SeedGroup>) => {
    setSeedGroups(prev => prev.map(g => g.id === id ? { ...g, ...patch } : g))
  }, [])
  /** What the last Add rows actually did — a skipped date must not be silent. */
  const [seedMsg, setSeedMsg] = useState<string | null>(null)
  // ── Batch edit (admin only) ──────────────────────────────────────────────
  // Replaced per-cell fill-down arrows. Bulk changes are a deliberate act on a
  // deliberate surface: pick a scope, tick the fields you mean, apply once.
  // The runner has no equivalent — a runner records their own shift.
  type BatchField = 'room' | 'from' | 'to' | 'rate' | 'ot_hours' | 'ot_rate' | 'staff' | 'notes'
  const [batchOpen, setBatchOpen] = useState(false)
  // ── Monthly split (Eli, 2026-08-26) ────────────────────────────────────────
  // Monthly lockouts ($19.5k / $29.5k deals) are ONE flat number for the month
  // — no clean day rate exists (19,500 ÷ 31 repeats). The office types the
  // monthly amount here and it is allocated across the dated studio rows to
  // the cent (largest-remainder: some days get one cent more) so the rows sum
  // to EXACTLY the monthly figure and daily financial numbers stay real. Rows
  // become ordinary day-rate rows — 12h agreed window, OT beyond it, runner
  // flow, PDF and projections all unchanged. OT rate stays typed per deal
  // (deliberately NOT the 10%-of-day-rate autofill). Re-run after adding or
  // removing days; it re-splits idempotently.
  const [monthlyOpen, setMonthlyOpen] = useState(false)
  const [monthlyAmt, setMonthlyAmt] = useState('')
  // The deal's OT rate (per hour, typed per deal — monthlies include 12h/day
  // and everything beyond is OT at this rate). Applied to every dated studio
  // row alongside the split so OT has a home the moment the month is set up.
  const [monthlyOt, setMonthlyOt] = useState('')
  // Default daily session window, stamped onto every day row (runners edit
  // each day as it's worked). N/A is for 24-hour rent-only lockouts where
  // clocks are meaningless — it blanks the times and zeroes OT instead.
  const [monthlyFrom, setMonthlyFrom] = useState('')
  const [monthlyTo, setMonthlyTo] = useState('')
  const [monthlyNA, setMonthlyNA] = useState(false)
  /**
   * STAFF IS ITS OWN QUESTION (Eli, 2026-09-03). It used to be welded to the
   * N/A times toggle — `eng_visible: !monthlyNA` — which made two unrelated
   * facts one switch. A monthly lockout normally has NO staff (Camper: 24/7,
   * rent only), so that is the default; Mustard is the exception that proves
   * the split, because he has real daily times AND an assistant. Without the
   * separation his thirty rows each carried an empty staff line nobody wanted,
   * and a no-times lockout could never have staff at all.
   * Per-day exceptions already have a home: the day card's × clears a staff
   * line and + Add Engineer / + Add Assistant puts one back. So this is one
   * control in one modal rather than a new button on every work order.
   */
  const [monthlyStaff, setMonthlyStaff] = useState(false)
  // The month's date range. A lockout booked from one calendar click has ONE
  // day row — the modal takes start/end dates and CREATES the missing day rows
  // for the whole range before splitting, so "monthly" never silently means
  // "one day" (Eli, 2026-08-26).
  const [monthlyStart, setMonthlyStart] = useState('')
  const [monthlyEnd, setMonthlyEnd] = useState('')

  function openMonthly() {
    // Seed the range from what exists: dated rows first, booking dates second.
    const dated = stRows.filter(r => (r.studio || '').trim() && r.date).map(r => r.date).sort()
    setMonthlyStart(dated[0] || booking.start_date || '')
    setMonthlyEnd(dated[dated.length - 1] || booking.end_date || booking.start_date || '')
    setMonthlyOpen(true)
  }

  function closeMonthly() {
    setMonthlyOpen(false)
    setMonthlyAmt(''); setMonthlyOt(''); setMonthlyFrom(''); setMonthlyTo(''); setMonthlyNA(false)
    setMonthlyStart(''); setMonthlyEnd(''); setMonthlyStaff(false)
  }

  function applyMonthlySplit() {
    const total = stripCurrency(monthlyAmt) ?? 0
    const otRate = stripCurrency(monthlyOt) ?? 0
    const start = monthlyStart
    const end = monthlyEnd || monthlyStart
    if (!(total > 0) || !start) return
    const dates = dateRange(start, end)
    if (dates.length === 0) return
    const dateSet = new Set(dates)

    // Create any missing day rows for the range (same shape addStRow builds).
    const lastStudioRow = [...stRows].reverse().find(r => !!r.studio)
    const rowStudio = lastStudioRow?.studio || (booking.studio ? toStudioLetter(booking.studio) : 'A')
    const rowLocation = lastStudioRow?.location || booking.location || ''
    let maxOrder = stRows.reduce((m, r) => Math.max(m, r.sort_order ?? -1), -1)
    const haveDate = new Set(stRows.filter(r => (r.studio || '').trim()).map(r => r.date))
    const from = monthlyNA ? '' : monthlyFrom
    const to = monthlyNA ? '' : monthlyTo
    const created: StRow[] = dates.filter(d => !haveDate.has(d)).map((d): StRow => {
      maxOrder += 1
      return {
        id: crypto.randomUUID(),
        studio: rowStudio, location: rowLocation,
        eng_name: '', date: d, session_info: '',
        from_time: from, to_time: to,
        total_hours: monthlyNA ? null : calcHours(from, to),
        rate: '', rate_daily: '', row_rate_type: 'day' as const,
        ot_rate: otRate > 0 ? String(otRate) : '',
        ot_hours: '0', ot_charge: null, charge: null,
        sort_order: maxOrder, day_count: null,
        eng_hours: null, eng_rate: '', eng_charge: null,
        eng_from_time: from, eng_to_time: to,
        actual_from_time: '', actual_to_time: '',
        admin_checked: false, admin_locked: false,
        // Staff is the modal's own answer now (monthlyStaff), not a side
        // effect of the times toggle — see the state declaration.
        eng_visible: monthlyStaff,
        eng_role: 'assistant' as const,
        status: 'in_progress' as const,
      }
    })

    const all = [...stRows, ...created]
    const targets = all
      .filter(r => (r.studio || '').trim() !== '' && r.date && dateSet.has(r.date))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    if (targets.length === 0) return
    const totalCents = Math.round(total * 100)
    const base = Math.floor(totalCents / targets.length)
    const rem = totalCents - base * targets.length
    const shareById = new Map<string, number>()
    targets.forEach((r, i) => shareById.set(r.id, (base + (i < rem ? 1 : 0)) / 100))

    setStRows(all.map(r => {
      const share = shareById.get(r.id)
      if (share === undefined) return r
      const u = { ...r, row_rate_type: 'day' as const, rate_daily: formatCurrency(share.toFixed(2)), charge: share }
      if (monthlyNA) {
        // 24-hour lockout: no clocks, no OT. The flat share is the whole story.
        u.from_time = ''; u.to_time = ''
        u.total_hours = null
        u.ot_hours = '0'; u.ot_charge = null
      } else if (monthlyFrom || monthlyTo) {
        u.from_time = monthlyFrom
        u.to_time = monthlyTo
        const hrs = calcHours(monthlyFrom, monthlyTo)
        u.total_hours = hrs
        // Same OT derivation as the day-rate updateRow path: beyond 12h = OT.
        u.ot_hours = String(Math.max(0, parseFloat(((hrs ?? 0)).toFixed(2)) - 12))
      }
      if (otRate > 0) u.ot_rate = String(otRate)
      const rn = parseFloat((u.ot_rate ?? '').replace(/[^0-9.]/g, '')) || 0
      const h = parseFloat(u.ot_hours ?? '0') || 0
      u.ot_charge = h > 0 && rn > 0 ? parseFloat((h * rn).toFixed(2)) : null
      return u
    }))
    closeMonthly()
  }
  const [batchScope, setBatchScope] = useState<'all' | 'range'>('all')
  const [batchFrom, setBatchFrom] = useState('')
  const [batchTo, setBatchTo] = useState('')
  const [batchOn, setBatchOn] = useState<Record<BatchField, boolean>>({
    room: false, from: false, to: false, rate: false, ot_hours: false, ot_rate: false, staff: false, notes: false,
  })
  const [batchVals, setBatchVals] = useState({
    location: '', studio: '',
    from_time: '', to_time: '',
    rateType: 'hour' as 'hour' | 'day', rate: '',
    ot_hours: '', ot_rate: '',
    staffRole: 'engineer' as 'engineer' | 'assistant', staffName: '',
    session_info: '',
  })
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null)
  const [confirmDeleteSession, setConfirmDeleteSession] = useState(false)
  // Non-session block (Tour/Tech/Open Hours) simple date fields
  const [blockStart, setBlockStart] = useState(booking.start_date || '')
  const [blockEnd, setBlockEnd] = useState(booking.end_date || booking.start_date || '')
  const [confirmClearEngId, setConfirmClearEngId] = useState<string | null>(null)
  // Day-card × (Eli, 2026-08-18: "no way to delete a day card on the WO").
  // Holds the date of the card awaiting its yes/no. Admin only.
  const [confirmDeleteDay, setConfirmDeleteDay] = useState<string | null>(null)
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
  // ── Studio Time view toggle (Eli, 2026-08-15 — mock docs/design-refs/runner-wo-views.html)
  // 'list' = the §16/§18 day blocks; 'cards' = one day, one card, tap → day sheet.
  // Available to everyone (same component, gating it off would be extra code);
  // only the DEFAULT differs: desktop admin defaults to list (the table is the
  // working surface), phones default to cards for 1–3 day sessions and list for
  // longer ones. null = not yet decided (rows not loaded).
  const [stView, setStView] = useState<'list' | 'cards' | null>(null)
  // The day sheet: which date's card is open for editing (card view only).
  const [daySheetDate, setDaySheetDate] = useState<string | null>(null)
  // Snapshot of the open day's rows, taken when the sheet opens (and again on
  // ‹ › day changes) — the baseline the sheet's Cancel reverts to (Eli,
  // 2026-08-18: "need save/cancel on the day pop up for runner and admin").
  // Save keeps the edits in state (persisting stays with the top-bar Save /
  // the runner's Submit); Cancel restores exactly this day's rows.
  const sheetSnapRef = useRef<StRow[]>([])
  useEffect(() => {
    if (daySheetDate !== null) {
      sheetSnapRef.current = stRows
        .filter(r => (r.date || '') === daySheetDate)
        .map(r => ({ ...r }))
      // A DAY ALWAYS HAS A STAFF LINE (Eli, 2026-08-20) — and it needs NO code.
      // `studio_time_rows.eng_visible` defaults to TRUE, so every room row
      // already carries a visible staff slot; the old filters were hiding it
      // by also demanding a name or a rate, which is what made a fresh session
      // look unstaffed. The filters now ask only `eng_visible !== false`.
      //
      // Nothing is auto-created or auto-revealed here on purpose: an earlier
      // version seeded a standalone row (broke time inheritance, left junk
      // rows), and a later one flipped hidden slots back to visible — which
      // would have silently undone the × that means "no staff on this day".
      // false is a deliberate state and this code must never overturn it.
    }
    // Deliberately NOT depending on stRows: the baseline is the moment the
    // sheet opened, not every keystroke since.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daySheetDate])
  // Which time well's preset dropdown is open (key = rowId|field).
  const [timeDDKey, setTimeDDKey] = useState<string | null>(null)
  // Swipe-between-days (Eli, 2026-08-16): touch start X, for the day sheet.
  const sheetTouchX = useRef<number | null>(null)
  // Runner submit (today's rows → 'submitted').
  const [submittingRun, setSubmittingRun] = useState(false)
  // Needs-attention photo upload (ported from the deleted runner WO page —
  // writes immediately, like the equipment note photos).
  const [naUploading, setNaUploading] = useState(false)
  const naFileRef = useRef<HTMLInputElement>(null)
  // Needs-attention strip: open/closed on admin desktop only (2026-08-18). It
  // is a single strip pinned to the bottom of the words column and it GROWS
  // ONLY WHEN IT HAS CONTENT — this flag is the manual override for adding the
  // first note. Pure UI state; mobile ignores it and always renders the field.
  const [naOpen, setNaOpen] = useState(false)
  // The two independent scroll bins on the admin-desktop numbers column
  // (2026-08-18). Days and rentals scroll separately — a multi-day session with
  // no rentals must not spend height on an empty rentals scroller, and vice
  // versa. Each ref feeds its own <ScrollHints>. Only one studio-time view
  // (list or cards) is mounted at a time, so they share stBinRef.
  const stBinRef = useRef<HTMLDivElement | null>(null)
  const rentBinRef = useRef<HTMLDivElement | null>(null)
  // Live-merge bookkeeping (Eli, 2026-08-16 — "I want EVERYTHING live").
  // Snapshots of payments/rentals as loaded; if the local state still matches
  // its snapshot the user hasn't touched that table and remote changes adopt.
  const paySnapRef = useRef<string>('')
  const rentSnapRef = useRef<string>('')
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref mirrors for the live-merge: the realtime channel is created once, so
  // its callbacks close over THAT render's state — reading these refs instead
  // keeps the merge honest about what is currently dirty / loading / open.
  const dirtyFieldsRef = useRef(dirtyFields)
  const openNoteKeyRef = useRef<string | null>(null)
  const loadingRef = useRef(true)
  const [siPopoverRowId, setSiPopoverRowId] = useState<string | null>(null)
  const [siPopoverText, setSiPopoverText] = useState('')
  const [siPopoverPos, setSiPopoverPos] = useState<{ top: number; left: number } | null>(null)
  // Track which rows exist in DB (vs. local-only new rows)
  // (rentIdsInDb / payIdsInDb removed — save_work_order_atomic upserts on id,
  // so the insert-vs-update split is no longer tracked client-side.)
  const equipNoteFileRef = useRef<HTMLInputElement>(null)
  const pendingNoteKey = useRef<{ key: string; equipment: string; date: string } | null>(null)
  const adminCanvasRef = useRef<HTMLCanvasElement>(null)
  const adminIsDrawingRef = useRef(false)
  const adminInitialSigRef = useRef('')
  const originalStRowsRef = useRef<StRow[]>([])
  const deletedRowsRef = useRef<StRow[]>([])

  // ── WO history (Eli, 2026-09-01 — lib/woActivity, options A + C) ───────────
  // The WO-field baseline for the save diff. Rows already have one
  // (originalStRowsRef, kept for Cancel-revert); this is its WO-fields twin.
  // Captured once, on the first non-null `wo` (the loaded record, before any
  // edit), and re-baselined after every successful save. A live-merge from the
  // other side between captures can attribute that edit to this saver — known,
  // tolerated: history is a record of saves, not a lock.
  const woSnapRef = useRef<Record<string, string> | null>(null)
  // Whether an invoice was already attached when this popup opened — drives the
  // entry's after_invoice ⚠ (the same fact billing derives as drift).
  const hadInvoiceRef = useRef(false)
  const [histOpen, setHistOpen] = useState(false)
  useEffect(() => {
    if (wo && !woSnapRef.current) woSnapRef.current = woAuditView(wo as unknown as Record<string, unknown>)
  }, [wo])

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

  useEffect(() => { dirtyFieldsRef.current = dirtyFields }, [dirtyFields])
  useEffect(() => { openNoteKeyRef.current = openNoteKey }, [openNoteKey])
  useEffect(() => { loadingRef.current = loading }, [loading])

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

  // Default Studio Time view, decided ONCE per open, after rows load.
  // RULING UPDATED 2026-08-18 (Eli, after the desktop V1 card shipped):
  // CARDS ARE THE DEFAULT EVERYWHERE for 1–3-day sessions — desktop admin
  // included ("card view default"; most sessions are one day). Longer runs
  // still open in list, where scanning 30 days as cards would be scrolling
  // punishment. The toggle overrides; this only picks the opening view.
  // (Supersedes the 2026-08-15 desktop-always-list rule.)
  useEffect(() => {
    if (loading || stView !== null) return
    const dayCount = new Set(stRows.filter(r => r.date).map(r => r.date)).size
    // RUNNER ALWAYS DEFAULTS TO CARDS (Eli, 2026-08-16). Everyone else —
    // admin desktop included (Eli, 2026-08-18) — opens in cards for short
    // sessions (≤3 days) and list for long runs.
    setStView(runner ? 'cards' : (dayCount > 0 && dayCount <= 3 ? 'cards' : 'list'))
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time subscription: work_orders status updates only
  useEffect(() => {
    if (!resolvedWoId) return

    // One channel, every table the popup renders (Eli, 2026-08-16). Events
    // funnel into the debounced live-merge — see refreshFromDb for the rule.
    const woChannel = supabase
      .channel(`wo-live-${resolvedWoId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'work_orders', filter: `id=eq.${resolvedWoId}` }, () => { queueRefresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_time_rows', filter: `work_order_id=eq.${resolvedWoId}` }, () => { queueRefresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment_condition_rows', filter: `work_order_id=eq.${resolvedWoId}` }, () => { queueRefresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment_condition_notes', filter: `work_order_id=eq.${resolvedWoId}` }, () => { queueRefresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_rows', filter: `work_order_id=eq.${resolvedWoId}` }, () => { queueRefresh() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_rows', filter: `work_order_id=eq.${resolvedWoId}` }, () => { queueRefresh() })
      .subscribe()

    // Phones suspend the socket when the screen locks and missed events are
    // never replayed — refresh on return to the foreground (same pattern as
    // hooks/useReloadOnReturn, inlined here because the merge is local).
    const onReturn = () => { if (document.visibilityState === 'visible') queueRefresh() }
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)

    return () => {
      supabase.removeChannel(woChannel)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
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
    // same function the booking-save path uses.
    if (!existing) {
      // RUNNER IS ADOPT-ONLY (standing rule since June 30, 2026). A runner never
      // creates a work order — creation is an office act at booking-save. The
      // old runner page enforced this; runner mode keeps enforcing it.
      if (runner) {
        setWoMissing('Work order not yet created — contact office.')
        setLoading(false)
        return
      }
      if (!booking.id) {
        setWoMissing('No booking selected — save the booking first.')
        setLoading(false)
        return
      }
      if (importedPast) {
        // Imported WordPress history: no WO exists and none may ever be
        // created. Open a read-only view seeded from the booking row alone —
        // readOnly (set above) hides every write control, and handleClose's
        // !readOnly guard means nothing here can reach the database.
        primaryBookingIdRef.current = booking.id
        const base = normalizeWO({})
        base.session_status = (booking as any).status || 'confirmed'
        base.session_type = (booking as any).session_type || 'recording'
        base.client = booking.client_name ?? ''
        base.artist = (booking as any).artist ?? ''
        base.label = (booking as any).label ?? ''
        base.session_date = booking.start_date ?? ''
        base.from_time = booking.from_time ?? ''
        base.to_time = booking.to_time ?? ''
        base.session_notes = (booking as any).notes ?? ''
        setWo(base)
        setLoading(false)
        return
      }
      if (!bookingShouldHaveWorkOrder(booking)) {
        // Legacy block (Tour/Tech/Open-Hours/cancelled made before the WO
        // rebuild) — no WO row exists and none should be created. Open the
        // simple block editor against the booking alone: handleBlockSave
        // already guards its work_orders write on woIdRef, so saving a
        // WO-less block works. (Step 8 — this replaced the BookingForm
        // fallback when BookingForm was deleted.)
        primaryBookingIdRef.current = booking.id
        const base = normalizeWO({})
        base.session_status = (booking as any).status || 'tour'
        base.client = booking.client_name ?? ''
        base.from_time = booking.from_time ?? ''
        base.to_time = booking.to_time ?? ''
        setWo(base)
        setLoading(false)
        return
      }
      try {
        await createWorkOrderForBooking(booking, { id: profile?.id ?? null, name: profile?.display_name || '' })
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
      // History: was an invoice already attached when we opened? (normalizeWO
      // drops the invoice columns from `wo` state, so read the raw record.)
      hadInvoiceRef.current = !!(existing as any).invoice_doc_path
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
      const [{ data: st }, { data: eq }, { data: rent }, { data: pay }, { data: eqNotes }, { data: exp }] = await Promise.all([
        supabase.from('studio_time_rows').select('*').eq('work_order_id', existing.id).order('sort_order'),
        supabase.from('equipment_condition_rows').select('*').eq('work_order_id', existing.id),
        supabase.from('rental_rows').select('*').eq('work_order_id', existing.id).order('sort_order'),
        supabase.from('payment_rows').select('*').eq('work_order_id', existing.id).order('recorded_at'),
        supabase.from('equipment_condition_notes').select('*').eq('work_order_id', existing.id),
        supabase.from('wo_expenses').select('*').eq('work_order_id', existing.id).order('sort_order'),
      ])
      setExpenses((exp ?? []) as WoExpense[])
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
        const arr = rent.map(r => ({ id: r.id, qty: String(r.qty ?? ''), item: r.item ?? '', supplier: r.supplier ?? '', dates_used: r.dates_used ?? '', rate: r.rate ?? '', charge: String(r.charge ?? '') }))
        setRentRows(arr)
        rentSnapRef.current = JSON.stringify(arr)
      }
      if (pay?.length) {
        const arr = pay.map(p => ({ id: p.id, payment_type: p.payment_type ?? '', amount: p.amount != null ? formatCurrency(String(p.amount)) : '', memo: p.memo ?? '', last_four: p.last_four ?? '', fee_amount: p.fee_amount != null ? formatCurrency(String(p.fee_amount)) : '' }))
        setPayRows(arr)
        paySnapRef.current = JSON.stringify(arr)
      }
    }
    setLoading(false)
  }

  // ── LIVE MERGE (Eli, 2026-08-16: "I want EVERYTHING live") ────────────────
  // The popup was strictly local-first: load once, edit, one atomic save. That
  // is still the WRITE model — but the open work order now also LISTENS. When
  // the other side saves (office fixes a rate while a runner has the day sheet
  // open, or a runner submits times while the office is looking), every field
  // the local user has NOT touched updates in place. "Touched" is derived by
  // comparing local state against the load-time original, so it covers single
  // edits, batch edit and the seed panel without separate bookkeeping. Your
  // unsaved edits always win locally; everything else is the database's.
  async function refreshFromDb() {
    const id = woIdRef.current
    if (!id || loadingRef.current) return
    const [{ data: woRow }, { data: st }, { data: eq }, { data: eqNotes }, { data: rent }, { data: pay }, { data: exp }] = await Promise.all([
      supabase.from('work_orders').select('*').eq('id', id).maybeSingle(),
      supabase.from('studio_time_rows').select('*').eq('work_order_id', id).order('sort_order'),
      supabase.from('equipment_condition_rows').select('*').eq('work_order_id', id),
      supabase.from('equipment_condition_notes').select('*').eq('work_order_id', id),
      supabase.from('rental_rows').select('*').eq('work_order_id', id).order('sort_order'),
      supabase.from('payment_rows').select('*').eq('work_order_id', id).order('recorded_at'),
      supabase.from('wo_expenses').select('*').eq('work_order_id', id).order('sort_order'),
    ])
    setExpenses((exp ?? []) as WoExpense[])

    // WO header fields — adopt remote except the keys the user has dirtied.
    if (woRow) {
      onStatusChange?.(woRow.status ?? 'open')
      setWo(prev => {
        if (!prev) return prev
        const base: WO = normalizeWO(woRow)
        base.session_status = base.session_status || (booking as any).status || 'tentative'
        base.session_type = base.session_type || (booking as any).session_type || 'recording'
        base.client_id = base.client_id ?? ((booking as any).client_id ?? null)
        base.is_srs = base.is_srs || !!(booking as any).is_srs
        base.cod_method = base.cod_method || (booking as any).cod_method || ''
        for (const k of Object.keys(base) as (keyof WO)[]) {
          if (dirtyFieldsRef.current.has(k as string)) (base as any)[k] = prev[k]
        }
        return base
      })
    }

    // Studio time rows — per-FIELD merge against the load-time original.
    if (st) {
      const freshRows = st.map(normalizeStRow)
      const freshById: Record<string, StRow> = {}
      for (const f of freshRows) freshById[f.id] = f
      const origById: Record<string, StRow> = {}
      for (const o of originalStRowsRef.current) origById[o.id] = o
      setStRows(prev => {
        const localById: Record<string, StRow> = {}
        for (const l of prev) localById[l.id] = l
        // Fresh order leads; a row deleted remotely disappears (the office owns
        // structure) — EXCEPT rows the DB never had (locally added, unsaved).
        const merged: StRow[] = freshRows.map(f => {
          const local = localById[f.id]
          const orig = origById[f.id]
          if (!local || !orig) return f
          const m: StRow = { ...f }
          for (const k of Object.keys(f) as (keyof StRow)[]) {
            if (JSON.stringify(local[k]) !== JSON.stringify(orig[k])) (m as any)[k] = local[k]
          }
          return m
        })
        for (const l of prev) {
          if (!freshById[l.id] && !origById[l.id]) merged.push(l) // locally added, not yet saved
        }
        return merged
      })
      originalStRowsRef.current = freshRows
    }

    // Equipment — condition writes are immediate on both sides; adopt remote.
    // The note map is skipped while a note is open so typing isn't clobbered.
    if (eq) setEquipRows(eq as EquipRow[])
    if (eqNotes && !openNoteKeyRef.current) {
      const map: Record<string, EquipNote> = {}
      for (const n of eqNotes) map[`${n.equipment}||${n.date}`] = { id: n.id, note: n.note ?? '', photo_urls: n.photo_urls ?? [] }
      setEquipNotes(map)
    }

    // Rentals / payments — coarse guard: adopt remote only while the local
    // table is untouched (matches its snapshot, or is still the empty shell).
    if (rent) {
      const arr = rent.map(r => ({ id: r.id, qty: String(r.qty ?? ''), item: r.item ?? '', supplier: r.supplier ?? '', dates_used: r.dates_used ?? '', rate: r.rate ?? '', charge: String(r.charge ?? '') }))
      setRentRows(prev => {
        const untouched = rentSnapRef.current
          ? JSON.stringify(prev) === rentSnapRef.current
          : prev.every(r => !r.item && !r.charge)
        if (!untouched) return prev
        rentSnapRef.current = JSON.stringify(arr)
        return arr.length ? arr : prev
      })
    }
    if (pay) {
      const arr = pay.map(p => ({ id: p.id, payment_type: p.payment_type ?? '', amount: p.amount != null ? formatCurrency(String(p.amount)) : '', memo: p.memo ?? '', last_four: p.last_four ?? '', fee_amount: p.fee_amount != null ? formatCurrency(String(p.fee_amount)) : '' }))
      setPayRows(prev => {
        const untouched = paySnapRef.current
          ? JSON.stringify(prev) === paySnapRef.current
          : prev.every(p => !p.payment_type && !p.amount)
        if (!untouched) return prev
        paySnapRef.current = JSON.stringify(arr)
        return arr.length ? arr : prev
      })
    }
  }

  // Debounced trigger — a save on the other side lands as several row events
  // at once; one refresh covers them all.
  function queueRefresh() {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => { refreshFromDb() }, 350)
  }

  // ── Admin canvas signature ──────────────────────────────────────────────────

  useEffect(() => {
    if (loading) return
    const canvas = adminCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = 'var(--c-fg)'
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
    ctx.strokeStyle = 'var(--c-fg)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
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
    setDirtyFields(prev => new Set(prev).add('signature_data'))
    setWo(w => w ? { ...w, signature_data: canvas.toDataURL('image/png') } : w)
  }

  function clearAdminSignature() {
    const canvas = adminCanvasRef.current; if (!canvas) return
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setDirtyFields(prev => new Set(prev).add('signature_data'))
    setWo(w => w ? { ...w, signature_data: '' } : w)
  }

  // ── Studio time row updates ─────────────────────────────────────────────────

  function updateStRow(id: string, updates: Partial<StRow>) {
    const row = stRows.find(r => r.id === id)
    // RUNNER FIELD LOCKS (defence in depth — the inputs are also disabled).
    // A locked day is the office's; rates are the office's on every day.
    if (runner) {
      if (row?.admin_locked) return
      delete (updates as any).rate
      delete (updates as any).rate_daily
      delete (updates as any).ot_rate
      delete (updates as any).eng_rate
      delete (updates as any).row_rate_type
      if (Object.keys(updates).length === 0) return
      // OT IS A DESIGNATION, DERIVED FROM THE CLOCK (Eli, 2026-08-16): the
      // agreed window is the booked from/to (hourly) or 12h (day-rate; already
      // auto below). When a runner moves the times on an HOURLY row, OT hours
      // are recomputed as time beyond the booked hours — never typed, so the
      // same hours can't be billed twice and the count can't disagree with the
      // clock. Admin edits stay manual — overriding is the office's call.
      if (row && row.row_rate_type !== 'day' && ('from_time' in updates || 'to_time' in updates)) {
        const bookedHrs = calcHours(booking.from_time ?? '', booking.to_time ?? '')
        const actualHrs = calcHours(
          ('from_time' in updates ? updates.from_time : row.from_time) ?? '',
          ('to_time' in updates ? updates.to_time : row.to_time) ?? '',
        )
        if (bookedHrs != null && actualHrs != null) {
          (updates as any).ot_hours = String(Math.max(0, parseFloat((actualHrs - bookedHrs).toFixed(2))))
        }
      }
    }
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
          // Twin-field sync (house law, DAY_HOUR_RATIO): editing the day rate
          // rewrites the hidden hourly to day ÷ 10, so no stale hourly can
          // survive to poison a later Day→Hr toggle.
          if ('rate_daily' in updates && !isNaN(rn) && rn > 0) {
            u.rate = String(parseFloat((rn / DAY_HOUR_RATIO).toFixed(2)))
          }
          // OT rate auto-calc: the hourly equivalent (day ÷ DAY_HOUR_RATIO)
          if (!('ot_rate' in updates)) {
            u.ot_rate = rn > 0 ? String(parseFloat((rn / DAY_HOUR_RATIO).toFixed(2))) : u.ot_rate
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
        // Twin-field sync (house law, DAY_HOUR_RATIO): editing the hourly rate
        // rewrites the hidden day rate to hourly × 10 — same anti-stale rule
        // as the day branch, other direction.
        if ('rate' in updates) {
          const rn = parseFloat((u.rate ?? '').replace(/[^0-9.]/g, ''))
          if (!isNaN(rn) && rn > 0) u.rate_daily = String(parseFloat((rn * DAY_HOUR_RATIO).toFixed(2)))
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

      // Staff times FOLLOW the session times unless they were set independently.
      //
      // A staff line under a studio row is that session's engineer/assistant — the
      // two are the same record and belong together. But engineers genuinely do
      // come in before or leave after the session, so an explicitly different time
      // must survive. The test is whether the staff time still MATCHES the time the
      // session had before this edit: if it does, it was just following along and
      // should keep following. If it doesn't, someone set it deliberately — leave it.
      if ('from_time' in updates && r.from_time !== updates.from_time) {
        if (!u.eng_from_time || u.eng_from_time === r.from_time) u.eng_from_time = u.from_time
      }
      if ('to_time' in updates && r.to_time !== updates.to_time) {
        if (!u.eng_to_time || u.eng_to_time === r.to_time) u.eng_to_time = u.to_time
      }

      // Eng charge
      if ('eng_hours' in updates || 'eng_rate' in updates || 'from_time' in updates || 'to_time' in updates || 'eng_from_time' in updates || 'eng_to_time' in updates) {
        const ef = u.eng_from_time || u.from_time
        const et = u.eng_to_time   || u.to_time
        const eh = calcHours(ef, et) ?? (u.eng_hours != null ? Number(u.eng_hours) : null)
        const er = parseFloat((u.eng_rate ?? '').replace(/[^0-9.]/g, ''))
        // Write the hours back too. This block recomputed the CHARGE from the times
        // but left eng_hours stale, so a saved row could carry hours that didn't
        // match its own charge until the next reload re-derived them.
        u.eng_hours = eh
        u.eng_charge = eh != null && eh > 0 && !isNaN(er) && er > 0 ? parseFloat((eh * er).toFixed(2)) : null
      }
      return u
    }))
  }

  // Toggle a row between 'hour' and 'day' rate type, auto-deriving the companion rate
  // Rows a batch edit would touch: dated STUDIO rows only, never approved ones.
  //
  // Standalone staff rows (blank studio) are excluded — they're ad-hoc additions
  // with no room, times or rate of their own, and sweeping them up in a bulk
  // change is how you silently rewrite someone's extra assistant.
  // admin_locked rows are excluded because approved work must not move under
  // anyone; the panel reports how many it skipped rather than staying silent.
  function batchTargets(): StRow[] {
    return stRows.filter(r => {
      if (!r.date || !(r.studio || '').trim() || r.admin_locked) return false
      if (batchScope === 'range') {
        if (batchFrom && r.date < batchFrom) return false
        if (batchTo && r.date > batchTo) return false
      }
      return true
    })
  }

  function batchLockedSkipped(): number {
    return stRows.filter(r => {
      if (!r.date || !(r.studio || '').trim() || !r.admin_locked) return false
      if (batchScope === 'range') {
        if (batchFrom && r.date < batchFrom) return false
        if (batchTo && r.date > batchTo) return false
      }
      return true
    }).length
  }

  // Apply only the ticked fields. Everything routes through updateStRow so charge,
  // OT and engineer totals recalculate through the SAME path as a manual edit —
  // no second copy of the billing maths. Local-first, so Cancel still reverts.
  function applyBatch() {
    const targets = batchTargets()
    if (targets.length === 0) { setBatchOpen(false); return }
    const patch: Partial<StRow> = {}
    if (batchOn.room && batchVals.studio) {
      patch.studio = batchVals.studio
      // location travels with studio or the two disagree; '' means "booking's venue".
      patch.location = batchVals.location === (booking.location || '') ? '' : batchVals.location
    }
    if (batchOn.from) patch.from_time = batchVals.from_time
    if (batchOn.to) patch.to_time = batchVals.to_time
    if (batchOn.rate) {
      patch.row_rate_type = batchVals.rateType
      // Both twins, always (house law DAY_HOUR_RATIO) — a batch that wrote one
      // side left the other stale, which is exactly the toggle glitch.
      const rn = parseFloat((batchVals.rate || '').replace(/[^0-9.]/g, '')) || 0
      if (batchVals.rateType === 'day') {
        patch.rate_daily = batchVals.rate
        if (rn > 0) patch.rate = String(parseFloat((rn / DAY_HOUR_RATIO).toFixed(2)))
      } else {
        patch.rate = batchVals.rate
        if (rn > 0) patch.rate_daily = String(parseFloat((rn * DAY_HOUR_RATIO).toFixed(2)))
      }
    }
    if (batchOn.ot_hours) patch.ot_hours = batchVals.ot_hours
    if (batchOn.ot_rate) patch.ot_rate = batchVals.ot_rate
    if (batchOn.notes) patch.session_info = batchVals.session_info
    if (batchOn.staff) {
      // One row carries ONE staffer + role, so this SETS that line (overwriting
      // whatever role/person it held) rather than adding a second person. Both an
      // engineer and an assistant on the same day needs a standalone staff row —
      // that's an add, not an edit, so it stays out of batch.
      patch.eng_name = batchVals.staffName.trim() || null
      patch.eng_role = batchVals.staffRole
      patch.eng_visible = !!batchVals.staffName.trim()
    }
    if (Object.keys(patch).length === 0) { setBatchOpen(false); return }
    for (const r of targets) updateStRow(r.id, patch)
    setBatchOpen(false)
    setBatchOn({ room: false, from: false, to: false, rate: false, ot_hours: false, ot_rate: false, staff: false, notes: false })
  }

  function toggleRowRateType(id: string) {
    setStRows(prev => prev.map(r => {
      if (r.id !== id) return r
      if (r.row_rate_type === 'hour') {
        // Hour → Day: rate_daily = rate × DAY_HOUR_RATIO, ALWAYS (Eli,
        // 2026-08-26: "day rate is always 10× hr, across the board"). The old
        // keep-if-manually-overridden heuristic is gone — it couldn't tell a
        // deliberate special rate from a stale leftover, and stale leftovers
        // are how $750/day became $750/hr on a toggle. A special deal is typed
        // AFTER toggling; the toggle itself is always the pure conversion.
        const rateNum = parseFloat(r.rate.replace(/[^0-9.]/g, '')) || 0
        const finalDaily = rateNum > 0 ? String(parseFloat((rateNum * DAY_HOUR_RATIO).toFixed(2))) : r.rate_daily
        const dailyNum = parseFloat(finalDaily.replace(/[^0-9.]/g, '')) || 0
        // Day-row OT rate is the hourly equivalent — which IS the rate we came
        // from, so carry it (or derive from the new daily when rate was blank).
        const otRate = rateNum > 0 ? String(rateNum) : (dailyNum > 0 ? String(parseFloat((dailyNum / DAY_HOUR_RATIO).toFixed(2))) : '')
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
        // Day → Hour: rate = rate_daily ÷ DAY_HOUR_RATIO, ALWAYS — same law,
        // same reason. No heuristic.
        const dailyNum = parseFloat(r.rate_daily.replace(/[^0-9.]/g, '')) || 0
        const finalRate = dailyNum > 0 ? String(parseFloat((dailyNum / DAY_HOUR_RATIO).toFixed(2))) : r.rate
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

  /**
   * ONE PILL, TAPPED (RULING 2026-08-13, spec §18 — REVISED 2026-08-20).
   *
   *   blank → OK → Not OK → blank → …
   *
   * The cycle now RETURNS TO BLANK. The original rule was that blank means
   * "nobody has answered yet" and a tap must not be able to destroy that. Real
   * use overruled it (Eli: "my staff is just clicking everything… need to be
   * able to zero it out if it gets touched before a session"): a day that was
   * tapped through by accident before the session had no way back to
   * unanswered, so "checked and fine" became the lie instead. An honest
   * unanswered state you can restore beats one nobody can correct.
   *
   * Both surfaces (runner + admin) get this — the runner is the likeliest
   * person to fat-finger a pill mid-load-in. Clearing a Not OK leaves its note
   * row in place; re-flagging the item shows the note again rather than
   * silently losing what someone wrote.
   */
  function cycleEquip(equipment: string, date: string) {
    const existing = equipRows.find(r => r.equipment === equipment && r.date === date)
    const next = existing?.condition === 'ok' ? 'not_ok'
      : existing?.condition === 'not_ok' ? null
      : 'ok'
    return setEquipCondition(equipment, date, next)
  }

  async function setEquipCondition(equipment: string, date: string, nextCond: 'ok' | 'not_ok' | null) {
    const key = `${equipment}||${date}`
    const existing = equipRows.find(r => r.equipment === equipment && r.date === date)

    // CREATE THE ROW IF IT ISN'T THERE (fix, 2026-08-13). Equipment rows are
    // seeded once, at work-order creation, for the dates the booking had THEN.
    // Add a day in the Studio Time table afterwards — which is normal, sessions
    // run long — and that day's cells had no row behind them, so the OK / ✗
    // buttons were gated on `row &&` and silently did nothing. Only the first
    // day worked, which is exactly what Eli saw.
    //
    // The column exists for the day because the table renders one per session
    // date; the ROW just hadn't been created. So create it on first tap.
    if (!existing) {
      if (!woIdRef.current) return
      const { data, error } = await supabase
        .from('equipment_condition_rows')
        .insert({ work_order_id: woIdRef.current, equipment, date, condition: nextCond })
        .select()
        .limit(1)
      if (!dbResult('Saving equipment condition', error)) return
      const created = data?.[0]
      if (created) setEquipRows(prev => [...prev, created as any])
    } else {
      // Was an unchecked write — a failure here left the screen showing a
      // condition the database never got (CLAUDE.md: every important write goes
      // through dbResult).
      const { error } = await supabase
        .from('equipment_condition_rows')
        .update({ condition: nextCond })
        .eq('id', existing.id)
      if (!dbResult('Saving equipment condition', error)) return
      setEquipRows(prev => prev.map(r => r.id === existing.id ? { ...r, condition: nextCond } : r))
    }

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

  // ── Food-budget expenses (immediate writes — equip-note pattern) ──────────

  async function addExpense() {
    if (!woIdRef.current) return
    const maxSort = expenses.reduce((m, e) => Math.max(m, e.sort_order), 0)
    // opsToday: a 1 AM food run belongs to the shift's night, which is what
    // the paper sheet's date column always meant (2026-09-01 midnight pass).
    const today = opsToday()
    const { data, error } = await supabase.from('wo_expenses').insert({
      work_order_id: woIdRef.current,
      // Prefill the sheet's short date (10/14) — the paper's habit.
      date: `${parseInt(today.slice(5, 7))}/${parseInt(today.slice(8, 10))}`,
      place: '', amount: '', sort_order: maxSort + 1,
    }).select().single()
    if (!dbResult('Adding expense', error) || !data) return
    setExpenses(prev => [...prev, data as WoExpense])
  }

  /** Local-state edit; the DB write happens on blur via saveExpense. */
  function editExpense(id: string, patch: Partial<WoExpense>) {
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }

  async function saveExpense(id: string) {
    const e = expenses.find(x => x.id === id)
    if (!e) return
    const { error } = await supabase.from('wo_expenses')
      .update({ date: e.date, place: e.place, amount: e.amount })
      .eq('id', id)
    dbResult('Saving expense', error)
  }

  async function deleteExpense(id: string) {
    if (!window.confirm('Delete this expense?')) return
    const { error } = await supabase.from('wo_expenses').delete().eq('id', id)
    if (!dbResult('Deleting expense', error)) return
    setExpenses(prev => prev.filter(e => e.id !== id))
  }

  async function uploadReceipt(file: File) {
    const id = pendingExpenseId.current
    if (!id || !woIdRef.current) return
    setRcptUploading(id)
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `wo-receipts/${woIdRef.current}/${id}_${Date.now()}.${ext}`
    const { data, error } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
    if (dbResult('Uploading receipt', error) && data) {
      const { error: updErr } = await supabase.from('wo_expenses').update({ receipt_path: data.path }).eq('id', id)
      if (dbResult('Saving receipt', updErr)) {
        setExpenses(prev => prev.map(e => e.id === id ? { ...e, receipt_path: data.path } : e))
      }
    }
    setRcptUploading(null)
    if (expenseFileRef.current) expenseFileRef.current.value = ''
    pendingExpenseId.current = null
  }

  async function viewReceipt(path: string) {
    const url = await signedPhotoUrl(path)
    if (url) setReceiptPreview(url)
  }

  // Sign a thumbnail URL for every attached receipt while the panel is open.
  // Keyed by PATH, so a replaced receipt (new path) signs fresh and nothing
  // ever shows a stale photo. Signed URLs outlive any realistic panel session.
  useEffect(() => {
    if (!showExpenses) return
    let alive = true
    const missing = expenses.filter(e => e.receipt_path && !rcptThumbs[e.receipt_path])
    if (missing.length === 0) return
    ;(async () => {
      for (const e of missing) {
        const url = await signedPhotoUrl(e.receipt_path!)
        if (!alive) return
        if (url) setRcptThumbs(prev => ({ ...prev, [e.receipt_path!]: url }))
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExpenses, expenses])

  // ── Add studio time row ────────────────────────────────────────────────────

  function addStRow() {
    const maxOrder = stRows.reduce((max, r) => Math.max(max, r.sort_order ?? -1), -1)
    // Inherit from the last STUDIO row specifically — a standalone staff row has
    // studio '' (the eng-row encoding), and inheriting that would turn this
    // "studio time" row into an engineer row.
    const lastStudioRow = [...stRows].reverse().find(r => !!r.studio)
    const last = lastStudioRow ?? ([...stRows].reverse().find(r => !!(r.studio || r.date)) ?? stRows[stRows.length - 1])
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
      // A studio-time row must never start with studio '' (that's an eng row):
      // last studio row → booking's room → 'A'.
      studio: lastStudioRow?.studio || (booking.studio ? toStudioLetter(booking.studio) : 'A'),
      location: lastStudioRow?.location || booking.location || '',
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
      // Staff times MIRROR the session times on creation (RULING 2026-08-10).
      // They stay editable for the genuine cases where an engineer's shift
      // differs, and the follow-unless-set-independently rule above keeps them
      // in step until someone deliberately changes one. These used to start
      // blank, which is how rows reached billing with no staff hours at all —
      // the seed path (lib/seedStudioTimeRows) always filled them, so only rows
      // added by hand after WO creation had the gap.
      eng_from_time: fromTime,
      eng_to_time: toTime,
      actual_from_time: '',
      actual_to_time: '',
      admin_checked: false,
      admin_locked: false,
      eng_visible: true,
      // Follow the row above (so a session staffed with an engineer keeps adding
      // engineers), otherwise fall back to assistant.
      eng_role: last?.eng_role || 'assistant',
      status: 'in_progress',
    }
    setStRows(prev => [...prev, newRow])
    if (last?.eng_rate || (last?.eng_hours ?? 0) > 0) setShowEngRows(true)
  }

  // Standalone staff row — engineer (1ST) or assistant (2ND). Any number of
  // these can be added per day, fully custom, independent of studio rows.
  /**
   * Add a staff line TO A GIVEN DAY (Eli, 2026-08-20, building a real session:
   * "there wasnt a place for rate and there was nothing for eng/ass
   * assignemtn… that needs to exist on the card"). The day sheet only ever
   * rendered staff blocks for rows that already existed, so a session with no
   * seeded staff offered nothing to fill in and no way to add one without
   * leaving the sheet. Same shape as addEngRow, but dated and returning the
   * new row's id so the sheet's snapshot can include it.
   */
  /**
   * A staff line's effective times (2026-08-20 fix). Staff times follow the
   * ROOM's times until someone overrides them — but "the room" is the studio
   * row for that DATE, which for a standalone staff row (studio: '') is a
   * different row entirely. The old fallback read the row's own from_time,
   * which on a standalone row is always empty, so added staff showed blank
   * times forever. Looked up live rather than copied at creation, so entering
   * the room's times later fills the staff line in by itself.
   */
  function staffTimes(r: StRow): { from: string; to: string } {
    if (r.eng_from_time || r.eng_to_time) {
      return { from: r.eng_from_time || '', to: r.eng_to_time || '' }
    }
    if (r.studio !== '') return { from: r.from_time || '', to: r.to_time || '' }
    const room = stRows.find(x => x.studio !== '' && (x.date || '') === (r.date || ''))
    return { from: room?.from_time || '', to: room?.to_time || '' }
  }

  function addEngRowForDate(role: 'engineer' | 'assistant', date: string) {
    const maxOrder = stRows.reduce((max, r) => Math.max(max, r.sort_order ?? -1), -1)
    const dayStudio = stRows.find(r => (r.date || '') === date && r.studio !== '')
    const lastEng = [...stRows].reverse().find(r => r.eng_rate)
    const newRow: StRow = {
      id: crypto.randomUUID(),
      studio: '', location: '', eng_name: '', date,
      session_info: '', from_time: '', to_time: '', total_hours: null,
      rate: '', rate_daily: '', row_rate_type: 'hour',
      ot_rate: '', ot_hours: '', ot_charge: null, charge: null,
      sort_order: maxOrder + 1, day_count: null,
      // Follow the day's studio window — the same "staff times follow the
      // studio times until you change them" rule the sheet already states.
      eng_from_time: dayStudio?.from_time || '',
      eng_to_time: dayStudio?.to_time || '',
      eng_rate: lastEng?.eng_rate || '',
      eng_hours: null, eng_charge: null,
      actual_from_time: '', actual_to_time: '',
      admin_checked: false, admin_locked: false, eng_visible: true,
      eng_role: role, status: 'in_progress',
    }
    setStRows(prev => [...prev, newRow])
  }

  function addEngRow(role: 'engineer' | 'assistant' = 'assistant') {
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
      actual_from_time: '',
      actual_to_time: '',
      admin_checked: false,
      admin_locked: false,
      eng_visible: true,
      eng_role: role,
      status: 'in_progress',
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

  // Deletes EVERY row of a day card in one call (Eli, 2026-08-18). Same
  // contract as deleteStRow: immediate DB delete, rows parked in
  // deletedRowsRef so Cancel re-inserts them. dbResult per the audit rule —
  // a silent failed delete here would leave the card on screen after reload.
  async function deleteDayRows(rows: StRow[]) {
    const ids = rows.map(r => r.id)
    const { error } = await supabase.from('studio_time_rows').delete().in('id', ids)
    if (!dbResult('Deleting day', error)) return
    deletedRowsRef.current = [...deletedRowsRef.current, ...rows]
    setStRows(prev => prev.filter(r => !ids.includes(r.id)))
    setConfirmDeleteDay(null)
  }

  async function clearEngRow(id: string) {
    await supabase.from('studio_time_rows').update({
      // Clearing resets the role to the default (assistant), not to engineer —
      // otherwise clearing a row silently promoted it back to 1ST.
      eng_name: null, eng_role: 'assistant', eng_from_time: null, eng_to_time: null, eng_rate: null, eng_hours: null, eng_charge: null, eng_visible: false,
    }).eq('id', id)
    setStRows(prev => prev.map(r => r.id === id ? { ...r, eng_name: '', eng_role: 'assistant', eng_from_time: '', eng_to_time: '', eng_rate: '', eng_hours: null, eng_charge: null, eng_visible: false } : r))
    setConfirmClearEngId(null)
  }

  // ── Export ────────────────────────────────────────────────────────────────

  /**
   * SAVE, THEN DOWNLOAD (ruling 2026-08-11). Eli: "you make changes, that saves,
   * and then you hit save and download where it regenerates another updated
   * one." Exporting a work order you have edited but not saved would hand a
   * client a document that disagrees with the record — so the save is part of
   * the act, not a thing you have to remember first.
   *
   * REPLACES window.print() AND THE PRINT STYLESHEET. The browser dialogue gave
   * you a page to save by hand at whatever margins Chrome felt like, and it
   * could not be stapled to an invoice. The PDF is now DRAWN, server-side, in
   * black and white — /api/wo-package, laid out in lib/woPdf.
   *
   * Nothing is stored: every export is built from the live record at the moment
   * you ask, so a stale export cannot exist.
   */
  async function exportPdf() {
    if (!woIdRef.current) return
    setExporting(true)
    if (!readOnly) await saveOnly()
    // `wo=1` — the work order alone. An invoice is only stapled on from the
    // billing hub, where there is one to staple.
    await downloadPackage(woIdRef.current, true)
    setExporting(false)
  }

  // ── Per-row admin lock ────────────────────────────────────────────────────

  async function handleToggleLock(rowId: string, currentLocked: boolean) {
    const newLocked = !currentLocked
    const { error: lockErr } = await supabase.from('studio_time_rows').update({
      admin_checked: newLocked,
      admin_locked: newLocked,
    }).eq('id', rowId)
    // Was a silent write (the audited defect class) — found while adding the
    // history call below; checked now like every important write.
    if (!dbResult('Saving day review', lockErr)) return
    // History: the lock IS the admin review (house convention, 2026-09-01 —
    // runner submits, admin reviews, owner approves). Unlocking is history
    // too: a reopened day is exactly the kind of thing to see who did.
    const lockedRow = stRows.find(r => r.id === rowId)
    if (woIdRef.current) {
      void logWoActivity({
        workOrderId: woIdRef.current,
        actorId: profile?.id ?? null,
        actorName: profile?.display_name || '',
        source: 'office',
        kind: 'reviewed',
        afterInvoice: hadInvoiceRef.current,
        changes: [{ what: newLocked ? 'Reviewed the day' : 'Review reopened', day: lockedRow?.date || null }],
      })
    }
    setStRows(prev => prev.map(r => r.id === rowId
      ? { ...r, admin_checked: newLocked, admin_locked: newLocked }
      : r
    ))
    if (!newLocked) {
      setPendingLockedEdits(p => { const n = { ...p }; delete n[rowId]; return n })
    }
  }

  // ── Runner mode: needs-attention photos, flag sync, Submit ─────────────────
  // All three ported from the deleted app/runner/[studio]/wo/[id]/page.tsx —
  // behaviour unchanged, they just live on the shared component now.

  async function uploadNAPhoto(file: File) {
    if (!woIdRef.current || !wo) return
    setNaUploading(true)
    const ext = file.name.split('.').pop()
    const path = `na-photos/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    const { data, error: uploadError } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
    if (!uploadError && data) {
      // Store the storage PATH — checklist-photos is private; reads sign on demand.
      const prevPhotos = wo.needs_attention_photos ?? []
      const newPhotos = [...prevPhotos, data.path]
      setWo(w => w ? { ...w, needs_attention_photos: newPhotos } : w)
      const { error: dbError } = await supabase.from('work_orders')
        .update({ needs_attention_photos: newPhotos })
        .eq('id', woIdRef.current)
      // A console.error is invisible to a runner on a phone — surface it.
      if (!dbResult('Saving attention photo', dbError)) setWo(w => w ? { ...w, needs_attention_photos: prevPhotos } : w)
    } else {
      dbResult('Uploading attention photo', uploadError)
    }
    setNaUploading(false)
    if (naFileRef.current) naFileRef.current.value = ''
  }

  async function deleteNAPhoto(url: string) {
    if (!wo) return
    const prevPhotos = wo.needs_attention_photos ?? []
    const updated = prevPhotos.filter(u => u !== url)
    setWo(w => w ? { ...w, needs_attention_photos: updated } : w)
    if (woIdRef.current) {
      const { error: rmErr } = await supabase.from('work_orders')
        .update({ needs_attention_photos: updated.length > 0 ? updated : null })
        .eq('id', woIdRef.current)
      // Put the photo back on screen if the removal didn't land.
      if (!dbResult('Removing attention photo', rmErr)) setWo(w => w ? { ...w, needs_attention_photos: prevPhotos } : w)
    }
  }

  /**
   * Keep the wo_flag row in step with the needs-attention note. Runs on every
   * runner save (handleClose calls it): a note raises/updates the flag, an
   * emptied note resolves it. This is the runner page's exact behaviour —
   * the flag system stays the office's record of "something needs a look".
   */
  async function syncRunnerFlag() {
    if (!runner || !woIdRef.current || !wo) return
    const woId = woIdRef.current
    const notes = (wo.needs_attention_notes || '').trim()
    if (notes) {
      const artistPart = booking.artist || wo.artist || ''
      const clientPart = booking.client_name || wo.client || booking.label || wo.label || ''
      const sessionParts = [artistPart, clientPart].filter(Boolean).join(' / ')
      const studioLabel = runnerStudioLabel || runnerStudio || ''
      const sourceLabel = sessionParts ? `${studioLabel} · ${sessionParts}` : studioLabel
      const { data: existingFlag } = await supabase
        .from('flags').select('id').eq('source_id', woId).eq('source', 'wo_flag').maybeSingle()
      if (existingFlag) {
        const { error } = await supabase.from('flags')
          .update({ runner_note: notes, status: 'pending', created_by_name: profile?.display_name || null }).eq('id', existingFlag.id)
        dbResult('Updating flag', error)
      } else {
        const { error } = await supabase.from('flags').insert({
          studio: runnerStudio, source: 'wo_flag', source_id: woId,
          source_label: sourceLabel, runner_note: notes, status: 'pending',
          // Flag names (2026-09-01). The WO has no typed-initials field, so the
          // profile name is the best we have — the shared runner login reads as
          // its display name until per-person runner logins exist.
          created_by_name: profile?.display_name || null,
        })
        dbResult('Raising flag', error)
      }
    } else {
      const { data: existingFlag } = await supabase
        .from('flags').select('id').eq('source_id', woId).eq('source', 'wo_flag').maybeSingle()
      if (existingFlag) {
        const { error } = await supabase.from('flags')
          .update({ status: 'resolved', resolved_note: 'Needs attention cleared by runner' })
          .eq('id', existingFlag.id)
        dbResult('Resolving flag', error)
      }
    }
  }

  /**
   * THE RUNNER'S TERMINAL ACT (spec §15): save everything through the same
   * atomic RPC the admin uses, then mark today's rows 'submitted'. Submitted
   * is a SIGNAL, not a seal — the runner can reopen and edit until the office
   * approves a day (admin_locked), then that day alone is out of reach. There
   * is no penalty for resubmitting; the button just reads "Update submission"
   * once today's rows are already in. Sessions with no rows dated today still
   * save (a runner fixing yesterday), they just have nothing to mark.
   */
  async function handleRunnerSubmit() {
    if (!woIdRef.current) return
    setSubmittingRun(true)
    const saved = await handleClose(false)
    if (!saved) { setSubmittingRun(false); return }
    // opsToday, NEVER getLocalToday (Eli, 2026-09-01: "we definitely need to
    // anticipate runners submitting after midnight. this will be 80% of
    // sessions"). This was the Aug 28 rule's one miss in this file: keyed on
    // the calendar day, a 1 AM submit matched no rows and silently marked
    // nothing. The 8:50 AM boundary IS the no-midnight-logic implementation —
    // the shift's day holds until the building turns over.
    const today = opsToday()
    const todayIds = stRows.filter(r => r.date === today).map(r => r.id)
    if (todayIds.length > 0) {
      const { error } = await supabase.from('studio_time_rows')
        .update({ status: 'submitted' }).in('id', todayIds)
      if (!dbResult('Submitting today', error)) { setSubmittingRun(false); return }
      const mark = (rows: StRow[]) => rows.map(r =>
        todayIds.includes(r.id) && r.status !== 'approved' ? { ...r, status: 'submitted' } : r)
      setStRows(mark)
      originalStRowsRef.current = mark(originalStRowsRef.current)
      // History: the runner's terminal act gets its own line (the save above
      // already logged any field changes as a 'saved' entry).
      void logWoActivity({
        workOrderId: woIdRef.current,
        actorId: profile?.id ?? null,
        actorName: profile?.display_name || '',
        source: 'runner',
        kind: 'submitted',
        afterInvoice: hadInvoiceRef.current,
        changes: [{ what: 'Day submitted', day: today }],
      })
    }
    setSubmittingRun(false)
    onClose()
  }

  // ── Projection (Step 5b): one WO → one booking card per room-run ────────────
  // Splits the WO's dated studio rows into segments of consecutive same-room days.
  // Segment 0 updates the primary booking; extra segments become secondary cards
  // (same work_order_id) so a session that moves rooms shows a card in each room.
  // Pure builder: computes the primary-card update + secondary-card payloads for
  // the per-room-segment projection. All WRITES happen atomically inside the
  // save_work_order_atomic RPC (matching by (studio, start_date), stale delete).
  function buildBookingProjection(woId: string): { primaryCard: Record<string, any>; secondaryCards: Record<string, any>[] } {
    const venue = booking.location || ''
    const dated = stRows.filter(r => r.date && r.studio).sort((a, b) => a.date.localeCompare(b.date))

    // Build segments (new segment on room change OR non-consecutive date).
    // Each segment carries BOTH an engineer (1ST) and an assistant (2ND) —
    // first named staffer per role wins.
    type Seg = { studio: string; location: string; start: string; end: string; from: string; to: string; eng: string; asst: string }
    const applyStaff = (seg: Seg, name: string, role: string) => {
      if (!name) return
      if (role === 'assistant') { if (!seg.asst) seg.asst = name }
      else { if (!seg.eng) seg.eng = name }
    }
    const segs: Seg[] = []
    for (const r of dated) {
      const last = segs[segs.length - 1]
      const rLoc = r.location || venue
      if (last && last.studio === r.studio && last.location === rLoc && isNextDay(last.end, r.date)) {
        last.end = r.date
        applyStaff(last, r.eng_name, r.eng_role || 'assistant')
      } else {
        const seg: Seg = { studio: r.studio, location: rLoc, start: r.date, end: r.date, from: r.from_time, to: r.to_time, eng: '', asst: '' }
        applyStaff(seg, r.eng_name, r.eng_role || 'assistant')
        segs.push(seg)
      }
    }
    // Standalone staff rows (+ Add Engineer / + Add Assistant — no studio) fold
    // into every segment covering their date, so a day can carry both roles.
    for (const sr of stRows.filter(r => r.date && !r.studio && r.eng_name)) {
      for (const seg of segs) {
        if (sr.date >= seg.start && sr.date <= seg.end) applyStaff(seg, sr.eng_name, sr.eng_role || 'assistant')
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
      is_srs: wo.is_srs,
      invoice_num: wo.invoice_number || null,
      po: wo.po_number || null,
      notes: wo.session_notes || null,
      anr_contact_id: wo.anr_contact_id,
      anr_admin_contact_id: wo.anr_admin_contact_id,
      work_order_id: woId,
      wo_number: wo.wo_number || null,
    }
    // Staff initials for the card: segment staff (1ST + 2ND can coexist), with
    // the legacy WO-level fields as fallback. When neither role has a name we
    // omit both keys so a save never wipes existing card initials; when at
    // least one is known we write both explicitly (name or null) so removals
    // and role flips propagate to the card.
    const staffFor = (seg: Seg): Record<string, any> => {
      const eng = seg.eng || wo.engineer || ''
      const asst = seg.asst || wo.second_engineer || ''
      if (!eng && !asst) return {}
      return { engineer_name: eng || null, assistant_name: asst || null }
    }
    const scheduleFor = (seg: Seg) => ({
      ...staffFor(seg),
      location: seg.location || venue || undefined,
      studio: roomLabelForVenue(seg.location || venue, seg.studio),
      start_date: seg.start,
      end_date: seg.end,
      from_time: seg.from || null,
      to_time: seg.to || null,
    })

    // No dated rows yet: just make sure the primary card carries the session
    // fields + WO link (no schedule overwrite, no secondary cards).
    if (segs.length === 0) {
      return { primaryCard: sessionFields, secondaryCards: [] }
    }

    // Segment 0 → the primary booking card; segments 1..n → secondary cards.
    return {
      primaryCard: { ...sessionFields, ...scheduleFor(segs[0]) },
      secondaryCards: segs.slice(1).map(seg => ({
        ...sessionFields,
        ...scheduleFor(seg),
        engineer_status: 'not_needed',
        assistant_status: 'not_needed',
      })),
    }
  }

  // ── Complete WO ───────────────────────────────────────────────────────────

  async function handleComplete() {
    if (!woIdRef.current || !wo) return

    const reopening = wo.status === 'completed'

    // REOPEN IS BACK (Eli, 2026-08-24 — reversing the 2026-08-11 removal).
    // The removal reasoned that nothing read the reopened state and the button
    // sat one slip from Save; then the office hit Complete by accident and the
    // only undo was SQL. The slip risk is answered with a confirm instead of
    // absence.
    if (reopening && !window.confirm('Reopen this work order? It goes back to OPEN and comes out of the billing queue until it’s completed again.')) return

    // Gate COMPLETING only. Re-opening a WO must never be blocked — that would
    // strand a bad WO in the completed state with no way back to fix it.
    // Lockouts skip the times rule entirely (lib/woValidation.woNeedsTimes) —
    // rent rows have no times, and rent must still be invoiceable.
    if (!reopening && woNeedsTimes(booking.status)) {
      const problems = findMissingTimes(stRows)
      if (problems.length > 0) {
        setTimeErrorRows(new Set(problems.map(p => p.rowId)))
        setTimeErrorMsg(missingTimesMessage(problems))
        return
      }
    }
    setTimeErrorRows(new Set())
    setTimeErrorMsg(null)

    setCompleting(true)

    // SAVE FIRST, THEN STAMP, THEN CLOSE (fix, 2026-08-13).
    //
    // The footer comment has claimed since 2026-08-11 that this "saves and
    // closes". It never did — it wrote the status and left you sitting in the
    // popup with your edits unsaved, so you then pressed Close and got asked
    // whether to save. Worse, Complete is what starts the billing pipeline, so
    // a work order could enter billing with the numbers on screen not yet
    // written to the row anyone would bill from.
    //
    // `handleClose(false)` is the existing save path (save_work_order_atomic +
    // the booking projection). It returns having reported its own failure, so
    // if the save fails we must NOT go on to stamp it completed.
    if (isDirty()) {
      const saved = await handleClose(false)
      if (!saved) { setCompleting(false); return }
    }

    const newStatus = reopening ? 'open' : 'completed'
    const now = new Date().toISOString()
    const { error: completeErr } = await supabase.from('work_orders').update({
      status: newStatus,
      admin_approved_at: newStatus === 'completed' ? now : null,
    }).eq('id', woIdRef.current)

    // Reopening also takes it back OUT of billing — but only from
    // 'needs_invoice', the state Complete itself set. An invoice already in
    // flight (sent/paid/approved) is never dragged back by a reopen.
    if (!completeErr && reopening) {
      await supabase.from('work_orders')
        .update({ invoice_state: null })
        .eq('id', woIdRef.current)
        .eq('invoice_state', 'needs_invoice')
    }

    // COMPLETING STARTS THE BILLING PROCESS (ruling 2026-08-11).
    //
    // Completing used to be a dead end: the WO closed and the money
    // conversation left for QuickBooks and never came back. In Eli's actual
    // workflow this is the gate — billing reviews the runner's work order,
    // completes it, and only then goes to QuickBooks for the invoice.
    //
    // Lands in "Needs invoice", NOT "Needs approval". Nothing reaches an
    // owner's queue until the invoice PDF is attached. Applies to COD and
    // Billing alike: "this starts the billing process regardless."
    //
    // enterInvoicePipeline refuses to touch a work order whose invoice is
    // already in flight, so re-completing cannot drag a sent invoice back.
    //
    // Non-blocking on purpose: if this fails the WO is still completed, and
    // billing's own screen can pick it up. Failing the completion because a
    // downstream stamp did not stick would be the tail wagging the dog.
    if (!completeErr && newStatus === 'completed') {
      await enterInvoicePipeline(woIdRef.current)
    }

    setWo(prev => prev ? { ...prev, status: newStatus } : prev)
    onStatusChange?.(newStatus)
    setCompleting(false)
    // AND CLOSE. Complete WO is "I'm done here" — leaving the popup open made it
    // a step rather than a decision, and left people pressing Close afterwards
    // wondering whether the first press had done anything.
    if (!reopening) onClose()
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

  /**
   * Save and close. `close=false` saves in place — used by the PDF export, which
   * must never hand out a document that disagrees with the saved record.
   */
  /**
   * Returns TRUE only when everything was written. Complete WO calls this to
   * save before it stamps the work order, and must not stamp a work order whose
   * save just failed (fix, 2026-08-13).
   */
  async function handleClose(close = true): Promise<boolean> {
    if (!wo) { if (close) onClose(); return false }
    // Tour/Tech/Open-Hours → save as a simple block, skip the WO body + projection.
    if (BLOCK_STATUSES.includes(wo.session_status)) { await handleBlockSave(); return true }
    if (!woIdRef.current) {
      // A legacy WO-less block whose status was flipped to a real session:
      // create its WO now (atomic RPC), then fall through to the normal save.
      if (!booking.id) { onClose(); return false }
      setSaving(true)
      try {
        const { workOrderId } = await createWorkOrderForBooking(
          { ...(booking as any), status: wo.session_status } as Booking,
          { id: profile?.id ?? null, name: profile?.display_name || '' },
        )
        woIdRef.current = workOrderId
        primaryBookingIdRef.current = booking.id
      } catch (e: any) {
        setSaving(false)
        dbResult('Creating work order', { message: e?.message ?? String(e) })
        return false
      }
      setSaving(false)
    }

    // ── VENUE GUARD (Eli's ruling, 2026-08-17 — found in launch testing) ──
    // A dated studio row with no VENUE saves fine and shows in Billing, but
    // projects a booking card the calendar cannot place — the session becomes
    // invisible exactly where the office looks for it. So the save refuses
    // until every dated studio row has a venue picked in its studio dropdown.
    // Office-only: runners cannot edit location, so blocking them would trap
    // them behind a field that isn't theirs (same logic as the hidden
    // eng-rate warning).
    if (!runner) {
      const venueless = stRows.filter(r =>
        r.studio !== '' && (r.date || '') !== '' &&
        !((r.location || booking.location || '').trim()),
      )
      if (venueless.length > 0) {
        setSaving(false)
        setTimeErrorRows(new Set(venueless.map(r => r.id)))
        setTimeErrorMsg('Pick a venue for each studio day (the studio dropdown — e.g. "Paramount · A"). Without a venue the session never appears on the calendar.')
        return false
      }

      setTimeErrorRows(new Set())
      setTimeErrorMsg(null)

      // ── CONFIRMING NEEDS START AND END TIMES ON EVERY DAY (Eli, 2026-09-03)
      // The failure this exists to stop: a session confirmed with blank times
      // that lands on the runner to guess. Every dated studio day needs both
      // From and To. Tentative saves freely (deals close before times settle);
      // lockouts are exempt entirely (woNeedsTimes — Mustard's times are
      // runner-entered live). Office-only: runners cannot set the status.
      if (woNeedsTimes(wo.session_status)) {
        const startProblem = confirmStartProblem(wo.session_status, stRows)
        if (startProblem) {
          setSaving(false)
          setTimeErrorRows(new Set(startProblem.rowIds))
          setTimeErrorMsg(startProblem.message)
          return false
        }
      }
    }

    setSaving(true)
    const id = woIdRef.current

    // ── Build every payload client-side (values computed here, single source),
    // then apply them in ONE all-or-nothing call to save_work_order_atomic.
    const woUpdate = {
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
      no_po_needed: wo.no_po_needed,
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
    }

    // Studio time rows — upserts (RPC conflicts on id; uniform key set required).
    const stPayloads = stRows.map(r => ({
      id: r.id,
      studio: r.studio, location: r.location || null, eng_name: r.eng_name || null, eng_role: r.eng_role, date: r.date, session_info: r.session_info,
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
      actual_from_time: r.actual_from_time || null,
      actual_to_time: r.actual_to_time || null,
      admin_checked: r.admin_checked,
      admin_locked: r.admin_locked,
      eng_visible: r.eng_visible,
    }))

    // Rental + payment rows that have content — upserts.
    const rentPayloads = rentRows.filter(r => r.item || r.charge).map(r => ({
      id: r.id, qty: parseInt(r.qty) || null, item: r.item || null, supplier: r.supplier || null, dates_used: r.dates_used || null, rate: r.rate || null, charge: parseFloat(r.charge) || null,
    }))
    const payPayloads = payRows.filter(p => p.payment_type || p.amount).map(p => ({
      id: p.id, payment_type: p.payment_type || null, amount: stripCurrency(p.amount), memo: p.memo || null, last_four: p.last_four || null,
      fee_amount: stripCurrency(p.fee_amount),
    }))

    // Projection (Step 5b): one WO → one booking card per room-run. Only when a
    // booking is resolvable — without it the RPC skips all card writes.
    const projection = booking.id ? buildBookingProjection(id) : null

    const { error: saveErr } = await supabase.rpc('save_work_order_atomic', {
      p_wo_id: id,
      p_wo: woUpdate,
      p_primary_booking_id: primaryBookingIdRef.current,
      p_primary_card: projection?.primaryCard ?? null,
      p_st_rows: stPayloads,
      p_rentals: rentPayloads,
      p_payments: payPayloads,
      p_secondary_cards: projection?.secondaryCards ?? [],
    })
    // All-or-nothing: on failure NOTHING was written — keep the popup open so
    // the user's edits aren't lost, and let them retry.
    if (!dbResult('Saving work order', saveErr)) { setSaving(false); return false }

    // Runner mode: keep the wo_flag row in step with the needs-attention note
    // on EVERY save, not just Submit — the old runner page did this in its one
    // save path and the office relies on the flag appearing promptly.
    if (runner) await syncRunnerFlag()

    // The lead that produced this session is marked booked HERE — on a successful
    // save — rather than when Start Booking was pressed. Opening a WO to check a
    // rate and backing out must not close the lead out of the pipeline.
    //
    // Deliberately a separate write, not part of save_work_order_atomic: the RPC
    // is the all-or-nothing unit for the WO + its line items + the booking cards,
    // and a CRM status change is not part of that unit. A failure here must not
    // roll back a saved session — it just reports and leaves the lead as-is.
    if (leadId && wo.session_status !== 'cancelled') {
      const { error: leadErr } = await supabase
        .from('leads')
        .update({ status: 'booked', keep_hot_until: null })
        .eq('id', leadId)
      dbResult('Marking lead booked', leadErr)
    }

    // ── History (lib/woActivity): diff the baselines against what was just
    // written, BEFORE they are re-baselined below. Fire-and-forget — a lost
    // history line must never fail or delay the save it describes. An empty
    // diff writes nothing (opening to look is not history).
    {
      const woAfter = woAuditView(wo as unknown as Record<string, unknown>)
      const changes = diffWoForSave({
        woBefore: woSnapRef.current,
        woAfter,
        rowsBefore: originalStRowsRef.current,
        rowsAfter: stRows,
        rowsDeleted: deletedRowsRef.current,
      })
      if (changes.length > 0) {
        void logWoActivity({
          workOrderId: id,
          actorId: profile?.id ?? null,
          actorName: profile?.display_name || (runner ? '' : 'Office'),
          source: runner ? 'runner' : 'office',
          kind: 'saved',
          afterInvoice: hadInvoiceRef.current,
          changes,
        })
      }
      woSnapRef.current = woAfter
    }

    originalStRowsRef.current = stRows
    deletedRowsRef.current = []
    setDirtyFields(new Set())
    // Re-baseline the live-merge: everything just written IS the database now.
    paySnapRef.current = JSON.stringify(payRows)
    rentSnapRef.current = JSON.stringify(rentRows)
    setSaving(false)
    onSaved?.()
    if (close) onClose()
    return true
  }

  const saveOnly = () => handleClose(false)

  /**
   * Has anything been touched? Drives the Close prompt and the greyed-out
   * Complete button.
   *
   * DELIBERATELY FAIL-SAFE: when this says "clean", Close still SAVES rather
   * than discarding (see handleCloseButton). So a signal this misses costs a
   * redundant write, never someone's work. Greying a button on an imperfect
   * detector is a hint; discarding data on one is a bug you find out about from
   * the person who lost an hour.
   */
  function isDirty(): boolean {
    if (dirtyFields.size > 0) return true
    if (deletedRowsRef.current.length > 0) return true
    return JSON.stringify(stRows) !== JSON.stringify(originalStRowsRef.current)
  }

  /**
   * CLOSE ONLY ASKS WHEN SOMETHING CHANGED (ruling 2026-08-11).
   *
   * Eli: "we will be opening and closing regularly just to check info, view to
   * approve — so I want a clear path for 'I'm updating this' and one for 'I'm
   * viewing this'." A prompt on every close would be a tax on the frequent path
   * to protect the rare one, and a dialogue people see fifty times a week is a
   * dialogue they dismiss without reading. So: nothing changed, it just closes.
   */
  function handleCloseButton() {
    if (isDirty()) { setConfirmClose(true); return }
    handleClose()
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
          studio: r.studio, location: r.location || null, eng_name: r.eng_name || null, eng_role: r.eng_role, date: r.date, session_info: r.session_info,
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

  // Money math lives in lib/woTotals (extracted 2026-08-10) so My Day's balances
  // queue computes a balance the same way this screen displays one.
  //
  // NO FALLBACK RATE (2026-08-13). This used to read
  // `liveForm?.engineer_rate || booking.engineer_rate`. BOTH are dead: the
  // booking form is deleted, `liveForm` is the leftover form-data shape, and
  // `buildBookingProjection` never writes `bookings.engineer_rate`. Staffing
  // lives ONLY in the Studio Time table (CLAUDE.md).
  //
  // It was not harmless. Billing, the invoice and the PDF all compute from the
  // ROWS, so a work order whose row had no rate but whose pre-rebuild booking
  // still carried the retired $55 default showed an engineer charge on this
  // screen that nothing downstream would ever bill. Three work orders were in
  // that state (WO-1001, WO-1002, WO-1008 — all open, none invoiced).
  const woTotals = computeWoTotals({
    studioRows: stRows,
    rentalRows: rentRows,
    paymentRows: payRows,
  })

  // Live, derived — no state, so they cannot get stale behind an edit.
  // Duplicates outrank a missing rate: being charged twice is a bigger error
  // than not being charged, and fixing it usually removes the other one too.
  const engRateWarning = missingEngRatesMessage(findMissingEngRates(stRows))
  const dupStaffWarning = duplicateStaffMessage(findDuplicateStaffLines(stRows))
  const stTotal = woTotals.studio
  const engTotal = woTotals.engineer
  const rentTotal = woTotals.rentals
  const cardFeesTotal = woTotals.cardFees
  const grandTotal = woTotals.grand
  const totalPaid = woTotals.paid
  const balanceDue = woTotals.balance

  // ── 3% COD card surcharge (Eli, 2026-08-26) ────────────────────────────────
  // COD only — billing/label sessions never carry the fee. The AMOUNT field is
  // what actually hit the card; the fee is the 3% slice inside it, derived by
  // cardFeeOfCharged so the runner types exactly what the terminal charged and
  // the split is exact. "Card Total" under Balance Due is the number staff
  // reads to the terminal — balance × 1.03 — so nobody does math at the desk.
  // wo is still null on the first render (before initWO resolves) — this block
  // sits ABOVE the loading/early returns, so it must never dereference wo bare.
  const isCodWo = wo?.payment_status === 'COD'
  const cardTotalDue = isCodWo && balanceDue > 0 ? cardTotalForBase(balanceDue) : 0

  /** Re-derive a payment row's fee from its type + amount. Card + COD → 3%
   *  slice of the charged amount; anything else → no fee. */
  function withCardFee(row: PayRow): PayRow {
    if (!isCodWo || !CARD_PAY_TYPES.includes(row.payment_type)) return { ...row, fee_amount: '' }
    const charged = stripCurrency(row.amount) ?? 0
    const fee = cardFeeOfCharged(charged)
    return { ...row, fee_amount: fee > 0 ? formatCurrency(String(fee)) : '' }
  }

  // Food budget math — spent is the expense rows' sum; remaining against
  // wo.food_amount. Text money fields, parsed the same way everywhere.
  const foodSpent = expenses.reduce((s, e) => s + (parseFloat((e.amount || '').replace(/[^0-9.-]/g, '')) || 0), 0)
  const foodBudgetNum = wo ? (parseFloat((wo.food_amount || '').replace(/[^0-9.-]/g, '')) || 0) : 0
  const foodRemaining = foodBudgetNum - foodSpent

  // ── Styles ────────────────────────────────────────────────────────────────

  // (`inp` deleted. Table cells now use `c-tin` — bare, per the §8 TABLE
  //  EXEMPTION; form fields use the `c-input c-inset2` well recipe.)

  // The single horizontal inset for every data table on this surface. Change it
  // here and headers, text cells and input cells all move together.
  const TCELL_X = 6
  const cellS: React.CSSProperties = {
    // 500 matches .c-tin — a computed cell (Hrs, OT Chg) and a typed cell must
    // carry the same weight or the row reads as two different kinds of data.
    padding: `3px ${TCELL_X}px`, fontSize: 11, fontFamily: 'Inter', fontWeight: 500, color: 'var(--c-fg)',
    display: 'flex', alignItems: 'center', minWidth: 0,
  }
  // A cell whose child is a .c-tin input: no inset of its own, because the input
  // carries it. Otherwise the inset would be applied twice and input columns
  // would sit 6px right of text columns — which is what was misaligned.
  const cellIn: React.CSSProperties = { ...cellS, padding: '3px 0' }
  // COLUMN HEADERS MATCH THE SECTION HEADERS (Eli, 2026-08-13). Same treatment
  // as `.c-lozenge` now that both are bare text (§16c): Inter 800, 0.1em, upper,
  // `--c-fg` at 45%. They used to be Archivo at `--c-fg-2`, which read as a
  // THIRD kind of type on a surface that already has display text and entry
  // text — and sat close enough to the entry text's weight to blur into it.
  // A header names a column; it should recede the same way a section name does.
  const thS: React.CSSProperties = {
    padding: `5px ${TCELL_X}px`, fontSize: 9, fontFamily: 'Inter, sans-serif', fontWeight: 800,
    letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg)', opacity: 0.45,
    display: 'flex', alignItems: 'center', minWidth: 0,
  }
  // Right-aligned header, for the money columns whose values are right-aligned.
  const thR: React.CSSProperties = { ...thS, justifyContent: 'flex-end' }
  function shortDate(d: string) {
    if (!d) return '—'
    const parts = d.split('-')
    if (parts.length < 3) return d
    return `${parseInt(parts[1], 10)}-${parseInt(parts[2], 10)}`
  }
  const metaLabel: React.CSSProperties = {
    fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400,
    letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-2)',
  }
  // "Thu, Aug 14" for the day cards / day sheet. T00:00:00 keeps the date in
  // local time — bare YYYY-MM-DD parses as UTC and shifts a day west of it.
  function weekdayDate(d: string) {
    if (!d) return 'No date'
    const dt = new Date(d + 'T00:00:00')
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  // ── Card-view helpers (Eli, 2026-08-15) ───────────────────────────────────
  // The equipment pills + Not-OK note, shared by the day cards and the day
  // sheet. The LIST view keeps its own §18 in-row copy untouched — these exist
  // so the card surfaces don't re-implement the cycle/note behaviour.
  function renderEquipPills(date: string, disabled: boolean) {
    if (!date) return null
    return (
      <div data-no-print="" style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {EQUIPMENT_ITEMS.map(eq => {
          const cond = equipRows.find(x => x.equipment === eq && x.date === date)?.condition ?? null
          const noteKey = `${eq}||${date}`
          const hasNote = !!(equipNotes[noteKey]?.note || (equipNotes[noteKey]?.photo_urls?.length ?? 0) > 0)
          return (
            <button
              key={eq}
              type="button"
              disabled={readOnly || disabled}
              onClick={e => { e.stopPropagation(); cycleEquip(eq, date) }}
              title={cond === null ? 'Not checked — tap to mark OK' : cond === 'ok' ? 'OK — tap if it was not' : 'Not OK — tap to clear back to not checked'}
              className={`c-eqpill${cond ? ` c-${cond === 'ok' ? 'ok' : 'bad'}` : ''}`}
            >
              <i />
              {eq}
              {cond === 'not_ok' && hasNote && <b>·</b>}
            </button>
          )
        })}
      </div>
    )
  }

  function renderEquipNoteBlock(date: string) {
    if (!date || !openNoteKey?.endsWith(`||${date}`)) return null
    const eq = openNoteKey.split('||')[0]
    const note = equipNotes[openNoteKey]
    return (
      <div data-no-print="" onClick={e => e.stopPropagation()} style={{ padding: '8px 12px', background: 'var(--c-wash2)', borderRadius: 12, marginTop: 8 }}>
        <div style={{ fontSize: 9, fontFamily: 'Inter, sans-serif', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-st-hot)', marginBottom: 6 }}>
          {eq} — what was wrong?
        </div>
        <textarea
          value={note?.note ?? ''}
          disabled={readOnly}
          onChange={e => setEquipNotes(prev => ({ ...prev, [openNoteKey]: { ...(prev[openNoteKey] ?? { id: '', photo_urls: [] }), note: e.target.value } }))}
          onBlur={e => upsertEquipNote(openNoteKey, eq, date, { note: e.target.value })}
          placeholder="Note about this issue…"
          style={{ width: '100%', background: 'transparent', borderRadius: 4, color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 11, padding: '5px 7px', resize: 'none', outline: 'none', boxSizing: 'border-box', minHeight: 52 }}
        />
        {(note?.photo_urls?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {note!.photo_urls.map((url, i) => (
              <SignedImage key={i} path={url} link alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
          {!readOnly && (
            <button
              type="button"
              disabled={noteUploading}
              onClick={() => { pendingNoteKey.current = { key: openNoteKey, equipment: eq, date }; equipNoteFileRef.current?.click() }}
              style={{ fontSize: 10, fontFamily: 'Inter', color: noteUploading ? 'var(--c-fg-3)' : 'var(--c-fg-2)', background: 'none', cursor: noteUploading ? 'not-allowed' : 'pointer', padding: 0 }}
            >
              {noteUploading ? 'Uploading…' : '+ Photo'}
            </button>
          )}
          <button type="button" onClick={() => setOpenNoteKey(null)} style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)', background: 'none', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}>
            Done
          </button>
        </div>
      </div>
    )
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
    const ready = seedGroups.filter(g => g.start)
    if (!woIdRef.current || ready.length === 0) return
    setSeedBusy(true)
    setSeedMsg(null)
    try {
      let added = 0
      let skipped = 0
      // Sequential, not Promise.all: each group's insert reads the rows already
      // present to skip dates it would duplicate, so they must not race.
      for (const g of ready) {
        const dates = dateRange(g.start, g.end || g.start)
        const res = await seedStudioTimeRows({
          workOrderId: woIdRef.current,
          studio: g.studio ? toStudioLetter(g.studio) : '',
          dates,
          fromTime: g.from,
          toTime: g.to,
          rateType: g.rateType,
          rate: g.rateType === 'hour' ? g.rate : '',
          rateDaily: g.rateType === 'day' ? g.rate : '',
          engRate: g.engOn && g.engRate ? g.engRate : undefined,
          engName: g.engOn && g.engName.trim() ? g.engName.trim() : undefined,
          engRole: g.engOn ? g.engRole : undefined,
        })
        added += res.inserted
        skipped += dates.length - res.inserted
        // A named 1ST engineer also becomes the WO-level fallback (legacy field,
        // used as the placeholder + card fallback). Assistants stay row-only.
        if (g.engOn && g.engName.trim() && g.engRole === 'engineer') {
          setDirtyFields(prev => new Set(prev).add('engineer'))
          setWo(w => w ? { ...w, engineer: g.engName.trim() } : w)
        }
      }
      const { data: reloaded } = await supabase.from('studio_time_rows')
        .select('*').eq('work_order_id', woIdRef.current).order('date')
      setStRows((reloaded ?? []).map(normalizeStRow))
      originalStRowsRef.current = (reloaded ?? []).map(normalizeStRow)
      setSeedGroups([newSeedGroup()])
      // SAY WHAT HAPPENED. Dates already in the table are skipped, and a group
      // that added nothing (its dates were all covered) used to close the panel
      // looking like it had worked.
      if (added === 0) {
        setSeedMsg(`Nothing added — ${skipped === 1 ? 'that date is' : 'those dates are'} already in the table.`)
      } else {
        setSeedMsg(null)
        setSeedOpen(false)
      }
    } finally {
      setSeedBusy(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={inline
      ? { position: 'static', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }
      : { position: 'fixed', top: (isMobile || runner) ? 0 : 52, left: 0, right: 0, bottom: 0, zIndex: 10010, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 12 }}>Loading work order…</div>
    </div>
  )

  if (woMissing) return (
    <div style={inline
      ? { position: 'static', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }
      : { position: 'fixed', top: (isMobile || runner) ? 0 : 52, left: 0, right: 0, bottom: 0, zIndex: 10010, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 360, padding: 24, background: 'var(--c-bg)', borderRadius: 12, textAlign: 'center' }}>
        <div style={{ color: 'var(--c-st-hot)', fontFamily: 'Inter', fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>{woMissing}</div>
        <button onClick={onClose} style={{ background: 'transparent', color: 'var(--c-fg)', borderRadius: 6, padding: '7px 18px', fontFamily: 'Inter', fontSize: 11, cursor: 'pointer' }}>Close</button>
      </div>
    </div>
  )

  if (!wo) return null

  // ── IMPORTED HISTORY (Eli, 2026-08-26): a past session imported from the
  // old WordPress calendar never shows the work order at all — there is no WO
  // and never will be. Just the session facts and a read-only notice.
  if (importedPast) {
    const b = booking as any
    const idTitle = b.label
      ? `${b.label}${b.artist ? ' — ' + b.artist : ''}`
      : (b.client_name || wo.client || '—')
    const times = [b.from_time, b.to_time].filter(Boolean).join(' – ')
    const dates = b.end_date && b.end_date !== b.start_date
      ? `${longDate(b.start_date)} – ${longDate(b.end_date)}`
      : longDate(b.start_date || '')
    const staff = [
      b.engineer_name ? `1ST-${b.engineer_name}` : null,
      b.assistant_name ? `2ND-${b.assistant_name}` : null,
    ].filter(Boolean).join(' · ')
    return (
      <div style={inline
        ? { position: 'static', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }
        : { position: 'fixed', top: isMobile ? 0 : 52, left: 0, right: 0, bottom: 0, zIndex: 10010, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <div className="c-sheet" style={{ width: '100%', maxWidth: 400, padding: 24, boxSizing: 'border-box' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <StatusBadge status={wo.session_status} />
            <span className="c-sub" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>
              Read only · imported from old calendar
            </span>
          </div>
          <div className="c-arch" style={{ fontSize: 20, marginBottom: 10 }}>{idTitle}</div>
          <div style={{ color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 13, lineHeight: 1.7 }}>
            <div>{[b.location, b.studio].filter(Boolean).join(' · ')}</div>
            <div>{dates}{times ? ` · ${times}` : ''}</div>
            {staff && <div className="c-sub" style={{ fontSize: 11 }}>{staff}</div>}
            {b.notes && <div className="c-sub" style={{ fontSize: 11, marginTop: 8 }}>{b.notes}</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={onClose} className="c-soft c-control c-raised">Close</button>
          </div>
        </div>
      </div>
    )
  }

  const woId = woIdRef.current
  const isCompleted = wo.status === 'completed'
  // Tour/Tech/Open-Hours → render the simplified "block" view (title + times only).
  const isBlock = BLOCK_STATUSES.includes(wo.session_status)
  // Runner-style section card (mobile only) — var(--c-bg) surface, var(--c-wash2) border,
  // radius 12, matching app/runner/[studio]/wo/[id]/page.tsx section cards.
  // Section containers are BANDS: one tone step, no depth, no border. Only the
  // outer sheet carves — nesting dents inside dents is what made this read muddy.
  const mCard: React.CSSProperties = { background: 'var(--c-wash)', borderRadius: 20, padding: 14, boxSizing: 'border-box' }
  // "Needs attention" variant — same band, warm status dot supplies the signal
  // rather than a coloured border (§5: colour is a fill, never an outline).
  const mCardOrange: React.CSSProperties = { background: 'var(--c-wash2)', borderRadius: 20, padding: 14, boxSizing: 'border-box' }

  // ── ADMIN DESKTOP, TWO COLUMNS (RULING 2026-08-18, task #11) ───────────────
  // mock: docs/design-refs/wo-compact-options.html — its header comment is the
  // ruling list and this layout is built to it.
  //
  //   WORDS LEFT (0.72fr) · NUMBERS RIGHT (1.28fr)
  //
  // `wide` is the ONE switch. Everything it gates is layout: where a block sits,
  // how tall a bin is, whether a hint renders. No saves, queries, realtime,
  // atomic RPCs, projections or lib/woPdf.ts behaviour changes with it — the PDF
  // is drawn from studio_time_rows on the server and never reads this DOM.
  //
  // Blocks (Tour/Tech/Open Hours) keep the old single column: they have no
  // numbers column to put beside anything. Mobile and runner keep the original
  // stack — see the `order` values below, which are what preserve it.
  const wide = !isMobile && !isBlock

  // Column members carry an explicit flex `order` so that when the two column
  // wrappers collapse to `display: contents` (mobile / block), the children fall
  // back into EXACTLY the sequence they had before this layout existed. The
  // numbers are spaced so a block can be inserted without renumbering.
  const ORD = {
    letterhead: 20, sessionTop: 30, seed: 50, studioTime: 60, studioTotal: 65,
    equipFile: 70, rentals: 80, spacer: 90, sessionNotes: 100, payments: 110,
    needsAttention: 120, mobileComplete: 130,
  }

  // ── Itemized studio running total (pinned under the days bin) ──────────────
  // "Totals always computed from studio_time_rows — no view invents math."
  // Every figure below is either straight from computeWoTotals (already the
  // canonical source for stTotal / engTotal) or a REGROUPING of the very same
  // per-row function the totals use, engChargeForRow. Sum(staffLines) is
  // engTotal by construction; nothing here is a second implementation.
  const staffLines = (() => {
    const m = new Map<string, { role: 'engineer' | 'assistant'; name: string; total: number }>()
    for (const r of stRows) {
      const amt = engChargeForRow(r)
      if (!(amt > 0)) continue
      const name = (r.eng_name || '').trim() || 'TBD'
      const key = `${r.eng_role}|${name.toLowerCase()}`
      const cur = m.get(key)
      if (cur) cur.total += amt
      else m.set(key, { role: r.eng_role, name, total: amt })
    }
    return Array.from(m.values())
  })()
  const otHoursAll = stRows.reduce((s, r) => s + (parseFloat(r.ot_hours || '0') || 0), 0)
  const otChargeAll = stRows.reduce((s, r) => s + (r.ot_charge ?? 0), 0)
  const dayCount = new Set(stRows.filter(r => r.date).map(r => r.date)).size
  // "It grows only when it has content" — content means a note OR a photo.
  const naHasContent = !!(wo.needs_attention_notes || '').trim() || (wo.needs_attention_photos?.length ?? 0) > 0

  // Small shared bits of the words column.
  const kLabel: React.CSSProperties = {
    fontSize: 8, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: 'var(--c-fg)', opacity: 0.42,
  }
  const internalTag: React.CSSProperties = {
    fontSize: 8, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--c-st-warm)', background: 'var(--c-wash2)',
    borderRadius: 5, padding: '2px 7px',
  }

  return (
    <div
      data-wo-portal=""
      style={inline
        ? { position: 'static', background: 'transparent' }
        : isMobile
        // top: 52 clears the Nav on mobile too. The Nav is z-index 99999 and is
        // deliberately ABOVE all modals (see CLAUDE.md), so a sheet starting at
        // top: 0 doesn't cover it — the Nav paints straight through the middle
        // of the sheet. The desktop branch below has always offset by 52 for
        // exactly this reason; the mobile branch just never carried it over.
        // The Nav is 52px tall on mobile as well (the 44px is the hamburger
        // button inside it, not the bar).
        // Runner routes have no Nav, so runner mode starts at top: 0.
        ? { position: 'fixed', top: runner ? 0 : 52, left: 0, right: 0, bottom: 0, zIndex: 10010, background: 'var(--c-bg)' }
        // DESKTOP: left: 176 clears the RAIL, not a top nav (fix 2026-08-18 —
        // Eli: "youll see the see-through issue"). The rail is 176px, sticky,
        // z 99999 and deliberately ABOVE modals; at maxWidth 1320 the sheet
        // reached under it and the rail's text painted through. top: 52 was
        // the OLD top-nav offset — the rail layout has no top bar, so it just
        // showed a strip of page above the sheet.
        : { position: 'fixed', top: 0, left: 176, right: 0, bottom: 0, zIndex: 10010, background: 'rgba(0,0,0,0.55)', overflowY: 'auto' }}
      onClick={inline || isMobile ? undefined : e => { if (e.target === e.currentTarget) handleCloseButton() }}
    >
      {isMobile && (
        <style>{`
          [data-wo-portal] input:not([type="checkbox"]):not([type="radio"]), [data-wo-portal] select, [data-wo-portal] textarea { min-height: 44px; }
          /* The Studio Time LIST is a table of inputs — the 44px tap-target
             rule inflated every row into a slab (Eli, 2026-08-16: "the list
             view is super padded"). Table cells get a tighter minimum; the
             cards/sheet keep the full-size wells for actual entry. */
          [data-wo-portal] [data-st-scroll] input:not([type="checkbox"]):not([type="radio"]), [data-wo-portal] [data-st-scroll] select { min-height: 30px; }
        `}</style>
      )}
      <div
        style={isMobile
          // height: '100%' rather than 100dvh — the fixed parent is now inset
          // 52px from the top, so 100dvh would overflow the viewport by exactly
          // the height of the Nav and push the footer buttons off-screen.
          ? { display: 'flex', flexDirection: 'column', height: '100%', padding: 0, boxSizing: 'border-box' }
          // wide: 8px top, not 20 — with the title band gone the sheet should
          // start just under the Nav (Eli: "i need that realestate").
          : { display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minHeight: '100%', padding: wide ? '8px 16px 16px' : '20px 16px', boxSizing: 'border-box' }}
        onClick={inline || isMobile ? undefined : e => { if (e.target === e.currentTarget) { readOnly ? onClose() : handleCloseButton() } }}
      >
      <div
        style={isMobile
          ? { width: '100vw', height: '100%', maxWidth: 'none', minWidth: 0, margin: 0, display: 'flex', flexDirection: 'column' }
          // WIDER FOR THE TWO-COLUMN ADMIN LAYOUT (2026-08-18). 920 was sized for
          // a single stacked column; the numbers column alone has to hold the
          // 14-column studio-time table (~850px) with every cell still typeable,
          // which is the standing rule for this screen. 1320 puts the table
          // inside its column with no sideways scroll on a normal laptop and
          // still leaves margin on a 1440 display. Blocks keep 920 — they have
          // one column of content and would just be a wide empty sheet.
          : { width: '100%', maxWidth: wide ? 1320 : 920, minWidth: 780, marginBottom: 20, alignSelf: 'flex-start',
              display: 'flex', flexDirection: 'column', maxHeight: wide ? 'calc(100vh - 26px)' : 'calc(100vh - 42px)' }}
        className="c-sheet"
        onClick={e => e.stopPropagation()}
      >

        {/* ── HEADER ────────────────────────────────────────────────────────── */}
        {/* NO TITLE BAND ON THE WIDE ADMIN LAYOUT (Eli, 2026-08-18: "def too
            much padding at the top… starts 2 inches from top of the page. i
            need that realestate"). The letterhead IS the header — a band
            reading "Work Order · WO-x" above a letterhead reading WO-x said
            everything twice and spent a row doing it. Blocks keep the band
            (they have no letterhead); read-only wide is fine too — the action
            bar below carries its Close and Download PDF. */}
        {isMobile ? (
          /* Mobile: matches the Runner Hub WO header (back arrow + title + sub) */
          <div style={{ background: 'var(--c-bg)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10, flexShrink: 0 }}>
            <button onClick={() => handleCancel()} disabled={saving} aria-label="Close" className="c-control c-raised" style={{ width: 34, height: 34, borderRadius: 99, background: 'var(--c-bg)', color: 'var(--c-fg)', cursor: saving ? 'default' : 'pointer', fontSize: 15, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
            <div style={{ minWidth: 0 }}>
              <div className="c-arch" style={{ fontSize: 16 }}>
                Work Order{wo.wo_number ? ` · ${wo.wo_number}` : ''}
              </div>
              <div className="c-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(booking.client_name || wo.client || '—')} · {longDate(booking.start_date || wo.session_date || '')}
              </div>
            </div>
            {/* WO history (Eli, 2026-09-01) — same gate as desktop. */}
            {resolvedWoId && !runner && (
              <button
                type="button"
                onClick={() => setHistOpen(true)}
                aria-label="History"
                title="History — every change, and the original work order"
                style={{ marginLeft: 'auto', background: 'none', color: 'var(--c-fg-3)', fontSize: 16, cursor: 'pointer', padding: '6px 8px', flexShrink: 0 }}
              >⟲</button>
            )}
          </div>
        ) : wide ? null : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px 12px', position: 'sticky', top: 0, background: 'var(--c-bg)', zIndex: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="c-arch" style={{ fontSize: 15 }}>
                Work Order{wo.wo_number ? ` · ${wo.wo_number}` : ''}
              </span>
              {/* Open / Completed is an INTERNAL state — never on the client's
                  printed WO. data-no-print is the existing hook for that. */}
              <span data-no-print="">
                <StatusBadge status={wo.status} />
              </span>
            </div>
            {/* NO ACTIONS IN THE TITLE BAR (Eli, 2026-08-13: "there are a
                million buttons up here. the top cancel and close can go").
                Correct — once the action bar moved to the top, this pair sat
                directly above a second row containing the same two words, so
                the screen offered Cancel twice and Close twice. The action bar
                below is the only place actions live now.
                Read-only keeps its single Close: there is no action bar then. */}
            {readOnly && (
              <button onClick={onClose} className="c-soft c-control c-raised">
                Close
              </button>
            )}
          </div>
        )}

        {/* ── ACTIONS + WARNINGS, AT THE TOP (RULING 2026-08-13) ───────────
            Eli: "move the red banner to the top and move all buttons to the
            top not the bottom. that was a bad call for me."

            The footer was argued for on the grounds that the click which
            triggers a warning happens down there. Wrong for this screen: the
            work order is long, you scroll it, and a bar pinned under a metre
            of table is a bar you have to go looking for. At the top it sits
            beside the title — the one place you always pass through.

            Rendered in place rather than restyled: this is the SAME markup,
            moved. Nothing about what the buttons do changed. */}
        {/* ── MISSING TIMES BANNER (RULING 2026-08-10) ──────────────────────
            Sits directly above the footer rather than at the top of the body:
            the click that triggers it is down here, and on a long WO a
            top-of-page error would appear somewhere you aren't looking.
            Fill, not border — Law 1. Hot is the sanctioned critical colour. */}
        {timeErrorMsg && (
          <div
            data-no-print=""
            role="alert"
            style={{
              flexShrink: 0,
              background: 'color-mix(in srgb, var(--c-st-hot) 16%, transparent)',
              color: 'var(--c-fg)',
              fontFamily: 'Inter',
              fontSize: 11,
              lineHeight: 1.5,
              padding: isMobile ? '10px 16px' : '10px 22px',
            }}
          >
            {timeErrorMsg}
          </div>
        )}

        {/* ── STAFF LINE WITH NO RATE (RULING 2026-08-13) ───────────────────
            A WARNING, not a block, and it is LIVE — it appears the moment the
            condition exists rather than waiting for you to press Complete,
            because the whole point is to catch a typo before the work order is
            signed off, not after. The rate is hand-typed on every line now that
            the old inherited default is gone, so a forgotten one is the
            likeliest way a session quietly under-bills.
            Hot is sanctioned for missing information (§5). Suppressed while the
            times banner is up — that error names the same rows and has to be
            fixed first. */}
        {/* RUNNER LIVE MISSING-TIMES WARNING (RULING 2026-08-10, ported from
            the deleted runner page): WARNS, never blocks — a runner mid-session
            often genuinely has no end time yet, and blocking Save/Submit would
            cost everything else they typed. The hard stop stays on the admin
            side (Complete WO refuses, same lib/woValidation rule, so the two
            sides can't disagree about what "done" means). Recomputed live, so
            it clears itself as rows fill in. */}
        {runner && !timeErrorMsg && woNeedsTimes(booking.status) && (() => {
          // Only days that have HAPPENED (2026-09-03). On a three-week
          // session the later mornings are set day by day, so tomorrow's
          // blank row is not a missing time — it is a time nobody knows yet.
          const problems = findMissingTimes(stRows, opsToday())
          if (problems.length === 0) return null
          return (
            <div role="alert" style={{ flexShrink: 0, background: 'color-mix(in srgb, var(--c-st-hot) 12%, transparent)', color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 11, lineHeight: 1.5, padding: '10px 16px' }}>
              {problems.length === 1 ? 'One row is missing times:' : `${problems.length} rows are missing times:`}{' '}
              {/* Capped (problemsDetail) — a 30-day WO's banner was the page. */}
              <span style={{ opacity: 0.8 }}>{problemsDetail(problems)}</span>
            </div>
          )
        })()}

        {/* The rate warnings are the OFFICE's to act on — rates are locked in
            runner mode, so showing a runner a problem they cannot fix would
            just train them to ignore banners. */}
        {!runner && !timeErrorMsg && dupStaffWarning && (
          <div
            data-no-print=""
            role="status"
            style={{
              flexShrink: 0,
              background: 'color-mix(in srgb, var(--c-st-hot) 12%, transparent)',
              color: 'var(--c-fg)',
              fontFamily: 'Inter',
              fontSize: 11,
              lineHeight: 1.5,
              padding: isMobile ? '10px 16px' : '10px 22px',
            }}
          >
            {dupStaffWarning}
          </div>
        )}

        {!runner && !timeErrorMsg && !dupStaffWarning && engRateWarning && (
          <div
            data-no-print=""
            role="status"
            style={{
              flexShrink: 0,
              background: 'color-mix(in srgb, var(--c-st-hot) 12%, transparent)',
              color: 'var(--c-fg)',
              fontFamily: 'Inter',
              fontSize: 11,
              lineHeight: 1.5,
              padding: isMobile ? '10px 16px' : '10px 22px',
            }}
          >
            {engRateWarning}
          </div>
        )}

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        {/* Padding is top-of-screen padding now — the old value carried
            `env(safe-area-inset-bottom)` to clear the iPhone home indicator,
            which at the top of the sheet just added dead space. Sticky, so the
            actions stay reachable while the work order scrolls under them. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'stretch' : 'flex-end', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? 8 : 10, padding: isMobile ? '4px 16px 12px' : wide ? '12px 22px 10px' : '0 22px 12px', flexShrink: 0, background: 'var(--c-bg)', zIndex: 9, ...(wide ? { position: 'sticky', top: 0 } : {}) }}>
          {/* Document + destructive actions live HERE, not in the title bar.
              Nothing to export for a block — no WO body, so the PDF would be a
              header over an empty page. */}
          {/* PRINT IS GONE (ruling 2026-08-11). It and Export PDF both opened the
              browser's print dialogue — a page you save by hand, at whatever
              margins the browser chose, that cannot be stapled to an invoice.
              One button now, and it produces a real drawn PDF via
              /api/wo-package. Deleting the print path is also what keeps the
              work order's layout described in ONE place instead of two. */}
          {/* DOWNLOAD IS A BILLING ACT, NOT A WORK-ORDER ACT (Eli, 2026-08-13:
              "i just want save, cancel, complete WO"). The PDF still exists —
              it is on every row of /billing, which is where packages get sent
              from and the only place they are archived. Keeping it here made a
              document button compete with the two controls that actually
              advance the session.
              READ-ONLY keeps it: with no Save and no Complete, downloading is
              the only thing that screen can do. */}
          {!isBlock && readOnly && (
            <button onClick={exportPdf} disabled={exporting} className="c-soft c-control c-raised" style={{ cursor: exporting ? 'default' : 'pointer', ...(isMobile ? { display: 'none' } : {}) }}>
              {exporting ? 'Building…' : 'Download PDF'}
            </button>
          )}
          {/* Delete, moved down from the header. It keeps its two-step confirm —
              a one-click delete next to Close & Save would be a bad neighbour. */}
          {!readOnly && onDelete && (
            confirmDeleteSession ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}>
                <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)' }}>Delete session?</span>
                <button onClick={() => { setConfirmDeleteSession(false); onDelete() }} className="c-pill c-fill-hot c-control c-raised-chip" style={{ cursor: 'pointer' }}>
                  Delete
                </button>
                <button onClick={() => setConfirmDeleteSession(false)} className="c-soft c-control c-raised">
                  Keep
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteSession(true)}
                disabled={saving}
                className="c-soft c-control c-raised"
                style={{ marginRight: 'auto', color: 'var(--c-st-hot)', cursor: saving ? 'default' : 'pointer', ...(isMobile ? { display: 'none' } : {}) }}
              >
                Delete
              </button>
            )
          )}
          {!readOnly && (
          <>
          {/* DOUBLED + FLAT ON DESKTOP (Eli, 2026-08-18: "doubel the size of
              the close/save pills… none of the old carved or raised buttons").
              Mobile keeps the raised classes and its own sizing untouched —
              the className fork below is what protects it. */}
          <button onClick={() => handleCancel()} disabled={saving} className={isMobile ? 'c-soft c-control c-raised' : 'c-soft c-control'} style={{ cursor: saving ? 'default' : 'pointer', ...(isMobile ? { flex: '1 1 0', minHeight: 48, fontSize: 12 } : { fontSize: 12, padding: '12px 26px', borderRadius: 99, boxShadow: '1.5px 1.5px 4px rgba(0,0,0,.25)' }) }}>
            Cancel
          </button>
          {/* Blocks (Tour / Tech / Open Hours) have no work order to complete —
              they're calendar occupancy, not billable work. The mobile twin of
              this button is already inside the !isBlock branch above. */}
          {/* COMPLETE ⇄ REOPEN (Eli 2026-08-24, reversing the 2026-08-11
              removal of Re-open). Before completion this is Complete WO — the
              primary act that starts billing. After completion the SAME button
              becomes Reopen WO: the office hit Complete by accident and the
              only undo was SQL, which is exactly the "stranded with no way
              back" the reopen path always warned about. The 08-11 slip-risk
              concern is answered by handleComplete's confirm, not by absence.
              Saving an edit to a completed WO is what the Save button is for. */}
          {!isBlock && (
          <button
            // Complete SAVES AND CLOSES (fix, 2026-08-11) — see handleComplete.
            onClick={() => handleComplete()}
            disabled={completing || saving}
            className={`c-control ${isCompleted ? 'c-soft' : 'c-pill c-fill-booked'}`}
            style={{ padding: '12px 26px', fontSize: 12, cursor: (completing || saving) ? 'default' : 'pointer', opacity: (completing || saving) ? 0.4 : 1, boxShadow: '1.5px 1.5px 4px rgba(0,0,0,.25)', ...(isMobile ? { display: 'none' } : {}) }}
            title={isCompleted ? 'Reopen this work order' : undefined}
          >
            {completing ? (isCompleted ? 'Reopening…' : 'Completing…') : isCompleted ? 'Reopen WO' : 'Complete WO'}
          </button>
          )}
          {/* SAVE (Eli, 2026-08-13; prompt removed 2026-08-18). It was "Close"
              once, and until today it still carried Close's dirty-check — so
              pressing SAVE with changes asked "save or discard?", a question
              that answers itself when the button you pressed says Save. Now it
              calls handleClose() directly: saves and closes, no dialog. The
              confirm dialog survives ONLY on the backdrop-click path
              (handleCloseButton), where intent genuinely is ambiguous. */}
          <button onClick={() => handleClose()} disabled={saving} className={isMobile ? 'c-btn c-control c-raised-primary' : 'c-btn c-control'} style={{ cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1, ...(isMobile ? { flex: '2 1 0', minHeight: 48, fontSize: 12 } : { fontSize: 12, padding: '12px 32px', boxShadow: '1.5px 1.5px 4px rgba(0,0,0,.3)' }) }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          </>
          )}
          {/* THE ONLY DIALOGUE ON THIS SCREEN, and it only appears when there
              is something to lose. Three ways out, all named for the outcome
              rather than for Yes/No — "Discard" has to say what it discards or
              nobody reads it in time. */}
          {confirmClose && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 10005, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                 onClick={() => setConfirmClose(false)}>
              <div className="c-panel" style={{ maxWidth: 380, width: '100%' }} onClick={e => e.stopPropagation()}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>You&apos;ve made changes</div>
                <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 14, lineHeight: 1.5 }}>
                  Save them to this work order, or throw them away and leave it as it was?
                </div>
                <button className="c-bact c-bblock" onClick={() => { setConfirmClose(false); handleClose() }}>Save and close</button>
                <button className="c-bact c-bblock" onClick={() => { setConfirmClose(false); handleCancel() }}>Discard my changes</button>
                <button className="c-bact c-bmuted c-bblock" onClick={() => setConfirmClose(false)}>Keep editing</button>
              </div>
            </div>
          )}

          {/* ── FOOD BUDGET EXPENSE REPORT (2026-08-24, mock wo-food-budget.html)
              The paper sheet, live: Date · Place of Business · Amount (incl.
              tip), one row per receipt + a photo per row. Rows write
              IMMEDIATELY (never through the WO's batched save) so a runner's
              receipts survive anything. The budget amount is set HERE, not on
              the WO row. Rendered into the invoice PDF package with the
              receipt photos as pages. */}
          {showExpenses && wo && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 10006, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 0 : 20 }}
                 onClick={e => { if (e.target === e.currentTarget) setShowExpenses(false) }}>
              <div className="c-panel" style={{
                width: 580, maxWidth: '100%', maxHeight: isMobile ? '100dvh' : '88vh',
                overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12,
                ...(isMobile ? { height: '100dvh', borderRadius: 0 } : {}),
              }}>
                {/* Header — the paper sheet's title block */}
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 15, letterSpacing: '-0.01em' }}>
                    {[wo.label || wo.client, wo.artist].filter(Boolean).join(' / ') || 'Session'}
                  </div>
                  <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 2 }}>
                    Food Budget{wo.invoice_number ? ` · INV ${wo.invoice_number}` : ''}
                  </div>
                </div>

                {/* Budget bar — Budget is EDITABLE here (and only here) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div style={{ background: 'var(--c-wash)', borderRadius: 12, padding: '9px 12px', textAlign: 'center' }}>
                    <input
                      className="c-mono"
                      value={wo.food_amount}
                      disabled={readOnly}
                      inputMode="decimal"
                      placeholder="$0.00"
                      onChange={e => {
                        setDirtyFields(prev => new Set(prev).add('food_amount'))
                        setWo(w => w ? { ...w, food_amount: e.target.value } : w)
                      }}
                      onBlur={e => {
                        const n = parseFloat(e.target.value.replace(/[^0-9.-]/g, ''))
                        if (!isNaN(n)) setWo(w => w ? { ...w, food_amount: n.toFixed(2) } : w)
                      }}
                      style={{ width: '100%', textAlign: 'center', background: 'transparent', border: 'none', outline: 'none', color: 'var(--c-fg)', fontFamily: "'Archivo Black', sans-serif", fontSize: 16, letterSpacing: '-0.02em' }}
                    />
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.45, marginTop: 1 }}>Budget</div>
                  </div>
                  <div style={{ background: 'var(--c-wash)', borderRadius: 12, padding: '9px 12px', textAlign: 'center' }}>
                    <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 16, letterSpacing: '-0.02em' }}>${foodSpent.toFixed(2)}</div>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.45, marginTop: 1 }}>Spent</div>
                  </div>
                  <div style={{ background: 'var(--c-wash)', borderRadius: 12, padding: '9px 12px', textAlign: 'center' }}>
                    <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 16, letterSpacing: '-0.02em', color: foodRemaining < 0 ? 'var(--c-st-hot)' : 'var(--c-st-booked)' }}>
                      {foodRemaining < 0 ? `−$${Math.abs(foodRemaining).toFixed(2)}` : `$${foodRemaining.toFixed(2)}`}
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.45, marginTop: 1 }}>
                      {foodRemaining < 0 ? 'Over budget' : 'Remaining'}
                    </div>
                  </div>
                </div>

                {/* Rows — the sheet's columns */}
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 96px 40px 26px', gap: 8, padding: '0 8px 5px', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.45 }}>
                    <span>Date</span><span>Place of business</span><span style={{ textAlign: 'right' }}>Amt incl. tip</span><span>Rcpt</span><span />
                  </div>
                  {expenses.length === 0 && (
                    <div style={{ fontSize: 11, opacity: 0.45, padding: '6px 8px' }}>No expenses yet.</div>
                  )}
                  {expenses.map(e => (
                    <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 96px 40px 26px', gap: 8, alignItems: 'center', background: 'var(--c-wash)', borderRadius: 10, padding: '6px 8px', marginBottom: 4 }}>
                      <input value={e.date} disabled={readOnly}
                        onChange={ev => editExpense(e.id, { date: ev.target.value })}
                        onBlur={() => saveExpense(e.id)}
                        className="c-mono"
                        style={{ background: 'var(--c-wash2)', border: 'none', borderRadius: 7, padding: '6px 7px', color: 'var(--c-fg)', fontSize: 11, outline: 'none', width: '100%', textAlign: 'center' }} />
                      <input value={e.place} disabled={readOnly} placeholder="Place"
                        onChange={ev => editExpense(e.id, { place: ev.target.value })}
                        onBlur={() => saveExpense(e.id)}
                        style={{ background: 'var(--c-wash2)', border: 'none', borderRadius: 7, padding: '6px 9px', color: 'var(--c-fg)', font: 'inherit', fontSize: 12, outline: 'none', width: '100%' }} />
                      <input value={e.amount} disabled={readOnly} placeholder="$0.00" inputMode="decimal"
                        onChange={ev => editExpense(e.id, { amount: ev.target.value })}
                        onBlur={ev => {
                          const n = parseFloat(ev.target.value.replace(/[^0-9.-]/g, ''))
                          if (!isNaN(n)) editExpense(e.id, { amount: `$${n.toFixed(2)}` })
                          // saveExpense reads state on the next tick's value; write directly.
                          supabase.from('wo_expenses').update({
                            date: e.date, place: e.place,
                            amount: !isNaN(n) ? `$${n.toFixed(2)}` : ev.target.value,
                          }).eq('id', e.id).then(({ error }) => { dbResult('Saving expense', error) })
                        }}
                        className="c-mono"
                        style={{ background: 'var(--c-wash2)', border: 'none', borderRadius: 7, padding: '6px 7px', color: 'var(--c-fg)', fontSize: 11, outline: 'none', width: '100%', textAlign: 'right' }} />
                      <button
                        type="button"
                        onClick={() => {
                          if (e.receipt_path) { viewReceipt(e.receipt_path); return }
                          if (readOnly) return
                          pendingExpenseId.current = e.id
                          expenseFileRef.current?.click()
                        }}
                        title={e.receipt_path ? 'View receipt' : 'Attach receipt photo'}
                        style={{
                          width: 34, height: 28, border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12,
                          padding: 0, overflow: 'hidden',
                          background: e.receipt_path ? 'color-mix(in srgb, var(--c-st-booked) 22%, transparent)' : 'var(--c-wash2)',
                          opacity: rcptUploading === e.id ? 0.4 : e.receipt_path ? 1 : 0.6,
                          // The attached state wears a teal ring so a thumbnail
                          // that happens to be dark still reads as "photo here".
                          boxShadow: e.receipt_path ? 'inset 0 0 0 1.5px var(--c-st-booked)' : undefined,
                        }}
                      >
                        {/* The button IS the thumbnail once a photo exists —
                            the icon only while uploading / signing / empty. */}
                        {rcptUploading === e.id
                          ? '…'
                          : e.receipt_path
                            ? (rcptThumbs[e.receipt_path]
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={rcptThumbs[e.receipt_path]} alt="Receipt" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                              : '🧾')
                            : '📷'}
                      </button>
                      {!readOnly ? (
                        <button type="button" className="c-x" onClick={() => deleteExpense(e.id)} title="Delete expense" style={{ fontSize: 13 }}>×</button>
                      ) : <span />}
                    </div>
                  ))}
                  {!readOnly && (
                    <button type="button" onClick={addExpense} style={{ marginTop: 6, width: '100%', minHeight: 38, background: 'var(--c-wash)', border: 'none', borderRadius: 10, color: 'var(--c-fg)', opacity: 0.65, font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      + Add expense
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="c-btn c-control" onClick={() => setShowExpenses(false)} style={{ cursor: 'pointer' }}>Done</button>
                </div>
              </div>
            </div>
          )}

          {/* Receipt lightbox */}
          {receiptPreview && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 10008, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                 onClick={() => setReceiptPreview(null)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={receiptPreview} alt="Receipt" style={{ maxWidth: '94vw', maxHeight: '88vh', borderRadius: 8 }} />
            </div>
          )}

          {/* Hidden receipt file input — camera-first on phones */}
          <input
            ref={expenseFileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadReceipt(f) }}
          />
          {readOnly && (
            <button onClick={onClose} className="c-soft c-control c-raised" style={{ ...(isMobile ? { flex: '1 1 0', minHeight: 48, fontSize: 12 } : {}) }}>
              Close
            </button>
          )}
        </div>

        {/* ── SCROLLABLE BODY ──────────────────────────────────────────────── */}
        <div style={isMobile
          ? { padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }
          // wide: mock density — the popup itself should barely scroll; the
          // bins do the scrolling (Eli, 2026-08-18: "so much scrolling now").
          : { padding: wide ? '10px 22px 18px' : '24px 28px', display: 'flex', flexDirection: 'column', gap: wide ? 14 : 24, flex: 1, minHeight: 0, overflowY: 'auto' }}>

          {/* SESSION INFO — mobile only, read-only (mirrors the Runner WO card).
              The editable booking-form fields live in the META section below,
              which is hidden on mobile. */}
          {isMobile && (() => {
            const contactPhone = booking.phone || wo.phone
            const sessionRows: [string, any][] = [
              [wo.payment_status === 'Billing' ? 'Label / A&R' : 'Client',
                wo.payment_status === 'Billing'
                  ? [booking.label || wo.label, booking.client_name || wo.client].filter(Boolean).join(' / ')
                  : (booking.client_name || wo.client)],
              ['Artist', booking.artist || wo.artist],
              ['Engineer', booking.engineer_name || wo.engineer],
              // "August 17th, 2026", not the raw DB date (Eli, 2026-08-16);
              // multi-day sessions show the full range.
              ['Date', (() => {
                const dStart = booking.start_date || wo.session_date
                if (!dStart) return ''
                const dEnd = booking.end_date && booking.end_date !== dStart ? booking.end_date : null
                return dEnd ? `${longDate(dStart)} – ${longDate(dEnd)}` : longDate(dStart)
              })()],
              ['Time', [booking.from_time, booking.to_time].filter(Boolean).join(' – ')],
              ['Studio', booking.studio || (wo.studios ?? []).join(', ')],
              // Billing pipeline + live balance chip — a runner takes COD at the
              // desk, so an outstanding balance is a fact they must see up top.
              ['Billing', wo.payment_status],
            ]
            return (
              <div style={mCard}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-fg-2)' }}>Session Info</div>
                  {/* The locked-top marker (Eli: "lock the client block at the
                      top"). In runner mode this card is the WHOLE top — the
                      editable META/client panel never renders — so the chip is
                      the truthful label, not a decoration. */}
                  {runner && <span style={{ fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }}>🔒 Set by the office</span>}
                </div>
                {sessionRows.filter(([, v]) => v).map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', gap: 8, marginBottom: 5, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--c-fg-2)', fontFamily: 'Inter', minWidth: 60 }}>{l}</span>
                    <span style={{ fontSize: 11, color: 'var(--c-fg)', fontFamily: 'Inter' }}>{v}</span>
                    {/* COD ONLY (Eli 2026-08-24): hot means "collect at the
                        desk". A label session with an open invoice is normal
                        billing-hub business, not an alarm — painting it red
                        teaches people to ignore red. */}
                    {l === 'Billing' && balanceDue > 0 && wo.payment_status === 'COD' && (
                      <span style={{ fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'var(--c-st-hot)', color: 'var(--c-hot-text, #fff4f2)', borderRadius: 99, padding: '2px 8px' }}>Balance due</span>
                    )}
                  </div>
                ))}
                {/* FOOD BUDGET on the phone/runner card (2026-08-24) — the
                    runner FILLS the expense report, so the way in lives here.
                    The on/off is the office's; runners get the amount + the
                    balance bubble that opens the report. */}
                {wo.food_budget && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)', borderRadius: 99, padding: '6px 14px' }}>
                      Food budget{foodBudgetNum > 0 && <span className="c-mono" style={{ fontWeight: 400, marginLeft: 7 }}>${foodBudgetNum.toFixed(2)}</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowExpenses(true)}
                      style={{ border: 'none', font: 'inherit', cursor: 'pointer', fontSize: 10.5, padding: '6px 14px', borderRadius: 99, background: 'var(--c-wash2)', color: 'var(--c-fg)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <span className="c-mono" style={{ color: foodRemaining < 0 ? 'var(--c-st-hot)' : 'var(--c-st-booked)', fontWeight: foodRemaining < 0 ? 700 : 400 }}>
                        {foodRemaining < 0 ? `$${Math.abs(foodRemaining).toFixed(2)} over` : `$${foodRemaining.toFixed(2)} left`}
                      </span>
                      <span style={{ opacity: 0.5 }}>›</span>
                    </button>
                  </div>
                )}
                {/* A&R / client contact number — calling is always allowed even
                    when the block is locked (Eli, 2026-08-15). */}
                {contactPhone && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 5, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--c-fg-2)', fontFamily: 'Inter', minWidth: 60 }}>Phone</span>
                    <a href={`tel:${contactPhone.replace(/[^0-9+]/g, '')}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--c-wash2)', borderRadius: 99, padding: '2px 10px', fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg)', textDecoration: 'none' }}>
                      📞 {contactPhone}
                    </a>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ══ TWO COLUMNS · words left, numbers right ═════════════════════════
              On mobile and for block events both wrappers go `display: contents`,
              so every child below drops straight back into the body's flex column
              in its original sequence (that is what the ORD numbers guarantee).
              Nothing about the mobile render changes. */}
          <div style={wide
            ? { display: 'grid', gridTemplateColumns: '0.72fr 1.28fr', gap: 13, alignItems: 'stretch', minHeight: 0 }
            : { display: 'contents' }}>

          {/* ══ WORDS COLUMN ══════════════════════════════════════════════════ */}
          <div style={wide
            ? { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }
            : { display: 'contents' }}>

          {/* LETTERHEAD — OPEN SPACE, TOP-LEFT (ruling 2026-08-18). Was a centred
              three-line masthead with the invoice number floated opposite it, which
              spent a full band of the sheet on branding and put the WO's own number
              nowhere. Now: who we are on the left, WHICH work order on the right,
              at size, with the invoice number under it. No box — real padding is
              what makes a letterhead read as a letterhead.
              Invoice # is deliberately in TWO places (mock ruling): here, always
              visible, and editable in the Invoice/PO/Food row below. */}
          <div style={{ order: ORD.letterhead, textAlign: wide ? 'left' : 'center', paddingBottom: wide ? 2 : 20, display: (isMobile || isBlock) ? 'none' : 'block' }}>
            {wide ? (
              <div style={{ padding: '2px 4px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="c-arch" style={{ fontSize: 17, letterSpacing: '-0.02em' }}>Paramount Recording</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--c-fg-2)', marginTop: 7, lineHeight: 1.7 }}>
                    6245 Santa Monica Blvd, Hollywood, CA 90038<br />
                    (323) 465-4000 · booking@paramountrecording.com
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="c-arch" style={{ fontSize: 24, letterSpacing: '-0.02em' }}>{wo.wo_number || 'WO'}</div>
                  <div style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 11, color: 'var(--c-fg-2)', marginTop: 2 }}>
                    Invoice #{wo.invoice_number || '—'}
                  </div>
                  {/* Status + Complete, as the mock draws them (Eli, 2026-08-18
                      — "copy the mock exactly"). I had left Complete out on the
                      2026-08-13 "million buttons up here" ruling, since the
                      action bar already has one; overruled. Same handler as the
                      action bar's button, same disabled rule, so the two can
                      never disagree about what Complete means. */}
                  <div data-no-print="" style={{ marginTop: 7, display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                    {/* WO history (Eli, 2026-09-01) — the paper original, back.
                        Gated on resolvedWoId: a WO-less block has no history. */}
                    {resolvedWoId && !runner && (
                      <button
                        type="button"
                        onClick={() => setHistOpen(true)}
                        title="History — every change, and the original work order"
                        style={{ background: 'none', color: 'var(--c-fg-3)', fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', cursor: 'pointer', padding: '4px 6px' }}
                      >⟲ HISTORY</button>
                    )}
                    <StatusBadge status={wo.status} />
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => handleComplete()}
                        disabled={completing || saving}
                        className={`c-pill c-control ${isCompleted ? 'c-fill-booked' : ''}`}
                        // c-pill has no background of its own — the fill classes
                        // supply it — so the un-completed state painted black on
                        // black (Eli, 2026-08-18: "complete is black and cant
                        // see"). Wash2 + fg, same recipe as the mock's pill.
                        style={{ cursor: (completing || saving) ? 'default' : 'pointer', opacity: (completing || saving) ? 0.4 : 1, ...(isCompleted ? {} : { background: 'var(--c-wash2)', color: 'var(--c-fg)' }) }}
                        title={isCompleted ? 'Reopen this work order' : 'Complete this work order'}
                      >
                        {completing ? (isCompleted ? 'Reopening…' : 'Completing…') : isCompleted ? '↺ Reopen' : '✓ Complete'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 15, color: 'var(--c-fg)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Paramount Recording Group</div>
                <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--c-fg-2)', marginTop: 3 }}>Paramount · Encore · Ameraycan · Wilder · Track</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--c-fg-2)' }}>Recording Studios (323) 465-4000</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--c-fg-2)' }}>Invoice #</span>
                    <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--c-fg)', minWidth: 60 }}>{wo.invoice_number || '—'}</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* SESSION-LEVEL TOP — status bar + session type + billing + client panel.
              No per-day schedule here (studios / dates / times / rates / engineers
              live ONLY in the Studio Time table — see docs/WO-SPEC.md §3). Hidden on
              mobile; the read-only SESSION INFO card above replaces it there. */}
          <div style={isMobile ? { display: 'none' } : { order: ORD.sessionTop, display: 'flex', flexDirection: 'column', gap: wide ? 12 : 16, minWidth: 0 }}>

            {/* Status — ONE housing (§8). This was six separate raised pills; the
                selected one now presses IN and fills with its own status colour,
                which is sanctioned here because the field IS status (§5). */}
            {/* STATUS + SESSION TYPE BACK ABOVE THE CONTACT CARD (Eli,
                2026-08-24 — reversing his own 2026-08-18 ruling that put them
                under it). Wide order is now: status (1) → type (2) → client
                card (3) → Invoice/PO (4) → Food budget (5) → notes (6). */}
            {/* c-seg-tiny on wide (Eli, 2026-08-18: "sesstoin status is two
                rows") — six pills at the tiny size fit the words column on one
                line. Non-wide keeps the full-size seg. */}
            {/* ALL SEVEN VISIBLE, ONE LINE, NO SCROLL (Eli, 2026-09-03).
                The 2026-08-26 version scrolled sideways when Lockout made it
                seven, which hid Lockout itself at the non-wide width — the
                status you cannot see is the status nobody sets. `c-seg-status`
                (globals.css) fits them at every width by tightening padding and
                tracking; the horizontal scroll is deliberately gone. */}
            <div className={`c-seg c-seg-status${wide ? ' c-seg-tiny' : ''}`} style={{ order: wide ? 1 : undefined, alignSelf: 'stretch', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
              {SESSION_STATUSES.map(([val, lbl]) => {
                const on = wo.session_status === val
                return (
                  <button key={val} type="button" disabled={readOnly}
                    className={on ? `c-on ${statusFillClass(val)}` : ''}
                    onClick={() => { setDirtyFields(prev => new Set(prev).add('session_status')); setWo(w => w ? { ...w, session_status: val } : w) }}
                    style={{ cursor: readOnly ? 'default' : 'pointer' }}>
                    {lbl}
                  </button>
                )
              })}
            </div>

            {/* BLOCK view — Tour/Tech/Open-Hours: just a title + dates + times */}
            {isBlock && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
                <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>
                  {SESSION_STATUSES.find(([v]) => v === wo.session_status)?.[1]} block — no work order or billing, just a calendar event.
                </div>
                <div>
                  <div style={{ ...metaLabel, marginBottom: 6 }}>Title</div>
                  <input value={wo.client} onChange={e => { setDirtyFields(prev => new Set(prev).add('client')); setWo(w => w ? { ...w, client: e.target.value } : w) }} placeholder="Name this block" className="c-input c-inset2" />
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...metaLabel, marginBottom: 6 }}>Start date</div>
                    <input type="date" value={blockStart} onChange={e => setBlockStart(e.target.value)} className="c-input c-inset2" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...metaLabel, marginBottom: 6 }}>End date</div>
                    <input type="date" value={blockEnd} onChange={e => setBlockEnd(e.target.value)} className="c-input c-inset2" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...metaLabel, marginBottom: 6 }}>From</div>
                    <TimeInput value={wo.from_time} onChange={v => { setDirtyFields(prev => new Set(prev).add('from_time')); setWo(w => w ? { ...w, from_time: v } : w) }} className="c-input c-inset2" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...metaLabel, marginBottom: 6 }}>To</div>
                    <TimeInput value={wo.to_time} onChange={v => { setDirtyFields(prev => new Set(prev).add('to_time')); setWo(w => w ? { ...w, to_time: v } : w) }} className="c-input c-inset2" />
                  </div>
                </div>
              </div>
            )}

            {/* ONE COLUMN ON ADMIN DESKTOP (2026-08-18). This was a 0.85fr/1fr
                pair — session meta beside the client card — which is the shape
                that has to go when the whole sheet becomes words-left /
                numbers-right: the client card IS the words column's anchor and
                cannot sit in a sub-column of it.
                Order on the desktop stack: Session Type → ★ locked contact card
                → Invoice/PO/Food → Booking notes. `display: contents` on the old
                left-hand wrapper is what lets the three meta blocks interleave
                with the client card without moving any of their markup. */}
            {!isBlock && (
            /* `display: contents` on BOTH this and the wrapper below is what
               lets the status bar (a sibling above, outside this block) sit
               between the client card and the Invoice row. Everything inside
               becomes a direct flex child of the session top, so one `order`
               scale covers all five. */
            <div style={wide
              ? { display: 'contents' }
              : { display: 'grid', gridTemplateColumns: '0.85fr 1fr', gap: 20, alignItems: 'stretch' }}>

              {/* Left — session type + meta + notes. NO container of its own:
                  the wells carve into the sheet directly. It used to be a
                  c-bg box sitting inside the sheet, which put a surface between
                  panel and control for no reason (§8: panel → control, nothing
                  between). */}
              <div style={wide ? { display: 'contents' } : { display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{ order: wide ? 2 : 4 }}>
                  <div style={{ ...metaLabel, marginBottom: 8 }}>Session Type</div>
                  {/* ONE housing (§8) — was three loose pills. Tiny on wide,
                      same reason as the status seg above. */}
                  <div className={wide ? 'c-seg c-seg-wrap c-seg-tiny' : 'c-seg c-seg-wrap'}>
                    {SESSION_TYPES.map(([val, lbl]) => (
                      <button key={val} type="button" disabled={readOnly}
                        className={wo.session_type === val ? 'c-on' : ''}
                        onClick={() => { setDirtyFields(prev => new Set(prev).add('session_type')); setWo(w => w ? { ...w, session_type: val } : w) }}
                        style={{ cursor: readOnly ? 'default' : 'pointer' }}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                {/* ONE SLIM ROW (§8 IdWell). Invoice #, PO # and Food budget were
                    three full-width rows with labels stacked above — three lines
                    and the panel's whole width spent on about five characters
                    each. They now share a line at their natural widths, and the
                    reclaimed height all goes to Booking Notes below. */}
                {/* ONE ROW, THREE SAME-SIZE FIELDS, directly under the contact
                    card (mock ruling 2026-08-18). PO gets 1.35 rather than a
                    true third because it is the only one of the three carrying a
                    second control — the Not req'd toggle — and starving that
                    field to make the row arithmetically equal would cost the
                    thing the row is for. */}
                <div style={wide
                  ? { order: 4, display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 8, alignItems: 'center', background: 'var(--c-wash)', borderRadius: 12, padding: '10px 12px' }
                  : { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* MOCK VALUES, NOT HOUSE COMPONENTS (2026-08-18). These were
                      three loose wells with inline `Inv #` / `PO #` / `Food $`
                      prefixes. The mock stacks a small-caps label ABOVE each
                      field and sits the whole row in one tinted block — copied
                      exactly. The `display: contents` wrappers keep the
                      non-wide (phone) render as three bare flex children. */}
                  <div style={wide ? { minWidth: 0 } : { display: 'contents' }}>
                  {wide && <div style={{ ...kLabel, marginBottom: 3 }}>Invoice #</div>}
                  <div className="c-well" style={wide ? { minWidth: 0 } : { flex: '0 1 132px', minWidth: 118 }}>
                    {!wide && <span className="c-pfx">Inv #</span>}
                    <input
                      className="c-mono"
                      value={wo.invoice_number}
                      disabled={readOnly}
                      placeholder="—"
                      onChange={e => { setDirtyFields(prev => new Set(prev).add('invoice_number')); setWo(w => w ? { ...w, invoice_number: e.target.value } : w) }}
                    />
                  </div>
                  </div>
                  {/* PO NUMBERS ARE LONG (Eli, 2026-08-13). A label's PO can run
                      well past ten characters, and this was sized off Inv #,
                      which never does. It gets the widest basis on the row. */}
                  <div style={wide ? { minWidth: 0 } : { display: 'contents' }}>
                  {wide && <div style={{ ...kLabel, marginBottom: 3 }}>PO #</div>}
                  <div className="c-well" style={wide ? { minWidth: 0 } : { flex: '1 1 210px', minWidth: 160 }}>
                    {!wide && <span className="c-pfx">PO #</span>}
                    <input
                      className="c-mono"
                      value={wo.po_number}
                      disabled={readOnly || wo.no_po_needed}
                      placeholder={wo.no_po_needed ? '' : '—'}
                      onChange={e => { setDirtyFields(prev => new Set(prev).add('po_number')); setWo(w => w ? { ...w, po_number: e.target.value } : w) }}
                    />
                    {/* THE FIELD ANSWERS ITS OWN QUESTION (RULING 2026-08-13,
                        option A). This was a separate "PO req'd Yes/No" segment
                        with a floating label — a full field's width spent on a
                        yes/no, sitting beside the field it was about.

                        The rule it serves is unchanged and still load-bearing:
                        approval waits in Awaiting PO until there is a PO number
                        OR this is set. It is the one thing PRSFlo cannot work
                        out for itself, so it stays visible on EVERY work order
                        — never behind a disclosure — because Eli wants the
                        habit of answering it. */}
                    <button
                      type="button"
                      disabled={readOnly}
                      className={`c-poreq${wo.no_po_needed ? ' c-on' : ''}`}
                      title={wo.no_po_needed
                        ? 'This job does not need a PO — approval is not waiting on one'
                        : 'Mark this job as not needing a PO'}
                      onClick={() => {
                        setDirtyFields(prev => new Set(prev).add('no_po_needed'))
                        setWo(w => w ? { ...w, no_po_needed: !w.no_po_needed } : w)
                      }}
                    >
                      Not req&apos;d
                    </button>
                  </div>
                  </div>
                </div>

                {/* FOOD BUDGET — TWO BUBBLES (Eli 2026-08-24, mock
                    wo-top-rework.html; supersedes the 08-13 "just an amount"
                    ruling now that the expense report exists). Bubble 1 IS the
                    on/off and carries the amount when on; bubble 2 is the live
                    balance and opens the expense report, where the amount is
                    actually set. */}
                <div style={wide
                  ? { order: 5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
                  : { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => {
                      setDirtyFields(prev => new Set(prev).add('food_budget'))
                      setWo(w => w ? { ...w, food_budget: !w.food_budget } : w)
                    }}
                    className="c-pill c-control"
                    style={{
                      cursor: readOnly ? 'default' : 'pointer', border: 'none', font: 'inherit',
                      fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em', padding: '7px 16px', borderRadius: 99,
                      background: wo.food_budget ? 'var(--c-st-booked)' : 'var(--c-wash)',
                      color: wo.food_budget ? 'var(--c-chip-ink)' : 'var(--c-fg)',
                      opacity: wo.food_budget ? 1 : 0.55,
                    }}
                    title={wo.food_budget ? 'Turn the food budget off' : 'Turn a food budget on for this session'}
                  >
                    Food budget
                    {wo.food_budget && foodBudgetNum > 0 && (
                      <span className="c-mono" style={{ fontWeight: 400, marginLeft: 8 }}>${foodBudgetNum.toFixed(2)}</span>
                    )}
                  </button>
                  {wo.food_budget && (
                    <button
                      type="button"
                      onClick={() => setShowExpenses(true)}
                      className="c-pill c-control"
                      style={{
                        cursor: 'pointer', border: 'none', font: 'inherit', fontSize: 10.5,
                        padding: '7px 16px', borderRadius: 99, background: 'var(--c-wash2)', color: 'var(--c-fg)',
                        display: 'inline-flex', alignItems: 'center', gap: 7,
                      }}
                      title="Open the expense report"
                    >
                      <span className="c-mono" style={{
                        color: foodRemaining < 0 ? 'var(--c-st-hot)' : 'var(--c-st-booked)',
                        fontWeight: foodRemaining < 0 ? 700 : 400,
                      }}>
                        {foodRemaining < 0
                          ? `$${Math.abs(foodRemaining).toFixed(2)} over`
                          : `$${foodRemaining.toFixed(2)} left`}
                      </span>
                      <span style={{ opacity: 0.5 }}>›</span>
                    </button>
                  )}
                </div>

                {/* Booking notes — internal/ops notes about the booking; never printed */}
                {/* THE THREE NOTE BOXES MUST NOT READ AS ONE KIND (mock ruling).
                    Booking notes and Needs attention are INTERNAL: orange tag,
                    wash2 tint. Session notes is what the client's session was —
                    it stays plain. On admin desktop the three are compact and
                    ordered Booking → Session → Needs attention, and any of them
                    may shrink as the column needs; on mobile this box keeps its
                    full 190px, which is where it is actually typed into. */}
                <div data-no-print="" style={wide
                  ? { order: 6, display: 'flex', flexDirection: 'column', background: 'var(--c-wash2)', borderRadius: 12, padding: '9px 12px' }
                  : { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  <div style={{ ...metaLabel, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    Booking Notes
                    <span style={wide ? internalTag : { fontSize: 8, fontFamily: 'Inter', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--c-st-warm)', borderRadius: 3, padding: '1px 5px', textTransform: 'uppercase' }}>Internal{wide ? '' : ' only'}</span>
                  </div>
                  {/* Absorbs everything the meta row gave back — the notes are the
                      only field here anyone writes a paragraph into, so they get
                      the height rather than leaving it as dead panel. */}
                  <textarea
                    className="c-area"
                    value={wo.booking_notes}
                    disabled={readOnly}
                    onChange={e => { setDirtyFields(prev => new Set(prev).add('booking_notes')); setWo(w => w ? { ...w, booking_notes: e.target.value } : w) }}
                    placeholder="Ops notes about the booking — arrival, payment, past experience… never on the invoice."
                    style={wide ? { minHeight: 62, background: 'transparent', boxShadow: 'none', padding: 0 } : { flex: 1, minHeight: 190 }}
                  />
                </div>
              </div>

              {/* ★ THE LOCKED CONTACT CARD — the anchor of the words column.
                  In `wide` it renders LABEL-as-hero for label clients (person
                  for COD), the artist well sized to its content, and A&R beside
                  Admin with ellipsizing emails and icon actions. Same component,
                  same state, same saves — only its arrangement differs. */}
              <div style={wide ? { order: 3, minWidth: 0, display: 'flex', flexDirection: 'column' } : { minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <ClientPanel value={clientValue} onChange={handleClientChange} readOnly={readOnly} layout={wide ? 'wide' : 'stack'} />
              </div>
            </div>
            )}
          </div>

          {/* Session notes → Needs attention, the bottom of the WORDS column
              (mock ruling): Booking notes (internal) → Session notes (plain) →
              Needs attention (internal), each smaller than the last. */}
          {!isBlock && (<>

          {/* SESSION NOTES — the whole session, in the client's terms. Plain: no
              orange tag, no wash2 tint. It is the one of the three notes boxes
              that is NOT internal, and it has to look unlike the other two. */}
          <div style={{ order: ORD.sessionNotes, display: 'flex', flexDirection: 'column', gap: 16, ...(isMobile ? mCard : {}) }}>
            <div>
              <SectionHeader carved title="Session Notes" />
              <textarea value={wo.session_notes} onChange={e => { setDirtyFields(prev => new Set(prev).add('session_notes')); setWo(w => w ? { ...w, session_notes: e.target.value } : w) }}
                style={{ width: '100%', minHeight: wide ? 58 : 90, background: 'var(--c-wash)', borderRadius: 5, color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 11, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }} />
            </div>
            {wo.payment_status === 'COD' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 9, fontFamily: 'Inter', color: 'var(--c-fg-3)', lineHeight: 1.8, padding: '10px 12px', background: 'var(--c-wash)', borderRadius: 5 }}>
                  By signing below, I acknowledge that I am authorized to approve charges for this session. I accept responsibility for all associated costs and understand that payment is due in full at the time of service unless otherwise agreed. I also acknowledge that Paramount Recording is not responsible for any media, personal items, or equipment left behind.
                  <br /><br />
                  <em>No Tapes, CDs, DVDs, Thumb Drives, Computer Drives or other Recording Media will be released until payment in full is received.</em>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center' }}>
                  <div style={metaLabel}>Date</div>
                  <span style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg)' }}>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center' }}>
                  <div style={metaLabel}>Print Name</div>
                  <input value={wo.print_name} onChange={e => { setDirtyFields(prev => new Set(prev).add('print_name')); setWo(w => w ? { ...w, print_name: e.target.value } : w) }} className="c-tin" />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={metaLabel}>Signature</div>
                    {!readOnly && <button type="button" onClick={clearAdminSignature} style={{ background: 'none', borderRadius: 4, padding: '2px 8px', color: 'var(--c-fg-2)', fontSize: 10, cursor: 'pointer', fontFamily: 'Inter' }}>Clear</button>}
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
                    style={{ width: '100%', height: 100, background: 'var(--c-bg)', borderRadius: 6, display: 'block', touchAction: 'none', cursor: 'crosshair' }}
                  />
                  )}
                  {wo.signature_data && <div style={{ fontSize: 9, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 4 }}>Signature captured ✓</div>}
                </div>
              </div>
            )}
          </div>

          {/* NEEDS ATTENTION — internal only, never printed.
              ONE STRIP, PINNED TO THE COLUMN BOTTOM (mock ruling 2026-08-18).
              It was a full section with a 80px textarea always standing open at
              the very bottom of the work order — about a third of the words
              column spent on a field that is empty on most sessions. It is now
              `margin-top: auto` so it hugs the bottom of the column, collapsed
              to a single labelled strip, and GROWS ONLY WHEN IT HAS CONTENT:
              open the row (or have notes/photos already) and the full editable
              textarea and photo tools are right there. Nothing was removed. */}
          <div data-no-print="" style={wide
            ? { order: ORD.needsAttention, marginTop: 'auto', background: 'var(--c-wash2)', borderRadius: 12, padding: '7px 12px' }
            : { order: ORD.needsAttention, ...(isMobile ? mCardOrange : { paddingTop: 20 }) }}>
            <div style={wide
              ? { display: 'flex', alignItems: 'baseline', gap: 8 }
              : { marginBottom: 8 }}>
              <span style={wide
                ? kLabel
                : { fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 10, color: 'var(--c-st-warm)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Needs Attention{wide ? '' : ' / Runner Notes'}
              </span>
              {wide && <span style={internalTag}>Internal</span>}
              {wide && (
                <button
                  type="button"
                  onClick={() => setNaOpen(o => !o)}
                  className="c-x"
                  style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', background: 'none', boxShadow: 'none', cursor: 'pointer', padding: 0, opacity: 1 }}
                >
                  {naHasContent || naOpen ? (naOpen ? 'Hide' : 'Show') : '+ Add'}
                </button>
              )}
            </div>
            {(!wide || naOpen || naHasContent) && (
            <>
            <textarea
              value={wo.needs_attention_notes}
              onChange={e => { setDirtyFields(prev => new Set(prev).add('needs_attention_notes')); setWo(w => w ? { ...w, needs_attention_notes: e.target.value } : w) }}
              placeholder="Internal notes only — never appears on the PDF export…"
              style={{ width: '100%', minHeight: wide ? 46 : 80, marginTop: wide ? 6 : 0, background: 'var(--c-wash)', borderRadius: 5, color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 11, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
            />
            {wo.needs_attention_photos?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {wo.needs_attention_photos.map((url, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <SignedImage path={url} link linkStyle={{ display: 'block', flexShrink: 0 }} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                    {!readOnly && (
                      <button type="button" onClick={() => deleteNAPhoto(url)} aria-label="Remove photo" style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 99, background: 'var(--c-wash2)', color: 'var(--c-fg-2)', fontSize: 11, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* Photo attach — ported from the runner page; writes immediately
                (like the equipment note photos), not on Save. */}
            {!readOnly && (
              <>
                <input data-no-print="" ref={naFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadNAPhoto(f) }} />
                <button
                  type="button"
                  disabled={naUploading}
                  onClick={() => naFileRef.current?.click()}
                  style={{ marginTop: 8, fontSize: 10, fontFamily: 'Inter', color: naUploading ? 'var(--c-fg-3)' : 'var(--c-fg-2)', background: 'none', cursor: naUploading ? 'not-allowed' : 'pointer', padding: 0 }}
                >
                  {naUploading ? 'Uploading…' : '+ Add photo'}
                </button>
              </>
            )}
            </>
            )}
          </div>

          </>)}

          </div>{/* ══ end WORDS column ══ */}

          {/* ══ NUMBERS COLUMN ══════════════════════════════════════════════════
              Studio-time bin → pinned itemized total → rentals bin → payments
              and totals. The two bins scroll INDEPENDENTLY and each announces
              itself; everything below them is pinned. */}
          {!isBlock && (
          <div style={wide
            ? { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }
            : { display: 'contents' }}>

          {/* SEED — bulk-append studio-time rows for a date range (WO-SPEC §6) */}
          {!readOnly && !runner && (
            <div style={{ order: ORD.seed, borderRadius: 12, overflow: 'hidden' }}>
              <button type="button" onClick={() => setSeedOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--c-wash)', cursor: 'pointer', color: 'var(--c-fg-2)' }}>
                <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>+ Seed — add multiple days</span>
                <span style={{ fontSize: 10 }}>{seedOpen ? '▲' : '▼'}</span>
              </button>
              {seedOpen && (
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {seedGroups.map((seed, gi) => (
                    <div
                      key={seed.id}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 12,
                        // Groups after the first are visually separated so the
                        // panel reads as a list of shapes, not one long form.
                        ...(gi > 0 ? { borderTop: '1px solid var(--c-wash2)', paddingTop: 12 } : {}),
                      }}
                    >
                      {seedGroups.length > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ ...metaLabel, marginBottom: 0 }}>Group {gi + 1}</span>
                          <div style={{ flex: 1 }} />
                          <button
                            type="button"
                            onClick={() => setSeedGroups(prev => prev.filter(g => g.id !== seed.id))}
                            title="Remove this group"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-fg)', opacity: 0.4, fontSize: 14, padding: '0 2px' }}
                          >×</button>
                        </div>
                      )}
                      {/* Note: plain <div> wrappers, NOT <label> — a <label> forwards
                          clicks to its first control, which broke the Day/Hr toggle. */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(126px, 1fr))', gap: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={metaLabel}>Studio</span>
                          <input value={seed.studio} onChange={e => patchSeed(seed.id, { studio: e.target.value })} className="c-input c-inset2" />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={metaLabel}>Start date</span>
                          <input type="date" value={seed.start} onChange={e => patchSeed(seed.id, { start: e.target.value })} className="c-input c-inset2" />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={metaLabel}>End date</span>
                          <input type="date" value={seed.end} onChange={e => patchSeed(seed.id, { end: e.target.value })} className="c-input c-inset2" />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={metaLabel}>From</span>
                          <TimeInput value={seed.from} onChange={v => patchSeed(seed.id, { from: v })} className="c-input c-inset2" />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={metaLabel}>To</span>
                          <TimeInput value={seed.to} onChange={v => patchSeed(seed.id, { to: v })} className="c-input c-inset2" />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                          <span style={metaLabel}>Rate</span>
                          {/* flexShrink:0 on the toggle — the Hr button used to be
                              squeezed to nothing by the rate input in a narrow cell,
                              so the control looked like a static "Day" label. */}
                          <div style={{ display: 'flex', gap: 4, minWidth: 0 }}>
                            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                              {(['day', 'hour'] as const).map(rt => (
                                <button key={rt} type="button" onClick={() => patchSeed(seed.id, { rateType: rt })} style={{ padding: '4px 9px', fontSize: 10, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', background: seed.rateType === rt ? 'var(--c-fg)' : 'var(--c-wash2)', color: seed.rateType === rt ? 'var(--c-bg)' : 'var(--c-fg-2)' }}>{rt === 'day' ? 'Day' : 'Hr'}</button>
                              ))}
                            </div>
                            <input value={seed.rate} onChange={e => patchSeed(seed.id, { rate: e.target.value })} className="c-input c-inset2" style={{ flex: 1, minWidth: 0 }} />
                          </div>
                        </div>
                      </div>

                      {/* Staff — off by default; toggle on to add an engineer (1ST) or assistant (2ND) + rate */}
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={metaLabel}>Eng / Asst</span>
                          <button type="button" onClick={() => patchSeed(seed.id, { engOn: !seed.engOn })} style={{ padding: '4px 18px', borderRadius: 4, fontSize: 10, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer', background: seed.engOn ? 'var(--c-wash2)' : 'transparent', color: seed.engOn ? 'var(--c-fg)' : 'var(--c-fg-2)' }}>
                            {seed.engOn ? 'Yes' : 'No'}
                          </button>
                        </div>
                        {seed.engOn && (
                          <>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span style={metaLabel}>Role</span>
                              <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden' }}>
                                {(['engineer', 'assistant'] as const).map(role => (
                                  <button key={role} type="button" onClick={() => patchSeed(seed.id, { engRole: role })} style={{ padding: '4px 10px', fontSize: 10, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer', background: seed.engRole === role ? 'var(--c-fg)' : 'var(--c-wash2)', color: seed.engRole === role ? 'var(--c-bg)' : 'var(--c-fg-2)' }}>
                                    {role === 'engineer' ? '1ST' : '2ND'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '0 1 220px' }}>
                              <span style={metaLabel}>{seed.engRole === 'assistant' ? 'Assistant name' : 'Engineer name'}</span>
                              <input list="wo-eng-roster" value={seed.engName} onChange={e => patchSeed(seed.id, { engName: e.target.value })} className="c-input c-inset2" />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 80 }}>
                              <span style={metaLabel}>Rate</span>
                              <input value={seed.engRate} onChange={e => patchSeed(seed.id, { engRate: e.target.value })} className="c-input c-inset2" />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  <div>
                    <button
                      type="button"
                      onClick={() => setSeedGroups(prev => [...prev, newSeedGroup(prev[prev.length - 1])])}
                      style={{ padding: '6px 14px', borderRadius: 6, fontSize: 10.5, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer', background: 'var(--c-wash2)', color: 'var(--c-fg)' }}
                    >+ Add another group</button>
                  </div>

                  {seedMsg && (
                    <div role="alert" style={{ fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-st-hot)' }}>{seedMsg}</div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>Appends one row per day; dates already in the table are skipped.</span>
                    {(() => {
                      const ready = seedGroups.filter(g => g.start).length
                      const can = ready > 0 && !seedBusy
                      return (
                        <button type="button" disabled={!can} onClick={handleSeed} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 11, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, whiteSpace: 'nowrap', cursor: can ? 'pointer' : 'default', background: ready > 0 ? 'var(--c-fg)' : 'var(--c-wash)', color: ready > 0 ? 'var(--c-bg)' : 'var(--c-fg-3)' }}>
                          {seedBusy ? 'Adding…' : ready > 1 ? `Add rows · ${ready} groups` : 'Add rows'}
                        </button>
                      )
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STUDIO TIME TABLE — unified per-row Day/Hr toggle */}
          <div style={isMobile ? { order: ORD.studioTime, ...mCard } : { order: ORD.studioTime, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* VIEW TOGGLE (Eli, 2026-08-15 — Finder-style, mock
                docs/design-refs/runner-wo-views.html): list = the §16 day
                blocks, cards = one day one card. Sits beside the section
                header; batch edit (admin's bulk mode) keeps its slot in the
                header itself. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SectionHeader
                  carved
                  title={wide && dayCount > 0 ? `Studio Time · ${dayCount} day${dayCount === 1 ? '' : 's'}` : 'Studio Time'}
                  action={!readOnly && !runner && stView !== 'cards' && stRows.some(r => r.date && (r.studio || '').trim())
                    ? { label: batchOpen ? 'Close batch edit' : 'Batch edit', onClick: () => setBatchOpen(v => !v) }
                    : undefined}
                />
              </div>
              {/* Monthly split control — admin only, needs dated studio rows.
                  Small popover: monthly total + the deal's OT rate, applied
                  together (monthlies include 12h/day; beyond = OT). */}
              {!readOnly && !runner && stRows.some(r => r.date && (r.studio || '').trim()) && (
                <div style={{ position: 'relative', flexShrink: 0, marginBottom: 12 }}>
                  <button type="button" onClick={() => monthlyOpen ? closeMonthly() : openMonthly()} title="Monthly lockout: split a flat monthly amount across the month's day rows to the cent" style={{ fontSize: 10, fontFamily: 'Inter', color: monthlyOpen ? 'var(--c-fg)' : 'var(--c-fg-2)', background: 'none', cursor: 'pointer', padding: 0 }}>Monthly</button>
                  {monthlyOpen && (
                    <div className="c-sheet" style={{ position: 'absolute', top: 'calc(100% + 10px)', right: 0, zIndex: 40, width: 300, padding: 20, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--c-bg)', borderRadius: 16 }}>
                      <div className="c-arch" style={{ fontSize: 14 }}>Monthly lockout</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Start date</div>
                          <input type="date" value={monthlyStart} onChange={e => setMonthlyStart(e.target.value)} className="c-input c-inset2" style={{ width: '100%', boxSizing: 'border-box' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>End date</div>
                          <input type="date" value={monthlyEnd} onChange={e => setMonthlyEnd(e.target.value)} className="c-input c-inset2" style={{ width: '100%', boxSizing: 'border-box' }} />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Monthly total</div>
                          <input
                            autoFocus
                            value={monthlyAmt}
                            onChange={e => setMonthlyAmt(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') applyMonthlySplit(); if (e.key === 'Escape') closeMonthly() }}
                            placeholder="19,500"
                            className="c-input c-inset2"
                            style={{ width: '100%', boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>OT rate / hr</div>
                          <input
                            value={monthlyOt}
                            onChange={e => setMonthlyOt(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') applyMonthlySplit(); if (e.key === 'Escape') closeMonthly() }}
                            placeholder="per deal"
                            className="c-input c-inset2"
                            style={{ width: '100%', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                          <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Daily times</span>
                          {/* 24hr lockout: no clocks on the rows, no OT ever. */}
                          <button
                            type="button"
                            onClick={() => setMonthlyNA(v => !v)}
                            title="24-hour lockout — no daily times, no OT"
                            className={monthlyNA ? 'c-pill c-fill-dead' : ''}
                            style={{ fontSize: 10, fontFamily: 'Inter', color: monthlyNA ? undefined : 'var(--c-fg-3)', background: monthlyNA ? undefined : 'none', cursor: 'pointer', padding: monthlyNA ? '3px 10px' : 0, letterSpacing: '0.04em' }}
                          >N/A</button>
                        </div>
                        {monthlyNA ? (
                          <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-3)' }}>24-hour lockout — no daily times, no OT.</div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <TimeInput value={monthlyFrom} onChange={setMonthlyFrom} placeholder="from" className="c-input c-inset2" style={{ width: '100%', boxSizing: 'border-box' }} />
                            <TimeInput value={monthlyTo} onChange={setMonthlyTo} placeholder="to" className="c-input c-inset2" style={{ width: '100%', boxSizing: 'border-box' }} />
                          </div>
                        )}
                      </div>
                      {/* STAFF — the monthly's own question (2026-09-03). A
                          lockout is rent, and rent normally has nobody on it,
                          so No staff leads and the created days carry no empty
                          staff lines. Mustard is the exception: Assistant here
                          gives every day its 2ND slot for the runner to fill.
                          Per-day changes stay on the day card (× / + Add). */}
                      <div>
                        <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Staff</div>
                        <div className="c-seg c-seg-tiny" style={{ alignSelf: 'flex-start' }}>
                          {([[false, 'No staff'], [true, 'Assistant']] as const).map(([val, lbl]) => (
                            <button
                              key={lbl}
                              type="button"
                              onClick={() => setMonthlyStaff(val)}
                              className={monthlyStaff === val ? 'c-on' : ''}
                              style={{ cursor: 'pointer' }}
                            >{lbl}</button>
                          ))}
                        </div>
                        <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)', marginTop: 5 }}>
                          {monthlyStaff
                            ? 'Every day gets a 2ND line for the runner to fill in.'
                            : 'No staff lines on these days. Add one on a day card if a day needs it.'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, alignItems: 'center', marginTop: 2 }}>
                        <button type="button" onClick={closeMonthly} style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-3)', background: 'none', cursor: 'pointer', padding: 0 }}>Cancel</button>
                        <button type="button" onClick={applyMonthlySplit} className="c-soft c-control c-raised" style={{ cursor: 'pointer', fontSize: 12, padding: '8px 18px' }}>Apply</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="c-seg c-seg-tiny" style={{ flexShrink: 0, marginBottom: 12 }}>
                {(['list', 'cards'] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => { setStView(v); setDaySheetDate(null) }}
                    className={stView === v ? 'c-on' : ''}
                    title={v === 'list' ? 'List view' : 'Card view'}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px' }}
                  >
                    {v === 'list' ? (
                      <svg width="12" height="10" viewBox="0 0 14 12" fill="none"><rect y="0" width="14" height="2" rx="1" fill="currentColor"/><rect y="5" width="14" height="2" rx="1" fill="currentColor"/><rect y="10" width="14" height="2" rx="1" fill="currentColor"/></svg>
                    ) : (
                      <svg width="12" height="10" viewBox="0 0 14 12" fill="none"><rect width="14" height="5" rx="1.5" fill="currentColor"/><rect y="7" width="14" height="5" rx="1.5" fill="currentColor"/></svg>
                    )}
                    {/* The mock labels the toggle. Two bare icons make you learn
                        which is which; on a phone the icon alone is the right
                        call for the room it saves, so the words are desktop-only. */}
                    {wide && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{v}</span>}
                  </button>
                ))}
              </div>
            </div>
            <datalist id="wo-eng-roster">
              {engRoster.map(n => <option key={n} value={n} />)}
            </datalist>

            {/* ── BATCH EDIT ──────────────────────────────────────────────────
                Change many days at once: choose the scope, tick only the fields
                you mean, apply once. Nothing is written until the WO is saved, so
                Cancel reverts the whole thing.
                Replaced per-cell fill-down arrows — bulk editing reads better as a
                deliberate mode than as 120 tiny buttons scattered through a table. */}
            {batchOpen && !readOnly && stView !== 'cards' && (() => {
              const targets = batchTargets()
              const skipped = batchLockedSkipped()
              const nDays = new Set(targets.map(r => r.date)).size
              const anyField = Object.values(batchOn).some(Boolean)
              const lbl: React.CSSProperties = { fontSize: 10, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.11em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }
              // Was a hand-written duplicate of the well recipe. Deleted per F-22:
              // one implementation, in CSS. `c-input c-inset2` IS that recipe.
              const bInpCls = 'c-input c-inset2'
              const rowS: React.CSSProperties = { display: 'grid', gridTemplateColumns: '128px 1fr', gap: 10, alignItems: 'center' }
              // §8: a segmented control is ONE housing. These were pairs of
              // individually-raised pills sitting inside the already-raised batch
              // panel — bubbles in bubbles. The housing is what says "these two
              // are the choices for one field".
              const scopeBtn = (_on: boolean): React.CSSProperties => ({ cursor: 'pointer' })
              const scopeCls = (on: boolean) => (on ? 'c-on' : '')
              // One checkbox + label per field; unticked fields are never written,
              // so a blank input can't wipe a column by accident.
              const check = (k: BatchField, text: string) => (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', ...lbl, color: batchOn[k] ? 'var(--c-fg)' : 'var(--c-fg-3)' }}>
                  <input type="checkbox" checked={batchOn[k]} onChange={e => setBatchOn(p => ({ ...p, [k]: e.target.checked }))} style={{ cursor: 'pointer', accentColor: 'var(--c-fg)', width: 13, height: 13 }} />
                  {text}
                </label>
              )
              return (
                <div style={{ background: 'var(--c-wash2)', borderRadius: 6, padding: 12, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Scope */}
                  <div style={rowS}>
                    <span style={lbl}>Apply to</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div className="c-seg c-seg-tiny">
                        <button type="button" onClick={() => setBatchScope('all')} className={scopeCls(batchScope === 'all')} style={scopeBtn(batchScope === 'all')}>All days</button>
                        <button type="button" onClick={() => setBatchScope('range')} className={scopeCls(batchScope === 'range')} style={scopeBtn(batchScope === 'range')}>Date range</button>
                      </div>
                      {batchScope === 'range' && (
                        <>
                          <input type="date" value={batchFrom} onChange={e => setBatchFrom(e.target.value)} className={bInpCls} style={{ width: 140 }} />
                          <span style={{ color: 'var(--c-fg-3)', fontSize: 11 }}>–</span>
                          <input type="date" value={batchTo} onChange={e => setBatchTo(e.target.value)} className={bInpCls} style={{ width: 140 }} />
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ height: 1, background: 'var(--c-wash2)' }} />

                  {/* Room */}
                  <div style={rowS}>
                    {check('room', 'Room')}
                    <select
                      value={`${batchVals.location || booking.location || ''}|${batchVals.studio}`}
                      disabled={!batchOn.room}
                      onChange={e => { const [loc, room] = e.target.value.split('|'); setBatchVals(v => ({ ...v, location: loc, studio: room })) }}
                      className={bInpCls} style={{ opacity: batchOn.room ? 1 : 0.45 }}
                    >
                      <option value={`${booking.location || ''}|`}>— select room —</option>
                      {STUDIO_LOCATIONS.map(l => l.rooms.map(room => {
                        const letter = toStudioLetter(room)
                        return <option key={`${l.name}|${letter}`} value={`${l.name}|${letter}`}>{STUDIO_SHORT[l.name] ?? l.name} {letter}</option>
                      }))}
                    </select>
                  </div>

                  {/* Times */}
                  <div style={rowS}>
                    {check('from', 'Start time')}
                    <div style={{ maxWidth: 160, opacity: batchOn.from ? 1 : 0.45 }}>
                      <TimeInput value={batchVals.from_time} onChange={v => setBatchVals(s2 => ({ ...s2, from_time: v }))} className={bInpCls} disabled={!batchOn.from} />
                    </div>
                  </div>
                  <div style={rowS}>
                    {check('to', 'End time')}
                    <div style={{ maxWidth: 160, opacity: batchOn.to ? 1 : 0.45 }}>
                      <TimeInput value={batchVals.to_time} onChange={v => setBatchVals(s2 => ({ ...s2, to_time: v }))} className={bInpCls} disabled={!batchOn.to} />
                    </div>
                  </div>

                  {/* Rate + type */}
                  <div style={rowS}>
                    {check('rate', 'Rate')}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: batchOn.rate ? 1 : 0.45 }}>
                      <div className="c-seg c-seg-tiny">
                        <button type="button" disabled={!batchOn.rate} onClick={() => setBatchVals(v => ({ ...v, rateType: 'hour' }))} className={scopeCls(batchVals.rateType === 'hour')} style={scopeBtn(batchVals.rateType === 'hour')}>/ hr</button>
                        <button type="button" disabled={!batchOn.rate} onClick={() => setBatchVals(v => ({ ...v, rateType: 'day' }))} className={scopeCls(batchVals.rateType === 'day')} style={scopeBtn(batchVals.rateType === 'day')}>/ day</button>
                      </div>
                      <input value={batchVals.rate} disabled={!batchOn.rate} onChange={e => setBatchVals(v => ({ ...v, rate: e.target.value }))} placeholder={batchVals.rateType === 'day' ? '$0/day' : '$0/hr'} className={bInpCls} style={{ maxWidth: 130 }} />
                    </div>
                  </div>

                  {/* OT */}
                  <div style={rowS}>
                    {check('ot_hours', 'OT hours')}
                    <input value={batchVals.ot_hours} disabled={!batchOn.ot_hours} onChange={e => setBatchVals(v => ({ ...v, ot_hours: e.target.value }))} placeholder="0" className={bInpCls} style={{ maxWidth: 130, opacity: batchOn.ot_hours ? 1 : 0.45 }} />
                  </div>
                  <div style={rowS}>
                    {check('ot_rate', 'OT rate')}
                    <input value={batchVals.ot_rate} disabled={!batchOn.ot_rate} onChange={e => setBatchVals(v => ({ ...v, ot_rate: e.target.value }))} placeholder="$0" className={bInpCls} style={{ maxWidth: 130, opacity: batchOn.ot_rate ? 1 : 0.45 }} />
                  </div>

                  {/* Staff */}
                  <div style={rowS}>
                    {check('staff', 'Staff')}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: batchOn.staff ? 1 : 0.45 }}>
                      <div className="c-seg c-seg-tiny">
                        <button type="button" disabled={!batchOn.staff} onClick={() => setBatchVals(v => ({ ...v, staffRole: 'engineer' }))} className={scopeCls(batchVals.staffRole === 'engineer')} style={scopeBtn(batchVals.staffRole === 'engineer')}>1ST</button>
                        <button type="button" disabled={!batchOn.staff} onClick={() => setBatchVals(v => ({ ...v, staffRole: 'assistant' }))} className={scopeCls(batchVals.staffRole === 'assistant')} style={scopeBtn(batchVals.staffRole === 'assistant')}>2ND</button>
                      </div>
                      <input list="wo-eng-roster" value={batchVals.staffName} disabled={!batchOn.staff} onChange={e => setBatchVals(v => ({ ...v, staffName: e.target.value }))} placeholder="Name (blank = unassign)" className={bInpCls} style={{ maxWidth: 220 }} />
                    </div>
                  </div>

                  {/* Session notes */}
                  <div style={rowS}>
                    {check('notes', 'Session info')}
                    <textarea value={batchVals.session_info} disabled={!batchOn.notes} onChange={e => setBatchVals(v => ({ ...v, session_info: e.target.value }))} rows={2} placeholder="Applies the same note to every day in scope" className="c-area" style={{ minHeight: 64, opacity: batchOn.notes ? 1 : 0.45 }} />
                  </div>

                  <div style={{ height: 1, background: 'var(--c-wash2)' }} />

                  {/* Footer: what will happen, stated plainly before you commit. */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-2)' }}>
                      {nDays === 0
                        ? 'No days in range.'
                        : `Will change ${nDays} day${nDays === 1 ? '' : 's'}${skipped > 0 ? ` · skipping ${skipped} approved` : ''}.`}
                      {!anyField && nDays > 0 && <span style={{ color: 'var(--c-fg-3)' }}> Tick a field to enable.</span>}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={() => setBatchOpen(false)} style={{ padding: '6px 14px', borderRadius: 5, background: 'transparent', color: 'var(--c-fg-2)', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                      <button
                        type="button"
                        onClick={applyBatch}
                        disabled={!anyField || nDays === 0}
                        style={{ padding: '6px 16px', borderRadius: 5, background: 'var(--c-fg)', color: 'var(--c-bg)', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, cursor: (!anyField || nDays === 0) ? 'default' : 'pointer', opacity: (!anyField || nDays === 0) ? 0.45 : 1 }}
                      >
                        Apply to {nDays} day{nDays === 1 ? '' : 's'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })()}
            {/* LIST gets the horizontal-scroll container (880px grid on a
                phone); CARDS deliberately does NOT — cards are plain full-width
                blocks, and rendering them inside an overflow-x container is
                what clipped their right corners square (Eli's screenshot,
                2026-08-16). The shared footer sits below both. */}
            {stView !== 'cards' ? (
            /* The relative wrapper is OUTSIDE the horizontal scroller on
               purpose: the fade and the "↓ N more" pill must stay put over the
               bin, not slide away when a wide table is scrolled sideways. */
            <div style={{ position: 'relative' }}>
            <div style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
              {/* Header: Studio | Date | Session Info | From | To | Hrs | Type | Rate | OT Hrs | OT Rate | OT Chg | Total | Lock | Del */}
              {/* ST_MINW: the 14 columns add up to 848px at their minimums. The
                  header and the row scroller both carry it so that when the
                  numbers column is narrower than that, ONE horizontal scrollbar
                  — the outer container's — moves the header and the rows
                  together. Without it the inner scroller (overflow-y: auto
                  computes overflow-x to auto) grows a second scrollbar and the
                  header stops lining up with the cells under it. */}
              <div style={{ display: 'grid', gridTemplateColumns: '58px 58px minmax(150px, 1fr) 66px 66px 38px 48px 68px 44px 62px 60px 74px 34px 22px', paddingBottom: 5, minWidth: isMobile ? 880 : (wide ? ST_MINW : undefined) }}>
                {/* `right` marks the money columns — header and value share an
                    alignment, or the column reads as two ragged edges. */}
                {([['Studio'], ['Date'], ['Session Info'], ['From'], ['To'], ['Hrs'], ['Type'],
                   ['Rate'], ['OT Hrs'], ['OT Rate'], ['OT Chg', 'right'], ['Total', 'right'], [''], ['']] as [string, string?][])
                  .map(([h, align], i) => <div key={i} style={align === 'right' ? thR : thS}>{h}</div>)}
              </div>
              {/* BIN 1 — the days. Scrolls ALONE (mock ruling): it is capped so
                  the rentals bin and the money below it stay on screen, and it
                  gets its own <ScrollHints> so a day below the fold announces
                  itself instead of hiding. Shorter cap on admin desktop because
                  the column has three more things under it that must stay
                  pinned; mobile keeps its original 420. */}
              <div ref={stBinRef} data-st-scroll="" style={{ maxHeight: wide ? ST_BIN_H : 420, overflowY: 'auto', minWidth: isMobile ? 880 : (wide ? ST_MINW : undefined) }}>
                {stRows.map((r, rowIdx) => {
                  // ── DAY BLOCK (RULING 2026-08-13, spec §16) ──────────────
                  // A day and every staff line under it sit in ONE wash block,
                  // with a gap between days. The zebra stripe is retired here:
                  // it banded by DAY, but the question you ask at a row is "who
                  // was on this?" — and the staff line answered it from a band
                  // that said nothing about belonging. A studio line and its
                  // staff lines are one fact and now look like one.
                  //
                  // Grouped by DATE, not by row, so a standalone staff row
                  // (studio '') joins the day it belongs to rather than
                  // floating as its own block. Undated rows group together at
                  // whatever position they hold.
                  //
                  // Done as corner radii on the existing per-row wrapper rather
                  // than by restructuring the loop into nested maps: the row
                  // body below is ~300 lines of money-bearing markup, and
                  // re-nesting it to gain the same pixels would be a large
                  // diff over a small idea.
                  const dayKey = r.date || '(none)'
                  const firstOfDay = rowIdx === 0 || (stRows[rowIdx - 1].date || '(none)') !== dayKey
                  const lastOfDay = rowIdx === stRows.length - 1 || (stRows[rowIdx + 1].date || '(none)') !== dayKey
                  const isEngOnly = r.studio === ''
                  const isDayRow = r.row_rate_type === 'day'
                  const engName = wo?.engineer || liveForm?.engineer_name || booking.engineer_name || ''
                  // The ROW's rate, full stop — see the note on woTotals above.
                  // It used to fall back to the booking's dead engineer_rate,
                  // which made this cell display a charge that billing and the
                  // invoice would never produce.
                  const engRateDisplay = r.eng_rate || ''
                  const engRateNum = parseFloat((engRateDisplay ?? '').replace(/[^0-9.]/g, '')) || 0
                  const engHrs = calcHours(r.eng_from_time || r.from_time, r.eng_to_time || r.to_time)
                  const engCharge = engHrs != null && engHrs > 0 && engRateNum > 0 ? parseFloat((engHrs * engRateNum).toFixed(2)) : null
                  const rowTotal = (r.charge ?? 0) + (r.ot_charge ?? 0)
                  const toggleStyle = (active: boolean): React.CSSProperties => ({
                    fontSize: 9, fontFamily: 'Inter', fontWeight: 700, padding: '2px 5px',
                    borderRadius: 3, cursor: 'pointer',
                    background: active ? 'var(--c-fg)' : 'var(--c-wash)',
                    color: active ? 'var(--c-bg)' : 'var(--c-fg-2)',
                  })
                  const rowHrs = r.total_hours ?? calcHours(r.from_time, r.to_time)
                  const otHrsNum = parseFloat(r.ot_hours ?? '0') || 0

                  // Missing-times highlight. A tint, not a border — Law 1. Hot is
                  // sanctioned for critical/missing-info (spec §5, ruling 2026-07-31).
                  const hasTimeError = timeErrorRows.has(r.id)
                  return (
                    <div
                      key={r.id}
                      style={{
                        // The block's fill. A missing-times row overrides it
                        // with the hot tint — that has to stay louder than the
                        // grouping, or the one row you must fix disappears into
                        // its day.
                        background: hasTimeError
                          ? 'color-mix(in srgb, var(--c-st-hot) 12%, transparent)'
                          : 'var(--c-wash)',
                        borderTopLeftRadius: firstOfDay ? 12 : 0,
                        borderTopRightRadius: firstOfDay ? 12 : 0,
                        borderBottomLeftRadius: lastOfDay ? 12 : 0,
                        borderBottomRightRadius: lastOfDay ? 12 : 0,
                        marginBottom: lastOfDay ? 7 : 0,
                        overflow: 'hidden',
                      }}
                    >
                      {/* Runner mode: a day admin locked is the office's — the
                          whole row goes inert (the lock/delete cells' own
                          pointerEvents:auto is neutralised by the runner
                          branches below, so nothing inside re-enables). */}
                      {!isEngOnly && <div style={{ display: 'grid', gridTemplateColumns: '58px 58px minmax(150px, 1fr) 66px 66px 38px 48px 68px 44px 62px 60px 74px 34px 22px', background: r.admin_locked ? 'var(--c-wash2)' : undefined, ...(runner && r.admin_locked ? { pointerEvents: 'none' as const, opacity: 0.62 } : {}) }}>
                        {/* Studio */}
                        <div style={cellS}>
                          <select
                            value={`${r.location || booking.location || ''}|${toStudioLetter(r.studio)}`}
                            onChange={e => {
                              const [loc, room] = e.target.value.split('|')
                              updateStRow(r.id, { location: loc === (booking.location || '') ? '' : loc, studio: room })
                            }}
                            className="c-tin" style={{ padding: '2px 2px', fontSize: 10 }}
                          >
                            {!STUDIO_LOCATIONS.some(l => l.name === (r.location || booking.location)) && (
                              /* NEVER A BARE ROOM LETTER (ruling 2026-08-13,
                                 restated in the WO-reorg mock): every venue has
                                 a Studio A, so the fallback option names the
                                 venue too — PRS B / ARS A / ERS B / TRS North —
                                 via lib/studios' roomCode, the same map the PDF
                                 prints from. */
                              <option value={`${r.location || booking.location || ''}|${toStudioLetter(r.studio)}`}>{roomCode(toStudioLetter(r.studio), r.location || booking.location) || toStudioLetter(r.studio) || '—'}</option>
                            )}
                            {STUDIO_LOCATIONS.map(l => l.rooms.map(room => {
                              const letter = toStudioLetter(room)
                              return <option key={`${l.name}|${letter}`} value={`${l.name}|${letter}`}>{STUDIO_SHORT[l.name] ?? l.name} {letter}</option>
                            }))}
                          </select>
                        </div>
                        {/* Date — transparent overlay opens native picker, auto-sorts on pick.
                            showPicker() so ANY click in the cell opens it (the invisible
                            input alone only reacts on the browser's calendar-icon zone). */}
                        <div
                          key={r.id + '-date'}
                          style={{ ...cellS, color: 'var(--c-fg-2)', fontSize: 10, position: 'relative', cursor: 'pointer' }}
                          onClick={e => { try { ((e.currentTarget as HTMLElement).querySelector('input[type="date"]') as any)?.showPicker?.() } catch {} }}
                        >
                          <span style={{ pointerEvents: 'none' }}>{shortDate(r.date)}</span>
                          {/* Submit-state dot: warm = submitted, booked = approved (§5). */}
                          {(r.status === 'submitted' || r.status === 'approved') && (
                            <span style={{ position: 'absolute', top: 3, right: 2, width: 5, height: 5, borderRadius: 99, background: r.status === 'approved' ? 'var(--c-st-booked)' : 'var(--c-st-warm)', pointerEvents: 'none' }} />
                          )}
                          {/* Moving a row's DATE is a schedule act — office only. */}
                          {!runner && <input
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
                          />}
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
                          <span data-si-input="" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', color: r.session_info ? 'var(--c-fg)' : 'var(--c-fg-3)', fontSize: 11 }}>
                            {r.session_info || '—'}
                          </span>
                          {r.session_info && <span data-si-print="" style={{ display: 'none' }}>{r.session_info}</span>}
                        </div>
                        {siPopoverRowId === r.id && siPopoverPos && (
                          <>
                            <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setSiPopoverRowId(null)} />
                            {/* OPAQUE (2026-09-03). --c-wash is a translucent
                                tint meant to sit ON a surface; as a floating
                                panel's own background it let the table read
                                straight through the notes. Surface + shadow. */}
                            <div style={{ position: 'fixed', top: siPopoverPos.top, left: siPopoverPos.left, width: 280, zIndex: 200, background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 8, padding: 12 }} onClick={e => e.stopPropagation()}>
                              <textarea
                                value={siPopoverText}
                                onChange={e => setSiPopoverText(e.target.value)}
                                autoFocus
                                rows={4}
                                style={{ width: '100%', background: 'transparent', outline: 'none', resize: 'vertical', color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 11, lineHeight: 1.5, marginBottom: 8, boxSizing: 'border-box' }}
                                placeholder="Session notes…"
                              />
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => { updateStRow(r.id, { session_info: siPopoverText }); setSiPopoverRowId(null) }} style={{ flex: 1, background: 'var(--c-fg)', color: 'var(--c-bg)', borderRadius: 5, padding: '5px 0', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, cursor: 'pointer' }}>Save</button>
                                <button onClick={() => setSiPopoverRowId(null)} style={{ flex: 1, background: 'var(--c-wash2)', color: 'var(--c-fg-2)', borderRadius: 5, padding: '5px 0', fontFamily: "'Archivo Black', sans-serif", fontSize: 11, cursor: 'pointer' }}>Close</button>
                              </div>
                            </div>
                          </>
                        )}
                        {/* From / To */}
                        <div style={cellIn}><TimeInput value={r.from_time} onChange={v => updateStRow(r.id, { from_time: v })} className="c-tin c-tin-mono" /></div>
                        <div style={cellIn}><TimeInput value={r.to_time} onChange={v => updateStRow(r.id, { to_time: v })} className="c-tin c-tin-mono" /></div>
                        {/* Total Hrs — always auto-calc */}
                        <div style={{ ...cellS, color: 'var(--c-fg-2)', fontSize: 10 }}>{rowHrs != null ? `${rowHrs}h` : '—'}</div>
                        {/* Rate Type toggle — office's call; frozen for runners */}
                        <div style={{ ...cellS, gap: 2, padding: '3px 4px' }}>
                          <button style={{ ...toggleStyle(isDayRow), cursor: runner ? 'default' : 'pointer' }} disabled={runner} onClick={() => !runner && !isDayRow && toggleRowRateType(r.id)}>Day</button>
                          <button style={{ ...toggleStyle(!isDayRow), cursor: runner ? 'default' : 'pointer' }} disabled={runner} onClick={() => !runner && isDayRow && toggleRowRateType(r.id)}>Hr</button>
                        </div>
                        {/* Rate — LOCKED IN RUNNER MODE (Eli: "lock rates").
                            Read-only text, not a disabled input: hidden nothing,
                            promised nothing. */}
                        <div style={cellS}>
                          {runner
                            ? <span className="c-tnum" style={{ fontSize: 10, color: 'var(--c-fg-2)' }}>{(isDayRow ? r.rate_daily : r.rate) || '—'}</span>
                            : isDayRow
                            ? <input value={r.rate_daily} onChange={e => updateStRow(r.id, { rate_daily: e.target.value })} className="c-tin" placeholder="$0/day" />
                            : <input value={r.rate} onChange={e => updateStRow(r.id, { rate: e.target.value })} className="c-tin c-tin-mono" placeholder="$0/hr" />
                          }
                        </div>
                        {/* OT Hrs — day: auto display; hourly: editable */}
                        <div style={cellS}>
                          {isDayRow
                            ? <span style={{ fontSize: 10, color: 'var(--c-fg-2)' }}>{otHrsNum > 0 ? `${otHrsNum}h` : '—'}</span>
                            : <input value={r.ot_hours ?? ''} onChange={e => updateStRow(r.id, { ot_hours: e.target.value })} className="c-tin c-tin-mono" placeholder="0" />
                          }
                        </div>
                        {/* OT Rate — editable (auto-populated but overridable); a rate, so locked for runners */}
                        <div style={cellS}>
                          {runner
                            ? <span className="c-tnum" style={{ fontSize: 10, color: 'var(--c-fg-2)' }}>{r.ot_rate || '—'}</span>
                            : <input value={r.ot_rate ?? ''} onChange={e => updateStRow(r.id, { ot_rate: e.target.value })} className="c-tin c-tin-mono" placeholder="$0" />}
                        </div>
                        {/* OT Charge — computed read-only */}
                        <div className="c-tnum" style={{ ...cellS, justifyContent: 'flex-end', color: (r.ot_charge ?? 0) > 0 ? 'var(--c-fg)' : 'var(--c-fg-2)' }}>
                          {(r.ot_charge ?? 0) > 0 ? `$${r.ot_charge!.toFixed(2)}` : '—'}
                        </div>
                        {/* Total Charge = charge + OT charge */}
                        <div className="c-tnum" style={{ ...cellS, justifyContent: 'flex-end', color: rowTotal > 0 ? 'var(--c-fg)' : 'var(--c-fg-2)', fontWeight: rowTotal > 0 ? 600 : 400 }}>
                          {rowTotal > 0 ? `$${rowTotal.toFixed(2)}` : '—'}
                        </div>
                        {/* Lock pill — always clickable even when WO is completed.
                            Except for runners: the lock is the OFFICE's act, so
                            runner mode shows the state and can't flip it. */}
                        <div style={{ ...cellS, justifyContent: 'center', pointerEvents: runner ? 'none' : 'auto' }}>
                          <button
                            type="button"
                            disabled={runner}
                            onClick={() => !runner && handleToggleLock(r.id, r.admin_locked)}
                            style={{
                              fontSize: 8, fontFamily: 'Inter', fontWeight: 700, padding: '2px 5px',
                              borderRadius: 3, cursor: runner ? 'default' : 'pointer', whiteSpace: 'nowrap',
                              background: r.admin_locked ? 'var(--c-st-booked)' : 'var(--c-wash)',
                              color: r.admin_locked ? 'var(--c-bg)' : 'var(--c-fg-3)',
                            }}
                          >{r.admin_locked ? '🔒' : '✓'}</button>
                        </div>
                        {/* Delete row — confirm pops open to the LEFT of the ×, next
                            to the cursor (the × is at the far-right edge). */}
                        <div style={{ ...cellS, justifyContent: 'center', pointerEvents: runner ? 'none' : 'auto', position: 'relative' }}>
                          {!readOnly && !runner && (
                            <>
                              <button type="button" onClick={() => setConfirmDeleteRowId(confirmDeleteRowId === r.id ? null : r.id)} style={{ fontSize: 13, fontFamily: 'Inter', color: confirmDeleteRowId === r.id ? 'var(--c-st-hot)' : 'var(--c-fg-3)', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                              {confirmDeleteRowId === r.id && (
                                <>
                                  <div onClick={() => setConfirmDeleteRowId(null)} style={{ position: 'fixed', inset: 0, zIndex: 190 }} />
                                  <div style={{ position: 'absolute', right: '130%', top: '50%', transform: 'translateY(-50%)', zIndex: 191, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--c-wash)', borderRadius: 6, padding: '5px 9px', whiteSpace: 'nowrap', boxShadow: '0 6px 20px rgba(0,0,0,0.45)' }}>
                                    <span style={{ fontSize: 10, color: 'var(--c-fg-2)', fontFamily: 'Inter' }}>Delete row?</span>
                                    <button type="button" onClick={() => deleteStRow(r.id)} style={{ fontSize: 10, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-bg)', background: 'var(--c-st-hot)', borderRadius: 4, cursor: 'pointer', padding: '3px 10px' }}>Delete</button>
                                    <button type="button" onClick={() => setConfirmDeleteRowId(null)} style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', background: 'var(--c-wash2)', borderRadius: 4, cursor: 'pointer', padding: '3px 10px' }}>Cancel</button>
                                  </div>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>}
                      {!isEngOnly && pendingLockedEdits[r.id] && (
                        <div style={{ padding: '5px 12px', background: 'var(--c-wash)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: 'Inter', color: 'var(--c-st-booked)' }}>
                          <span>Editing a locked row —</span>
                          <button
                            type="button"
                            onClick={() => { handleToggleLock(r.id, true); setPendingLockedEdits(p => { const n = { ...p }; delete n[r.id]; return n }) }}
                            style={{ padding: '2px 8px', borderRadius: 3, background: 'var(--c-wash2)', color: 'var(--c-st-booked)', fontSize: 9, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer' }}
                          >Update</button>
                          <button
                            type="button"
                            onClick={() => { const orig = pendingLockedEdits[r.id]; setStRows(prev => prev.map(row => row.id === r.id ? orig : row)); setPendingLockedEdits(p => { const n = { ...p }; delete n[r.id]; return n }) }}
                            style={{ padding: '2px 8px', borderRadius: 3, background: 'transparent', color: 'var(--c-fg-2)', fontSize: 9, fontFamily: 'Inter', cursor: 'pointer' }}
                          >Revert</button>
                        </div>
                      )}
                      {r.eng_visible !== false && (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '58px 58px minmax(150px, 1fr) 66px 66px 38px 48px 68px 44px 62px 60px 74px 34px 22px', ...(runner && r.admin_locked ? { pointerEvents: 'none' as const, opacity: 0.62 } : {}) }}>
                            {/* 1ST/2ND role toggle — engineer vs assistant (every session has one OR the other) */}
                            <div style={{ ...cellS, paddingTop: 2, paddingBottom: 2 }}>
                              <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => updateStRow(r.id, { eng_role: r.eng_role === 'assistant' ? 'engineer' : 'assistant' })}
                                title={r.eng_role === 'assistant' ? 'Assistant (2nd) — click to switch to Engineer' : 'Engineer (1st) — click to switch to Assistant'}
                                style={{ fontSize: 8, fontFamily: 'Inter', fontWeight: 700, letterSpacing: '0.04em', padding: 0, borderRadius: 3, cursor: readOnly ? 'default' : 'pointer', background: 'transparent', color: r.eng_role === 'assistant' ? 'var(--c-st-warm)' : 'var(--c-fg)' }}
                              >
                                {r.eng_role === 'assistant' ? '2ND' : '1ST'}
                              </button>
                            </div>
                            {/* Date picker — uses r.date for eng-only rows; shared with main row for studio rows */}
                            <div
                              key={r.id + '-eng-date'}
                              style={{ ...cellS, color: 'var(--c-fg-2)', fontSize: 10, position: 'relative', cursor: isEngOnly ? 'pointer' : 'default' }}
                              onClick={e => { try { ((e.currentTarget as HTMLElement).querySelector('input[type="date"]') as any)?.showPicker?.() } catch {} }}
                            >
                              <span style={{ pointerEvents: 'none' }}>{shortDate(r.date)}</span>
                              {isEngOnly && !runner && (
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
                            <div style={{ ...cellIn, paddingTop: 2, paddingBottom: 2 }}>
                              <input
                                list="wo-eng-roster"
                                value={r.eng_name || ''}
                                onChange={e => updateStRow(r.id, { eng_name: e.target.value })}
                                placeholder={engName || (r.eng_role === 'assistant' ? 'Assistant…' : 'Engineer…')}
                                className="c-tin" style={{ fontSize: 10, color: 'var(--c-fg)' }}
                              />
                            </div>
                            <div style={cellIn}><TimeInput value={r.eng_from_time || r.from_time} onChange={v => updateStRow(r.id, { eng_from_time: v })} className="c-tin c-tin-mono" /></div>
                            <div style={cellIn}><TimeInput value={r.eng_to_time || r.to_time} onChange={v => updateStRow(r.id, { eng_to_time: v })} className="c-tin c-tin-mono" /></div>
                            <div style={{ ...cellS, color: 'var(--c-fg-2)', fontSize: 10 }}>{engHrs != null ? `${engHrs}h` : '—'}</div>
                            <div style={cellS} />
                            <div style={cellS}>
                              {runner
                                ? <span className="c-tnum" style={{ fontSize: 10, color: 'var(--c-fg-2)' }}>{(r.eng_rate || engRateDisplay) || '—'}</span>
                                : (
                                  // "$/hr" placeholder + warm tint when an ENGINEER
                                  // is named with no rate (Eli, 2026-08-18: the
                                  // blank cell gave no hint it was an input, and a
                                  // rated engineer with no rate bills $0).
                                  // Assistants excluded — they're never rated.
                                  <input
                                    value={r.eng_rate || engRateDisplay}
                                    onChange={e => updateStRow(r.id, { eng_rate: e.target.value })}
                                    placeholder="$/hr"
                                    className="c-tin c-tin-mono"
                                    style={{
                                      width: 64,
                                      ...(r.eng_role !== 'assistant' && (r.eng_name || '').trim() && !(r.eng_rate || engRateDisplay)
                                        ? { background: 'color-mix(in srgb, var(--c-st-warm) 20%, transparent)', borderRadius: 5 }
                                        : {}),
                                    }}
                                  />
                                )}
                            </div>
                            <div style={cellS} />
                            <div style={cellS} />
                            <div style={{ ...cellS, justifyContent: 'flex-end' }} />
                            <div className="c-tnum" style={{ ...cellS, justifyContent: 'flex-end', color: engCharge != null ? 'var(--c-fg)' : 'var(--c-fg-2)', fontWeight: engCharge != null ? 600 : 400 }}>
                              {engCharge != null ? `$${engCharge.toFixed(2)}` : '—'}
                            </div>
                            {/* Eng lock — office act; runner sees state only */}
                            <div style={{ ...cellS, justifyContent: 'center', pointerEvents: runner ? 'none' : 'auto' }}>
                              <button type="button" disabled={runner} onClick={() => !runner && handleToggleLock(r.id, r.admin_locked)} style={{ fontSize: 8, fontFamily: 'Inter', fontWeight: 700, padding: '2px 5px', borderRadius: 3, cursor: runner ? 'default' : 'pointer', whiteSpace: 'nowrap', background: r.admin_locked ? 'var(--c-st-booked)' : 'var(--c-wash)', color: r.admin_locked ? 'var(--c-bg)' : 'var(--c-fg-3)' }}>{r.admin_locked ? '🔒' : '✓'}</button>
                            </div>
                            {/* Eng delete × */}
                            <div style={{ ...cellS, justifyContent: 'center', pointerEvents: runner ? 'none' : 'auto' }}>
                              {!readOnly && !runner && <button type="button" onClick={() => setConfirmClearEngId(r.id)} style={{ fontSize: 13, fontFamily: 'Inter', color: 'var(--c-fg-3)', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>}
                            </div>
                          </div>
                          {confirmClearEngId === r.id && (
                            <div style={{ padding: '5px 12px', background: 'var(--c-wash)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: 'Inter', color: 'var(--c-st-warm)' }}>
                              <span>Delete engineer row?</span>
                              <button type="button" onClick={() => isEngOnly ? deleteStRow(r.id) : clearEngRow(r.id)} style={{ padding: '2px 8px', borderRadius: 3, background: 'var(--c-wash2)', color: 'var(--c-st-warm)', fontSize: 9, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer' }}>Y</button>
                              <button type="button" onClick={() => setConfirmClearEngId(null)} style={{ padding: '2px 8px', borderRadius: 3, background: 'transparent', color: 'var(--c-fg-2)', fontSize: 9, fontFamily: 'Inter', cursor: 'pointer' }}>N</button>
                            </div>
                          )}
                        </>
                      )}

                      {/* ── EQUIPMENT, THE DAY'S THIRD LINE (§18) ───────────
                          Rendered on the LAST row of each date, so it closes the
                          day block rather than splitting the studio row from its
                          staff. Undated rows get nothing — there is no night to
                          report on.

                          NEVER PRINTS. Equipment condition is internal; it is
                          not in lib/woPdf.ts and must not be added there. */}
                      {lastOfDay && r.date && (
                        <div data-no-print="" style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', padding: '3px 12px 8px' }}>
                          <span style={{ fontSize: 8.5, fontFamily: 'Inter, sans-serif', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg)', opacity: 0.38, marginRight: 2 }}>
                            Equipment
                          </span>
                          {EQUIPMENT_ITEMS.map(eq => {
                            const cond = equipRows.find(x => x.equipment === eq && x.date === r.date)?.condition ?? null
                            const noteKey = `${eq}||${r.date}`
                            const hasNote = !!(equipNotes[noteKey]?.note || (equipNotes[noteKey]?.photo_urls?.length ?? 0) > 0)
                            return (
                              <button
                                key={eq}
                                type="button"
                                disabled={readOnly}
                                onClick={() => cycleEquip(eq, r.date)}
                                title={cond === null ? 'Not checked — tap to mark OK' : cond === 'ok' ? 'OK — tap if it was not' : 'Not OK — tap to clear back to not checked'}
                                className={`c-eqpill${cond ? ` c-${cond === 'ok' ? 'ok' : 'bad'}` : ''}`}
                              >
                                <i />
                                {eq}
                                {cond === 'not_ok' && hasNote && <b>·</b>}
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {/* The Not-OK note, for whichever item on THIS day is open. */}
                      {lastOfDay && r.date && openNoteKey?.endsWith(`||${r.date}`) && (() => {
                        const eq = openNoteKey.split('||')[0]
                        const note = equipNotes[openNoteKey]
                        return (
                          <div data-no-print="" style={{ padding: '8px 12px', background: 'var(--c-wash2)', borderRadius: 12, margin: '0 8px 8px' }}>
                            <div style={{ fontSize: 9, fontFamily: 'Inter, sans-serif', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-st-hot)', marginBottom: 6 }}>
                              {eq} — what was wrong?
                            </div>
                            <textarea
                              value={note?.note ?? ''}
                              disabled={readOnly}
                              onChange={e => setEquipNotes(prev => ({ ...prev, [openNoteKey]: { ...(prev[openNoteKey] ?? { id: '', photo_urls: [] }), note: e.target.value } }))}
                              onBlur={e => upsertEquipNote(openNoteKey, eq, r.date, { note: e.target.value })}
                              placeholder="Note about this issue…"
                              style={{ width: '100%', background: 'transparent', borderRadius: 4, color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 11, padding: '5px 7px', resize: 'none', outline: 'none', boxSizing: 'border-box', minHeight: 52 }}
                            />
                            {(note?.photo_urls?.length ?? 0) > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                                {note.photo_urls.map((url, i) => (
                                  <SignedImage key={i} path={url} link alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                                ))}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
                              {!readOnly && (
                                <button
                                  type="button"
                                  disabled={noteUploading}
                                  onClick={() => { pendingNoteKey.current = { key: openNoteKey, equipment: eq, date: r.date }; equipNoteFileRef.current?.click() }}
                                  style={{ fontSize: 10, fontFamily: 'Inter', color: noteUploading ? 'var(--c-fg-3)' : 'var(--c-fg-2)', background: 'none', cursor: noteUploading ? 'not-allowed' : 'pointer', padding: 0 }}
                                >
                                  {noteUploading ? 'Uploading…' : '+ Photo'}
                                </button>
                              )}
                              <button type="button" onClick={() => setOpenNoteKey(null)} style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)', background: 'none', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}>
                                Done
                              </button>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>
            </div>
            {wide && <ScrollHints targetRef={stBinRef} unit="row" />}
            </div>
            ) : (
              /* ── CARD VIEW — one day, one card (Eli, 2026-08-15; mock
                  docs/design-refs/runner-wo-views.html phone 2). A day, its
                  staff and its condition are ONE FACT (§16/§18) — the card is
                  the same block, stood upright for a phone. Tap → the day
                  sheet. All edits go through the sheet; the card itself only
                  cycles equipment pills. Locked days (admin_locked, runner
                  mode) render dimmed with no sheet. */
              /* BIN 1, cards flavour — same bin, same cap, same hints. The
                 toggle changes what a day looks like, never where it lives or
                 what scrolls. */
              <div style={{ position: 'relative' }}>
              <div ref={stBinRef} data-st-cards="" style={wide ? { maxHeight: ST_BIN_H, overflowY: 'auto', paddingRight: 4 } : undefined}>
                {(() => {
                  const groups: { date: string; rows: StRow[] }[] = []
                  for (const r of stRows) {
                    const key = r.date || ''
                    const last = groups[groups.length - 1]
                    if (last && last.date === key) last.rows.push(r)
                    else groups.push({ date: key, rows: [r] })
                  }
                  return groups.map(g => {
                    const studioRows = g.rows.filter(r => r.studio !== '')
                    // THE SLOT SHOWS EVEN WHEN EMPTY (2026-08-20). This used to
                    // require a name or a rate, which hid the legitimate
                    // "engineer, TBD" state and meant a fresh session showed no
                    // staffing at all. eng_visible === false is still an
                    // explicit "this day runs unstaffed" and stays hidden.
                    const staffRows = g.rows.filter(r => r.eng_visible !== false)
                    const cardLocked = runner && g.rows.length > 0 && g.rows.every(r => r.admin_locked)
                    const allApproved = g.rows.length > 0 && g.rows.every(r => r.status === 'approved')
                    const anySubmitted = g.rows.some(r => r.status === 'submitted')
                    const dotColor = allApproved ? 'var(--c-st-booked)' : anySubmitted ? 'var(--c-st-warm)' : null
                    const first = studioRows[0] ?? g.rows[0]
                    const studios = Array.from(new Set(studioRows.map(r => toStudioLetter(r.studio)).filter(Boolean)))
                    const song = g.rows.map(r => r.session_info).find(Boolean) || ''
                    const otHrsTotal = g.rows.reduce((s, r) => s + (parseFloat(r.ot_hours || '0') || 0), 0)
                    const engChargeFor = (r: StRow) => {
                      const rate = parseFloat((r.eng_rate ?? '').replace(/[^0-9.]/g, '')) || 0
                      const hrs = calcHours(r.eng_from_time || r.from_time, r.eng_to_time || r.to_time)
                      return hrs != null && hrs > 0 && rate > 0 ? hrs * rate : 0
                    }
                    const dayTotal = g.rows.reduce((s, r) => s + (r.charge ?? 0) + (r.ot_charge ?? 0) + engChargeFor(r), 0)

                    // ── DESKTOP CARD — V1 "two halves" (Eli's pick, 2026-08-18;
                    // mock docs/design-refs/wo-day-card-options.html). The day
                    // reads on the left exactly like the phone card but at
                    // size — studio times big, each staff line directly under
                    // in the same inline voice — and the money lives in a
                    // right panel where OT sits touching the day total.
                    // Phone/runner keeps the original card below untouched
                    // (mobile-is-the-original rule). Same row fields as the
                    // table and the PDF — no card-only math.
                    if (!isMobile) {
                      const otChargeTotal = g.rows.reduce((s, r) => s + (r.ot_charge ?? 0), 0)
                      return (
                        <div
                          key={g.date || 'undated'}
                          onClick={() => { if (!readOnly) setDaySheetDate(g.date) }}
                          style={{
                            background: 'var(--c-wash)', borderRadius: 14, padding: '15px 16px', marginBottom: 9,
                            cursor: cardLocked || readOnly ? 'default' : 'pointer',
                            opacity: cardLocked ? 0.62 : 1,
                            display: 'flex', gap: 14, alignItems: 'stretch',
                          }}
                        >
                          {/* Three regions, per the mock: the day on the left,
                              its notes in the middle gap, the money on the
                              right. The left is basis-sized rather than an equal
                              flex share so the notes column gets the room — a
                              time range and two staff lines have a known width;
                              a note does not. */}
                          {/* 340 FIXED, not 235 shrinkable (Eli, 2026-08-18:
                              "move the line… over so that the info on the left
                              isnt crampeed. we dont need that much space for
                              seession info"). At 235 with shrink the equipment
                              pills wrapped and the staff line squeezed; the
                              notes column was hogging width it rarely uses. */}
                          <div style={{ flex: '0 0 340px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {studios.length > 0 && (
                                <span className="c-arch" style={{ fontSize: 16, letterSpacing: '-0.01em', flexShrink: 0 }}>
                                  Studio {studios.join(' · ')}
                                </span>
                              )}
                              <span style={{ fontSize: 12, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-fg-2)' }}>{weekdayDate(g.date)}</span>
                              {dotColor && <span style={{ width: 8, height: 8, borderRadius: 99, background: dotColor, display: 'inline-block', flexShrink: 0 }} />}
                            </div>
                            {/* 16px, NOT 22 (2026-08-18). At 22 the range wrapped
                                onto two lines and pushed the hours onto a third —
                                the mock sets 16 and keeps "12:00 PM – 7:00 PM 7h"
                                on ONE line, which is the whole point of the day
                                reading at a glance. `whiteSpace: nowrap` makes
                                that a guarantee rather than a hope. */}
                            <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
                              <span style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 16, fontWeight: 600 }}>
                                {first?.from_time || '—'} – {first?.to_time || <span style={{ color: 'var(--c-fg-3)', fontSize: 12 }}>tap to set</span>}
                              </span>
                              {first?.total_hours != null && <span style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-2)' }}>{first.total_hours}h</span>}
                              {/* THE RATE THAT MADE THE TOTAL (Eli, 2026-08-20:
                                  "the studio time cards have no place for rate").
                                  The card showed times, hours and a day total with
                                  nothing to check the total against. Read-only, like
                                  every other figure on the card — editing still
                                  happens in the day sheet. Day rate reads "Day
                                  $1,400"; hourly reads "$150/hr". A dated studio row
                                  with no rate says so in warm, the same signal the
                                  table and sheet use for a missing rate. */}
                              {first && (() => {
                                const daily = first.row_rate_type === 'day'
                                const raw = ((daily ? first.rate_daily : first.rate) ?? '').toString().trim()
                                if (!raw) {
                                  return first.date ? (
                                    <span style={{ fontSize: 10.5, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-st-warm)' }}>rate?</span>
                                  ) : null
                                }
                                const money = raw.startsWith('$') ? raw : `$${raw}`
                                return (
                                  <span style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-2)' }}>
                                    {daily ? `Day ${money}` : `${money}/hr`}
                                  </span>
                                )
                              })()}
                            </div>
                            {/* Actual arrival/departure (2026-09-01) — quiet,
                                times only (no percentage — Eli), internal only. */}
                            {(first?.actual_from_time || first?.actual_to_time) && (
                              <div style={{ marginTop: 3, fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg-3)', whiteSpace: 'nowrap' }}>
                                Actually here{' '}
                                <span style={{ fontFamily: "'DM Mono', ui-monospace, monospace", color: 'var(--c-fg-2)' }}>
                                  {first.actual_from_time || '—'} – {first.actual_to_time || '—'}
                                </span>
                              </div>
                            )}
                            {/* THE STAFF SLOT IS ALWAYS VISIBLE (2026-08-20).
                                Every session has someone on it, so a day with
                                nobody assigned yet shows the empty slot rather
                                than hiding the whole idea — click through to
                                the day sheet to fill it. */}
                            {staffRows.length === 0 && (
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4, whiteSpace: 'nowrap', opacity: 0.55 }}>
                                <span style={{ fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, color: 'var(--c-st-warm)' }}>2ND</span>
                                <span style={{ fontSize: 11.5, fontFamily: 'Inter', fontWeight: 600, color: 'var(--c-fg-3)' }}>no one assigned</span>
                                {!readOnly && <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)' }}>· click to set</span>}
                              </div>
                            )}
                            {staffRows.map(r => {
                              const st = staffTimes(r)
                              const engHrs = calcHours(st.from, st.to)
                              return (
                                /* One line per staffer, same as the mock: role
                                   chip, name, their window, their hours. It was
                                   13.5/15px and wrapping to three lines. */
                                <div key={r.id + '-staff'} style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4, whiteSpace: 'nowrap' }}>
                                  <span style={{ fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, color: r.eng_role === 'assistant' ? 'var(--c-st-warm)' : 'var(--c-fg)', flexShrink: 0 }}>
                                    {r.eng_role === 'assistant' ? '2ND' : '1ST'}
                                  </span>
                                  <span style={{ fontSize: 11.5, fontFamily: 'Inter', fontWeight: 600 }}>
                                    {r.eng_name || <span style={{ color: 'var(--c-fg-3)' }}>TBD</span>}
                                  </span>
                                  <span style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 10.5, color: 'var(--c-fg-2)', opacity: 0.75 }}>
                                    {st.from || '—'} – {st.to || '—'}
                                    {engHrs != null && engHrs > 0 ? ` · ${engHrs}h` : ''}
                                  </span>
                                  {/* Their rate, same reason as the studio rate
                                      above. A NAMED staffer with no rate is the
                                      likeliest way a session under-bills, so that
                                      case shouts in warm rather than staying blank
                                      — the live warning banner says the same thing.
                                      Assistants are excluded from the warning (they
                                      are often unpaid seconds), matching the rule
                                      the table cell and sheet already use. */}
                                  {(() => {
                                    const raw = (r.eng_rate ?? '').toString().trim()
                                    if (raw) {
                                      const money = raw.startsWith('$') ? raw : `$${raw}`
                                      return (
                                        <span style={{ fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg-2)' }}>
                                          {money}/hr
                                        </span>
                                      )
                                    }
                                    return r.eng_name && r.eng_role !== 'assistant' ? (
                                      <span style={{ fontSize: 10, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-st-warm)' }}>rate?</span>
                                    ) : null
                                  })()}
                                  {/* Staff-line × — ADMIN ONLY (Eli, 2026-08-18:
                                      two assistants is rare but real, so a
                                      mis-add needs a way out). Standalone staff
                                      rows delete; a studio row's eng sub-row
                                      clears — the same fork the list view uses. */}
                                  {!readOnly && (
                                    <button
                                      type="button"
                                      aria-label="Remove this staff line"
                                      className="c-x"
                                      onClick={e => { e.stopPropagation(); r.studio === '' ? deleteStRow(r.id) : clearEngRow(r.id) }}
                                      style={{ fontSize: 12, boxShadow: 'none' }}
                                    >×</button>
                                  )}
                                </div>
                              )
                            })}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 12, flexWrap: 'wrap' }}>
                              <span style={{ display: 'inline-flex' }}>{renderEquipPills(g.date, cardLocked)}</span>
                            </div>
                            {renderEquipNoteBlock(g.date)}
                          </div>

                          {/* THE MIDDLE GAP IS WHERE THE DAY'S NOTES GO (mock
                              ruling 2026-08-18). The song/session note used to
                              trail the equipment pills as one more italic scrap
                              on the bottom line, where a three-day card gave you
                              no way to tell at a glance what happened on each
                              day. It now has the card's middle column to itself.
                              Read-only here on purpose — it is `session_info`,
                              the SAME existing field, edited in the day sheet
                              this card opens. No new field, no new write. */}
                          <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--c-wash2)', paddingLeft: 12 }}>
                            <div style={{ ...kLabel, marginBottom: 3 }}>
                              Song / session notes{g.date ? ` · ${shortDate(g.date)}` : ''}
                            </div>
                            <div style={{ fontSize: 11.5, fontFamily: 'Inter', lineHeight: 1.5, color: song ? 'var(--c-fg-2)' : 'var(--c-fg-3)', fontStyle: song ? 'normal' : 'italic' }}>
                              {song || '—'}
                            </div>
                          </div>

                          {/* NO PANEL (2026-08-18). This was a 158px --c-wash2
                              slab with a raised Edit chip — a box inside a box,
                              and the heaviest thing on the card. The mock is a
                              120px column of plain right-aligned text on the
                              card's own surface: a small "✎ edit" label at the
                              top, the day total at the bottom, OT touching it. */}
                          <div style={{ width: 120, flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column' }}>
                            {!readOnly && (
                              confirmDeleteDay === (g.date || '') ? (
                                /* Two-step, like every other delete on this
                                   screen — a whole day is too much to lose to
                                   one stray click. */
                                <span style={{ display: 'flex', gap: 6, alignSelf: 'flex-end', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                                  <span style={{ fontSize: 9.5, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-fg-2)' }}>Delete day?</span>
                                  <button type="button" className="c-x" onClick={() => deleteDayRows(g.rows)} style={{ fontSize: 9.5, fontFamily: 'Inter', fontWeight: 800, color: 'var(--c-bg)', background: 'var(--c-st-hot)', borderRadius: 99, padding: '2px 9px', cursor: 'pointer', opacity: 1 }}>Delete</button>
                                  <button type="button" className="c-x" onClick={() => setConfirmDeleteDay(null)} style={{ fontSize: 9.5, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-fg-2)', background: 'var(--c-wash2)', borderRadius: 99, padding: '2px 9px', cursor: 'pointer', opacity: 1 }}>Keep</button>
                                </span>
                              ) : (
                                <span style={{ display: 'flex', gap: 10, alignSelf: 'flex-end', alignItems: 'center' }}>
                                  <span style={kLabel}>{cardLocked ? '👁 view' : '✎ edit'}</span>
                                  {/* Day-card × — ADMIN ONLY (runner renders the
                                      phone card, never this branch). */}
                                  <button
                                    type="button"
                                    aria-label="Delete this day"
                                    className="c-x"
                                    onClick={e => { e.stopPropagation(); setConfirmDeleteDay(g.date || '') }}
                                    style={{ fontSize: 13, boxShadow: 'none' }}
                                  >×</button>
                                </span>
                              )
                            )}
                            <div style={{ marginTop: 'auto' }}>
                              {otHrsTotal > 0 && (
                                <div style={{ fontSize: 10.5, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-st-warm)' }}>
                                  OT {otHrsTotal}h{otChargeTotal > 0 ? ` · $${otChargeTotal.toFixed(0)}` : ''}
                                </div>
                              )}
                              <div style={{ ...kLabel, marginTop: otHrsTotal > 0 ? 3 : 0 }}>
                                Day total
                              </div>
                              <div className="c-arch" style={{ fontSize: 15, letterSpacing: '-0.02em', color: dayTotal > 0 ? 'var(--c-fg)' : 'var(--c-fg-3)' }}>
                                {dayTotal > 0 ? `$${dayTotal.toFixed(2)}` : '—'}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div
                        key={g.date || 'undated'}
                        // Locked days still OPEN — for reference (Eli,
                        // 2026-08-16); their inputs are inert inside the sheet.
                        onClick={() => { if (!readOnly) setDaySheetDate(g.date) }}
                        style={{
                          background: 'var(--c-wash)', borderRadius: 14, padding: '13px 14px', marginBottom: 9,
                          maxWidth: '100%', boxSizing: 'border-box', minWidth: 0,
                          cursor: cardLocked || readOnly ? 'default' : 'pointer',
                          opacity: cardLocked ? 0.62 : 1,
                        }}
                      >
                        {/* THE ROOM LEADS (Eli, 2026-08-16): "Studio B" far
                            left, slight hero, BEFORE the date — a runner's
                            first question on any card is "which room". */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
                          {studios.length > 0 && (
                            <span className="c-arch" style={{ fontSize: 15, letterSpacing: '-0.01em', flexShrink: 0 }}>
                              Studio {studios.join(' · ')}
                            </span>
                          )}
                          <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1, fontSize: 11.5, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {weekdayDate(g.date)}
                            {dotColor && <span style={{ width: 7, height: 7, borderRadius: 99, background: dotColor, display: 'inline-block', flexShrink: 0 }} />}
                          </span>
                          {/* The signpost (Eli, 2026-08-16): the whole card
                              opens the sheet, but nothing SAID so. Not a
                              separate handler — it rides the card's tap. */}
                          {!readOnly && (
                            <span style={{ flexShrink: 0, fontSize: 9, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'var(--c-wash2)', color: 'var(--c-fg-2)', borderRadius: 99, padding: '4px 11px' }}>
                              {cardLocked ? '👁 View' : '✎ Edit'}
                            </span>
                          )}
                        </div>
                        {/* Not .c-tnum — that class is text-align: right (it's
                            for money columns) and it shoved the times to the
                            card's right edge. */}
                        <div style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 12, fontWeight: 500, color: 'var(--c-fg)', marginBottom: 2 }}>
                          {first?.from_time || '—'} – {first?.to_time || <span style={{ color: 'var(--c-fg-3)' }}>tap to set</span>}
                          {first?.total_hours != null && <span style={{ color: 'var(--c-fg-2)' }}> · {first.total_hours}h</span>}
                          {otHrsTotal > 0 && <span style={{ color: 'var(--c-st-warm)' }}> · OT {otHrsTotal}h</span>}
                        </div>
                        {staffRows.map(r => (
                          <div key={r.id + '-staff'} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-2)', marginBottom: 3 }}>
                            <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'var(--c-wash2)', color: r.eng_role === 'assistant' ? 'var(--c-st-warm)' : 'var(--c-fg)' }}>
                              {r.eng_role === 'assistant' ? '2ND' : '1ST'}
                            </span>
                            {r.eng_name || <span style={{ color: 'var(--c-fg-3)' }}>TBD</span>}
                          </div>
                        ))}
                        <div style={{ margin: '7px 0' }}>{renderEquipPills(g.date, cardLocked)}</div>
                        {renderEquipNoteBlock(g.date)}
                        <div style={{ fontSize: 11, fontFamily: 'Inter', fontStyle: 'italic', color: song ? 'var(--c-fg-2)' : 'var(--c-fg-3)', margin: '2px 0 8px' }}>
                          {song || 'Song title —'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--c-wash2)', borderRadius: 8, padding: '5px 9px' }}>
                          <span style={{ fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }}>
                            {runner ? 'Day total · set by the office' : 'Day total'}
                          </span>
                          <span className="c-tnum" style={{ fontSize: 12, fontWeight: 700, color: dayTotal > 0 ? 'var(--c-fg)' : 'var(--c-fg-3)' }}>
                            {dayTotal > 0 ? `$${dayTotal.toFixed(2)}` : '—'}
                          </span>
                        </div>
                        {cardLocked && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)', marginTop: 6 }}>
                            🔒 Approved by the office — locked
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
              {wide && <ScrollHints targetRef={stBinRef} unit="day" />}
              </div>
              )}
              {/* ── PINNED STUDIO RUNNING TOTAL (mock ruling 2026-08-18) ──────
                  "Not a whimpy one-liner." This was a small chip reading
                  "Studio: $x / Eng: $y / Total: $z" tucked beside the add-row
                  links. It is now the itemized panel the mock asks for: Studio,
                  then a line per engineer/assistant, then the OT note, then the
                  arch total — sitting directly under the bin in BOTH views and
                  never scrolling with it.
                  Every figure comes from studio_time_rows via lib/woTotals; the
                  staff lines are that same per-row function regrouped by person,
                  so they add up to Eng Total by construction and the card, the
                  table and the PDF cannot disagree. */}
              {wide ? (
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', background: 'var(--c-wash)', borderRadius: 12, padding: '7px 12px', marginTop: 6 }}>
                {!readOnly && !runner ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                    <button type="button" onClick={addStRow} className="c-x" style={{ fontSize: 10, color: 'var(--c-fg-2)', background: 'none', boxShadow: 'none', cursor: 'pointer', padding: 0 }}>+ Add Studio Time</button>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <button type="button" onClick={() => addEngRow('engineer')} className="c-x" style={{ fontSize: 10, color: 'var(--c-fg)', opacity: 0.4, background: 'none', boxShadow: 'none', cursor: 'pointer', padding: 0 }}>+ Add Engineer</button>
                      <button type="button" onClick={() => addEngRow('assistant')} className="c-x" style={{ fontSize: 10, color: 'var(--c-st-warm)', background: 'none', boxShadow: 'none', cursor: 'pointer', padding: 0 }}>+ Add Assistant</button>
                    </div>
                  </div>
                ) : <div />}
                <div style={{ marginLeft: 'auto', textAlign: 'right', minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 11.5, padding: '1px 0' }}>
                    <span style={{ color: 'var(--c-fg-2)' }}>Studio</span>
                    <span className="c-tnum" style={{ color: 'var(--c-fg)' }}>${stTotal.toFixed(2)}</span>
                  </div>
                  {staffLines.map(s => (
                    <div key={`${s.role}|${s.name}`} style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 11.5, padding: '1px 0' }}>
                      <span style={{ color: 'var(--c-fg-2)' }}>
                        <b style={{ color: s.role === 'assistant' ? 'var(--c-st-warm)' : 'var(--c-fg)', fontSize: 9, letterSpacing: '0.04em' }}>{s.role === 'assistant' ? '2ND' : '1ST'}</b>
                        {' · '}{s.name}
                      </span>
                      <span className="c-tnum" style={{ color: 'var(--c-fg)' }}>${s.total.toFixed(2)}</span>
                    </div>
                  ))}
                  {otHoursAll > 0 && (
                    <div style={{ fontSize: 11, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-st-warm)', marginTop: 2 }}>
                      OT {otHoursAll}h{otChargeAll > 0 ? ` · $${otChargeAll.toFixed(2)}` : ''} included
                    </div>
                  )}
                  <div style={{ ...kLabel, marginTop: 5 }}>
                    Studio total{dayCount > 0 ? ` · ${dayCount} day${dayCount === 1 ? '' : 's'}` : ''}
                  </div>
                  <div className="c-arch" style={{ fontSize: 20, letterSpacing: '-0.02em', color: (stTotal + engTotal) > 0 ? 'var(--c-fg)' : 'var(--c-fg-3)' }}>
                    ${(stTotal + engTotal).toFixed(2)}
                  </div>
                </div>
              </div>
              ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: stView === 'cards' ? '5px 4px 0' : '9px 4px 0' }}>
                {!readOnly && !runner && stView !== 'cards' ? (
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <button type="button" onClick={addStRow} className="c-x" style={{ fontSize: 10, color: 'var(--c-fg-2)', background: 'none', boxShadow: 'none', cursor: 'pointer', padding: 0 }}>+ Add Studio Time</button>
                  <button type="button" onClick={() => addEngRow('engineer')} className="c-x" style={{ fontSize: 10, color: 'var(--c-fg)', opacity: 0.4, background: 'none', boxShadow: 'none', cursor: 'pointer', padding: 0 }}>+ Add Engineer</button>
                  <button type="button" onClick={() => addEngRow('assistant')} className="c-x" style={{ fontSize: 10, color: 'var(--c-st-warm)', background: 'none', boxShadow: 'none', cursor: 'pointer', padding: 0 }}>+ Add Assistant</button>
                </div>
                ) : <div />}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, background: 'var(--c-wash2)', borderRadius: 14, padding: '6px 12px' }}>
                  <span className="c-tnum" style={{ color: 'var(--c-fg)' }}>Studio: ${stTotal.toFixed(2)}</span>
                  {engTotal > 0 && (
                    <span className="c-tnum" style={{ color: 'var(--c-fg)' }}>Eng: ${engTotal.toFixed(2)}</span>
                  )}
                  {engTotal > 0 && (
                    <span className="c-tnum" style={{ color: 'var(--c-fg)', fontWeight: 700 }}>Total: ${(stTotal + engTotal).toFixed(2)}</span>
                  )}
                </div>
              </div>
              )}
          </div>

          {/* EQUIPMENT CONDITION MOVED INTO THE STUDIO DAY (RULING 2026-08-13,
              spec §18). It was a separate table here with equipment down the
              side and ONE COLUMN PER SESSION DATE across the top, scrolling
              sideways — and the DATE was the only thing joining it to the studio
              time above, which made that join invisible. On a 30-day work order
              it was a 30-column horizontal scroll.

              It now renders as a third line inside each day block. Only the
              hidden file input for note photos stays here: it is shared by every
              day and must exist exactly once. */}
          <input data-no-print="" ref={equipNoteFileRef} type="file" accept="image/*" style={{ order: ORD.equipFile, display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadEquipNotePhoto(f) }} />

          {/* RENTALS — the SECOND independent bin (mock ruling). It scrolls on
              its own, so a 30-day session with two rentals wastes no height and
              a two-day session with twenty rentals is not squeezed by the days
              above it. Its own fade + "↓ N more" pill, on the same rule: shown
              only while rows remain below. */}
          <div style={isMobile ? { order: ORD.rentals, ...mCard } : { order: ORD.rentals, minWidth: 0 }}>
            <SectionHeader carved title="Rentals" />
            <div style={{ overflowX: isMobile ? 'auto' : 'hidden', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', position: 'relative' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 120px 110px 65px 80px 24px', paddingBottom: 5, minWidth: isMobile ? 540 : undefined }}>
                {([['Qty'], ['Item'], ['Supplier'], ["Date(s) Used"], ['Rate', 'right'], ['Charge', 'right'], ['']] as [string, string?][])
                  .map(([h, align], i) => <div key={i} style={align === 'right' ? thR : thS}>{h}</div>)}
              </div>
              {/* BIN 2. Capped and scrolling on its own on admin desktop; on
                  mobile the rows just run on as they always have. */}
              <div ref={rentBinRef} style={wide ? { maxHeight: 150, overflowY: 'auto', paddingRight: 4 } : undefined}>
              {rentRows.map((r, idx) => (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 120px 110px 65px 80px 24px', background: 'var(--c-wash)', borderRadius: 12, marginBottom: 6, minWidth: isMobile ? 540 : undefined }}>
                  <div style={cellIn}><input value={r.qty} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, qty: e.target.value } : x))} placeholder="—" className="c-tin c-tin-mono c-tin-show" /></div>
                  <div style={cellIn}><input value={r.item} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, item: e.target.value } : x))} placeholder="Item" className="c-tin c-tin-show" /></div>
                  <div style={cellIn}><input value={r.supplier} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, supplier: e.target.value } : x))} placeholder="Supplier" className="c-tin c-tin-show" /></div>
                  <div style={cellIn}><input value={r.dates_used} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, dates_used: e.target.value } : x))} placeholder="Dates" className="c-tin c-tin-show" /></div>
                  <div style={cellIn}><input value={r.rate} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, rate: e.target.value } : x))} placeholder="—" className="c-tin c-tin-mono c-tin-show" style={{ textAlign: 'right' }} /></div>
                  <div style={cellIn}><input value={r.charge} onChange={e => setRentRows(p => p.map(x => x.id === r.id ? { ...x, charge: e.target.value } : x))} placeholder="$0.00" className="c-tin c-tin-mono c-tin-show" style={{ textAlign: 'right' }} /></div>
                  <div style={{ ...cellS, paddingTop: 6, paddingBottom: 6, justifyContent: 'center' }}>
                    {!readOnly && <button type="button" onClick={() => setRentRows(p => p.filter(x => x.id !== r.id))} style={{ background: 'none', color: 'var(--c-fg-3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>}
                  </div>
                </div>
              ))}
              </div>
              {wide && <ScrollHints targetRef={rentBinRef} unit="rental" />}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 4px 0', minWidth: isMobile ? 540 : undefined }}>
                {!readOnly ? <button type="button" onClick={() => setRentRows(p => [...p, { id: crypto.randomUUID(), qty: '', item: '', supplier: '', dates_used: '', rate: '', charge: '' }])} style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', background: 'none', cursor: 'pointer', padding: 0 }}>+ Add row</button> : <span />}
                <span className="c-tnum" style={{ color: 'var(--c-fg)', fontWeight: 700, background: 'var(--c-wash2)', borderRadius: 99, padding: '5px 12px' }}>Total: ${rentTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Desktop spacer between rentals and the money block. In the two-column
              layout the column's own gap does that job, so it collapses. */}
          <div style={{ order: ORD.spacer, display: (isMobile || wide) ? 'none' : 'block' }} />

          {/* PAYMENTS + TOTALS — the foot of the NUMBERS column, PINNED.
              The old "BOTTOM TWO COLUMNS" grid is gone. Its left half (Session
              Notes + the COD legal/signature block) is words, not numbers, and
              has moved into the words column; payments and totals belong here,
              below the rentals bin, where they never scroll away — the two bins
              above scroll, this does not. On mobile nothing moves: both halves
              are still plain stacked cards in the same order (see ORD). */}
          <div style={{ order: ORD.payments, display: 'flex', flexDirection: 'column', gap: 16, ...(isMobile ? mCard : {}) }}>
              <div>
                <SectionHeader carved title="Payments" />
                <div>
                  {payRows.map((p, idx) => {
                    const needsLast4 = p.payment_type === 'Credit Card' || p.payment_type === 'Debit Card'
                    return (
                      <div key={p.id} style={{ display: 'grid', gridTemplateColumns: needsLast4 ? '130px 80px 1fr 70px 24px' : '130px 80px 1fr 24px', alignItems: 'center', background: 'var(--c-wash)', borderRadius: 12, marginBottom: 6 }}>
                        <div style={cellS}>
                          <select value={p.payment_type} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? withCardFee({ ...x, payment_type: e.target.value, last_four: '' }) : x))} className="c-tin c-tin-show" style={{ cursor: 'pointer' }}>
                            <option value="">— type —</option>
                            {['Cash', 'Zelle', 'Credit Card', 'Debit Card', 'Check', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div style={cellIn}><input value={p.amount} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, amount: e.target.value } : x))} onBlur={e => setPayRows(prev => prev.map(x => x.id === p.id ? withCardFee({ ...x, amount: formatCurrency(e.target.value) }) : x))} placeholder="0.00" className="c-tin c-tin-mono c-tin-show" /></div>
                        <div style={cellIn}><input value={p.memo} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, memo: e.target.value } : x))} placeholder="memo" className="c-tin c-tin-show" /></div>
                        {needsLast4 && (
                          <div style={cellIn}><input value={p.last_four} onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, last_four: e.target.value.replace(/\D/g, '').slice(0, 4) } : x))} placeholder="last 4" maxLength={4} className="c-tin c-tin-mono c-tin-show" /></div>
                        )}
                        <div style={{ ...cellS, paddingTop: 6, paddingBottom: 6, justifyContent: 'center' }}>
                          {!readOnly && <button type="button" onClick={() => setPayRows(p2 => p2.filter(x => x.id !== p.id))} style={{ background: 'none', color: 'var(--c-fg-3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>}
                        </div>
                        {/* 3% card fee chip — full-width sub-line under the row.
                            Shows the fee slice of the charged amount; the ×
                            waives it (whole amount then credits the balance). */}
                        {p.fee_amount && (
                          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 7px' }}>
                            <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)' }}>
                              includes {p.fee_amount} card fee (3%)
                            </span>
                            {!readOnly && (
                              <button type="button" title="Waive the card fee on this payment" onClick={() => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, fee_amount: '' } : x))} style={{ background: 'none', color: 'var(--c-fg-3)', cursor: 'pointer', fontSize: 10, fontFamily: 'Inter', padding: 0, textDecoration: 'underline' }}>waive</button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  <div style={{ padding: '9px 4px 0' }}>
                    {!readOnly && <button type="button" onClick={() => setPayRows(p => [...p, { id: crypto.randomUUID(), payment_type: '', amount: '', memo: '', last_four: '', fee_amount: '' }])} style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', background: 'none', cursor: 'pointer', padding: 0 }}>+ Add payment</button>}
                  </div>
                </div>
              </div>
              {/* Totals block */}
              <div style={{ borderRadius: 12, overflow: 'hidden', background: 'var(--c-wash)', padding: '0 6px 6px' }}>
                {[
                  { label: 'Studio Total', value: stTotal, color: 'var(--c-fg)', bold: false },
                  ...(engTotal > 0 ? [{ label: 'Eng Total', value: engTotal, color: 'var(--c-fg)', bold: false }] : []),
                  { label: 'Rentals Total', value: rentTotal, color: 'var(--c-fg)', bold: false },
                  // 3% surcharge on Credit/Debit payments (COD only) — a real
                  // charge, so it joins Grand Total.
                  ...(cardFeesTotal > 0 ? [{ label: 'Card Fees (3%)', value: cardFeesTotal, color: 'var(--c-fg)', bold: false }] : []),
                  { label: 'Grand Total', value: grandTotal, color: 'var(--c-fg)', bold: true },
                  { label: 'Total Paid', value: totalPaid, color: 'var(--c-st-booked)', bold: false },
                  // Hot balance is COD-only (Eli 2026-08-24) — red = collect
                  // at the desk. A billing session's open balance shows plain.
                  { label: 'Balance Due', value: balanceDue, color: balanceDue > 0 ? (wo.payment_status === 'COD' ? 'var(--c-st-hot)' : 'var(--c-fg)') : 'var(--c-st-booked)', bold: true },
                  // THE number a runner reads to the card terminal: balance
                  // × 1.03. PRSFlo is the source of truth — no desk math, no
                  // calling a manager. COD with an open balance only.
                  ...(cardTotalDue > 0 ? [{ label: 'If paying by card (incl. 3%)', value: cardTotalDue, color: 'var(--c-st-hot)', bold: false }] : []),
                ].map(({ label, value, color, bold }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px' }}>
                    <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)' }}>{label}</span>
                    <span style={{ fontSize: bold ? 13 : 11, fontFamily: 'Inter', color, fontWeight: bold ? 700 : 400 }}>${value.toFixed(2)}</span>
                  </div>
                ))}
              </div>
          </div>

          {/* COMPLETE WO — mobile secondary action (the footer is Cancel/Save only
              on mobile; the footer Complete button is hidden there). */}
          {/* MOBILE TWIN OF THE FOOTER'S COMPLETE BUTTON. It must behave
              IDENTICALLY to the desktop one (fix, 2026-08-13): it still offered
              "Re-open WO", which v1.9.0 deliberately removed on desktop when the
              billing hub took over the invoice lifecycle. Re-opening was an undo
              for a state nothing reads any more, and here it sat as the single
              full-width button on the phone — the easiest control on the screen
              to hit by accident. Now, once completed, it saves and closes and
              greys out until something actually changes. */}
          {/* COMPLETE WO NEVER APPEARS ON A RUNNER SURFACE (spec §15) —
              completing is the admin act that starts the billing pipeline.
              The runner's terminal act is the Submit footer below. */}
          {isMobile && !readOnly && !runner && (
            <button
              onClick={() => handleComplete()}
              disabled={completing || saving}
              className={`c-control c-block ${isCompleted ? 'c-soft c-raised' : 'c-pill c-fill-booked c-raised-chip'}`}
              style={{ order: ORD.mobileComplete, minHeight: 48, justifyContent: 'center', cursor: (completing || saving) ? 'default' : 'pointer', opacity: (completing || saving) ? 0.4 : 1 }}
              title={isCompleted ? 'Reopen this work order' : undefined}
            >
              {completing ? (isCompleted ? 'Reopening…' : 'Completing…') : isCompleted ? 'Reopen WO' : 'Complete WO'}
            </button>
          )}
          </div>
          )}{/* ══ end NUMBERS column ══ */}

          </div>{/* ══ end two-column layout ══ */}

        </div>{/* end body */}

        {/* ── DAY SHEET · FINAL (Eli rulings 2026-08-16; mock
            docs/design-refs/runner-wo-day-sheet-final.html — layout B).
            · Pair blocks: the studio and each staffer get the SAME shape —
              name + hours chip, then two big time wells (type or ▾ pick).
            · The AGREED window sits under the date; OT is a DESIGNATION —
              derived from the clock as time beyond the agreement, never
              typed by a runner (admin can still override in list view).
              No "pre-approved" language — dropped by ruling.
            · SWIPE left/right (or the ‹ › chevrons) moves between days for
              reference; the only edit lock is admin approval.
            · Billing splits "Agreed" from "Beyond the agreement" and gives
              the staff RATE a home — office types it, runner reads it.
            Rendered OUTSIDE the scrollable body (iOS fixed-in-scroller bug). */}
        {/* WO HISTORY (Eli, 2026-09-01 — options A + C of wo-history-options).
            `current` is built fresh on open so the compare's "Now" side always
            reflects unsaved edits too — you compare against what you see. */}
        {histOpen && resolvedWoId && (
          <WoHistoryModal
            woId={resolvedWoId}
            title={`${wo.wo_number || 'WO'} · ${[wo.label || wo.client, wo.artist].filter(Boolean).join(' — ')}`}
            current={buildWoSnapshot(wo as unknown as Record<string, unknown>, stRows, booking.location)}
            onClose={() => setHistOpen(false)}
          />
        )}

        {daySheetDate !== null && (() => {
          const allDates = Array.from(new Set(stRows.filter(r => r.date).map(r => r.date))).sort()
          const dayIdx = allDates.indexOf(daySheetDate)
          const goDay = (dir: number) => {
            const next = allDates[dayIdx + dir]
            if (next) { setDaySheetDate(next); setOpenNoteKey(null); setTimeDDKey(null) }
          }
          const sheetRows = stRows.filter(r => (r.date || '') === daySheetDate)
          const sheetStudioRows = sheetRows.filter(r => r.studio !== '')
          // Same rule as the card (2026-08-20): the slot exists whether or not
          // anyone is in it, so a day can be staffed from the day sheet.
          const sheetStaffRows = sheetRows.filter(r => r.eng_visible !== false)
          const sheetDot = sheetRows.length > 0 && sheetRows.every(r => r.status === 'approved')
            ? 'var(--c-st-booked)'
            : sheetRows.some(r => r.status === 'submitted') ? 'var(--c-st-warm)' : null
          const dayLocked = runner && sheetRows.length > 0 && sheetRows.every(r => r.admin_locked)
          const isDayRate = sheetStudioRows.some(r => r.row_rate_type === 'day')
          const agreedLabel = isDayRate
            ? '12h lockout'
            : (booking.from_time && booking.to_time) ? `${booking.from_time} – ${booking.to_time}` : null
          const fldK: React.CSSProperties = { fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }
          const hrsChip: React.CSSProperties = { fontFamily: 'DM Mono, ui-monospace, monospace', fontSize: 12, fontWeight: 700, color: 'var(--c-fg-2)', background: 'var(--c-wash2)', borderRadius: 99, padding: '4px 11px', whiteSpace: 'nowrap' }
          const engChargeFor = (r: StRow) => {
            const rate = parseFloat((r.eng_rate ?? '').replace(/[^0-9.]/g, '')) || 0
            const hrs = calcHours(r.eng_from_time || r.from_time, r.eng_to_time || r.to_time)
            return hrs != null && hrs > 0 && rate > 0 ? hrs * rate : 0
          }
          const otHrsDay = sheetRows.reduce((a, r) => a + (parseFloat(r.ot_hours || '0') || 0), 0)
          const otChargeDay = sheetRows.reduce((a, r) => a + (r.ot_charge ?? 0), 0)
          const agreedCharge = sheetRows.reduce((a, r) => a + (r.charge ?? 0), 0) + sheetStaffRows.reduce((a, r) => a + engChargeFor(r), 0)
          const sheetTotal = agreedCharge + otChargeDay
          const closeSheet = () => { setDaySheetDate(null); setOpenNoteKey(null); setTimeDDKey(null) }
          // One big time well: type into it (TimeInput smart-parse) or open the
          // half-hour preset list with the ▾.
          const timeWell = (r: StRow, field: 'from_time' | 'to_time' | 'eng_from_time' | 'eng_to_time' | 'actual_from_time' | 'actual_to_time', label: string, value: string, dashed = false) => {
            const key = `${r.id}|${field}`
            return (
              <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                {/* Dashed = the ACTUAL times (internal record, never money,
                    never on the client PDF) — a different skin so they can
                    never be mistaken for the billed pair above them. */}
                <div style={{ ...(dashed ? { background: 'transparent', border: '1.5px dashed var(--c-wash2)' } : { background: 'var(--c-wash2)' }), borderRadius: 12, padding: '7px 8px 7px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...fldK, fontSize: 8, marginBottom: 1 }}>{label}</div>
                    <TimeInput value={value} onChange={v => updateStRow(r.id, { [field]: v } as Partial<StRow>)} className="c-tin c-tin-mono" style={{ fontSize: 17, fontWeight: 600, padding: 0, minHeight: 30 }} />
                  </div>
                  {/* tabIndex -1 (Eli, 2026-08-20): tabbing from Start landed
                      on this picker before End, so entering times took two
                      tabs per field. It stays fully clickable — it is just out
                      of the keyboard's path, which is what you want for a
                      shortcut that duplicates something you can type. */}
                  <button type="button" tabIndex={-1} onClick={e => { e.stopPropagation(); setTimeDDKey(timeDDKey === key ? null : key) }} style={{ fontSize: 11, color: 'var(--c-fg-3)', background: 'none', cursor: 'pointer', padding: '8px 6px', flexShrink: 0 }}>
                    {timeDDKey === key ? '▴' : '▾'}
                  </button>
                </div>
                {timeDDKey === key && (() => {
                  // Open ON the shown time (nearest half-hour) — starting at
                  // 12:00 AM meant a long scroll and AM-for-PM mistakes
                  // (Eli, 2026-08-16).
                  const curMins = timeToMins(value)
                  let nearest = -1
                  if (curMins != null) {
                    let best = Infinity
                    TIME_OPTS.forEach((t, i) => {
                      const m = timeToMins(t)
                      if (m != null && Math.abs(m - curMins) < best) { best = Math.abs(m - curMins); nearest = i }
                    })
                  }
                  return (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 4 }} onClick={() => setTimeDDKey(null)} />
                    <div
                      ref={el => { if (el && nearest >= 0) { const sel = el.children[nearest] as HTMLElement | undefined; if (sel) el.scrollTop = Math.max(0, sel.offsetTop - 78) } }}
                      style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 5, background: 'var(--c-bg)', borderRadius: 12, boxShadow: '0 8px 26px rgba(0,0,0,0.4)', maxHeight: 200, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
                      {TIME_OPTS.map((t, i) => (
                        <div key={t} onClick={() => { updateStRow(r.id, { [field]: t } as Partial<StRow>); setTimeDDKey(null) }}
                          style={{ padding: '10px 16px', fontFamily: 'DM Mono, ui-monospace, monospace', fontSize: 13, cursor: 'pointer', color: i === nearest ? 'var(--c-fg)' : 'var(--c-fg-2)', fontWeight: i === nearest ? 700 : 400, background: i === nearest ? 'var(--c-wash2)' : 'transparent' }}>
                          {t}
                        </div>
                      ))}
                    </div>
                  </>
                  )
                })()}
              </div>
            )
          }
          return (
            <div
              onClick={closeSheet}
              style={{
                position: 'fixed', inset: 0, zIndex: 10030, background: 'rgba(0,0,0,0.45)',
                // 100dvh on phones (2026-09-03): `inset: 0` measures the LARGE
                // viewport on iOS, so a bottom-anchored sheet inside it ends
                // under the home indicator and its footer reads as cut off.
                // dvh is the viewport as it is right now.
                ...(isMobile ? { height: '100dvh' } : {}),
                // DESKTOP: the sheet is a CENTERED CARD, not a bottom sheet
                // (Eli, 2026-08-17 — the phone sheet rendered full-bleed under
                // the rail on admin desktop and looked broken).
                ...(isMobile ? {} : { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }),
              }}
            >
              <div
                onClick={e => e.stopPropagation()}
                onTouchStart={e => { sheetTouchX.current = e.touches[0].clientX }}
                onTouchEnd={e => {
                  const sx = sheetTouchX.current
                  sheetTouchX.current = null
                  if (sx == null || timeDDKey) return
                  const dx = e.changedTouches[0].clientX - sx
                  if (Math.abs(dx) > 64) goDay(dx < 0 ? 1 : -1)
                }}
                style={isMobile
                  ? { position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--c-bg)', borderRadius: '22px 22px 0 0', padding: '12px 16px calc(22px + env(safe-area-inset-bottom))', maxHeight: '86dvh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }
                  : { width: 'min(620px, 94vw)', maxHeight: '82vh', background: 'var(--c-bg)', borderRadius: 22, padding: '14px 18px 16px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', boxShadow: 'var(--c-softsh)' }}
              >
                {isMobile && <div style={{ width: 36, height: 4, borderRadius: 99, background: 'var(--c-wash2)', margin: '0 auto 10px', flexShrink: 0 }} />}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                  <span className="c-arch" style={{ fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button" disabled={dayIdx <= 0} onClick={() => goDay(-1)} style={{ fontSize: 15, color: 'var(--c-fg-3)', background: 'none', cursor: dayIdx > 0 ? 'pointer' : 'default', opacity: dayIdx > 0 ? 1 : 0.25, padding: '4px 6px' }}>‹</button>
                    {weekdayDate(daySheetDate)}
                    <button type="button" disabled={dayIdx >= allDates.length - 1} onClick={() => goDay(1)} style={{ fontSize: 15, color: 'var(--c-fg-3)', background: 'none', cursor: dayIdx < allDates.length - 1 ? 'pointer' : 'default', opacity: dayIdx < allDates.length - 1 ? 1 : 0.25, padding: '4px 6px' }}>›</button>
                    {/* THE DAY'S DATE IS EDITABLE AGAIN (Eli, 2026-08-20: "we
                        made it so no way to change date on studio time card").
                        The list view has always had a date cell; card view only
                        had ‹ › — which MOVES between days rather than changing
                        one, so a session booked on the wrong day could not be
                        corrected without switching views. Same transparent
                        native-picker overlay the list uses: click the date, get
                        the calendar. Moves EVERY row of this day together
                        (room + its staff), then follows the day so the sheet
                        stays on what you were editing. Approved days are
                        locked, like every other edit here. */}
                    {!readOnly && !runner && !dayLocked && (
                      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                        <span style={{ ...fldK, fontSize: 8, cursor: 'pointer', opacity: 0.5 }}>✎ date</span>
                        <input
                          type="date"
                          value={daySheetDate}
                          onChange={e => {
                            const nd = e.target.value
                            if (!nd || nd === daySheetDate) return
                            stRows
                              .filter(r => (r.date || '') === daySheetDate)
                              .forEach(r => updateStRow(r.id, { date: nd }))
                            setDaySheetDate(nd)
                          }}
                          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                        />
                      </span>
                    )}
                    {sheetDot && <span style={{ width: 7, height: 7, borderRadius: 99, background: sheetDot, display: 'inline-block' }} />}
                  </span>
                  <span style={fldK}>
                    {Array.from(new Set(sheetStudioRows.map(r => toStudioLetter(r.studio)).filter(Boolean))).map(s3 => `Studio ${s3}`).join(' · ')}
                  </span>
                </div>
                <div style={{ fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg-3)', margin: '2px 0 10px', flexShrink: 0 }}>
                  {agreedLabel && <>Agreed with client: <b style={{ color: 'var(--c-fg-2)', fontWeight: 700 }}>{agreedLabel}</b></>}
                  {dayLocked && <span style={{ marginLeft: agreedLabel ? 8 : 0 }}>🔒 Approved by the office — view only</span>}
                  {allDates.length > 1 && <span style={{ float: 'right' }}>{isMobile ? 'swipe' : '‹ ›'} for other days · {dayIdx + 1}/{allDates.length}</span>}
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>

                  {/* Studio pair block */}
                  {sheetStudioRows.map(r => {
                    const rowLocked = runner && r.admin_locked
                    const rowHrs = r.total_hours ?? calcHours(r.from_time, r.to_time)
                    return (
                      <div key={r.id + '-sheet'} style={{ background: 'var(--c-wash)', borderRadius: 14, padding: '11px 12px', marginBottom: 9, pointerEvents: rowLocked ? 'none' : undefined, opacity: rowLocked ? 0.62 : 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          {/* THE ROOM IS EDITABLE HERE TOO (Eli, 2026-09-01: "when
                              we made the cards we did not include the function to
                              change the studio within the card like you can on the
                              line view"). Same select, same options, same write as
                              the list view's Studio cell — venue + room pairs, with
                              the never-a-bare-letter fallback (ruling 2026-08-13) —
                              so the two views cannot disagree about what changing a
                              room means. Same precedent as the ✎ date fix above:
                              the card's editing surface is the day sheet. */}
                          {readOnly ? (
                            <span className="c-arch" style={{ fontSize: 13 }}>{toStudioLetter(r.studio) ? `STUDIO ${toStudioLetter(r.studio)}` : 'STUDIO'}</span>
                          ) : (
                            <select
                              value={`${r.location || booking.location || ''}|${toStudioLetter(r.studio)}`}
                              onChange={e => {
                                const [loc, room] = e.target.value.split('|')
                                updateStRow(r.id, { location: loc === (booking.location || '') ? '' : loc, studio: room })
                              }}
                              className="c-tin c-arch"
                              style={{ fontSize: 13, padding: '2px 4px', width: 'auto', cursor: 'pointer' }}
                            >
                              {!STUDIO_LOCATIONS.some(l => l.name === (r.location || booking.location)) && (
                                <option value={`${r.location || booking.location || ''}|${toStudioLetter(r.studio)}`}>{roomCode(toStudioLetter(r.studio), r.location || booking.location) || toStudioLetter(r.studio) || '—'}</option>
                              )}
                              {STUDIO_LOCATIONS.map(l => l.rooms.map(room => {
                                const letter = toStudioLetter(room)
                                return <option key={`${l.name}|${letter}`} value={`${l.name}|${letter}`}>{STUDIO_SHORT[l.name] ?? l.name} {letter}</option>
                              }))}
                            </select>
                          )}
                          <span style={hrsChip}>{rowHrs != null ? `${rowHrs}h` : '—'}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {timeWell(r, 'from_time', 'Start', r.from_time)}
                          {timeWell(r, 'to_time', 'End', r.to_time)}
                        </div>
                        {/* ACTUAL vs BILLED (Eli, 2026-09-01): when the client
                            really arrived and left. Typed, same smart-parse +
                            preset wells as everything else, DASHED so they can
                            never read as the billed pair. INTERNAL ONLY — no
                            money math reads these, they never print on the
                            client work order, and the line below restates the
                            law where the runner is standing. */}
                        <div className="c-label" style={{ margin: '9px 0 5px', fontSize: 8, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          Client actually here
                          <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, opacity: 0.7 }}>· billed stays as booked</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {timeWell(r, 'actual_from_time', 'Arrived', r.actual_from_time, true)}
                          {timeWell(r, 'actual_to_time', 'Left', r.actual_to_time, true)}
                        </div>
                        {/* THE ROOM'S RATE, BESIDE THE ROOM'S TIMES (Eli,
                            2026-08-20: "still not a good place for the rate to
                            be entered"). It lived only in the Billing block at
                            the very bottom of this sheet, under equipment —
                            nobody building a session ever scrolled to it. A
                            rate belongs with the thing it prices. The Billing
                            block keeps the OT rate and the computed summary;
                            these are the same fields, bound to the same row,
                            so editing either place is identical. Office only —
                            runners see rates as read-only text down below. */}
                        {!runner && !readOnly && (
                          /* A RATE WELL, SHAPED LIKE THE TIME WELLS beside it
                             (Eli, 2026-08-20: "the rates for eng or room are so
                             tiny and in very large boxes"). Same well, same 8px
                             caps label, same 17px value — a number that decides
                             the invoice should not read smaller than the times
                             above it. Sized to its content rather than
                             stretched: three or four digits never need half the
                             sheet. */
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                            <div className="c-seg c-seg-tiny" style={{ flexShrink: 0 }}>
                              <button type="button" className={r.row_rate_type !== 'day' ? 'c-on' : ''}
                                onClick={() => r.row_rate_type === 'day' && toggleRowRateType(r.id)}
                                style={{ cursor: 'pointer' }}>/ HR</button>
                              <button type="button" className={r.row_rate_type === 'day' ? 'c-on' : ''}
                                onClick={() => r.row_rate_type !== 'day' && toggleRowRateType(r.id)}
                                style={{ cursor: 'pointer' }}>/ DAY</button>
                            </div>
                            <div style={{ background: 'var(--c-wash2)', borderRadius: 12, padding: '7px 14px', width: 150, flexShrink: 0 }}>
                              <div style={{ ...fldK, fontSize: 8, marginBottom: 1 }}>
                                {r.row_rate_type === 'day' ? 'Room rate / day' : 'Room rate / hr'}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                                <span style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 17, fontWeight: 600, opacity: 0.45 }}>$</span>
                                {r.row_rate_type === 'day'
                                  ? <input value={r.rate_daily} onChange={e => updateStRow(r.id, { rate_daily: e.target.value })} placeholder="0" className="c-tin c-tin-mono" style={{ fontSize: 17, fontWeight: 600, padding: 0, minHeight: 30, width: '100%' }} />
                                  : <input value={r.rate} onChange={e => updateStRow(r.id, { rate: e.target.value })} placeholder="0" className="c-tin c-tin-mono" style={{ fontSize: 17, fontWeight: 600, padding: 0, minHeight: 30, width: '100%' }} />}
                              </div>
                            </div>
                          </div>
                        )}
                        {/* AM/PM tripwire (Eli, 2026-08-16): a wrong meridiem
                            reads as a 14h+ day. Sessions genuinely run that
                            long sometimes, so this WARNS and never blocks. */}
                        {rowHrs != null && rowHrs > 14 && (
                          <div style={{ fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-st-hot)', marginTop: 7 }}>
                            ⚠ That&apos;s {rowHrs}h in the room — long sessions happen, but double-check AM/PM on the times.
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Staff pair blocks — SAME shape, times aligned under the
                      studio's, auto-following them until edited. */}
                  {sheetStaffRows.map(r => {
                    const rowLocked = runner && r.admin_locked
                    const staffHrs = calcHours(staffTimes(r).from, staffTimes(r).to)
                    return (
                      <div key={r.id + '-sheetstaff'} style={{ background: 'var(--c-wash)', borderRadius: 14, padding: '11px 12px', marginBottom: 9, pointerEvents: rowLocked ? 'none' : undefined, opacity: rowLocked ? 0.62 : 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 }}>
                            <button
                              type="button"
                              onClick={() => updateStRow(r.id, { eng_role: r.eng_role === 'assistant' ? 'engineer' : 'assistant' })}
                              style={{ flexShrink: 0, fontSize: 9, fontFamily: 'Inter', fontWeight: 800, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', background: 'var(--c-wash2)', color: r.eng_role === 'assistant' ? 'var(--c-st-warm)' : 'var(--c-fg)' }}
                            >
                              {r.eng_role === 'assistant' ? '2ND' : '1ST'}
                            </button>
                            <input list="wo-eng-roster" value={r.eng_name || ''} onChange={e => updateStRow(r.id, { eng_name: e.target.value })} placeholder={r.eng_role === 'assistant' ? 'Assistant name…' : 'Engineer name…'} className="c-tin" style={{ fontWeight: 700, fontSize: 13, minHeight: 30 }} />
                          </span>
                          <span style={hrsChip}>{staffHrs != null ? `${staffHrs}h` : '—'}</span>
                          {/* REMOVE A STAFF BLOCK (Eli, 2026-08-20: staff hit
                              "+ Add engineer" to see what it did and there was
                              no way back). A standalone extra staffer is
                              deleted outright; the room row's OWN slot can't be
                              deleted — it IS the day — so its × hides it
                              (eng_visible false, the sanctioned "runs
                              unstaffed" state) and clears whatever was typed.
                              Office only, and never on an approved day. */}
                          {!readOnly && !runner && !dayLocked && (
                            <button
                              type="button"
                              className="c-x"
                              aria-label="Remove this staff line"
                              title={r.studio === '' ? 'Remove this staff line' : 'No staff on this day'}
                              onClick={() => { r.studio === '' ? deleteStRow(r.id) : clearEngRow(r.id) }}
                              style={{ fontSize: 14, boxShadow: 'none', flexShrink: 0 }}
                            >×</button>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {timeWell(r, 'eng_from_time', 'Start', staffTimes(r).from)}
                          {timeWell(r, 'eng_to_time', 'End', staffTimes(r).to)}
                        </div>
                        {/* Their rate, on their own block — same reasoning as
                            the room rate above. Warm tint when a NAMED engineer
                            has no rate: that is the likeliest way a session
                            quietly under-bills. Assistants are excluded (often
                            unpaid seconds), matching the table and the banner. */}
                        {!runner && !readOnly && (
                          /* Their rate, in the same well shape as the times
                             above it (2026-08-20) — see the room rate for why. */
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                            <div
                              style={{
                                borderRadius: 12, padding: '7px 14px', width: 150, flexShrink: 0,
                                background: r.eng_role !== 'assistant' && (r.eng_name || '').trim() && !r.eng_rate
                                  ? 'color-mix(in srgb, var(--c-st-warm) 20%, transparent)'
                                  : 'var(--c-wash2)',
                              }}
                            >
                              <div style={{ ...fldK, fontSize: 8, marginBottom: 1 }}>
                                {r.eng_role === 'assistant' ? '2ND rate / hr' : '1ST rate / hr'}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                                <span style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 17, fontWeight: 600, opacity: 0.45 }}>$</span>
                                <input
                                  value={r.eng_rate || ''}
                                  onChange={e => updateStRow(r.id, { eng_rate: e.target.value })}
                                  placeholder="0"
                                  className="c-tin c-tin-mono"
                                  style={{ fontSize: 17, fontWeight: 600, padding: 0, minHeight: 30, width: '100%' }}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                        {staffHrs != null && staffHrs > 14 && (
                          <div style={{ fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-st-hot)', marginTop: 7 }}>
                            ⚠ That&apos;s {staffHrs}h — double-check AM/PM on the times.
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {sheetStaffRows.length > 0 && !dayLocked && (
                    <div style={{ fontSize: 9.5, fontFamily: 'Inter', color: 'var(--c-fg-3)', margin: '-3px 0 10px 2px' }}>
                      Staff times follow the studio times until you change them.
                    </div>
                  )}
                  {/* ASSIGN STAFF FROM INSIDE THE DAY (2026-08-20). Without
                      these, a day with no seeded staff row had no staff UI at
                      all — you had to close the sheet and use the add links
                      under the bin, which nobody finds while building a
                      session. Office-only and hidden on a locked day, matching
                      every other edit affordance here. */}
                  {!readOnly && !runner && !dayLocked && (
                    <div style={{ display: 'flex', gap: 14, margin: '2px 0 12px 2px' }}>
                      <button
                        type="button"
                        className="c-x"
                        onClick={() => addEngRowForDate('engineer', daySheetDate)}
                        style={{ fontSize: 11, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-fg)', opacity: 0.55, background: 'none', boxShadow: 'none', padding: 0, cursor: 'pointer' }}
                      >+ Add engineer</button>
                      <button
                        type="button"
                        className="c-x"
                        onClick={() => addEngRowForDate('assistant', daySheetDate)}
                        style={{ fontSize: 11, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-st-warm)', opacity: 1, background: 'none', boxShadow: 'none', padding: 0, cursor: 'pointer' }}
                      >+ Add assistant</button>
                    </div>
                  )}

                  {/* Overtime — a designation, derived from the clock. */}
                  <div style={{ background: 'var(--c-wash)', borderRadius: 12, padding: '10px 14px', marginBottom: 10 }}>
                    <div style={{ ...fldK, marginBottom: 4 }}>Overtime</div>
                    {otHrsDay > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12, fontFamily: 'Inter', color: 'var(--c-fg-2)' }}>
                        <span>
                          Ran <b style={{ color: 'var(--c-fg)' }}>{otHrsDay}h</b> past the agreed {isDayRate ? '12h' : 'end'}
                          {sheetStudioRows[0]?.ot_rate ? ` × ${sheetStudioRows[0].ot_rate}` : ''}
                        </span>
                        <span style={{ fontFamily: 'DM Mono, ui-monospace, monospace', fontWeight: 700, color: 'var(--c-fg)' }}>
                          {otChargeDay > 0 ? `$${otChargeDay.toFixed(2)}` : '—'}
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, fontFamily: 'Inter', color: 'var(--c-fg-3)' }}>
                        None — within the agreed time. Runs past it and this fills in by itself.
                      </div>
                    )}
                  </div>

                  {/* Song title / session info */}
                  {sheetStudioRows.map(r => {
                    const rowLocked = runner && r.admin_locked
                    return (
                      <div key={r.id + '-sheetsong'} style={{ background: 'var(--c-wash)', borderRadius: 12, padding: '10px 14px', marginBottom: 10, pointerEvents: rowLocked ? 'none' : undefined, opacity: rowLocked ? 0.62 : 1 }}>
                        <div style={{ ...fldK, marginBottom: 3 }}>Song title / session info{sheetStudioRows.length > 1 ? ` · Studio ${toStudioLetter(r.studio)}` : ''}</div>
                        <textarea
                          value={r.session_info}
                          onChange={e => updateStRow(r.id, { session_info: e.target.value })}
                          rows={2}
                          placeholder="What was worked on…"
                          style={{ width: '100%', background: 'transparent', outline: 'none', resize: 'vertical', color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 13, lineHeight: 1.5, boxSizing: 'border-box' }}
                        />
                      </div>
                    )
                  })}

                  <div style={{ ...fldK, marginBottom: 6 }}>Equipment</div>
                  <div style={{ marginBottom: 4 }}>{renderEquipPills(daySheetDate, dayLocked)}</div>
                  {renderEquipNoteBlock(daySheetDate)}

                  {/* Billing — agreed vs beyond, the designation itself.
                      Rate wells (room / OT / staff) are office inputs. */}
                  <div style={{ background: 'var(--c-wash)', borderRadius: 12, padding: '10px 14px', margin: '10px 0 4px' }}>
                    <div style={{ ...fldK, marginBottom: 4 }}>{runner ? 'Billing · set by the office' : 'Billing'}</div>
                    {sheetStudioRows.map(r => {
                      const isDayRow = r.row_rate_type === 'day'
                      return (
                        <div key={r.id + '-bill'} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, fontFamily: 'Inter', color: 'var(--c-fg-2)', padding: '2px 0', gap: 8 }}>
                          {runner ? (
                            <span>Room {isDayRow ? `lockout — 12h incl. (${r.rate_daily || '—'})` : `${r.total_hours ?? calcHours(r.from_time, r.to_time) ?? '—'}h × ${r.rate || '—'}/hr`}</span>
                          ) : (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              Room
                              {isDayRow
                                ? <input value={r.rate_daily} onChange={e => updateStRow(r.id, { rate_daily: e.target.value })} placeholder="$0/day" className="c-tin c-tin-mono" style={{ width: 80 }} />
                                : <input value={r.rate} onChange={e => updateStRow(r.id, { rate: e.target.value })} placeholder="$0/hr" className="c-tin c-tin-mono" style={{ width: 80 }} />}
                              OT rate
                              <input value={r.ot_rate ?? ''} onChange={e => updateStRow(r.id, { ot_rate: e.target.value })} placeholder="$0" className="c-tin c-tin-mono" style={{ width: 64 }} />
                            </span>
                          )}
                          <span className="c-tnum">{(r.charge ?? 0) > 0 ? `$${(r.charge ?? 0).toFixed(2)}` : '—'}</span>
                        </div>
                      )
                    })}
                    {sheetStaffRows.map(r => {
                      const staffHrs = calcHours(staffTimes(r).from, staffTimes(r).to)
                      return (
                        <div key={r.id + '-billeng'} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, fontFamily: 'Inter', color: 'var(--c-fg-2)', padding: '2px 0', gap: 8 }}>
                          {runner ? (
                            <span>{r.eng_role === 'assistant' ? '2ND' : '1ST'} {r.eng_name || 'TBD'} {staffHrs != null ? `${staffHrs}h` : ''}{r.eng_rate ? ` × ${r.eng_rate}/hr` : ''}</span>
                          ) : (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {r.eng_role === 'assistant' ? '2ND' : '1ST'} {r.eng_name || 'TBD'} · rate
                              <input
                                value={r.eng_rate || ''}
                                onChange={e => updateStRow(r.id, { eng_rate: e.target.value })}
                                placeholder="$0/hr"
                                className="c-tin c-tin-mono"
                                style={{
                                  width: 64,
                                  // Same warm nudge as the table (Eli, 2026-08-18):
                                  // a named ENGINEER with no rate bills $0.
                                  ...(r.eng_role !== 'assistant' && (r.eng_name || '').trim() && !r.eng_rate
                                    ? { background: 'color-mix(in srgb, var(--c-st-warm) 20%, transparent)', borderRadius: 5 }
                                    : {}),
                                }}
                              />
                            </span>
                          )}
                          <span className="c-tnum">{engChargeFor(r) > 0 ? `$${engChargeFor(r).toFixed(2)}` : '—'}</span>
                        </div>
                      )
                    })}
                    {/* OT: its own line, only when it exists (Eli, 2026-08-16 —
                        plain itemized list, no agreement sub-headings). */}
                    {otHrsDay > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontFamily: 'Inter', color: 'var(--c-fg-2)', padding: '2px 0' }}>
                        <span>{`OT ${otHrsDay}h${sheetStudioRows[0]?.ot_rate ? ` × ${sheetStudioRows[0].ot_rate}/hr` : ''}`}</span>
                        <span className="c-tnum">{`$${otChargeDay.toFixed(2)}`}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-fg)', paddingTop: 5 }}>
                      <span>Day total</span>
                      <span className="c-tnum">{sheetTotal > 0 ? `$${sheetTotal.toFixed(2)}` : '—'}</span>
                    </div>
                  </div>
                </div>

                {/* SAVE / CANCEL (Eli, 2026-08-18) — was a lone "Done", which
                    gave sheet edits no way back. Cancel reverts THIS day's
                    rows to the open-time snapshot; Save keeps them (the real
                    persist stays with the top-bar Save / runner Submit). */}
                <div style={{ display: 'flex', gap: 9, marginTop: 10, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const snap = sheetSnapRef.current
                      if (snap.length) {
                        setStRows(prev => prev.map(r => {
                          const s = snap.find(x => x.id === r.id)
                          return s ? { ...s } : r
                        }))
                      }
                      closeSheet()
                    }}
                    style={{ flex: 1, minHeight: 46, borderRadius: 12, background: 'var(--c-wash2)', color: 'var(--c-fg)', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: 'none' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={closeSheet}
                    style={{ flex: 2, minHeight: 46, borderRadius: 12, background: 'var(--c-fg)', color: 'var(--c-bg)', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 12, cursor: 'pointer', border: 'none' }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* ── RUNNER SUBMIT FOOTER ──────────────────────────────────────────
            Fixed at the thumb, like every runner surface. Submit = the same
            atomic save as Save, plus today's rows → 'submitted'. Submitted is
            not a seal: the runner reopens and edits freely until the office
            approves a day, so after the first submit this reads "Update
            submission" — same act, no penalty, exactly the rule a runner
            learns in one sentence: you can always fix your day until the
            office approves it. */}
        {runner && !isBlock && (() => {
          // opsToday — the footer must agree with handleRunnerSubmit about
          // what "today" means, or at 12:01 AM the button reads "Submit
          // today" while the submit finds nothing to mark.
          const today = opsToday()
          const todayRows = stRows.filter(r => r.date === today)
          const alreadySubmitted = todayRows.length > 0 && todayRows.every(r => r.status === 'submitted' || r.status === 'approved')
          return (
            <div style={{ flexShrink: 0, padding: '10px 16px calc(14px + env(safe-area-inset-bottom))', background: 'var(--c-bg)' }}>
              <button
                onClick={handleRunnerSubmit}
                disabled={submittingRun || saving}
                className="c-control c-pill c-fill-booked c-raised-chip"
                style={{ width: '100%', minHeight: 48, justifyContent: 'center', display: 'flex', alignItems: 'center', cursor: (submittingRun || saving) ? 'default' : 'pointer', opacity: (submittingRun || saving) ? 0.5 : 1, fontSize: 13 }}
              >
                {submittingRun ? 'Submitting…' : alreadySubmitted ? 'Update submission' : 'Submit today'}
              </button>
              <div style={{ textAlign: 'center', fontSize: 9.5, fontFamily: 'Inter', color: 'var(--c-fg-3)', marginTop: 6 }}>
                {todayRows.length > 0
                  ? 'Sends today’s times to the office · nothing is invoiced yet'
                  : 'No rows dated today — this saves your changes'}
              </div>
            </div>
          )
        })()}


      </div>
      </div>
    </div>
  )
}
