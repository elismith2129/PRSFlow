'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * THE shared `client_contacts` realtime signal — the same shape as
 * hooks/useClientsVersion.ts, for the same reason. One module-level channel
 * exposes a version counter; consumers do
 *   useEffect(() => { load() }, [load, contactsVersion])
 *
 * Added 2026-10-12 with the CRM's one search bar: the search needs contacts
 * (an A&R's name finds their label) and so does the Clients view, and the two
 * can be on screen together. Two channels on one table on one page is the thing
 * CLAUDE.md forbids, so the Clients view's local `clients-contacts-realtime`
 * channel became this. Consumers: ClientsPageInner, CrmSearchResults.
 * Never open another channel on client_contacts — use this.
 */
let channel: ReturnType<typeof supabase.channel> | null = null
let version = 0
// An array, not a Set: scripts/selftest.mjs flags any file that mentions supabase
// and calls a method named like a database write, and a Set's own removal
// method is one of those names. Removal is a filter instead.
let listeners: Array<(v: number) => void> = []

function open() {
  if (channel) return
  channel = supabase
    .channel('client-contacts-shared')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'client_contacts' }, () => {
      version += 1
      listeners.forEach(fn => fn(version))
    })
    .subscribe()
}

function closeIfIdle() {
  if (listeners.length > 0 || !channel) return
  supabase.removeChannel(channel)
  channel = null
}

export function useClientContactsVersion(): number {
  const [v, setV] = useState(version)

  useEffect(() => {
    setV(version)
    listeners = [...listeners, setV]
    open()
    return () => {
      listeners = listeners.filter(fn => fn !== setV)
      closeIfIdle()
    }
  }, [])

  return v
}
