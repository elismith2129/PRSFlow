'use client'
// ─────────────────────────────────────────────────────────────────────────────
// WO History modal — options A + C of docs/design-refs/wo-history-options.html
// (Eli's pick, 2026-09-01).
//
// A: the feed — one entry per save, sentences, newest first, with the ORIGINAL
//    work order (the creation snapshot) pinned as a card at the bottom. Scroll
//    to the end and you are holding the paper original.
// C: the compare — the Original card expands into Original ⇄ Now, changed
//    lines tinted warm. Same summarizer runs on both sides (lib/woActivity
//    summarizeForCompare) so the tint is an honest string comparison.
//
// Data comes from `wo_activity` via lib/woActivity; this component renders and
// never writes. Realtime per the standing rule: the fetch pairs with a
// subscription (channel wo-activity-<id>, unique per open work order).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useIsMobile } from '@/hooks/useIsMobile'
import { fmtTimestamp } from '@/lib/format'
import {
  fetchWoActivity, summarizeForCompare, fmtDay,
  type WoActivityEntry, type WoChange, type WoSnapshot, type WoCompareSummary,
} from '@/lib/woActivity'

const K: React.CSSProperties = { fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }

function ActorChip({ e }: { e: WoActivityEntry }) {
  const runner = e.source === 'runner'
  const original = e.kind === 'created'
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
      padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap',
      background: original ? 'var(--c-st-booked)' : runner ? 'var(--c-st-warm)' : 'var(--c-wash2)',
      color: original || runner ? 'var(--c-chip-ink)' : 'var(--c-fg)',
    }}>
      {original ? 'Original' : runner ? `Runner${e.actor_name ? ` · ${e.actor_name}` : ''}` : (e.actor_name || 'Office')}
    </span>
  )
}

function ChangeLine({ c }: { c: WoChange }) {
  const day = c.day ? ` (${fmtDay(c.day)})` : ''
  // Added/removed lines carry only one side; edits carry both.
  const oneSided = (c.from ?? '') === '' || (c.to ?? '') === ''
  return (
    <span style={{ display: 'inline-block', marginRight: 12 }}>
      <span style={{ color: 'var(--c-fg-2)' }}>{c.what}{day}:</span>{' '}
      {oneSided ? (
        <b style={{ fontWeight: 600 }}>{c.to || c.from}</b>
      ) : (
        <>
          <span style={{ opacity: 0.5, textDecoration: 'line-through' }}>{c.from}</span>
          <span style={{ opacity: 0.4, fontSize: 10 }}> → </span>
          <b style={{ fontWeight: 600 }}>{c.to}</b>
        </>
      )}
    </span>
  )
}

