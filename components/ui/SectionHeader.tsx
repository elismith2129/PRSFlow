import React from 'react'

type CountColor = 'lime' | 'orange' | 'teal'

type SectionHeaderAction = {
  label: string
  href?: string
  onClick?: () => void
}

const COUNT_COLORS: Record<CountColor, { background: string; color: string }> = {
  lime: { background: '#c8f04e', color: '#0d0f14' },
  orange: { background: '#F97316', color: '#fff' },
  teal: { background: '#14B8A6', color: '#0d0f14' },
}

export function SectionHeader({
  title,
  count,
  countColor = 'lime',
  action,
}: {
  title: string
  count?: number
  countColor?: CountColor
  action?: SectionHeaderAction
}) {
  const pill = COUNT_COLORS[countColor]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#9ca3af',
          fontFamily: 'DM Mono',
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
            style={{ marginLeft: 'auto', fontSize: 11, color: '#c8f04e', textDecoration: 'none', cursor: 'pointer' }}
          >
            {action.label}
          </a>
        ) : (
          <button
            onClick={action.onClick}
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: '#c8f04e',
              textDecoration: 'none',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              padding: 0,
              fontFamily: 'DM Mono',
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
