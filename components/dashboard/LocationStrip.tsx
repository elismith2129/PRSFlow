'use client'

const LOCATIONS = ['Paramount', 'Encore', 'Ameraycan', 'Track Record']

export function LocationStrip() {
  // TODO: hook up to work orders for today
  const activeLocations: string[] = []

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
      {LOCATIONS.map(loc => {
        const active = activeLocations.includes(loc)
        return (
          <div key={loc} style={{
            background: 'var(--surface)',
            border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 10, padding: '12px 16px', position: 'relative', overflow: 'hidden'
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 2,
              background: active ? 'var(--accent)' : 'var(--border)',
              opacity: active ? 1 : 0.25
            }} />
            <div style={{
              fontFamily: 'Syne', fontWeight: 800, fontSize: 13,
              color: active ? 'var(--accent)' : 'var(--text2)'
            }}>{loc}</div>
            <div style={{
              fontSize: 9, fontFamily: 'Syne', fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              color: active ? 'var(--accent)' : 'var(--text3)', marginTop: 3
            }}>{active ? 'ACTIVE' : 'OPEN'}</div>
          </div>
        )
      })}
    </div>
  )
}
