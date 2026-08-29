import React from 'react'
import { StatusPill as CarvedStatusPill } from '@/components/carved'

// Unified status → color mapping for every status badge in the app.
// Colors are stored as 6-digit hex so the badge can derive a translucent
// tinted background (12% opacity) and matching border (25% opacity).
const STATUS_COLORS: Record<string, string> = {
  // gray
  uncontacted: 'var(--cold)',
  open: 'var(--cold)',
  // red (matches --hot)
  hot: 'var(--hot)',
  // orange (matches --warm)
  warm: 'var(--warm)',
  pending: 'var(--warm)',
  tentative: 'var(--warm)',
  // blue
  cold: '#60A5FA',
  // orchid — leasing lead. Hex, not a var(), because this legacy badge derives
  // its tint via hexToRgba below. Same value as --c-st-lease.
  leasing: '#b5a3ef',
  // teal
  booked: 'var(--booked)',
  completed: 'var(--booked)',
  resolved: 'var(--booked)',
  confirmed: 'var(--booked)',
  // lime
  needs_action: 'var(--accent)',
  needs_contact: 'var(--accent)',
  in_progress: 'var(--accent)',
  // red
  cancelled: 'var(--hot)',
  // teal — rent-only monthly lockout reads as a booked room
  lockout: 'var(--booked)',
}

const DEFAULT_COLOR = 'var(--cold)'

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

export function StatusBadge({
  status,
  carved = false,
}: {
  status: string
  /**
   * Carved design system variant (docs/PRSFLO-DESIGN-SPEC.md §5/§8): a solid
   * status fill with chip ink, raised off the surface — never tinted text in a
   * bordered box, which Law 1 forbids. Extends this component rather than
   * duplicating it, per spec §8. Default false — existing callers are untouched.
   *
   * Note the mapping differs from the legacy one above on purpose: `uncontacted`
   * is harbor (a live lead state), while `open`/`tech` are driftglass (inert).
   * The legacy map made both grey.
   */
  carved?: boolean
}) {
  const color = STATUS_COLORS[normalizeStatus(status)] ?? DEFAULT_COLOR
  const label = (status || '').replace(/_/g, ' ')

  if (carved) {
    return <CarvedStatusPill status={status} label={label} />
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 8px',
        borderRadius: 4,
        fontSize: 10,
        fontFamily: 'Inter',
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
