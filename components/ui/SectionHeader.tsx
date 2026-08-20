import React from 'react'

type CountColor = 'lime' | 'orange' | 'teal'

type SectionHeaderAction = {
  label: string
  href?: string
  onClick?: () => void
}

const COUNT_COLORS: Record<CountColor, { background: string; color: string }> = {
  lime: { background: 'var(--accent)', color: 'var(--bg)' },
  orange: { background: 'var(--warm)', color: '#fff' },
  teal: { background: 'var(--booked)', color: 'var(--bg)' },
}

export function SectionHeader({
  title,
  count,
  countColor = 'lime',
  action,
  actionColor = 'var(--accent)',
  carved = false,
}: {
  title: string
  count?: number
  countColor?: CountColor
  action?: SectionHeaderAction
  actionColor?: string
  /**
   * Carved design system variant (docs/PRSFLO-DESIGN-SPEC.md §8): renders as a
   * capsule lozenge resting on the surface instead of the legacy bare label.
   * Extends this component rather than duplicating it, per spec §8. Default
   * false — every existing caller is untouched.
   */
  carved?: boolean
}) {
  const pill = COUNT_COLORS[countColor]

  if (carved) {
    return (
      <div className="c-lozenge c-anchor">
        <b>
          {title}
          {count !== undefined && <span className="c-count">{count}</span>}
        </b>
        {action &&
          (action.href ? (
            <a className="c-lz-action" href={action.href}>{action.label}</a>
          ) : (
            <button className="c-lz-action" onClick={action.onClick}>{action.label}</button>
          ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text2)',
          fontFamily: 'Inter',
        }}
      >
        {title}
      </span>
      {count !== undefined && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 10,
            padding: '1px 7px',
            letterSpacing: '0.05em',
            background: pill.background,
            color: pill.color,
          }}
        >
          {count}
        </span>
      )}
      {action && (
        action.href ? (
          <a
            href={action.href}
            style={{ marginLeft: 'auto', fontSize: 11, color: actionColor, textDecoration: 'none', cursor: 'pointer' }}
          >
            {action.label}
          </a>
        ) : (
          <button
            onClick={action.onClick}
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: actionColor,
              textDecoration: 'none',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              padding: 0,
              fontFamily: 'Inter',
            }}
          >
            {action.label}
          </button>
        )
      )}
    </div>
  )
}

export default SectionHeader
