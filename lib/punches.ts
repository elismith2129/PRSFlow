// Punch-correction shared helpers — single source for the runner form, the
// personal record, and the admin /punches page, so labels and colour bands
// cannot drift between surfaces (same reason lib/tasks.ts exists).
//
// Tracking model (Eli, 2026-08-14): COUNTS, NOT POINTS. Colour is a plain
// green→red read of how many misses someone has in the trailing window. A true
// "% of shifts punched correctly" needs shift counts from the future
// scheduling build; when that lands, add the denominator here and every
// surface upgrades at once.
import { timeToMins } from '@/lib/time'

export type PunchRequest = {
  id: string
  staff_id: string
  shift_date: string
  punch_type: 'clock_in' | 'clock_out' | 'meal_out' | 'meal_in' | 'other'
  claimed_time: string
  employee_note: string | null
  studio: string | null
  submitted_at: string
  report_class: 'self_same_day' | 'self_late' | 'manager_found'
  status: 'pending' | 'approved' | 'adjusted' | 'rejected' | 'entered_in_adp'
  reviewed_by: string | null
  reviewed_at: string | null
  approved_time: string | null
  reviewer_note: string | null
  adp_comment: string | null
  entered_at: string | null
}

export const PUNCH_TYPES: { value: PunchRequest['punch_type']; label: string }[] = [
  { value: 'clock_in', label: 'Clock in' },
  { value: 'clock_out', label: 'Clock out' },
  { value: 'meal_out', label: 'Meal out' },
  { value: 'meal_in', label: 'Meal in' },
]

export function punchTypeLabel(t: string): string {
  return PUNCH_TYPES.find(p => p.value === t)?.label ?? 'Other'
}

export const REPORT_CLASS_LABEL: Record<PunchRequest['report_class'], string> = {
  self_same_day: 'Same day',
  self_late: 'Late report',
  manager_found: 'Manager found',
}

/** Trailing window every surface measures over. */
export const PUNCH_WINDOW_DAYS = 90

/** Green→red band for a miss count in the window. Status colours only (§5):
 *  0 = clean (booked green) · 1–2 = warm · 3+ = hot. */
export function missBand(count: number): { color: string; label: string } {
  if (count === 0) return { color: 'var(--c-st-booked)', label: 'Clean' }
  if (count <= 2) return { color: 'var(--c-st-warm)', label: `${count} miss${count === 1 ? '' : 'es'}` }
  return { color: 'var(--c-st-hot)', label: `${count} misses` }
}

/** "6:00 PM" / "18:00" → "18:00" for the Postgres `time` column. Null on junk. */
export function to24h(t: string): string | null {
  const mins = timeToMins(t.trim())
  if (Number.isNaN(mins)) return null
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "18:00:00" (Postgres time) → "6:00 PM" for display. */
export function fromDbTime(t: string | null): string {
  if (!t) return ''
  const m = t.match(/^(\d{2}):(\d{2})/)
  if (!m) return t
  let h = parseInt(m[1])
  const suf = h >= 12 ? 'PM' : 'AM'
  if (h > 12) h -= 12
  if (h === 0) h = 12
  return `${h}:${m[2]} ${suf}`
}

/** The ADP comment string PRG-P01 requires (HR-SPEC §5.5). Editable before copy. */
export function composeAdpComment(r: PunchRequest, reviewerInitials: string): string {
  const time = fromDbTime(r.approved_time ?? r.claimed_time)
  const submitted = new Date(r.submitted_at).toLocaleDateString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
  })
  return `Corrected ${punchTypeLabel(r.punch_type).toLowerCase()} ${time} per employee request ${submitted}. — ${reviewerInitials}`
}

/** ISO date PUNCH_WINDOW_DAYS ago — the window floor for queries. */
export function windowFloor(): string {
  const d = new Date()
  d.setDate(d.getDate() - PUNCH_WINDOW_DAYS)
  return d.toISOString().slice(0, 10)
}
