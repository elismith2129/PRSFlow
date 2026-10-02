// ─────────────────────────────────────────────────────────────────────────────
// Top clients — who's booking the most (Eli, 2026-10-01; reworked 2026-10-02).
//
// ROLLING WINDOW, COUNTED FROM THE DAYS WORKED. v1 used the calendar month by
// the WO's session_date — on Oct 2 that was only sessions that STARTED Oct 1–2,
// and a lockout starting Oct 1 counted all its future days. Now: the window is
// the last 30 / 90 / 365 days ending today, and only studio_time_rows dated
// inside it count — days, and the dollars of those days. A session = a work
// order with at least one day in the window.
//
// COD ranks the client account. LABEL/BILLING ranks the LABEL alone (Eli,
// 10-02: "grouped by the label, not necessarily the artist or the A&R"), and
// each label opens to who under it is booking — artist · A&R.
//
// Ranked by sessions, then dollars. Dollars = studio + engineering of the
// in-window days (no WO discount — it's for the whole WO, not a slice).
// Excluded: cancelled days and non-session statuses, closed WOs, and the
// tenant WO (Mustard's lockout — v1 matched tenants by client name and missed
// him, because his WO is under "10 Summers").
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { computeWoTotals } from '@/lib/woTotals'
import { SHARED_RUNNER } from '@/lib/tenants'

export type TopLine = { key: string; title: string; sub: string; sessions: number; days: number; dollars: number; lakers: number }
export type TopRow = TopLine & { breakdown: TopLine[] }

const SKIP_STATUS = new Set(['cancelled', 'tenant', 'tour', 'tech', 'open_hours'])

