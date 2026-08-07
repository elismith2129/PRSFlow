'use client'
import { FlagsLogSection } from '@/components/admin/FlagsLogSection'

// Thin host for the existing Flags log so the rail's Flags item is a real
// destination. The section is unchanged (it still lives in Admin too) —
// its layout gets rethought in Phase B.
export default function FlagsPage() {
  return <FlagsLogSection />
}
