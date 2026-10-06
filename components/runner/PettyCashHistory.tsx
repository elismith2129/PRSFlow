'use client'
// ─────────────────────────────────────────────────────────────────────────────
// PettyCashHistory — the last 14 days of a studio's box, read-only, for the
// runner (Eli, 2026-10-05).
//
// "If runners can see all the petty cash counts from previous days instead of
// their own so they can confirm previous money along with what's getting taken
// out. I feel this has caused some confusion on how to document certain losses
// and gains to the petty cash as sometimes it might not add up correctly."
//
// The runner page became a ONE-DAY ledger on 2026-09-23 because showing every
// entry ever made the opening balance a lie. That stays. But one day alone
// hides the trail: a runner whose opening looks wrong could see the last count
// and nothing about what happened between. This is that trail — per day: what
// the box opened at, each line in and out, what it should have closed at, what
// was counted, by whom, and the difference.
//
// RULES IT KEEPS
//   · READ-ONLY. Nothing here is a field. A runner who disagrees with a past
//     day counts the box tonight and types tonight's count — same as before.
//   · THE OPENING IS NOT RE-DERIVED HERE. Each day's opening comes from
//     petty_cash_opening() — the one SQL rule the runner page and the office
//     read — so the three cannot disagree.
//   · ONE FIXED BOX (CLAUDE.md → Locked Design Conventions). The list scrolls
//     inside it; a busy fortnight and an empty one are the same size.
//   · No channel of its own: the page already subscribes to both tables and
//     bumps `refresh`.
// Colour is status only (§5): in = booked green, out = hot, a count that does
// not match = warm. Balances are plain.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const DAYS_BACK = 14
const BOX_H = 320

type Line = { description: string; amount: number; type: 'in' | 'out' }
type Day = {
  date: string
  opening: number
  lines: Line[]
  expected: number
  counted: number | null
  countedBy: string | null
  note: string | null
  /** counted − expected; null when nobody counted that day. */
  diff: number | null
}

const money = (n: number) => `$${Math.abs(n).toFixed(2)}`
const round2 = (n: number) => Math.round(n * 100) / 100

/** "2026-09-20" → "Sat, Sep 20" — parsed by hand; new Date('2026-09-20') is
 *  UTC midnight, which is the 19th west of Greenwich. */
function fmtDay(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function daysBefore(today: string, n: number): string {
  const [y, m, d] = today.split('-').map(Number)
  const dt = new Date(y, m - 1, d - n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function PettyCashHistory({ studio, today, refresh }: { studio: string; today: string; refresh: number }) {
  const [days, setDays] = useState<Day[] | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const from = daysBefore(today, DAYS_BACK)
      const [{ data: ents }, { data: bals }] = await Promise.all([
        supabase.from('petty_cash_entries').select('date, description, amount, type, created_at')
          .eq('studio', studio).gte('date', from).lt('date', today).order('created_at'),
        supabase.from('petty_cash_balances').select('date, counted_close, counted_by_name, count_note')
          .eq('studio', studio).gte('date', from).lt('date', today),
      ])
      // Only days something happened on — a logged line or a count.
      const dates = Array.from(new Set([
        ...(ents ?? []).map((e: any) => String(e.date)),
        ...(bals ?? []).filter((b: any) => b.counted_close != null).map((b: any) => String(b.date)),
      ])).sort().reverse()
      const openings = await Promise.all(dates.map(d => supabase.rpc('petty_cash_opening', { p_studio: studio, p_date: d })))
      const out: Day[] = dates.map((date, i) => {
        const opening = Number(openings[i].data ?? 0)
        const lines: Line[] = (ents ?? []).filter((e: any) => String(e.date) === date).map((e: any) => ({
          description: (e.description ?? '').trim() || '(no description)',
          amount: Number(e.amount) || 0,
          type: e.type === 'in' ? 'in' : 'out',
        }))
        const expected = round2(opening + lines.reduce((t, l) => t + (l.type === 'in' ? l.amount : -l.amount), 0))
        const bal = (bals ?? []).find((b: any) => String(b.date) === date && b.counted_close != null) as any
        const counted = bal ? Number(bal.counted_close) : null
        return {
          date, opening, lines, expected, counted,
          countedBy: bal?.counted_by_name ?? null,
          note: (bal?.count_note ?? '').trim() || null,
          diff: counted == null ? null : round2(counted - expected),
        }
      })
      if (live) setDays(out)
    })()
    return () => { live = false }
  }, [studio, today, refresh])

  const label: React.CSSProperties = { fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }
  const mono: React.CSSProperties = { fontFamily: "'DM Mono', ui-monospace, monospace" }

  return (
    <div style={{
      background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 16,
      height: BOX_H, boxSizing: 'border-box', padding: '12px 14px 0',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ ...label, display: 'flex', justifyContent: 'space-between', flexShrink: 0, height: 20 }}>
        <span>Previous days</span>
        <span style={{ letterSpacing: '0.04em' }}>last {DAYS_BACK} · read only</span>
      </div>
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 16, scrollbarWidth: 'thin',
        WebkitMaskImage: 'linear-gradient(#000 calc(100% - 16px), transparent)',
        maskImage: 'linear-gradient(#000 calc(100% - 16px), transparent)',
      }}>
        {days === null ? (
          <div style={{ fontSize: 12, opacity: 0.5, padding: '20px 0', textAlign: 'center' }}>Loading…</div>
        ) : days.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.5, padding: '20px 0', textAlign: 'center' }}>Nothing logged or counted in the last {DAYS_BACK} days.</div>
        ) : days.map((d, i) => (
          <div key={d.date} style={{ padding: '10px 0', boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <b style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{fmtDay(d.date)}</b>
              {d.diff == null ? (
                <span style={{ fontSize: 10.5, color: 'var(--c-fg-3)' }}>not counted</span>
              ) : d.diff === 0 ? (
                <span style={{ fontSize: 10.5, color: 'var(--c-st-booked)', fontWeight: 700 }}>count matched</span>
              ) : (
                <span style={{ fontSize: 10.5, color: 'var(--c-st-warm)', fontWeight: 800 }}>{d.diff > 0 ? 'over' : 'short'} {money(d.diff)}</span>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--c-fg-2)', marginTop: 4 }}>
              <span>Opened at</span><span style={mono}>{money(d.opening)}</span>
            </div>
            {d.lines.map((l, j) => (
              <div key={j} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5, marginTop: 2 }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-fg-2)' }}>{l.description}</span>
                <span style={{ ...mono, flexShrink: 0, color: l.type === 'in' ? 'var(--c-st-booked)' : 'var(--c-st-hot)' }}>
                  {l.type === 'in' ? '+' : '−'}{money(l.amount)}
                </span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--c-fg-2)', marginTop: 2 }}>
              <span>Should have closed at</span><span style={mono}>{money(d.expected)}</span>
            </div>
            {d.counted != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700, marginTop: 2 }}>
                <span>Counted{d.countedBy ? ` · ${d.countedBy}` : ''}</span><span style={mono}>{money(d.counted)}</span>
              </div>
            )}
            {d.note && (
              <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontStyle: 'italic', marginTop: 3 }}>&ldquo;{d.note}&rdquo;</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
