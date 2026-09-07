// HOT LEAD SIGNALS:
// - Asked for specific dates/availability
// - Requested a quote
// - Mentioned budget
// - Said "I want to book"
// - Asked about gear/rooms
// - Has project timeline
// - Previous client returning
// Rule: If asking logistical questions (when/how much/what gear) → HOT

// WARM LEAD SIGNALS:
// - "Just looking for information"
// - "Comparing a few studios"
// - "Might record later this year"
// - Slow to respond (2+ days)
// - General questions only
// - No budget discussed yet
// Rule: If still thinking or comparing options → WARM

// ─── Pipeline timers (Eli ruling 2026-09-07) ─────────────────────────────────
// ONE cadence constant. Every contact log / Keep Hot / hot-or-warm create sets
// keep_hot_until = now + NEXT_TOUCH_DAYS[status] — keep_hot_until IS the
// next-touch date, and a lead with a future one is VISIBLE in Coming Up
// (parked, coming back), never hidden. The old trio (COOL_DOWN_DAYS,
// TOUCH_INTERVAL_DAYS with warm=8) is retired: the write paths always used
// 5/3, so the 8-day fallback was drift, not policy.
export const NEXT_TOUCH_DAYS = { hot: 5, warm: 3 }

// A due lead sits VISIBLY overdue in the Due lane this many days before the
// auto-demote cron moves it down a temperature. Demotion logs a lead_activity
// entry and lands the lead DUE in its new lane — it never re-hides it (the
// old cron's +3d gift timer was exactly the "handled" misread Eli killed).
export const DEMOTE_AFTER_OVERDUE_DAYS = 3
