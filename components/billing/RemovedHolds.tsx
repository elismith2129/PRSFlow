'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Removed holds — the billing hub's tab beside Closed (Eli, 2026-10-07).
//
// "I want on the billing hub a 'removed holds' where they will all live. Put
// beside closed."
//
// A hold taken off the calendar — from its work order's "Remove hold", or from
// this hub's own Delete — is kept, and this is the list: which hold, which
// days, who, when. Recover puts it back:
//   · a WHOLE hold comes back exactly as it was (same WO number, same cards);
//   · removed DAYS go back onto the hold they came from, each as its own
//     one-day card until that work order is next saved.
//
// It is the same log as "Deleted work orders" (deleted_work_orders), split by
// kind: holds here, where they are looked for weekly; real work orders and
// blocks stay under the page ⋯, where they are looked for a few times a year.
//
// The page owns the rows (it needs the count for the tab); this only draws
// them. Owner / manager / billing — the log's own read rule.
//
// FIXED SIZE (house rule): the list is one height and scrolls inside.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { toast } from '@/components/ui/Toaster'
import { recoverDeleted, type DeletedEntry } from '@/lib/deleteSession'
import { fmtWhen, prettyDetail } from '@/components/billing/DeletedLog'

const LIST_H = 420

/** "2 days" for some-days entries (the detail line ends "2 of 5 days"); "Whole hold" otherwise. */
function chipFor(r: DeletedEntry): string {
  if (r.kind !== 'hold_days') return 'Whole hold'
  const m = /(\d+) of \d+ days/.exec(r.detail)
  const n = m ? Number(m[1]) : 0
  return n > 0 ? `${n} ${n === 1 ? 'day' : 'days'}` : 'Days'
}

export function RemovedHoldsPanel({ rows, loading, onRecovered }: {
  rows: DeletedEntry[]
  loading: boolean
  /** The hub reloads — the hold is back in its bucket. */
  onRecovered: () => void
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function recover(r: DeletedEntry) {
    if (busyId) return
    setBusyId(r.id)
    const res = await recoverDeleted(r.id)
    setBusyId(null)
    setConfirmId(null)
    if (!res.ok) { toast(`Could not recover — ${res.reason ?? 'unknown error'}`); return }
    toast(r.kind === 'hold_days'
      ? `${r.wo_number || 'The hold'} — the days are back on the calendar`
      : `${r.wo_number || r.title || 'The hold'} is back`)
    onRecovered()
  }

  return (
    <div className="c-panel">
      <div className="c-lozenge">
        <b>Removed holds</b>
        <span className="c-ct">{rows.filter(r => !r.recovered_at).length}</span>
      </div>

      <div style={{ height: LIST_H, maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {loading ? (
          <div className="c-bempty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="c-bempty">No holds have been removed.</div>
        ) : rows.map(r => {
          const recovered = !!r.recovered_at
          const confirming = confirmId === r.id
          const busy = busyId === r.id
          return (
            <div key={r.id} style={{ flexShrink: 0, display: 'flex', gap: 10, alignItems: 'center', padding: '9px 10px', borderRadius: 12, background: confirming ? 'var(--c-wash2)' : 'var(--c-wash)', opacity: recovered ? 0.55 : 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                  {r.wo_number && (
                    <span className="c-mono" style={{ fontSize: 10.5, color: 'var(--c-fg-2)', flexShrink: 0 }}>{r.wo_number}</span>
                  )}
                  <b style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || 'Hold'}</b>
                </div>
                {r.detail && (
                  <div style={{ fontSize: 11, color: 'var(--c-fg-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={prettyDetail(r.detail)}>
                    {prettyDetail(r.detail)}
                  </div>
                )}
                <div style={{ fontSize: 10.5, color: 'var(--c-fg-3)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Removed by {r.deleted_by_name || 'someone'} · {fmtWhen(r.deleted_at)}
                  {recovered && ` · recovered by ${r.recovered_by_name || 'someone'} ${fmtWhen(r.recovered_at as string)}`}
                </div>
              </div>
              {!confirming && (
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', background: 'var(--c-wash2)', padding: '3px 8px', borderRadius: 99, flexShrink: 0, whiteSpace: 'nowrap' }}>{chipFor(r)}</span>
              )}
              {recovered ? (
                <span style={{ fontSize: 10.5, color: 'var(--c-fg-3)', flexShrink: 0 }}>Recovered</span>
              ) : confirming ? (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button type="button" className="c-btn" disabled={busy} onClick={() => recover(r)}>{busy ? 'Recovering…' : 'Put it back'}</button>
                  <button type="button" className="c-soft" disabled={busy} onClick={() => setConfirmId(null)}>Cancel</button>
                </div>
              ) : (
                <button type="button" className="c-soft" disabled={!!busyId} onClick={() => setConfirmId(r.id)} style={{ flexShrink: 0 }}>Recover</button>
              )}
            </div>
          )
        })}
      </div>

      <div className="c-bnote">
        A hold taken off the calendar lands here — the whole hold, or just the days that were removed. Recover puts it back. Real work orders that were deleted are under the page ⋯ → Deleted work orders.
      </div>
    </div>
  )
}
