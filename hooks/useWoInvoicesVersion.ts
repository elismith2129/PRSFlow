'use client'
// One shared work-order/payment realtime channel for the invoice surfaces.
//
// Why this exists (2026-09-01, the approval-notification build): three surfaces
// now react to invoice movement — the billing hub itself, the Rail's Billing
// badge, and the owner dashboard's approvals banner. On any page where two of
// them are mounted, per-surface subscriptions would break the standing rule
// against duplicate channels on one table per page. Same shape as
// hooks/useClientsVersion (the generalized `leadsVersion` pattern CLAUDE.md
// names as the reference): one module-level channel, opened on the first
// subscriber and torn down after the last, exposing a monotonically increasing
// counter components watch as a re-fetch trigger.
//
// `payment_rows` rides the same channel because a payment landing is what moves
// a COD work order between Balance due and Paid — the billing hub watched both
// tables before this hook existed, and the badge/banner refetch is cheap.
//
// Usage:
//   const v = useWoInvoicesVersion()
//   useEffect(() => { load() }, [load, v])
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

let channel: ReturnType<typeof supabase.channel> | null = null
let version = 0
const listeners = new Set<(v: number) => void>()

function open() {
  if (channel) return
  channel = supabase
    .channel('wo-invoices-shared')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, () => {
      version += 1
      listeners.forEach(fn => fn(version))
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_rows' }, () => {
      version += 1
      listeners.forEach(fn => fn(version))
    })
    .subscribe()
}

function closeIfIdle() {
  if (listeners.size > 0 || !channel) return
  supabase.removeChannel(channel)
  channel = null
}

export function useWoInvoicesVersion(): number {
  const [v, setV] = useState(version)

  useEffect(() => {
    // Adopt the current version on mount — a change may have landed between this
    // component's first render and its subscription.
    setV(version)
    listeners.add(setV)
    open()
    return () => {
      listeners.delete(setV)
      closeIfIdle()
    }
  }, [])

  return v
}
