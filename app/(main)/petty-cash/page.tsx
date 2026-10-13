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
    // The title, the "?" and the buttons are the shared page top, drawn by
    // the section (it owns the studio and month) — 2026-10-13.
    <PettyCashSection />
  )
}
