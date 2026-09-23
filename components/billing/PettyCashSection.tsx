'use client'
// ─────────────────────────────────────────────────────────────────────────────
// PETTY CASH — the month view (Eli's accountant, 2026-09-23: "is there a way to
// print the logs at the end of each month? I need to enter the transactions on
// QuickBooks and reconcile the accounts").
//
// WHY IT EXISTS. Petty cash was built as a nightly runner checklist. The only
// office windows onto it were the dashboard's daily-ops modal and Admin → Ops
// Log, BOTH of which show ONE DAY. There was no range, no totals, no export —
// so a month-end reconciliation meant opening thirty modals and retyping.
//
// WHAT AN ACCOUNTANT NEEDS that a runner does not: a running balance down the
// page, the period's opening and closing as bookends, and the nights the box
// did not match with the counter's own words attached. The variance lines are
// the point — a list of transactions that doesn't tie out to the cash on hand
// is not a reconciliation, it's a list.
//
// The opening for the period comes from petty_cash_opening() — the same SQL
// the runner page and the daily-ops modal read (v1.39.0), so the accountant's
// figure and the runner's figure cannot disagree.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'

const STUDIOS = [
  { key: 'paramount', label: 'Paramount', short: 'PRS' },
  { key: 'ameraycan', label: 'Ameraycan', short: 'ARS' },
  { key: 'encore',    label: 'Encore',    short: 'ERS' },
  { key: 'track',     label: 'Track',     short: 'TRS' },
] as const
type StudioKey = typeof STUDIOS[number]['key']

type Entry = { id: string; date: string; description: string | null; amount: number; type: 'in' | 'out'; created_at: string }
type Bal = { date: string; counted_close: number | null; count_note: string | null; counted_by_name: string | null }

