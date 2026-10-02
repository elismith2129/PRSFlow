// ─────────────────────────────────────────────────────────────────────────────
// Top clients — who booked the most in a month (Eli, 2026-10-01; mock
// docs/design-refs/lakers-topclients-options.html, option A, round 2).
//
// Two boxes. COD ranks the CLIENT ACCOUNT. Label/Billing ranks the LABEL + A&R
// ("the hero for the label side to be the label and A&R with the artist not the
// hero") with their artists underneath. Ranked by SESSIONS (work orders whose
// session starts in the month), dollars alongside ("lets do sessions and
// include the dollar amounts").
//
// Dollars = studio + engineering after the WO discount, from computeWoTotals —
// rentals and food are pass-through, not "booking". Left out: cancelled and
// non-session statuses, written-off (closed) WOs, and tenants (rent isn't
// booking — Mustard would top COD every month).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { computeWoTotals } from '@/lib/woTotals'

export type TopRow = {
  key: string
  title: string        // COD: client · Label: "Label · A&R"
  sub: string[]        // Label: artists
  sessions: number
  days: number
  dollars: number
  lakers: number       // games this season (owners only; 0 otherwise)
}

const SKIP_STATUS = new Set(['cancelled', 'tenant', 'tour', 'tech', 'open_hours'])

function monthBounds(ym: string): [string, string] {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`]
}

export async function fetchTopClients(ym: string, lakersSeason: string): Promise<{ cod: TopRow[]; label: TopRow[] }> {
  const [from, to] = monthBounds(ym)
  const { data: wos, error } = await supabase.from('work_orders')
    .select('id, client_id, client, label, artist, payment_status, anr_contact_id, session_status, invoice_state, discount_kind, discount_value')
    .gte('session_date', from).lte('session_date', to)
  if (!dbResult('Loading top clients', error)) return { cod: [], label: [] }

  const [leases, lakers] = await Promise.all([
    supabase.from('leases').select('tenant'),
    supabase.from('lakers_games').select('recipient').eq('season', lakersSeason).not('recipient', 'is', null),
  ])
  const tenants = (leases.data ?? []).map(l => String(l.tenant).toLowerCase().trim()).filter(Boolean)
  const lakersCount = new Map<string, number>()
  for (const r of lakers.data ?? []) {       // RLS: empty for non-owners, which is the point
    const k = String(r.recipient).toLowerCase().trim()
    lakersCount.set(k, (lakersCount.get(k) ?? 0) + 1)
  }

  const live = (wos ?? []).filter(w =>
    !SKIP_STATUS.has(String(w.session_status ?? '')) &&
    w.invoice_state !== 'closed' &&
    !tenants.some(t => String(w.client ?? '').toLowerCase().includes(t)),
  )
  if (live.length === 0) return { cod: [], label: [] }
  const ids = live.map(w => w.id as string)

  const clientIds = Array.from(new Set(live.map(w => w.client_id).filter(Boolean))) as string[]
  const anrIds = Array.from(new Set(live.map(w => w.anr_contact_id).filter(Boolean))) as string[]
  const [st, cl, an] = await Promise.all([
    supabase.from('studio_time_rows')
      .select('work_order_id, date, charge, ot_charge, from_time, to_time, eng_from_time, eng_to_time, eng_hours, eng_rate, day_status')
      .in('work_order_id', ids),
    clientIds.length ? supabase.from('clients').select('id, name').in('id', clientIds) : Promise.resolve({ data: [], error: null }),
    anrIds.length ? supabase.from('client_contacts').select('id, fname, lname').in('id', anrIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (!dbResult('Loading top-client room charges', st.error)) return { cod: [], label: [] }
  const rowsBy = new Map<string, any[]>()
  for (const r of st.data ?? []) {
    const k = r.work_order_id as string
    if (!rowsBy.has(k)) rowsBy.set(k, [])
    rowsBy.get(k)!.push(r)
  }
  const clientName = new Map<string, string>((cl.data ?? []).map((c: any) => [c.id, c.name]))
  const anrName = new Map<string, string>((an.data ?? []).map((c: any) => [c.id, [c.fname, c.lname].filter(Boolean).join(' ').trim()]))

  const cod = new Map<string, TopRow & { artists?: Set<string> }>()
  const lab = new Map<string, TopRow & { artists: Set<string> }>()
  const bump = (row: TopRow, w: any) => {
    const rows = rowsBy.get(w.id) ?? []
    const t = computeWoTotals({ studioRows: rows, rentalRows: [], paymentRows: [], discount: { kind: w.discount_kind, value: w.discount_value } })
    row.sessions += 1
    row.dollars += t.studio + t.engineer - t.discount
    row.days += new Set(rows.filter(r => r.day_status !== 'cancelled' && r.date).map(r => r.date)).size
  }
  const lk = (...names: string[]) => names.reduce((s, n) => s + (lakersCount.get(n.toLowerCase().trim()) ?? 0), 0)

  for (const w of live) {
    if (String(w.payment_status) === 'Billing') {
      const labelName = (w.label as string)?.trim() || clientName.get(w.client_id) || (w.client as string) || 'No label'
      const anr = w.anr_contact_id ? anrName.get(w.anr_contact_id) || '' : ''
      const key = `${labelName.toLowerCase()}|${w.anr_contact_id ?? ''}`
      if (!lab.has(key)) lab.set(key, { key, title: `${labelName} · ${anr || 'no A&R'}`, sub: [], sessions: 0, days: 0, dollars: 0, lakers: anr ? lk(anr) : 0, artists: new Set() })
      const row = lab.get(key)!
      if (w.artist) row.artists.add(String(w.artist).trim())
      bump(row, w)
    } else {
      const name = clientName.get(w.client_id) || (w.client as string)?.trim() || 'No client'
      const key = w.client_id || name.toLowerCase()
      if (!cod.has(key)) cod.set(key, { key, title: name, sub: [], sessions: 0, days: 0, dollars: 0, lakers: lk(name) })
      bump(cod.get(key)!, w)
    }
  }
  const rank = (a: TopRow, b: TopRow) => b.sessions - a.sessions || b.dollars - a.dollars
  return {
    cod: Array.from(cod.values()).sort(rank).slice(0, 5),
    label: Array.from(lab.values()).map(r => ({ ...r, sub: Array.from(r.artists) })).sort(rank).slice(0, 5),
  }
}
