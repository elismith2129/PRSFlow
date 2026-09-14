'use client'
// ─────────────────────────────────────────────────────────────────────────────
// useMyMemos — the memos addressed to me, live. ONE shared channel for
// `memos` + `memo_receipts` (the clients-shared pattern, hooks/
// useClientsVersion): the gate, the rail badge, the hub tile and the archive
// all read this, and none of them may open a second channel.
// (No writes in this file — `listeners.delete()` is a Set, which the selftest's
//  silent-write regex cannot tell from a Supabase delete; dbResult lives in
//  lib/memos where the writes are.)
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchMyMemos, type MyMemo } from '@/lib/memos'
import type { UserProfile } from '@/lib/supabase'

let channel: ReturnType<typeof supabase.channel> | null = null
let version = 0
const listeners = new Set<(v: number) => void>()

function open() {
  if (channel) return
  const bump = () => { version += 1; listeners.forEach(fn => fn(version)) }
  channel = supabase
    .channel('memos-shared')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'memos' }, bump)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'memo_receipts' }, bump)
    .subscribe()
}
function closeIfIdle() {
  if (listeners.size > 0 || !channel) return
  supabase.removeChannel(channel)
  channel = null
}

export function useMemosVersion(): number {
  const [v, setV] = useState(version)
  useEffect(() => {
    listeners.add(setV)
    open()
    return () => { listeners.delete(setV); closeIfIdle() }
  }, [])
  return v
}

/** Pass the profile (null while it resolves — nothing is fetched until it does). */
export function useMyMemos(me: Pick<UserProfile, 'id' | 'role'> | null | undefined): { memos: MyMemo[]; loading: boolean; reload: () => Promise<void> } {
  const v = useMemosVersion()
  const [memos, setMemos] = useState<MyMemo[]>([])
  const [loading, setLoading] = useState(true)
  const id = me?.id ?? null
  const role = me?.role ?? null
  const reload = useCallback(async () => {
    if (!id || !role) return
    setMemos(await fetchMyMemos({ id, role }))
    setLoading(false)
  }, [id, role])
  useEffect(() => { reload() }, [reload, v])
  return { memos, loading, reload }
}
