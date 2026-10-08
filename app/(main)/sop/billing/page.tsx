'use client'

// /sop/billing — the Billing SOP (public/billing-sop.html), served the same
// way /sop serves the general guide (iframe). Shipped 2026-08-20: the SOP was
// built in docs/design-refs but never copied to public/ or routed, so launch
// day found it missing. public/billing-sop.html is the SERVED copy AND the
// source since the 2026-10-06 rewrite (it was rebuilt from the code, not from
// the design-refs mock, which is now history).
// WALKTHROUGH EDITION since 2026-10-07: the file is BUILT from docs/sop-build/
// (drawn screens + step copy + engine). Edit there and rebuild:
//   python3 docs/sop-build/build.py public/billing-sop.html
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
