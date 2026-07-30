'use client'
// Shared state for DEV → Testing verdicts.
//
// Both the Testing page and the floating tester panel read and write the same
// `test_results` rows. The write path (upsert shape, conflict target, optimistic
// update, rollback on failure) lives HERE once — two copies of it is exactly the
// drift risk that has bitten this codebase before, and this one writes data a
// human can't easily reconstruct.
//
// Unlock state also lives here: the PIN is entered once on the DEV page, and the
// floating panel — mounted app-wide, including on runner routes — has to know
// about it from a different part of the tree. sessionStorage + a window event is
// enough; it's a soft gate, not security.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'

export const TESTING_PIN = '4321'
const PIN_OK_KEY = 'dev_testing_unlocked'
const ACTIVE_BATCH_KEY = 'dev_testing_batch'
const UNLOCK_EVENT = 'prsflo-testing-unlock'

export type Verdict = {
  status: 'pass' | 'fail'
  note: string | null
  tested_by: string | null
  updated_at: string
}
export type ResultMap = Record<string, Verdict>

// ── Unlock ──────────────────────────────────────────────────────────────────
export function unlockTesting(batchId?: string) {
  try {
    sessionStorage.setItem(PIN_OK_KEY, '1')
    if (batchId) sessionStorage.setItem(ACTIVE_BATCH_KEY, batchId)
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(UNLOCK_EVENT))
}

export function lockTesting() {
  try {
    sessionStorage.removeItem(PIN_OK_KEY)
    sessionStorage.removeItem(ACTIVE_BATCH_KEY)
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(UNLOCK_EVENT))
}

export function setActiveBatch(batchId: string | null) {
  try {
    if (batchId) sessionStorage.setItem(ACTIVE_BATCH_KEY, batchId)
    else sessionStorage.removeItem(ACTIVE_BATCH_KEY)
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(UNLOCK_EVENT))
}

// Unlock flag + which batch is being worked, kept in sync across the tree.
export function useTestingSession(): { unlocked: boolean; activeBatchId: string | null } {
  const [state, setState] = useState<{ unlocked: boolean; activeBatchId: string | null }>({
    unlocked: false, activeBatchId: null,
  })

  useEffect(() => {
    const read = () => {
      try {
        setState({
          unlocked: sessionStorage.getItem(PIN_OK_KEY) === '1',
          activeBatchId: sessionStorage.getItem(ACTIVE_BATCH_KEY),
        })
      } catch {
        setState({ unlocked: false, activeBatchId: null })
      }
    }
    read()
    window.addEventListener(UNLOCK_EVENT, read)
    return () => window.removeEventListener(UNLOCK_EVENT, read)
  }, [])

  return state
}

// ── Verdicts ────────────────────────────────────────────────────────────────
// Every mount needs its OWN channel name. This hook runs in three places at once
// (a card per batch, the review view, and the floating panel), and naming the
// channel after the batch alone produced duplicate channels on one table — against
// the standing rule, and the likely cause of the error screen Eli hit.
let channelSeq = 0

export function useTestResults(batchId: string | null) {
  const [results, setResults] = useState<ResultMap>({})
  const [loading, setLoading] = useState(true)
  const channelIdRef = useRef<number | null>(null)
  if (channelIdRef.current === null) channelIdRef.current = ++channelSeq

  const load = useCallback(async () => {
    if (!batchId) { setResults({}); setLoading(false); return }
    const { data } = await supabase
      .from('test_results')
      .select('item_id, status, note, tested_by, updated_at')
      .eq('batch_id', batchId)
    const map: ResultMap = {}
    for (const r of data || []) {
      map[(r as any).item_id] = {
        status: (r as any).status,
        note: (r as any).note,
        tested_by: (r as any).tested_by,
        updated_at: (r as any).updated_at,
      }
    }
    setResults(map)
    setLoading(false)
  }, [batchId])

  useEffect(() => { load() }, [load])

  // Standing rule: every fetch pairs with a realtime subscription. Here it also
  // means the page and the floating panel stay in step with each other, and Eli
  // watching on a laptop sees verdicts land as the tester works.
  useEffect(() => {
    if (!batchId) return
    const channel = supabase
      .channel(`test-results-${batchId}-${channelIdRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'test_results' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [batchId, load])

  // Record (or change) a verdict. Optimistic — a tester tapping through 40 items
  // shouldn't wait on a round trip each time — and reloads to undo if the write
  // fails, so the UI never claims something was recorded when it wasn't.
  const save = useCallback(async (
    itemId: string,
    status: 'pass' | 'fail',
    note: string | null,
    testedBy: string,
  ) => {
    if (!batchId) return
    const updated_at = new Date().toISOString()
    setResults(prev => ({ ...prev, [itemId]: { status, note, tested_by: testedBy, updated_at } }))
    const { error } = await supabase
      .from('test_results')
      .upsert({ batch_id: batchId, item_id: itemId, status, note, tested_by: testedBy, updated_at },
              { onConflict: 'batch_id,item_id' })
    if (!dbResult('Saving test result', error)) load()
  }, [batchId, load])

  return { results, loading, save, reload: load }
}

// Progress for a batch — one definition so the cards, the page and the floating
// panel can never disagree about whether a batch is finished.
export function batchProgress(itemIds: string[], results: ResultMap) {
  const passed = itemIds.filter(id => results[id]?.status === 'pass').length
  const failed = itemIds.filter(id => results[id]?.status === 'fail').length
  const tested = passed + failed
  return {
    passed,
    failed,
    tested,
    total: itemIds.length,
    untested: itemIds.length - tested,
    // "Done" means every item has a verdict — including the ones that failed.
    // A batch with failures is finished being TESTED; it just isn't all green.
    complete: itemIds.length > 0 && tested === itemIds.length,
  }
}
