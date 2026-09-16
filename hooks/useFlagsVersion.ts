'use client'
// One shared realtime channel for the flag row (`dashboard_tasks`) and its
// notes (`dashboard_task_comments`) — the useClientsVersion pattern. The
// Flags page, and later a rail badge, watch this counter and re-fetch; the
// standing rule is one channel per table per page, so nobody opens another.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

let channel: ReturnType<typeof supabase.channel> | null = null
let version = 0
const listeners = new Set<(v: number) => void>()

function bump() {
  version += 1
  listeners.forEach(fn => fn(version))
}
function open() {
  if (channel) return
  channel = supabase
    .channel('flags-shared')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_tasks' }, bump)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_task_comments' }, bump)
    .subscribe()
}
function closeIfIdle() {
  if (listeners.size > 0 || !channel) return
  supabase.removeChannel(channel)
  channel = null
}

export function useFlagsVersion(): number {
  const [v, setV] = useState(version)
  useEffect(() => {
    setV(version)
    listeners.add(setV)
    open()
    return () => { listeners.delete(setV); closeIfIdle() }
  }, [])
  return v
}