function CompareCol({ title, ts, sum, other }: {
  title: React.ReactNode; ts?: string; sum: WoCompareSummary; other: WoCompareSummary
}) {
  const rows: Array<{ k: string; key: keyof WoCompareSummary }> = [
    { k: 'Client', key: 'client' }, { k: 'Dates', key: 'dates' }, { k: 'Studio', key: 'studios' },
    { k: 'Times', key: 'times' }, { k: 'Rate', key: 'rate' }, { k: 'Staff', key: 'staff' },
  ]
  return (
    <div style={{ background: 'var(--c-wash)', borderRadius: 14, padding: '11px 13px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        {title}
        {ts && <span style={{ fontSize: 10, opacity: 0.45 }}>{ts}</span>}
      </div>
      {rows.map(r => {
        const changed = sum[r.key] !== other[r.key]
        return (
          <div key={r.key} style={{
            display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12,
            padding: '5px 6px', borderRadius: 6,
            background: changed ? 'color-mix(in srgb, var(--c-st-warm) 14%, transparent)' : undefined,
          }}>
            <span style={{ ...K, alignSelf: 'center', flexShrink: 0 }}>{r.k}</span>
            <span style={{ fontWeight: changed ? 700 : 500, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{sum[r.key]}</span>
          </div>
        )
      })}
    </div>
  )
}

export function WoHistoryModal({ woId, title, current, onClose }: {
  woId: string
  /** e.g. "WO-1042 · Interscope — SZA" */
  title: string
  /** The live WO, summarized by the CALLER via buildWoSnapshot — "now" in C. */
  current: WoSnapshot
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  const [entries, setEntries] = useState<WoActivityEntry[] | null>(null)
  const [compare, setCompare] = useState(false)

  const load = useCallback(async () => {
    setEntries(await fetchWoActivity(woId))
  }, [woId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = supabase
      .channel(`wo-activity-${woId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wo_activity', filter: `work_order_id=eq.${woId}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [woId, load])

  const created = entries?.find(e => e.kind === 'created' && e.snapshot) ?? null
  const feed = (entries ?? []).filter(e => e !== created)
  const origSum = created?.snapshot ? summarizeForCompare(created.snapshot) : null
  const nowSum = summarizeForCompare(current)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10035, background: 'rgba(0,0,0,0.45)',
        ...(isMobile ? {} : { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }),
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={isMobile
          ? { position: 'absolute', left: 0, right: 0, bottom: 0, background: 'var(--c-bg)', borderRadius: '22px 22px 0 0', padding: '12px 16px calc(14px + env(safe-area-inset-bottom))', maxHeight: '86%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }
          : { width: 'min(600px, 94vw)', maxHeight: '82vh', background: 'var(--c-bg)', borderRadius: 22, padding: '14px 18px 16px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', boxShadow: 'var(--c-softsh)' }}
      >
        {isMobile && <div style={{ width: 36, height: 4, borderRadius: 99, background: 'var(--c-wash2)', margin: '0 auto 10px', flexShrink: 0 }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexShrink: 0 }}>
          <span className="c-arch" style={{ fontSize: 15 }}>History</span>
          <span style={{ fontSize: 10, opacity: 0.45, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', background: 'none', color: 'var(--c-fg-3)', fontSize: 14, cursor: 'pointer', padding: '4px 6px' }}>✕</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
          {entries === null && <div style={{ fontSize: 12, opacity: 0.5, padding: '8px 2px' }}>Loading…</div>}
          {entries !== null && feed.length === 0 && !created && (
            <div style={{ fontSize: 12, opacity: 0.5, padding: '8px 2px' }}>
              No history yet — entries start with the first save after this feature shipped.
            </div>
          )}

          {feed.map(e => (
            <div key={e.id} style={{
              background: 'var(--c-wash)', borderRadius: 12, padding: '10px 13px', marginBottom: 7,
              borderLeft: e.after_invoice ? '3px solid var(--c-st-hot)' : undefined,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <ActorChip e={e} />
                <span style={{ fontSize: 10, opacity: 0.45 }}>{fmtTimestamp(e.at)}</span>
                {e.after_invoice && (
                  <span style={{ color: 'var(--c-st-hot)', fontSize: 10, fontWeight: 800 }} title="Changed after the invoice was attached — billing calls this drift">⚠ after invoicing</span>
                )}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                {/* The ladder, in house convention: runner submits · admin
                    reviews · owner approves. */}
                {e.kind === 'submitted' && (
                  <span style={{ color: 'var(--c-fg-2)' }}>
                    Submitted the day{e.changes?.[0]?.day ? <> — <b style={{ fontWeight: 600, color: 'var(--c-fg)' }}>{fmtDay(e.changes[0].day)}</b></> : ''}
                  </span>
                )}
                {e.kind === 'reviewed' && (
                  <span style={{ color: 'var(--c-fg-2)' }}>
                    {e.changes?.[0]?.what || 'Reviewed the day'}{e.changes?.[0]?.day ? <> — <b style={{ fontWeight: 600, color: 'var(--c-fg)' }}>{fmtDay(e.changes[0].day)}</b></> : ''}
                  </span>
                )}
                {e.kind === 'approved' && (
                  <span style={{ color: 'var(--c-fg-2)' }}>
                    Approved the invoice{e.changes?.[0]?.to ? <> — <b style={{ fontWeight: 600, color: 'var(--c-fg)' }}>{e.changes[0].to}</b></> : ''}
                  </span>
                )}
                {e.kind === 'rejected' && (
                  <span style={{ color: 'var(--c-fg-2)' }}>
                    Did not approve{e.changes?.[0]?.to ? <> — “<b style={{ fontWeight: 600, color: 'var(--c-fg)' }}>{e.changes[0].to}</b>”</> : ''}
                  </span>
                )}
                {e.kind === 'resubmitted' && (
                  <span style={{ color: 'var(--c-fg-2)' }}>Sent back for approval</span>
                )}
                {e.kind === 'saved' && (e.changes ?? []).map((c, i) => <ChangeLine key={i} c={c} />)}
              </div>
            </div>
          ))}

          {created?.snapshot && origSum && (
            <div style={{ background: 'var(--c-wash)', borderRadius: 12, padding: '11px 13px', borderLeft: '3px solid var(--c-st-booked)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <ActorChip e={created} />
                <span style={{ fontSize: 10, opacity: 0.45 }}>
                  Created {fmtTimestamp(created.at)}{created.actor_name ? ` by ${created.actor_name}` : ''}
                </span>
                <button
                  onClick={() => setCompare(v => !v)}
                  style={{ marginLeft: 'auto', background: 'var(--c-wash2)', color: 'var(--c-fg)', fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: 99, cursor: 'pointer' }}
                >
                  {compare ? 'Hide compare' : 'Compare to now'}
                </button>
              </div>
              {!compare ? (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr', gap: '8px 14px', marginTop: 10 }}>
                  {([['Client', origSum.client], ['Dates', origSum.dates], ['Studio', origSum.studios], ['Times', origSum.times], ['Rate', origSum.rate], ['Staff', origSum.staff]] as const).map(([k, v]) => (
                    <div key={k} style={{ minWidth: 0 }}>
                      <div style={K}>{k}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 1, overflowWrap: 'anywhere' }}>{v}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, marginTop: 10 }}>
                  <CompareCol
                    title={<span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 99, background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)' }}>Original</span>}
                    ts={fmtTimestamp(created.at)}
                    sum={origSum} other={nowSum}
                  />
                  <CompareCol
                    title={<span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 99, background: 'var(--c-wash2)' }}>Now</span>}
                    sum={nowSum} other={origSum}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
