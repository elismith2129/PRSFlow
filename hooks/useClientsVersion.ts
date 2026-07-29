'use client'
// One shared `clients` realtime channel for the whole app.
//
// Why this exists: the CRM now has three surfaces that each need to know when a
// `clients` row changes — the pending-registration banner, the REGISTRATIONS
// list, and the client list itself. Giving each its own subscription would break
// the standing rule against duplicate channels on one table per page, and would
// fire three re-fetches for every single change.
//
// This is the same shape as WebInquiryProvider's `leadsVersion` (the pattern
// CLAUDE.md names as the reference), minus the React context: one module-level
// channel, opened on the first subscriber and torn down after the last one
// leaves, exposing a monotonically increasing counter that components watch as a
// re-fetch trigger.
//
// Usage:
//   const v = useClientsVersion()
//   useEffect(() => { load() }, [load, v])
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

let channel: ReturnType<typeof supabase.channel> | null = null
let version = 0
const listeners = new Set<(v: number) => void>()

function open() {
  if (channel) return
  channel = supabase
    .channel('clients-shared')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
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

export function useClientsVersion(): number {
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
