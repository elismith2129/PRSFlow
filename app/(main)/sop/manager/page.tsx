'use client'

// /sop/manager — the Studio Manager SOP (public/manager-sop.html), iframed
// like /sop and /sop/billing. public/ is the served copy; the design-refs
// original is the working mock — edit there, then re-copy.
export default function ManagerSopPage() {
  return (
    <div style={{ height: 'calc(100vh - 52px)', display: 'flex', flexDirection: 'column' }}>
      <iframe
        src="/manager-sop.html"
        style={{ flex: 1, width: '100%', border: 'none' }}
        title="Studio Manager SOP"
      />
    </div>
  )
}
