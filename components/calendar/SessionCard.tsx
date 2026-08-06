'use client'
// THE SESSION CARD — one implementation, every surface.
//
// Spec: docs/PRSFLO-DESIGN-SPEC.md §10b. Reference: docs/design-refs/calendar-card-options.html.
//
// This exists because "the dashboard cards should match the calendar cards" is
// not something a convention can hold. The calendar grid, the day view, the
// studio view and the dashboard room grid each had their own copy of the card,
// and they had already drifted: different fonts on the client line, staff
// stacked vertically in one place and inline in another, invoice numbers shown
// in two of the four. Four copies means four chances to be wrong on the next
// change. There is now one.
//
// ANATOMY, top to bottom:
//   1. Payload   — artist/label (Archivo) · client line · times, left-aligned
//   2. Footer    — a darker shade of the chip: invoice# left, staff tags right
//   3. COD strip — full-width hot bar, COD only. Billing renders NOTHING;
//                  silence is the billing signal.
//
// HEIGHT LADDER. Fields never drop on a NARROW card — they ellipsis (F-18/F-19).
// They drop on a SHORT one, because two or three sessions in one room on one day
// split a fixed cell between them and the row cannot grow without deforming the
// grid for the whole year. Order of loss is the reverse of what you need at a
// glance, and the COD bar shrinks to a 4px sliver rather than leaving — the red
// edge is the signal; the method is one hover away.
import React from 'react'

export type Sessionish = {
  payment_type?: string | null
  cod_method?: string | null
  artist?: string | null
  label?: string | null
  client_name?: string | null
  from_time?: string | null
  to_time?: string | null
  invoice_num?: string | number | null
  session_type?: string | null
}

/** "9:00 PM" → "9P", "9:30 PM" → "9:30P". Was duplicated byte-for-byte in the
 *  calendar and the dashboard. */
export function fmtCardTime(t: string): string {
  if (!t) return ''
  const m = t.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
  if (!m) return t
  let h = parseInt(m[1])
  const min = m[2]
  const ap = m[3]?.toUpperCase()
  if (ap) return `${h}${min !== '00' ? ':' + min : ''}${ap === 'AM' ? 'A' : 'P'}`
  const suf = h >= 12 ? 'P' : 'A'
  if (h > 12) h -= 12
  if (h === 0) h = 12
  return `${h}${min !== '00' ? ':' + min : ''}${suf}`
}

/** "Xavier Daniel" → "XD". Also duplicated in both pages before this. */
export function initials(name: string | null | undefined): string {
  if (!name?.trim()) return ''
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

// Height at which the full anatomy fits, measured:
// padding 5 + name 16 + client 12 + times 12 + footer 16 + COD 14 = 75.
// Set below 77 on purpose — a level-1 calendar row yields a 77px chip, and a
// threshold of 76+ would push every ordinary single-session card one pixel into
// the reduced ladder.
export const CARD_FULL_H = 74

export function cardTiers(height: number) {
  return {
    showFooter: height >= CARD_FULL_H,
    showClient: height >= 50,
    showTimes: height >= 36,
    // Anything short of the full card gets the sliver.
    codSliver: height < CARD_FULL_H,
  }
}

export function SessionCardBody({
  booking, height, eng = '', asst = '', isMobile = false, children,
}: {
  booking: Sessionish
  /** Usable height of the card in px — drives the ladder above. */
  height: number
  /** Pre-resolved initials. Passed in rather than derived, because the calendar
   *  resolves staff PER DAY from studio_time_rows and the dashboard reads the
   *  booking projection; the card must not care which. */
  eng?: string
  asst?: string
  isMobile?: boolean
  /** Extra absolutely-positioned content inside the payload — the calendar's
   *  repeated payload copies on long multi-day bars. */
  children?: React.ReactNode
}) {
  const isBilling = booking.payment_type === 'billing'
  const { showFooter, showClient, showTimes, codSliver } = cardTiers(height)

  // Billing leads with the artist; COD leads with who's paying.
  const primaryName = isBilling
    ? (booking.artist || booking.label || booking.client_name || '')
    : (booking.client_name || '')
  const labelLine = isBilling && booking.label && booking.label !== primaryName ? booking.label : ''
  const timeStr = booking.from_time && booking.to_time
    ? `${fmtCardTime(booking.from_time)}–${fmtCardTime(booking.to_time)}`
    : booking.from_time ? fmtCardTime(booking.from_time) : ''
  // Non-recording session types used to be flagged with an accent-coloured
  // border. The accent is retired (§12) so the distinction returns as a tag.
  const typeTag = booking.session_type === 'filming' ? 'FILM'
    : booking.session_type === 'event_playback' ? 'EVENT' : ''
  const codLabel = booking.cod_method === 'Credit Card' ? 'CC' : (booking.cod_method ?? '').toUpperCase()
  // Invoice only. The WO number came off the card — an internal key nobody reads
  // off a wall, and carrying both truncated the strip exactly where the staff
  // tags matter. It's still on the hover card.
  const invTag = booking.invoice_num ? `#${booking.invoice_num}` : ''
  const staffTag = [eng && `1ST-${eng}`, asst && `2ND-${asst}`].filter(Boolean).join(' · ')

  return (
    <div className="c-evbody">
      <div style={{
        flex: '1 1 auto', minHeight: 0, minWidth: 0, maxWidth: '100%',
        padding: showFooter ? '3px 8px 2px' : '2px 8px 1px', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        position: 'relative', zIndex: 1,
      }}>
        {children}
        <div style={{
          fontSize: isMobile ? 11 : (showTimes ? 12.5 : 11),
          fontFamily: "'Archivo Black', sans-serif", lineHeight: 1.3,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {primaryName}
        </div>
        {labelLine && showClient && (
          <div className="c-ev-meta" style={{
            fontSize: 10, lineHeight: 1.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {labelLine}
          </div>
        )}
        {timeStr && showTimes && (
          <div className="c-ev-2 c-mono" style={{
            fontSize: 9.5, lineHeight: 1.25,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {timeStr}{typeTag ? `  ${typeTag}` : ''}
          </div>
        )}
      </div>

      {showFooter && (invTag || staffTag) && (
        <div className="c-ev-foot">
          {invTag && <span className="c-ev-wo c-mono">{invTag}</span>}
          {staffTag && <span className="c-ev-staff">{staffTag}</span>}
        </div>
      )}

      {!isBilling && (
        <div className={`c-ev-cod${codSliver ? ' c-ev-cod-sliver' : ''}`}>
          {codSliver ? '' : (codLabel ? `COD ${codLabel}` : 'COD')}
        </div>
      )}
    </div>
  )
}
