'use client'

// ALL-STARS (Eli, 2026-10-13): "the owner just wants to be able to star people
// as top players." One star, used on BOTH the lead profile and the client
// profile (+ a small mark in every list row), so the two can't drift.
//
// Who can toggle: any admin — owner / manager / billing / asst_manager. Runners
// and tech never reach the CRM; this is the belt to that braces. Everyone else
// who can see a profile still SEES the star (read-only), so the whole office
// knows who the top players are.
//
// One star per person is NOT enforced here — DB triggers keep a client and its
// leads in step (migration 20261013120000). Callers just write their own row.

import React from 'react'

export const ALL_STAR_ROLES = ['owner', 'manager', 'billing', 'asst_manager'] as const

export function canToggleAllStar(role: string | null | undefined): boolean {
  return !!role && (ALL_STAR_ROLES as readonly string[]).includes(role)
}

/** The clickable star beside a profile's name. */
export function AllStarToggle({ on, canEdit, onToggle, size = 18 }: {
  on: boolean
  canEdit: boolean
  onToggle: () => void
  size?: number
}) {
  // Read-only and off: say nothing — an empty outline star on every profile
  // the viewer can't change would just be noise.
  if (!canEdit && !on) return null
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); if (canEdit) onToggle() }}
      disabled={!canEdit}
      aria-pressed={on}
      aria-label={on ? 'All-Star — tap to remove' : 'Mark as All-Star'}
      title={canEdit ? (on ? 'All-Star — tap to remove' : 'Mark as All-Star (top player)') : 'All-Star'}
      style={{
        flexShrink: 0, alignSelf: 'center', background: 'transparent', border: 'none', padding: '0 2px',
        cursor: canEdit ? 'pointer' : 'default', lineHeight: 1, fontSize: size,
        color: on ? 'var(--c-fg)' : 'var(--c-fg-3)',
        opacity: on ? 1 : 0.7,
      }}
    >{on ? '★' : '☆'}</button>
  )
}

/** The small mark in a list row. Renders nothing when not starred. */
export function AllStarMark({ on }: { on?: boolean }) {
  if (!on) return null
  return (
    <span aria-label="All-Star" title="All-Star" style={{ color: 'var(--c-fg)', fontSize: '0.95em', marginRight: 4, lineHeight: 1 }}>★</span>
  )
}
