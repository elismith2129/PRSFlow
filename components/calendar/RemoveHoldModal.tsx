'use client'
// ─────────────────────────────────────────────────────────────────────────────
// REMOVE HOLD — the pop-up behind the work order's "Remove hold" button.
// (Eli, 2026-10-07; mock: docs/design-refs/remove-hold-mock.html)
//
// "Instead of 'delete' it should be 'remove hold' and when you click it a
// window pops up, delete all days or just one… it shows all the days, if there
// are more than one, and the pop-up will allow you to select which days to
// delete or keep. This solves the problem of people trying to delete just one
// day and accidentally deleting all."
//
// THE RULES THIS HOLDS:
//   · NOTHING IS PICKED WHEN IT OPENS. The old Delete took the whole work
//     order behind whichever card was open (WO-1240). Here the whole hold only
//     goes when every day was ticked on purpose — and the button and the line
//     above it both say so, in red, before the click.
//   · Some days ticked → only those days. All ticked → the whole hold.
//   · A day that is confirmed, submitted or reviewed is not a hold: it shows
//     greyed and cannot be ticked. The database refuses it too (remove_hold).
//   · A one-day hold skips the ticking — there is nothing to choose.
//   · This file decides nothing about what is removable and removes nothing:
//     the work order hands it the days — a list FROZEN when the pop-up opened,
//     so it cannot shift under the ticks — and gets back the dates plus
//     whether the person chose the whole hold. The database checks that pair
//     against what the hold has now, and refuses if they disagree. "Whole" is
//     never inferred from a count that happened to match.
//
// FIXED SIZE (house rule): the list is one height and scrolls inside; the
// pop-up is the same size for two days or twenty.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'

export type HoldDay = {
  date: string
  /** "Mon, Oct 12" */
  label: string
  /** "PRS A · 12:00 PM – 12:00 AM" */
  sub: string
  /** Set when the day cannot be removed here — the word shown instead of a tick ("Confirmed"). */
  locked?: string
}

const LIST_H = 316

