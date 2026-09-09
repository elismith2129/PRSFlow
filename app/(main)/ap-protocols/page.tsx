'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /ap-protocols — how each label wants its invoice submitted.
//
// ITS OWN ROUTE, NOT AN ADMIN TAB (Eli, 2026-09-08: "there is no nav for
// admin"). This editor was first built as a section inside /admin — a page the
// Rail deliberately dropped ("Admin is OUT of the nav entirely… its rebuild is
// a later phase", components/layout/Rail.tsx). So it shipped unreachable.
// Engineers, Mic Inventory and Flags each got their own route when Admin was
// dismantled; this follows them rather than resurrecting the old page.
//
// Sits under Billing in the rail, because the procedures belong to the people
// who send the invoices.
// ─────────────────────────────────────────────────────────────────────────────

import { ApProfilesSection } from '@/components/admin/ApProfilesSection'

export default function ApProtocolsPage() {
  return (
    <div>
      <h1 className="c-arch" style={{ fontSize: 22, letterSpacing: '-0.01em', margin: '2px 0 4px' }}>
        Client AP Protocols
      </h1>
      <div style={{ fontSize: 12.5, color: 'var(--c-fg-3)', marginBottom: 16, maxWidth: 620 }}>
        How each label wants its invoice submitted — the portal or AP email, whether a PO is
        required, and the steps. This is what the <b>AP</b> button on a Billing row shows.
        A client is linked to a procedure on its client profile, not here.
      </div>
      <ApProfilesSection />
    </div>
  )
}
