// ─────────────────────────────────────────────────────────────────────────────
// lib/time — THE canonical session time/date math (Phase 1 audit fix).
//
// These functions used to exist as 3–4 hand-mirrored copies across
// WorkOrderPopup, the runner WO page, createWorkOrder, and the calendar —
// billing math that could silently drift. This is now the only home; import
// from here, never re-define locally.
// ─────────────────────────────────────────────────────────────────────────────

// "8:30 PM" / "14:30" → minutes since midnight. Unparseable → NaN (callers must
// guard). The old admin copies returned 0 here, which let a garbage time string
// produce phantom billable hours — the runner copy's stricter NaN behavior is
// the correct one and is now canonical.
export function timeToMins(t: string | null | undefined): number {
  if (!t) return NaN
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!m) return NaN
  let h = parseInt(m[1])
  const min = parseInt(m[2])
  const ap = m[3]?.toUpperCase()
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + min
}

// Session length in hours. Overnight sessions (to < from) wrap to the next day;
// identical from/to or unparseable times return null.
export function calcHours(from: string, to: string): number | null {
  if (!from || !to) return null
  const f = timeToMins(from)
  const t = timeToMins(to)
  if (isNaN(f) || isNaN(t)) return null
  let diff = t - f
  if (diff <= 0) diff += 24 * 60
  if (diff >= 24 * 60) return null
  return parseFloat((diff / 60).toFixed(2))
}

// hours × hourly rate (rate given as a "$1,450"-style string). Null when either
// side is missing/zero.
export function calcCharge(hours: number | null, rate: string): number | null {
  if (!hours || !rate) return null
  const r = parseFloat(rate.replace(/[^0-9.]/g, ''))
  if (isNaN(r) || r === 0) return null
  return parseFloat((hours * r).toFixed(2))
}

// Inclusive ISO date list start..end (noon-anchored to dodge TZ drift).
export function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const s = new Date(start + 'T12:00:00')
  const e = new Date((end || start) + 'T12:00:00')
  const d = new Date(s)
  while (d <= e) {
    dates.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

// True when ISO date `b` is exactly the day after ISO date `a`.
export function isNextDay(a: string, b: string): boolean {
  if (!a || !b) return false
  const da = new Date(a + 'T12:00:00')
  const db = new Date(b + 'T12:00:00')
  return Math.round((db.getTime() - da.getTime()) / 86400000) === 1
}

// "Studio A" → "A", "Studio X" → "X", "North" → "North"
export function toStudioLetter(s: string): string {
  const m = s.match(/Studio\s+([A-Z])/i)
  return m ? m[1].toUpperCase() : s.trim()
}

// Today as a LOCAL calendar date (YYYY-MM-DD), matching how dates are stored.
// Deliberately not `new Date().toISOString().slice(0,10)` — that's UTC, which
// rolls over mid-evening in Los Angeles and silently shows tomorrow's sessions.
//
// Was copy-pasted byte-for-byte into five files (both runner hubs, the runner
// mics page, WorkOrderPopup, MicInventorySection). Consolidated here per the
// July audit rule: never define date math locally.
export function getLocalToday(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

/**
 * The SHIFT LOG's day (Eli, 2026-08-20: "make the notes submit at 8:50a").
 * A night's log runs 8:50 AM → 8:49 AM the next day: entries written before
 * 8:50 AM belong to the PREVIOUS date's log (a 1 AM note is part of the night
 * it happened in, not tomorrow's page), and at 8:50 AM the log seals —
 * edits stop (RLS policy, migration 20260820) and a fresh day's log begins.
 * Implemented by subtracting 8h50m before taking the date. The matching
 * server-side rule lives in the shift_log_entries UPDATE policy — keep the
 * two in step.
 */
export function shiftLogDate(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset() - (8 * 60 + 50))
  return now.toISOString().slice(0, 10)
}

/**
 * THE OPERATIONAL DAY (Eli, 2026-08-28 — ARS test pass). The studio's day
 * rolls at 8:50 AM, not midnight: shifts overlap 12a constantly, so a 2 AM
 * checklist, stock save, mic check-in or WO edit belongs to the NIGHT IN
 * PROGRESS, and the office stock's Wednesday gate holds until Wednesday's
 * closer is done. Every runner surface keys its day on this — never
 * getLocalToday, which is for calendar semantics only (booking dates on
 * admin surfaces). Same boundary as the shift-note seal on purpose; if the
 * roll time ever changes, change shiftLogDate and the shift_note_docs /
 * shift_log_entries policies with it.
 */
export function opsToday(): string {
  return shiftLogDate()
}

// ─── Time-of-day copy (Eli, 2026-08-15) ──────────────────────────────────────
// The studios run 24/7 — a runner clocking in at 7am was being greeted with
// "Where are you tonight?". Any runner-facing copy that names the shift uses
// these helpers so the word tracks the clock and every surface agrees.
// Boundaries: 4am–11:59am morning · noon–4:59pm daytime · 5pm–3:59am night.
export type DayPart = 'morning' | 'day' | 'night'

export function dayPart(d: Date = new Date()): DayPart {
  const h = d.getHours()
  if (h >= 4 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'day'
  return 'night'
}

/** "This morning" / "Today" / "Tonight" — section labels, shift picker. */
export function dayPartLabel(d: Date = new Date()): string {
  const p = dayPart(d)
  return p === 'morning' ? 'This morning' : p === 'day' ? 'Today' : 'Tonight'
}

/** "this morning's" / "today's" / "tonight's" — possessive, mid-sentence. */
export function dayPartPossessive(d: Date = new Date()): string {
  const p = dayPart(d)
  return p === 'morning' ? "this morning's" : p === 'day' ? "today's" : "tonight's"
}
