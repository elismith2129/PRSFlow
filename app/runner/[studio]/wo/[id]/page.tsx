'use client'
// ─────────────────────────────────────────────────────────────────────────────
// RUNNER WORK ORDER — a thin wrapper around the shared WorkOrderPopup
// (2026-08-15, spec §15; mock docs/design-refs/runner-wo-views.html).
//
// This file was a 1,595-line duplicate of components/calendar/WorkOrderPopup.tsx
// — a second description of the work order that drifted from the first (the
// same disease /wo/[id]/print had). The runner work order is now the SAME
// component with mode="runner": the office's fields (client block, rates, any
// admin-locked day) are read-only, everything the runner owns (times, staff,
// OT hours, equipment condition, song titles, payments taken at the desk,
// notes) stays live, and the terminal act is Submit (today's rows →
// 'submitted'), never Complete WO.
//
// This page's only jobs: resolve the WO id (the URL may carry a wo id or
// ?booking_id for pre-rebuild cards), fetch the WO's booking row, and hand
// both to the shared component. Runner mode inside the popup is adopt-only —
// it never creates a work order.
//
// Realtime: the popup is deliberately LOCAL-FIRST while open (its stRows are
// edited in memory and committed in one atomic save; it subscribes only to
// work_orders status). That is the standing WO-popup exception to the
// realtime rule, and the runner now inherits it instead of maintaining a
// second, different wiring.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'

const STUDIO_META: Record<string, { label: string; abbr: string }> = {
  paramount: { label: 'Paramount', abbr: 'PRS' },
  ameraycan: { label: 'Ameraycan', abbr: 'ARS' },
  encore: { label: 'Encore', abbr: 'ERS' },
  track: { label: 'Track', abbr: 'TRS' },
}

export default function RunnerWOPage() {
  const router = useRouter()
  const { studio, id: woIdParam } = useParams<{ studio: string; id: string }>()
  const searchParams = useSearchParams()
  const bookingId = searchParams.get('booking_id')
  const meta = STUDIO_META[studio] ?? { label: studio, abbr: '?' }

  const [booking, setBooking] = useState<Booking | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      let resolvedId = woIdParam !== 'new' ? woIdParam : null

      if (!resolvedId && bookingId) {
        // Adopt-only: the runner never creates a work order. WO creation happens
        // at booking-save (admin). Resolve via the booking card's OWN
        // work_order_id first — post-rebuild a WO writes several projection
        // cards that all carry work_order_id, while work_orders.booking_id
        // names only the original.
        const { data: bk } = await supabase
          .from('bookings')
          .select('work_order_id')
          .eq('id', bookingId)
          .maybeSingle()
        if (bk?.work_order_id) resolvedId = bk.work_order_id
      }

      if (!resolvedId && bookingId) {
        // Fallback for pre-rebuild bookings whose work_order_id was never set.
        const { data: existingRows } = await supabase
          .from('work_orders')
          .select('id')
          .eq('booking_id', bookingId)
          .order('created_at', { ascending: true })
          .limit(1)
        if (existingRows?.[0]) resolvedId = existingRows[0].id
      }

      if (!resolvedId) {
        setError('Work order not yet created — contact office.')
        setLoading(false)
        return
      }

      // The popup takes a BOOKING and resolves the WO from it. Fetch the WO's
      // primary booking; carry work_order_id so the popup adopts this exact WO.
      const { data: woData } = await supabase
        .from('work_orders').select('id, booking_id').eq('id', resolvedId).maybeSingle()
      if (!woData) {
        setError('Work order not found — contact office.')
        setLoading(false)
        return
      }
      const bkId = woData.booking_id || bookingId
      const { data: bkData } = bkId
        ? await supabase.from('bookings').select('*').eq('id', bkId).maybeSingle()
        : { data: null }
      if (!bkData) {
        // WO with no linked booking (orphan) — error instead of a blank screen.
        setError('This work order is not linked to a booking — contact office.')
        setLoading(false)
        return
      }
      setBooking({ ...(bkData as Booking), work_order_id: woData.id } as Booking)
      setLoading(false)
    }
    init()
  }, [woIdParam, bookingId])

  if (loading) return (
    <div style={{ minHeight: '100dvh', background: 'var(--c-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-fg-2)', fontFamily: 'Inter', fontSize: 12 }}>
      Loading work order…
    </div>
  )

  if (error || !booking) return (
    <div style={{ minHeight: '100dvh', background: 'var(--c-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 360, textAlign: 'center' }}>
        <div style={{ color: 'var(--c-st-hot)', fontFamily: 'Inter', fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>{error ?? 'Work order not found.'}</div>
        <button onClick={() => router.push(`/runner/${studio}`)} style={{ background: 'var(--c-wash)', color: 'var(--c-fg)', borderRadius: 8, padding: '10px 22px', fontFamily: 'Inter', fontSize: 12, cursor: 'pointer' }}>
          ← Back to {meta.label}
        </button>
      </div>
    </div>
  )

  return (
    <WorkOrderPopup
      booking={booking}
      mode="runner"
      runnerStudio={studio}
      runnerStudioLabel={meta.label}
      onClose={() => router.push(`/runner/${studio}`)}
    />
  )
}
