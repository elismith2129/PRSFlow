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
    // The title, the "?" and the button are the shared page top, drawn by
    // the section (it owns the search and the editor) — 2026-10-13.
    <ApProfilesSection />
  )
}
