import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { dbResult } from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// DELETING A WORK ORDER — one door, always kept, always recoverable.
// (Eli, 2026-10-05, after WO-1240 — a week of Molly Santana sessions,
// runner-submitted and invoiced — vanished with no trace.)
//
// "Get rid of the delete button that's on the WOs. Only a delete button from
// the billing hub… I do want Lori and Fernando to be able to do this. I just
// want an in-app log for all deletions and a recover function."
//
// THE RULES THIS FILE HOLDS:
//   · A SESSION's work order is deleted from the billing hub and nowhere else
//     (owner / manager / billing). The WO popup has no Delete for a session.
//   · A BLOCK (Tour / Tech / Open hours / Tenant) never reaches the billing
//     hub, so its popup keeps a Delete — deleteBlock() below.
//   · NOTHING here deletes rows itself. Both paths call delete_with_archive()
//     (migration 20261005180000): the snapshot and the delete are one
//     transaction, so nothing can be deleted without being kept. Do not add a
//     client-side `.delete()` on work_orders or bookings anywhere — that is
//     the hole this closed.
//   · The log (deleted_work_orders) is read-only from the app; Recover puts a
//     snapshot back with its original ids.
//
// A HOLD IS THE EXCEPTION, AND ONLY A HOLD (Eli, 2026-10-07: "how do we delete
// holds? since we removed the delete button we can't do that anymore from the
// cal. we need to be able to do that."). A TENTATIVE session's work order card
// has "Remove hold" — removeHold() below → remove_hold() (migration
// 20261007120000). It takes off the days that were ticked, or the whole hold
// when every day was; it refuses anything with an invoice, a payment, or a
// confirmed / submitted / reviewed day; and it keeps everything it removes in
// the same log, as kind 'hold' or 'hold_days'. Assistant managers may use it
// (they place holds) — they still cannot delete a work order any other way.
// Removed holds have their own tab in the billing hub, beside Closed.
// ─────────────────────────────────────────────────────────────────────────────

/** The billing hub's Delete WO: the work order, every card, every row — kept
 *  in the deleted log first. Returns the reason on failure so the caller can
 *  say it; nothing here is silent. */
export async function deleteWorkOrderEverywhere(woId: string): Promise<{ ok: boolean; reason?: string; kind?: string }> {
  const { data, error } = await supabase.rpc('delete_with_archive', { p_wo_id: woId, p_booking_id: null })
  if (error) return { ok: false, reason: error.message }
  // 'hold' when it was a tentative session — it is then listed under the
  // hub's Removed holds tab, not under ⋯ → Deleted work orders.
  return { ok: true, kind: (data as { kind?: string } | null)?.kind }
}

/** The WO popup's Delete, for a BLOCK only (Tour / Tech / Open hours /
 *  Tenant): that card, plus any dormant work order still attached to it.
 *  Kept in the same log. False (with a toast) if it did not happen. */
export async function deleteBlock(b: Booking): Promise<boolean> {
  const { error } = await supabase.rpc('delete_with_archive', { p_wo_id: null, p_booking_id: b.id })
  return dbResult('Deleting block', error)
}

/** The card's "Remove hold". `dates` = the days being taken off
 *  ('YYYY-MM-DD'); `whole` = the person chose the whole hold, and `dates` is
 *  then every day the pop-up listed. BOTH are always sent: the database
 *  checks them against what the hold has now and refuses if they disagree
 *  (someone else added or removed a day meanwhile) — it never works out
 *  "whole" for itself. It also decides what is removable at all, and says why
 *  when something is not. `whole` comes back true when the work order itself
 *  went — the caller closes rather than re-saves. */
export async function removeHold(woId: string, dates: string[], whole: boolean): Promise<{ ok: boolean; whole?: boolean; days?: string[]; reason?: string }> {
  const { data, error } = await supabase.rpc('remove_hold', { p_wo_id: woId, p_dates: dates, p_whole: whole })
  if (error) return { ok: false, reason: error.message }
  const d = (data ?? {}) as { whole?: boolean; days?: string[] }
  return { ok: true, whole: !!d.whole, days: Array.isArray(d.days) ? d.days : undefined }
}

/** One line of the deleted log. The snapshot itself is never loaded into the
 *  page — it can be large, and Recover works from the id. */
export type DeletedEntry = {
  id: string
  deleted_at: string
  deleted_by_name: string
  /** 'hold' = a whole tentative hold; 'hold_days' = some days taken off one. */
  kind: 'work_order' | 'block' | 'hold' | 'hold_days'
  wo_number: string | null
  title: string
  detail: string
  recovered_at: string | null
  recovered_by_name: string | null
}

/** The log, newest first. 200 is years of deletes at the rate they happen.
 *  Two shelves, one table: 'deleted' = work orders and blocks (the page ⋯
 *  modal); 'holds' = removed holds and removed hold days (the hub's tab). */
export async function fetchDeleted(which: 'deleted' | 'holds' = 'deleted'): Promise<DeletedEntry[]> {
  const { data, error } = await supabase
    .from('deleted_work_orders')
    .select('id, deleted_at, deleted_by_name, kind, wo_number, title, detail, recovered_at, recovered_by_name')
    .in('kind', which === 'holds' ? ['hold', 'hold_days'] : ['work_order', 'block'])
    .order('deleted_at', { ascending: false })
    .limit(200)
  if (!dbResult(which === 'holds' ? 'Loading removed holds' : 'Loading deleted work orders', error)) return []
  return (data ?? []) as DeletedEntry[]
}

/** Put a deleted entry back. The database refuses (and says why) if it was
 *  already recovered or the work order exists again. */
export async function recoverDeleted(id: string): Promise<{ ok: boolean; reason?: string }> {
  const { error } = await supabase.rpc('recover_deleted_work_order', { p_id: id })
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}