function isoDaysAgo(today: string, n: number): string {
  const d = new Date(today + 'T12:00:00')
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

async function allRows(from: string, to: string): Promise<any[] | null> {
  const out: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from('studio_time_rows')
      .select('work_order_id, date, charge, ot_charge, from_time, to_time, eng_from_time, eng_to_time, eng_hours, eng_rate, day_status')
      .gte('date', from).lte('date', to)
      .order('date').range(off, off + 999)
    if (!dbResult('Loading top clients', error)) return null
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

async function chunked<T>(ids: string[], q: (slice: string[]) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await q(ids.slice(i, i + 200))
    if (!dbResult('Loading top clients', error)) return out
    out.push(...(data ?? []))
  }
  return out
}

export async function fetchTopClients(today: string, windowDays: number, lakersSeason: string): Promise<{ cod: TopRow[]; label: TopRow[] }> {
  const from = isoDaysAgo(today, windowDays - 1)
  const rows = await allRows(from, today)
  if (!rows) return { cod: [], label: [] }
  const live = rows.filter(r => r.day_status !== 'cancelled')
  const ids = Array.from(new Set(live.map(r => r.work_order_id as string).filter(Boolean)))
  if (ids.length === 0) return { cod: [], label: [] }

  const [wos, tenantBk, lakers] = await Promise.all([
    chunked<any>(ids, s => supabase.from('work_orders')
      .select('id, client_id, client, label, artist, payment_status, anr_contact_id, session_status, invoice_state')
      .in('id', s)),
    supabase.from('bookings').select('work_order_id')
      .eq('location', SHARED_RUNNER.venue).eq('studio', SHARED_RUNNER.tenantStudio).in('status', ['lockout', 'tenant']),
    supabase.from('lakers_games').select('recipient').eq('season', lakersSeason).not('recipient', 'is', null),
  ])
  const tenantWo = new Set((tenantBk.data ?? []).map(b => b.work_order_id).filter(Boolean))
  const lakersCount = new Map<string, number>()
  for (const r of lakers.data ?? []) {          // RLS: empty for non-owners
    const k = String(r.recipient).toLowerCase().trim()
    lakersCount.set(k, (lakersCount.get(k) ?? 0) + 1)
  }
  const lk = (n: string) => (n ? lakersCount.get(n.toLowerCase().trim()) ?? 0 : 0)

  const keep = wos.filter(w => !SKIP_STATUS.has(String(w.session_status ?? '')) && w.invoice_state !== 'closed' && !tenantWo.has(w.id))
  const woById = new Map(keep.map(w => [w.id as string, w]))
  const clientIds = Array.from(new Set(keep.map(w => w.client_id).filter(Boolean))) as string[]
  const anrIds = Array.from(new Set(keep.map(w => w.anr_contact_id).filter(Boolean))) as string[]
  const [cl, an] = await Promise.all([
    chunked<any>(clientIds, s => supabase.from('clients').select('id, name').in('id', s)),
    chunked<any>(anrIds, s => supabase.from('client_contacts').select('id, fname, lname').in('id', s)),
  ])
  const clientName = new Map<string, string>(cl.map(c => [c.id, c.name]))
  const anrName = new Map<string, string>(an.map(c => [c.id, [c.fname, c.lname].filter(Boolean).join(' ').trim()]))

  // Per-WO in-window figures.
  const rowsBy = new Map<string, any[]>()
  for (const r of live) {
    if (!woById.has(r.work_order_id)) continue
    if (!rowsBy.has(r.work_order_id)) rowsBy.set(r.work_order_id, [])
    rowsBy.get(r.work_order_id)!.push(r)
  }
  const fig = (woId: string) => {
    const rs = rowsBy.get(woId) ?? []
    const t = computeWoTotals({ studioRows: rs, rentalRows: [], paymentRows: [] })
    return { days: new Set(rs.map(r => r.date)).size, dollars: t.studio + t.engineer }
  }

  type Acc = TopLine & { kids: Map<string, TopLine> }
  const cod = new Map<string, Acc>()
  const lab = new Map<string, Acc>()
  const add = (line: TopLine, f: { days: number; dollars: number }) => { line.sessions += 1; line.days += f.days; line.dollars += f.dollars }

  for (const [woId, w] of woById) {
    if (!rowsBy.has(woId)) continue
    const f = fig(woId)
    if (String(w.payment_status) === 'Billing') {
      const name = (w.label as string)?.trim() || clientName.get(w.client_id) || (w.client as string)?.trim() || 'No label'
      const key = name.toLowerCase()
      if (!lab.has(key)) lab.set(key, { key, title: name, sub: '', sessions: 0, days: 0, dollars: 0, lakers: 0, kids: new Map() })
      const row = lab.get(key)!
      add(row, f)
      const artist = (w.artist as string)?.trim() || '—'
      const anr = w.anr_contact_id ? anrName.get(w.anr_contact_id) || '' : ''
      const kk = `${artist.toLowerCase()}|${anr.toLowerCase()}`
      if (!row.kids.has(kk)) row.kids.set(kk, { key: kk, title: artist, sub: anr ? `A&R ${anr}` : 'no A&R', sessions: 0, days: 0, dollars: 0, lakers: lk(anr) })
      add(row.kids.get(kk)!, f)
    } else {
      const name = clientName.get(w.client_id) || (w.client as string)?.trim() || 'No client'
      const key = (w.client_id as string) || name.toLowerCase()
      if (!cod.has(key)) cod.set(key, { key, title: name, sub: '', sessions: 0, days: 0, dollars: 0, lakers: lk(name), kids: new Map() })
      add(cod.get(key)!, f)
    }
  }

  const rank = (a: TopLine, b: TopLine) => b.sessions - a.sessions || b.dollars - a.dollars
  const done = (m: Map<string, Acc>): TopRow[] => Array.from(m.values()).map(({ kids, ...r }) => {
    const breakdown = Array.from(kids.values()).sort(rank)
    const lakersTotal = breakdown.reduce((s, k) => s + k.lakers, 0)
    return {
      ...r,
      lakers: r.lakers || lakersTotal,
      sub: breakdown.length ? `${breakdown.length} artist${breakdown.length === 1 ? '' : 's'}` : '',
      breakdown,
    }
  }).sort(rank)
  return { cod: done(cod), label: done(lab) }
}
