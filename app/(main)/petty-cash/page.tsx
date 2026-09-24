'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /petty-cash — the office's month view of each studio's cash box.
//
// ITS OWN ROUTE, UNDER BILLING IN THE RAIL (Eli, 2026-09-24). It shipped the
// day before as a TAB inside the billing hub heading, alongside Billing, COD,
// Tenants and Financials. Wrong shelf: those words are pipelines and views of
// one thing — invoices — and the heading's job is to say which pipeline you
// are looking at. A month of cash movements is not a pipeline, has no bucket
// and no next action, and sitting up there it competed with the COD toggle,
// which is deliberately in the title so nobody forgets COD (ruling
// 2026-08-13).
//
// It belongs beside Client AP Protocols: billing-adjacent things the same
// people need, reached from the rail rather than by switching what the
// billing page is about.
// ─────────────────────────────────────────────────────────────────────────────

import { PettyCashSection } from '@/components/billing/PettyCashSection'

export default function PettyCashPage() {
  return (
    <div>
      <h1 className="c-arch" style={{ fontSize: 22, letterSpacing: '-0.01em', margin: '2px 0 4px' }}>
        Petty Cash
      </h1>
      <div style={{ fontSize: 12.5, color: 'var(--c-fg-3)', marginBottom: 16, maxWidth: 620 }}>
        One studio, one month: every transaction with a running balance, what each box was
        counted at, and any night the count disagreed with the ledger. <b>Download CSV</b> for
        QuickBooks, or <b>Print</b> for the file. Runners record the nightly side in the runner app.
      </div>
      <PettyCashSection />
    </div>
  )
}
