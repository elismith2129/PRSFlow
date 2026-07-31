/**
 * CARVED DESIGN SYSTEM — PRIMITIVES
 * docs/PRSFLO-DESIGN-SPEC.md §8 · styles: the "CARVED DESIGN SYSTEM" block in styles/globals.css
 *
 * These consume `--c-*` tokens via `.c-` classes ONLY — no inline style objects,
 * which is the whole point (AUDIT item 10: 2,693 inline style objects are what
 * made the last theme change a 728-instance mechanical sweep).
 *
 * Nothing in the live app imports this yet. First consumer is /dev-style.
 *
 * THE TWO LAWS THAT DECIDE EVERY CHOICE HERE:
 *  - Containers HOLD content and are carved IN (Panel, Input, RoomCard-empty, Table rows).
 *  - Controls are PRESSED and stick OUT, depressing on :active (Button, SoftButton,
 *    EventChip, Count). If you add a primitive, it is one or the other — never neither.
 *
 * Colour is status and nothing else. There is no accent colour in this system.
 */
import React from 'react'

/* ── Status → token mapping (spec §5) ───────────────────────────────────────
   Deliberately NOT the same mapping as the legacy StatusBadge: there, `open`
   and `uncontacted` were both grey. Here `uncontacted` is harbor (it's a live
   lead state) and `open`/`tech` are driftglass (they're inert). */
export type CarvedStatus = 'hot' | 'warm' | 'cold' | 'booked' | 'uncon' | 'dead'

const STATUS_ALIASES: Record<string, CarvedStatus> = {
  hot: 'hot',
  urgent: 'hot',
  cancelled: 'hot',
  warm: 'warm',
  tentative: 'warm',
  pending: 'warm',
  cold: 'cold',
  booked: 'booked',
  confirmed: 'booked',
  completed: 'booked',
  resolved: 'booked',
  live: 'booked',
  uncontacted: 'uncon',
  uncon: 'uncon',
  tour: 'uncon',
  dead: 'dead',
  dnb: 'dead',
  tech: 'dead',
  open: 'dead',
  open_hours: 'dead',
}

function normalize(status: string): string {
  return (status || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/** Resolve any app status string to one of the six carved status slots. */
export function toCarvedStatus(status: string): CarvedStatus {
  return STATUS_ALIASES[normalize(status)] ?? 'dead'
}

/** Class that paints the status fill. Dark-mode dimming is handled in CSS. */
export function statusFillClass(status: string): string {
  return `c-fill-${toCarvedStatus(status)}`
}

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/* ── Surface ──────────────────────────────────────────────────────────────── */

export function Surface({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('c-root', className)}>{children}</div>
}

/* ── Button — raised, primary ink/ivory fill, presses in ──────────────────── */

export function Button({
  children,
  onClick,
  type = 'button',
  className,
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx('c-btn', 'c-control', 'c-raised-primary', className)}
    >
      {children}
    </button>
  )
}

/* ── SoftButton / Pill — raised; `on` flips to the ink/ivory fill ─────────── */

export function SoftButton({
  children,
  onClick,
  on = false,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  on?: boolean
  className?: string
}) {
  return (
    <button onClick={onClick} className={cx('c-soft', 'c-control', 'c-raised', on && 'c-on', className)}>
      {children}
    </button>
  )
}

/* ── Input — carved in; focus is a depth change, never an outline ─────────── */

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  className,
}: {
  value?: string
  onChange?: (v: string) => void
  placeholder?: string
  type?: string
  className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={onChange ? (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value) : undefined}
      className={cx('c-input', 'c-inset2', className)}
    />
  )
}

/* ── Panel — carved container with a capsule header lozenge ───────────────── */

export function Panel({
  title,
  count,
  action,
  children,
  className,
}: {
  title?: string
  count?: number
  action?: { label: string; href?: string; onClick?: () => void }
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cx('c-panel', className)}>
      {title && (
        <div className="c-lozenge c-anchor">
          <b>
            {title}
            {count !== undefined && <span className="c-count">{count}</span>}
          </b>
          {action &&
            (action.href ? (
              <a href={action.href}>{action.label}</a>
            ) : (
              <button onClick={action.onClick}>{action.label}</button>
            ))}
        </div>
      )}
      {children}
    </div>
  )
}

