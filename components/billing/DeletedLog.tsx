'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Deleted work orders — the log, and the way back (Eli, 2026-10-05).
//
// "I just want an in-app log for all deletions and a recover function."
//
// Every delete in the app goes through delete_with_archive() (see
// lib/deleteSession.ts), which keeps a full copy before it removes anything.
// This is that list: what was deleted, by whom, when — and one Recover button
// that puts it back exactly as it was (same WO number, same cards, same days,
// same payments, same history).
//
// Lives under the billing hub's page "⋯", not on the rail: it is opened a few
// times a year, and Eli's standing rule is no new pages for rare things.
// Owner / manager / billing only — the same three who can delete. The table
// has no write policy, so nothing here (or anywhere in the app) can edit or
// empty the log.
//
// FIXED SIZE (house rule): the list is one height and scrolls inside; the
// modal is the same size with one entry or a hundred.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from '@/components/ui/Toaster'
import { fetchDeleted, recoverDeleted, type DeletedEntry } from '@/lib/deleteSession'

const LIST_H = 380

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** The database writes the detail line with plain dates ("2026-09-23 to
 *  2026-10-03") — shown here the way the rest of the hub shows them. */
function prettyDetail(detail: string): string {
  return detail
    .replace(/(\d{4})-(\d{2})-(\d{2})/g, (_m, _y, mo, d) => `${MONTHS[Number(mo) - 1] ?? mo} ${Number(d)}`)
    .replace(/ to /g, ' – ')
}

export function DeletedLogModal({ onClose, onRecovered }: {
  onClose: () => void
  /** The hub reloads — the recovered work order is back in its bucket. */
  onRecovered: () => void
}) {
  const [rows, setRows] = useState<DeletedEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRows(await fetchDeleted())
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('billing-deleted-log')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deleted_work_orders' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  async function recover(r: DeletedEntry) {
    if (busyId) return
    setBusyId(r.id)
    const res = await recoverDeleted(r.id)
    setBusyId(null)
    setConfirmId(null)
    if (!res.ok) { toast(`Could not recover — ${res.reason ?? 'unknown error'}`); return }
    toast(`${r.wo_number || r.title || 'It'} is back`)
    await load()
    onRecovered()
  }

  return (
    <div className="c-bmodal-wrap" onClick={onClose}>
      <div className="c-bmodal" style={{ maxWidth: 560, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="c-label" style={{ marginBottom: 2 }}>Billing</div>
            <div className="c-arch" style={{ fontSize: 15, lineHeight: 1.25 }}>Deleted work orders</div>
            <div style={{ fontSize: 10.5, color: 'var(--c-fg-3)', marginTop: 2 }}>
              Everything deleted is kept here. Recover puts it back exactly as it was.
            </div>
          </div>
          <button type="button" className="c-x" onClick={onClose} style={{ marginLeft: 'auto', fontSize: 16, flexShrink: 0 }} aria-label="Close">×</button>
        </div>

        <div style={{ height: LIST_H, maxHeight: '62vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading ? (
            <div className="c-sub" style={{ padding: '8px 2px' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div className="c-sub" style={{ padding: '8px 2px' }}>Nothing has been deleted.</div>
          ) : rows.map(r => {
            const recovered = !!r.recovered_at
            const confirming = confirmId === r.id
            const busy = busyId === r.id
            return (
              <div key={r.id} style={{ flexShrink: 0, display: 'flex', gap: 10, alignItems: 'center', padding: '9px 10px', borderRadius: 12, background: confirming ? 'var(--c-wash2)' : 'var(--c-wash)', opacity: recovered ? 0.55 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                    {r.wo_number && r.kind === 'work_order' && (
                      <span className="c-mono" style={{ fontSize: 10.5, color: 'var(--c-fg-2)', flexShrink: 0 }}>{r.wo_number}</span>
                    )}
                    <b style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || (r.kind === 'block' ? 'Block' : 'Work order')}</b>
                  </div>
                  {r.detail && (
                    <div style={{ fontSize: 11, color: 'var(--c-fg-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={prettyDetail(r.detail)}>
                      {prettyDetail(r.detail)}
                    </div>
                  )}
                  <div style={{ fontSize: 10.5, color: 'var(--c-fg-3)', marginTop: 3 }}>
                    Deleted by {r.deleted_by_name || 'someone'} · {fmtWhen(r.deleted_at)}
                    {recovered && ` · recovered by ${r.recovered_by_name || 'someone'} ${fmtWhen(r.recovered_at as string)}`}
                  </div>
                </div>
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
      </div>
    </div>
  )
}
