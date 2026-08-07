'use client'

/**
 * Placeholder for rail destinations that don't have their real page yet.
 * Daily Ops gets its page in Phase B (layout rework); Punches / Hiring /
 * Training are the Phase C HR pages (design + build from scratch per
 * docs/HR-SPEC.md). Ruling 2026-08-06: rail links point at placeholders
 * rather than borrowing surfaces that are about to be reworked.
 */
export function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="c-panel" style={{ maxWidth: 560, margin: '48px auto', padding: '36px 40px', textAlign: 'center' }}>
      <div style={{
        fontSize: 9.5, fontWeight: 800, letterSpacing: '0.11em',
        textTransform: 'uppercase', opacity: 0.45, marginBottom: 6,
      }}>
        Coming soon
      </div>
      <h1 className="c-arch" style={{ fontSize: 28, letterSpacing: '-0.03em', lineHeight: 1.05, margin: 0 }}>
        {title}
      </h1>
      <p style={{ fontSize: 12.5, opacity: 0.6, marginTop: 10, marginBottom: 0 }}>{note}</p>
    </div>
  )
}

export default PlaceholderPage
