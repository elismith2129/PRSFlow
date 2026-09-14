'use client'
import { RoomRatesSection } from '@/components/admin/RoomRatesSection'

// /rates — the room rate card (Admin → Rates in the old page, which is out of
// the nav). Lives under the rail's ADMIN group (Eli, 2026-09-14: "we should
// create one so that we don't create more existing tabs") — the home for
// settings-shaped pages that are edited rarely and read often, so the next
// one (rooms, PINs, whatever) has somewhere to go that is not Operations.
export default function RatesPage() {
  return <div style={{ maxWidth: 780 }}><RoomRatesSection /></div>
}
