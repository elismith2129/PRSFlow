'use client'

// /sop/owner — The Owner's Page (public/owner-guide.html), served the same
// way as /sop/billing. One big-print scroll: the owner's day in three stops
// (dashboard, CRM, billing hub). Deliberately not the chaptered SOP shape —
// big text, nothing to navigate (Eli, 2026-09-07).
export default function OwnerGuidePage() {
  return (
    <div style={{ height: 'calc(100vh - 52px)', display: 'flex', flexDirection: 'column' }}>
      <iframe
        src="/owner-guide.html"
        style={{ flex: 1, width: '100%', border: 'none' }}
        title="The Owner's Page"
      />
    </div>
  )
}