/* ── StatusPill / StatusDot ───────────────────────────────────────────────── */

export function StatusPill({ status, label, className }: { status: string; label?: string; className?: string }) {
  const slot = toCarvedStatus(status)
  // No .c-raised-chip here: status is information, not a control. Raising it
  // made HOT/WARM read as pressable buttons, which breaks Law 2. The minimal
  // contact shadow lives on .c-pill itself.
  return (
    <span className={cx('c-pill', `c-fill-${slot}`, slot === 'hot' && 'c-pill-hot', className)}>
      {label ?? (status || '').replace(/_/g, ' ')}
    </span>
  )
}

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return <span className={cx('c-dot', statusFillClass(status), className)} />
}

/* ── Count badge ──────────────────────────────────────────────────────────── */

export function Count({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx('c-count', 'c-raised-chip', className)}>{children}</span>
}

/* ── RoomCard — empty is a dim second-level cut; booked is a colored pool ─── */

export function RoomCard({
  room,
  artist,
  meta,
  engineer,
  status,
  className,
}: {
  room: string
  artist?: string
  meta?: string
  engineer?: string
  status?: string
  className?: string
}) {
  const filled = Boolean(artist || status)
  return (
    <div
      className={cx(
        'c-room',
        filled ? cx('c-pool', statusFillClass(status || 'booked')) : 'c-inset2 c-room-empty',
        className,
      )}
    >
      <span className="c-room-name">{room}</span>
      {artist && <div className="c-room-artist c-arch">{artist}</div>}
      {meta && <div className="c-room-meta">{meta}</div>}
      {engineer && <span className="c-room-eng c-mono">{engineer}</span>}
    </div>
  )
}

/* ── EventChip — raised, solid status, Archivo title, mono engineer tag ───── */

export function EventChip({
  title,
  meta,
  engineer,
  status,
  cancelled = false,
  className,
}: {
  title: string
  meta?: string
  engineer?: string
  status: string
  cancelled?: boolean
  className?: string
}) {
  return (
    <div
      className={cx(
        'c-ev',
        'c-control',
        'c-raised-chip',
        statusFillClass(cancelled ? 'cancelled' : status),
        cancelled && 'c-ev-cancelled',
        className,
      )}
    >
      <b className="c-ev-title c-arch">{title}</b>
      {meta && <span className="c-ev-meta">{meta}</span>}
      {engineer && <span className="c-ev-eng c-mono">{engineer}</span>}
    </div>
  )
}

/* ── Row — capsule list row; selected is carved in, not tinted with colour ── */

export function Row({
  children,
  selected = false,
  onClick,
  className,
}: {
  children: React.ReactNode
  selected?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <div onClick={onClick} className={cx('c-row', selected && 'c-selected', className)}>
      {children}
    </div>
  )
}

/* ── Table — lozenge head, alternating carved rows, no rules ──────────────── */

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('c-table', className)}>{children}</div>
}

export function TableHead({ columns, template }: { columns: string[]; template: string }) {
  return (
    <div className="c-lozenge c-anchor" style={{ display: 'grid', gridTemplateColumns: template }}>
      {columns.map((c: string) => (
        <span key={c}>{c}</span>
      ))}
    </div>
  )
}

export function TableRow({
  cells,
  template,
  mono = true,
}: {
  cells: React.ReactNode[]
  template: string
  mono?: boolean
}) {
  return (
    <div className={cx('c-table-row', mono && 'c-mono')} style={{ gridTemplateColumns: template }}>
      {cells.map((cell: React.ReactNode, i: number) => (
        <span key={i}>{cell}</span>
      ))}
    </div>
  )
}

/* ── Modal — carved panel, floating on the one permitted outer shadow ─────── */

export function Modal({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean
  onClose?: () => void
  children: React.ReactNode
  className?: string
}) {
  if (!open) return null
  return (
    <div className="c-modal-backdrop" onClick={onClose}>
      <div
        className={cx('c-modal', className)}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

/* ── NewLeadPulse (§9) — the only animated element in the app ─────────────── */

export function NewLeadPulse({ className }: { className?: string }) {
  return <span className={cx('c-newpulse', className)} aria-label="New lead" />
}
