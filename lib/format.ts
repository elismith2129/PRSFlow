// ─────────────────────────────────────────────────────────────────────────────
// lib/format — canonical display formatters (Phase 1 audit fix).
// Consolidates the copies that used to live per-page. NOTE: the calendar chip's
// compact "8P" formatter and CRM's "8pm" formatter are intentionally page-local
// display styles and stay where they are.
// ─────────────────────────────────────────────────────────────────────────────

// "1234.5" / "$1,234.50" → "$1,234.50". Unparseable → ''.
export function formatCurrency(val: string): string {
  const num = parseFloat(String(val).replace(/[$,]/g, ''))
  if (isNaN(num)) return ''
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// "$1,234.50" → 1234.5. Unparseable → null.
export function stripCurrency(val: string): number | null {
  const n = parseFloat(String(val).replace(/[$,]/g, ''))
  return isNaN(n) ? null : n
}

// ISO timestamp → "Jul 21 · 08:30 PM" (activity feeds, flags, task meta).
export function fmtTimestamp(iso: string): string {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  )
}

// ISO timestamp → "08:30 PM" (time only).
export function fmtClock(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// "2026-08-17" → "August 17th, 2026" (Eli, 2026-08-16 — the Session Info card
// was showing the raw DB date). Parses as LOCAL time (bare YYYY-MM-DD parses
// as UTC and shifts a day west of it). Unparseable → the input unchanged.
export function longDate(d: string): string {
  if (!d) return d
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt.getTime())) return d
  const day = dt.getDate()
  const suffix = day % 10 === 1 && day !== 11 ? 'st'
    : day % 10 === 2 && day !== 12 ? 'nd'
    : day % 10 === 3 && day !== 13 ? 'rd' : 'th'
  return `${dt.toLocaleDateString('en-US', { month: 'long' })} ${day}${suffix}, ${dt.getFullYear()}`
}