/** A transaction line with the balance AFTER it — the column an accountant reads. */
type Line = Entry & { balance: number }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function monthBounds(ym: string): { from: string; to: string; nextFrom: string } {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const p = (n: number) => String(n).padStart(2, '0')
  return { from: `${y}-${p(m)}-01`, to: `${y}-${p(m)}-${p(last)}`, nextFrom: m === 12 ? `${y + 1}-01-01` : `${y}-${p(m + 1)}-01` }
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const money = (n: number) => `$${n.toFixed(2)}`

/** RFC 4180: quote everything, double internal quotes. A description with a
 *  comma in it silently shifting every column is exactly the bug an accountant
 *  finds three hours into a reconciliation. */
function csvCell(v: string | number | null | undefined): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`
}

export function PettyCashSection() {
  const now = new Date()
  const [studio, setStudio] = useState<StudioKey>('paramount')
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [entries, setEntries] = useState<Entry[]>([])
  const [bals, setBals] = useState<Bal[]>([])
  const [opening, setOpening] = useState(0)
  const [loading, setLoading] = useState(true)

  const { from, to, nextFrom } = useMemo(() => monthBounds(ym), [ym])

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: e, error: eErr }, { data: b, error: bErr }, { data: op, error: oErr }] = await Promise.all([
      supabase.from('petty_cash_entries').select('id, date, description, amount, type, created_at')
        .eq('studio', studio).gte('date', from).lte('date', to).order('date').order('created_at'),
      supabase.from('petty_cash_balances').select('date, counted_close, count_note, counted_by_name')
        .eq('studio', studio).gte('date', from).lte('date', to).order('date'),
      supabase.rpc('petty_cash_opening', { p_studio: studio, p_date: from }),
    ])
    if (!dbResult('Loading petty cash', eErr || bErr || oErr)) { setLoading(false); return }
    setEntries((e ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) || 0 })))
    setBals((b ?? []) as Bal[])
    setOpening(Number(op ?? 0))
    setLoading(false)
  }, [studio, from, to])

  useEffect(() => { load() }, [load])

  // Running balance, in the order the money actually moved.
  const lines: Line[] = useMemo(() => {
    let run = opening
    return entries.map(e => {
      run += e.type === 'in' ? e.amount : -e.amount
      return { ...e, balance: Math.round(run * 100) / 100 }
    })
  }, [entries, opening])

  const totalIn = entries.filter(e => e.type === 'in').reduce((s, e) => s + e.amount, 0)
  const totalOut = entries.filter(e => e.type === 'out').reduce((s, e) => s + e.amount, 0)
  const closing = Math.round((opening + totalIn - totalOut) * 100) / 100

  // Variances: a night where someone counted and the box disagreed with the
  // ledger as it stood at the end of that day.
  const variances = useMemo(() => {
    const out: { date: string; counted: number; expected: number; diff: number; by: string | null; note: string | null }[] = []
    for (const b of bals) {
      if (b.counted_close == null) continue
      let run = opening
      for (const e of entries) {
        if (e.date > b.date) break
        run += e.type === 'in' ? e.amount : -e.amount
      }
      const expected = Math.round(run * 100) / 100
      const diff = Math.round((Number(b.counted_close) - expected) * 100) / 100
      if (diff !== 0) out.push({ date: b.date, counted: Number(b.counted_close), expected, diff, by: b.counted_by_name, note: b.count_note })
    }
    return out
  }, [bals, entries, opening])

  const lastCount = useMemo(() => {
    const counted = bals.filter(b => b.counted_close != null)
    return counted.length ? counted[counted.length - 1] : null
  }, [bals])

  const label = STUDIOS.find(s => s.key === studio)!
  const [yy, mm] = ym.split('-').map(Number)
  const periodLabel = `${MONTHS[mm - 1]} ${yy}`

  function downloadCsv() {
    const head = ['Date', 'Description', 'Type', 'Amount', 'Signed Amount', 'Balance', 'Studio']
    const body = lines.map(l => [
      l.date, l.description ?? '', l.type === 'in' ? 'In' : 'Out',
      l.amount.toFixed(2), (l.type === 'in' ? l.amount : -l.amount).toFixed(2),
      l.balance.toFixed(2), label.label,
    ])
    // The bookends ride in the file: an accountant opening this in a week
    // should not have to come back to the app to learn what it opened at.
    const rows = [
      ['Opening balance', `${label.label} — ${periodLabel}`, '', '', '', opening.toFixed(2), label.label],
      ...body,
      ['Closing balance', 'Per ledger', '', totalIn.toFixed(2), (-totalOut).toFixed(2), closing.toFixed(2), label.label],
      ...(lastCount ? [['Counted', `${fmtDate(lastCount.date)}${lastCount.counted_by_name ? ` by ${lastCount.counted_by_name}` : ''}`, '', '', '', Number(lastCount.counted_close).toFixed(2), label.label]] : []),
    ]
    const csv = [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
    // ﻿ so Excel opens it as UTF-8 instead of mangling any accented name.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `petty-cash-${label.short}-${ym}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const th: React.CSSProperties = { textAlign: 'left', fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', padding: '0 10px 7px' }
  const td: React.CSSProperties = { padding: '7px 10px', fontSize: 12.5, verticalAlign: 'top' }

  return (
    <div className="c-pcwrap">
      <style>{`
        /* PRINT (the accountant's literal ask). The app chrome, the rail and
           every control leave; the table stays, on white, with the header
           repeating on each page via thead. Colour is dropped to ink — a
           red minus sign photocopies as grey and reads as nothing. */
        @media print {
          body * { visibility: hidden !important; }
          .c-pcwrap, .c-pcwrap * { visibility: visible !important; }
          .c-pcwrap { position: absolute; inset: 0; padding: 0; }
          .c-pcnoprint { display: none !important; }
          .c-pcwrap, .c-pcwrap * { color: #000 !important; background: transparent !important; box-shadow: none !important; }
          .c-pcsheet { break-inside: auto; }
          .c-pcsheet tr { break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>

      <div className="c-pcnoprint" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        {STUDIOS.map(s => (
          <button
            key={s.key}
            onClick={() => setStudio(s.key)}
            className={`c-pill c-control${studio === s.key ? ' c-on' : ''}`}
            style={{ border: 'none', font: 'inherit', cursor: 'pointer', minHeight: 34, padding: '0 14px' }}
          >{s.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <input
          type="month"
          value={ym}
          onChange={e => setYm(e.target.value)}
          className="c-control c-mono"
          style={{ background: 'var(--c-wash)', border: 'none', borderRadius: 10, padding: '8px 11px', color: 'var(--c-fg)', font: 'inherit', fontSize: 12.5, minHeight: 34 }}
        />
        <button onClick={downloadCsv} className="c-pill c-control" style={{ border: 'none', font: 'inherit', cursor: 'pointer', minHeight: 34, padding: '0 14px' }}>Download CSV</button>
        <button onClick={() => window.print()} className="c-pill c-control" style={{ border: 'none', font: 'inherit', cursor: 'pointer', minHeight: 34, padding: '0 14px' }}>Print</button>
      </div>

      <div className="c-pcsheet" style={{ background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 16, padding: 16 }}>
        <div style={{ marginBottom: 14 }}>
          <div className="c-arch" style={{ fontSize: 18, lineHeight: 1.2 }}>{label.label} petty cash</div>
          <div style={{ fontSize: 12.5, color: 'var(--c-fg-2)', marginTop: 2 }}>{periodLabel}</div>
        </div>

        {/* Bookends first: an accountant reads the summary, then goes looking
            for the line that explains it. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: '11px 0', marginBottom: 12, boxShadow: '0 1px 0 var(--c-wash2), 0 -1px 0 var(--c-wash2)' }}>
          {([
            ['Opening', money(opening)],
            ['Cash in', `+${money(totalIn)}`],
            ['Cash out', `-${money(totalOut)}`],
            ['Closing per ledger', money(closing)],
            ['Last count', lastCount?.counted_close != null ? `${money(Number(lastCount.counted_close))} · ${fmtDate(lastCount.date)}` : 'not counted'],
          ] as const).map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }}>{k}</div>
              <div className="c-mono" style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 22, textAlign: 'center', fontSize: 12.5, opacity: 0.5 }}>Loading…</div>
        ) : lines.length === 0 ? (
          <div style={{ padding: 22, textAlign: 'center', fontSize: 12.5, opacity: 0.5 }}>No transactions in {periodLabel}.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Date</th><th style={th}>Description</th>
              <th style={{ ...th, textAlign: 'right' }}>In</th>
              <th style={{ ...th, textAlign: 'right' }}>Out</th>
              <th style={{ ...th, textAlign: 'right' }}>Balance</th>
            </tr></thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id} style={{ boxShadow: '0 -1px 0 var(--c-wash)' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }} className="c-mono">{fmtDate(l.date)}</td>
                  <td style={td}>{l.description || <span style={{ opacity: 0.4 }}>—</span>}</td>
                  <td style={{ ...td, textAlign: 'right', color: l.type === 'in' ? 'var(--c-st-booked)' : undefined }} className="c-mono">{l.type === 'in' ? money(l.amount) : ''}</td>
                  <td style={{ ...td, textAlign: 'right', color: l.type === 'out' ? 'var(--c-st-hot)' : undefined }} className="c-mono">{l.type === 'out' ? money(l.amount) : ''}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} className="c-mono">{money(l.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* THE RECONCILIATION. A transaction list that does not tie out to the
            cash on hand is not a reconciliation, so the nights the box
            disagreed print with it — with the counter's own words, because the
            person reading this was not in the room. */}
        {variances.length > 0 && (
          <div style={{ marginTop: 18, paddingTop: 12, boxShadow: '0 -1px 0 var(--c-wash2)' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 8 }}>
              Nights the box didn&rsquo;t match
            </div>
            {variances.map(v => (
              <div key={v.date} style={{ fontSize: 12.5, marginBottom: 7, lineHeight: 1.5 }}>
                <span className="c-mono" style={{ fontWeight: 700 }}>{fmtDate(v.date)}</span>
                {' — counted '}<span className="c-mono">{money(v.counted)}</span>
                {' against '}<span className="c-mono">{money(v.expected)}</span>
                {', '}<b style={{ color: 'var(--c-st-warm)' }}>{v.diff > 0 ? 'over' : 'short'} {money(Math.abs(v.diff))}</b>
                {v.by ? ` · ${v.by}` : ''}
                {v.note ? <div style={{ color: 'var(--c-fg-2)', marginTop: 1 }}>&ldquo;{v.note}&rdquo;</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
