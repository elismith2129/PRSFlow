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

export const COOL_DOWN_DAYS = { hot: 5, warm: 8, cold: 11 }
export const TOUCH_INTERVAL_DAYS = { hot: 5, warm: 8 }
