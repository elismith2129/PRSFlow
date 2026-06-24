import React from 'react'

// Unified status → color mapping for every status badge in the app.
// Colors are stored as 6-digit hex so the badge can derive a translucent
// tinted background (12% opacity) and matching border (25% opacity).
const STATUS_COLORS: Record<string, string> = {
  // gray
  uncontacted: '#6B7280',
  open: '#6B7280',
  // orange
  hot: '#F97316',
  pending: '#F97316',
  tentative: '#F97316',
  // yellow
  warm: '#FACC15',
  // blue
  cold: '#60A5FA',
  // teal
  booked: '#14B8A6',
  completed: '#14B8A6',
  resolved: '#14B8A6',
  confirmed: '#14B8A6',
  // lime
  needs_action: '#C8F04E',
  needs_contact: '#C8F04E',
  in_progress: '#C8F04E',
  // red
  cancelled: '#EF4444',
}

const DEFAULT_COLOR = '#6B7280'

// Normalize an incoming status string to a map key: lowercase, trimmed,
// and any run of spaces/hyphens collapsed to a single underscore.
// e.g. "Needs Action" / "needs-action" → "needs_action".
function normalizeStatus(status: string): string {
  return (status || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[normalizeStatus(status)] ?? DEFAULT_COLOR
  const label = (status || '').replace(/_/g, ' ')
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 8px',
        borderRadius: 4,
        fontSize: 10,
        fontFamily: 'DM Mono',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        color,
        background: hexToRgba(color, 0.12),
        border: `1px solid ${hexToRgba(color, 0.25)}`,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  )
}

export default StatusBadge
