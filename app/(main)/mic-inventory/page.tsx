'use client'
import { MicInventorySection } from '@/components/admin/MicInventorySection'

// Thin host for the existing Mic Inventory so the rail's item is a real
// destination. The section is unchanged (it still lives in Admin too) —
// its layout gets rethought in Phase B.
export default function MicInventoryPage() {
  return <MicInventorySection />
}