export function RemoveHoldModal({ woNumber, title, days, blocked, busy, onClose, onRemove }: {
  woNumber: string
  title: string
  days: HoldDay[]
  /** Set when nothing on this hold can be removed from here (an invoice or a payment is on it). */
  blocked?: string | null
  busy: boolean
  onClose: () => void
  /** The dates to take off, and whether the person chose the whole hold
   *  (then `dates` is every day listed). */
  onRemove: (dates: string[], whole: boolean) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const removable = days.filter(d => !d.locked)
  const anyLocked = removable.length < days.length
  const single = days.length <= 1
  // What is ticked, by MEMBERSHIP in the list on screen — never a bare count.
  const pickedDates = removable.filter(d => picked.includes(d.date)).map(d => d.date)
  const n = pickedDates.length
  // The whole hold only when EVERY day is ticked and none is locked.
  const all = !anyLocked && days.length > 1 && n === days.length

  function toggle(d: HoldDay) {
    if (d.locked || busy) return
    setPicked(prev => prev.includes(d.date) ? prev.filter(x => x !== d.date) : [...prev, d.date])
  }
  function toggleAll() {
    if (busy) return
    setPicked(n === removable.length ? [] : removable.map(d => d.date))
  }

  const canGo = !blocked && !busy && (single ? !days[0]?.locked : n > 0)
  const goLabel = busy ? 'Removing…'
    : single ? 'Remove hold'
    : n === 0 ? 'Remove'
    : all ? 'Remove whole hold'
    : `Remove ${n} ${n === 1 ? 'day' : 'days'}`
  const tally = blocked ? ''
    : single ? ''
    : n === 0 ? 'Tick the days to remove. The rest stay on the calendar.'
    : all ? 'That’s every day — the whole hold comes off the calendar.'
    : `${n} of ${days.length} ${n === 1 ? 'day comes' : 'days come'} off · ${days.length - n} ${days.length - n === 1 ? 'stays' : 'stay'}`

  const row = (d: HoldDay, tick: boolean) => {
    const on = !d.locked && picked.includes(d.date)
    return (
      <div
        key={d.date}
        role={tick ? 'checkbox' : undefined}
        aria-checked={tick ? on : undefined}
        aria-disabled={tick && !!d.locked ? true : undefined}
        tabIndex={tick && !d.locked ? 0 : undefined}
        onClick={tick ? () => toggle(d) : undefined}
        onKeyDown={tick ? e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(d) } } : undefined}
        style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12,
          background: on ? 'color-mix(in srgb, var(--c-st-hot) 14%, transparent)' : 'var(--c-wash)',
          cursor: tick && !d.locked ? 'pointer' : 'default', opacity: d.locked ? 0.5 : 1, userSelect: 'none',
        }}
      >
        {tick && (
          <span style={{
            width: 19, height: 19, borderRadius: 6, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 800, lineHeight: 1,
            background: on ? 'var(--c-st-hot)' : 'transparent', color: on ? 'var(--c-hot-text)' : 'transparent',
            boxShadow: on ? 'none' : `inset 0 0 0 1.6px ${d.locked ? 'var(--c-wash2)' : 'var(--c-fg-3)'}`,
          }}>✓</span>
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: 13 }}>{d.label}</b>
          {d.sub && <span style={{ display: 'block', fontSize: 11, color: 'var(--c-fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.sub}</span>}
        </span>
        {(tick || d.locked) && (
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0, color: on ? 'var(--c-st-hot)' : 'var(--c-fg-3)' }}>
            {d.locked ? d.locked : on ? 'Remove' : 'Stays'}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 10046, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'Inter' }}
    >
      <div
        role="dialog"
        aria-label="Remove hold"
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--c-fg)', boxSizing: 'border-box' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="c-label" style={{ marginBottom: 2 }}>{woNumber ? `${woNumber} · ` : ''}Tentative</div>
            <div className="c-arch" style={{ fontSize: 16, lineHeight: 1.25 }}>Remove hold</div>
            {title && <div style={{ fontSize: 11.5, color: 'var(--c-fg-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>}
          </div>
          <button type="button" className="c-x" onClick={onClose} disabled={busy} style={{ marginLeft: 'auto', fontSize: 16, flexShrink: 0 }} aria-label="Close">×</button>
        </div>

        {blocked ? (
          <div style={{ height: LIST_H + 34, maxHeight: '56vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
            <b style={{ fontSize: 13 }}>This one can’t be removed from here.</b>
            <span style={{ fontSize: 12.5, color: 'var(--c-fg-2)', lineHeight: 1.5 }}>{blocked}</span>
          </div>
        ) : single ? (
          <div style={{ height: LIST_H + 34, maxHeight: '56vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: 'var(--c-fg-2)' }}>
              {days.length === 0 ? 'This hold has no days on it. Take it off?'
                : days[0].locked ? `This day is ${days[0].locked.toLowerCase()} — it is not a hold any more. It is deleted from the billing hub.`
                : 'This hold is one day. Take it off the calendar?'}
            </span>
            {days.map(d => row(d, false))}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, color: 'var(--c-fg-2)' }}>Which days come off the calendar?</span>
              {removable.length > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={toggleAll}
                  onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleAll() } }}
                  style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-fg-2)', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer' }}
                >{n === removable.length ? 'Clear' : 'Select all'}</span>
              )}
            </div>
            <div style={{ height: LIST_H, maxHeight: '50vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 2 }}>
              {days.map(d => row(d, true))}
            </div>
          </div>
        )}

        <div style={{ minHeight: 20, fontSize: 12, display: 'flex', alignItems: 'center', color: all ? 'var(--c-st-hot)' : 'var(--c-fg-2)', fontWeight: all ? 700 : 400 }}>
          {tally}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="c-soft" onClick={onClose} disabled={busy} style={{ flex: '1 1 0', padding: '12px 10px', fontSize: 12, cursor: busy ? 'default' : 'pointer' }}>
            {blocked ? 'Close' : 'Keep it'}
          </button>
          {!blocked && (
            <button
              type="button"
              className="c-btn"
              disabled={!canGo}
              onClick={() => {
                if (!canGo) return
                if (single || all) onRemove(days.map(d => d.date), true)
                else onRemove(pickedDates, false)
              }}
              style={{ flex: '1 1 0', padding: '12px 10px', fontSize: 12, background: 'var(--c-st-hot)', color: 'var(--c-hot-text)', opacity: canGo ? 1 : 0.35, cursor: canGo ? 'pointer' : 'default' }}
            >{goLabel}</button>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--c-fg-3)', textAlign: 'center' }}>
          Kept under Billing → Removed holds. Can be put back.
        </div>
      </div>
    </div>
  )
}
