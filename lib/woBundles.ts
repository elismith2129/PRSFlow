// ─────────────────────────────────────────────────────────────────────────────
// lib/woBundles — the whole-building BLANKET RATE (Eli, 2026-09-03; ruled
// Option B in docs/design-refs/wo-blanket-rate-options.html; built 2026-09-14
// after it had cost manual work twice — see supabase/one-off/
// 20260910_concord_blanket_rebuild.sql).
//
// A client takes several rooms for one custom price per day. It is ONE line on
// the invoice and N rows in the app. THE DAY HEADER OWNS THE PRICE: a bundle is
// (work_order_id, date, amount) — wo_rate_bundles — and every room row on that
// day is a member (studio_time_rows.bundle_id). Membership is the day's rooms
// BY CONSTRUCTION, which is what makes option C's silent-overcharge state
// (four rooms bundled, the fifth forgotten at rack on top) unreachable.
//
// THE WHOLE TRICK: each member row's `charge` becomes its ALLOCATED SHARE of
// the bundle, pro-rata by rack (the row's own rate_daily). computeWoTotals
// already sums charge + ot_charge, and the daily numbers, Financials, SRS,
// balances and the billing ladder all read from there — allocate into `charge`
// and every one of them is correct with zero downstream changes.
//
// ⚠ THE LANDMINE, AND HOW IT IS DEFUSED. Normally a day row's charge derives
// from rate_daily (normalizeStRow, updateStRow, toggleRowRateType, addStRows,
// the batch editor, the monthly split — six paths, and more will be added).
// Guarding each one is exactly the "edit both blocks" trap that bit twice on
// 2026-09-10. So the invariant is not PROTECTED, it is RE-ESTABLISHED:
// WorkOrderPopup runs allocateBundleShares after EVERY rows/bundles change (an
// effect), and it writes the share back over whatever a recompute produced.
// A recompute can wipe the allocation for one render; it cannot survive it.
//
// The row keeps rate_daily = RACK. That is deliberate and load-bearing:
//   · rack is the allocation basis, so editing the bundle amount re-allocates
//     live with nothing to look up;
//   · the day-row OT rate is rack ÷ 10 (DAY_HOUR_RATIO), and OT on a bundled
//     day is priced off RACK, never the share (ruling 5: "OT is rack").
// (The 2026-09-10 one-off wrote the SHARE into rate_daily because this feature
//  did not exist; those rows are not bundled and keep working unchanged.)
//
// INVARIANT: Σ(shares) === bundle.amount to the penny. Shares are floored to
// cents and the remainder lands on the largest rack. Proven necessary: against
// the stale rate sheet the rounded shares summed to $6,669.99 on live numbers.
// ─────────────────────────────────────────────────────────────────────────────

import { stripCurrency } from '@/lib/format'

export type WoRateBundle = {
  id: string
  work_order_id: string
  date: string
  /** Display string on the screen ("$6,670"); numeric in the DB. */
  amount: string
  label: string
}

/** The fields of a studio-time row that allocation reads and writes. */
export type BundleRow = {
  id: string
  studio: string
  date: string
  bundle_id: string | null
  row_rate_type: 'hour' | 'day'
  rate_daily: string
  charge: number | null
}

function money(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return isFinite(v) ? v : 0
  return stripCurrency(v) ?? 0
}

/** Pro-rata shares in cents. `racks` are the members' rack rates in row order. */
export function proRataShares(amount: number, racks: number[]): number[] {
  const n = racks.length
  if (n === 0) return []
  const totalCents = Math.round(amount * 100)
  const rackSum = racks.reduce((s, r) => s + (r > 0 ? r : 0), 0)
  // No rack anywhere (rates not typed yet) → even split, so the day still
  // totals the blanket and nobody is billed $0 while rates are being filled in.
  const weights = rackSum > 0 ? racks.map(r => (r > 0 ? r : 0) / rackSum) : racks.map(() => 1 / n)
  const floors = weights.map(w => Math.floor(totalCents * w))
  let rem = totalCents - floors.reduce((s, c) => s + c, 0)
  // Remainder to the largest rack (ties → first). One cent at a time, in case
  // floor error exceeds a cent across many rooms.
  const order = racks.map((r, i) => i).sort((a, b) => racks[b] - racks[a])
  let k = 0
  while (rem > 0) { floors[order[k % n]] += 1; rem -= 1; k += 1 }
  return floors.map(c => c / 100)
}

/**
 * Re-establish every bundle's allocation over its member rows.
 *
 * Returns the SAME array reference when nothing changes, so an effect can
 * `if (next !== rows) setRows(next)` without looping. Membership is by
 * (bundle.date === row.date) for every room row (studio non-empty): a row
 * added to a bundled day joins it; a row whose date leaves the bundle's day
 * leaves the bundle. Member rows are forced to 'day' — a bundle is a day
 * price, and an hourly member has no rack to allocate by.
 */
export function allocateBundleShares<R extends BundleRow>(rows: R[], bundles: WoRateBundle[]): R[] {
  if (bundles.length === 0 && !rows.some(r => r.bundle_id)) return rows
  const byDate = new Map<string, WoRateBundle>()
  for (const b of bundles) if (b.date) byDate.set(b.date, b)
  let changed = false
  const out = rows.map(r => r)

  // 1. Membership by day, for room rows only. Staff rows (studio '') never join.
  out.forEach((r, i) => {
    const isRoom = (r.studio || '').trim() !== ''
    const want = isRoom && r.date ? (byDate.get(r.date)?.id ?? null) : null
    if ((r.bundle_id ?? null) !== want) {
      out[i] = { ...r, bundle_id: want }
      changed = true
    }
  })

  // 2. Shares per bundle, pro-rata by rack (rate_daily), remainder to largest.
  for (const b of bundles) {
    const idx = out.map((r, i) => (r.bundle_id === b.id ? i : -1)).filter(i => i >= 0)
    if (idx.length === 0) continue
    const racks = idx.map(i => money(out[i].rate_daily))
    const shares = proRataShares(money(b.amount), racks)
    idx.forEach((i, k) => {
      const r = out[i]
      const share = shares[k]
      if (r.row_rate_type !== 'day' || (r.charge ?? null) !== share) {
        out[i] = { ...r, row_rate_type: 'day', charge: share }
        changed = true
      }
    })
  }
  return changed ? out : rows
}

/** What the day header reads out: rooms, rack total, discount off rack. */
export function bundleReadout(bundle: WoRateBundle, rows: BundleRow[]): {
  rooms: number
  rackTotal: number
  amount: number
  offRackPct: number | null
  shareSum: number
} {
  const members = rows.filter(r => r.bundle_id === bundle.id)
  const rackTotal = members.reduce((s, r) => s + money(r.rate_daily), 0)
  const amount = money(bundle.amount)
  const shareSum = parseFloat(members.reduce((s, r) => s + (r.charge ?? 0), 0).toFixed(2))
  const offRackPct = rackTotal > 0 && amount > 0 ? parseFloat(((1 - amount / rackTotal) * 100).toFixed(2)) : null
  return { rooms: members.length, rackTotal, amount, offRackPct, shareSum }
}
