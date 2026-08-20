'use client'

// /sop/billing — the Billing SOP (public/billing-sop.html), served the same
// way /sop serves the general guide (iframe). Shipped 2026-08-20: the SOP was
// built in docs/design-refs but never copied to public/ or routed, so launch
// day found it missing. public/billing-sop.html is the SERVED copy; the
// design-refs original is the working mock — edit there, then re-copy.
export default function BillingSopPage() {
  return (
    <div style={{ height: 'calc(100vh - 52px)', display: 'flex', flexDirection: 'column' }}>
      <iframe
        src="/billing-sop.html"
        style={{ flex: 1, width: '100%', border: 'none' }}
        title="Billing SOP"
      />
    </div>
  )
}
