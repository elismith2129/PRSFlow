// ─────────────────────────────────────────────────────────────────────────────
// CRM pipeline predicates — THE single source (Eli constraint: never
// re-implement CRM predicates, import them). Before this file existed the
// dashboard carried local copies that had already drifted from the CRM page
// (warm fallback 3d vs 8d). Consumers: app/(main)/crm/page.tsx,
// app/(main)/page.tsx, /api/cron/auto-demote, lib/server/floBriefing.ts.
//
// THE MODEL (Eli ruling 2026-09-07): keep_hot_until IS the next-touch date.
// Every contact log / Keep Hot / hot-or-warm create schedules the next touch
// (NEXT_TOUCH_DAYS). A lead with a future date is PARKED, COMING BACK — shown
// in the Coming Up lane, never hidden. Past the date it is DUE, escalating
// visibly ("overdue Nd"); after DEMOTE_AFTER_OVERDUE_DAYS ignored it demotes
// a temperature, logged and reported — landing DUE in the lower lane, never
// re-hidden behind a fresh timer.
// ─────────────────────────────────────────────────────────────────────────────

import type { Lead } from './supabase'
import { NEXT_TOUCH_DAYS } from './settings'

/** 999 on missing/unparseable — "very stale", so a broken date surfaces as
 *  due rather than silently fresh (the CRM page's original guard, kept). */
export function daysSince(d: string): number {
  if (!d) return 999
  const n = new Date(d).getTime()
  if (isNaN(n)) return 999
  return Math.floor((Date.now() - n) / 86400000)
}

export function isParked(l: Lead): boolean {
  return !!(l.parked_until && new Date(l.parked_until) > new Date())
}

/** When this lead's next touch is due. keep_hot_until when set; otherwise
 *  last contact (or creation) + cadence. Null = no cadence (not hot/warm). */
export function nextTouchAt(l: Lead): Date | null {
  if (l.status !== 'hot' && l.status !== 'warm') return null
  if (l.keep_hot_until) return new Date(l.keep_hot_until)
  const d = new Date(l.last_contact || l.created_at)
  d.setDate(d.getDate() + NEXT_TOUCH_DAYS[l.status])
  return d
}

/** Due for a touch now (next-touch date reached). Was isKhuDue. */
export function isDue(l: Lead): boolean {
  const at = nextTouchAt(l)
  return !!at && at.getTime() <= Date.now()
}

/** Days until the next touch — negative when overdue, null when no cadence
 *  applies. (Was daysUntilKhu, which returned null for no-timer leads and
 *  therefore couldn't nudge them.) */
export function daysUntilTouch(l: Lead): number | null {
  const at = nextTouchAt(l)
  if (!at) return null
  return Math.ceil((at.getTime() - Date.now()) / 86400000)
}

/** Whole days a lead has sat past its next-touch date. 0 = due today or not
 *  due. This is the escalation number ("overdue 3d") and the demote trigger. */
export function overdueDays(l: Lead): number {
  const at = nextTouchAt(l)
  if (!at) return 0
  return Math.max(0, Math.floor((Date.now() - at.getTime()) / 86400000))
}

/** Hot/warm leads scheduled for later — the visible "parked, coming back"
 *  lane. A parked lead (parked_until) belongs here too. */
export function isComingUp(l: Lead): boolean {
  if (l.status !== 'hot' && l.status !== 'warm') return false
  return isParked(l) || !isDue(l)
}

export function getMissing(l: Lead): string[] {
  const m: string[] = []
  if (!l.fname) m.push('first name')
  if (!l.lname) m.push('last name')
  if (!l.email) m.push('email')
  if (!l.phone) m.push('phone')
  if (!l.quote && !l.rate_daily) m.push('quote')
  return m
}
