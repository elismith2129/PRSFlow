'use client'
// TEXTING LIST — everyone who has said yes to promotional texts (Eli,
// 2026-09-29: "a list of people that opt in to this for text that grows and
// also has the ability to filter").
//
// The list IS the clients table filtered on sms_opt_in — not a second list to
// maintain. It grows on its own as registrations come in with the box ticked.
// Filters are client-side (same reasoning as RegistrationsView: one studio
// group's clients fit in memory; search stays instant; realtime is a plain
// re-fetch). Export gives a CSV of the current filter for whatever sends the
// texts — nothing here sends anything.
//
// STAFF ACTS ARE LOGGED. "Opt out" here is how a STOP that came by phone or
// in person gets recorded; "Opt in" is for a verbal/written yes the office
// took itself. Both write sms_consent_log with by_staff, so the trail says
// who, when and how. A staff opt-in is weaker evidence than the form's — use
// it when you have the yes in writing somewhere.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { RegViewModal } from '@/components/shared/RegViewModal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { useClientsVersion } from '@/hooks/useClientsVersion'
import { useUserProfile } from '@/hooks/useUserProfile'
import { getLocalToday } from '@/lib/time'

const PAGE_SIZE = 25

interface TxRow {
  id: string
  name: string | null
  fname: string | null
  lname: string | null
  email: string | null
  phone: string | null
  address_city: string | null
  address_state: string | null
  how_heard: string | null
  registered_at: string | null
  sms_opt_in: boolean
  sms_opt_in_at: string | null
  sms_opt_in_phone: string | null
  sms_opt_out_at: string | null
  /** Derived: latest work-order session date, or null. */
  last_session: string | null
  sessions: number
}

type LastFilter = 'any' | '90' | '180' | '365' | 'never'

const COLS = '1.4fr 1fr 1fr 0.9fr 0.9fr 0.8fr 0.7fr 96px'

function displayName(r: TxRow): string {
  const full = [r.fname, r.lname].filter(Boolean).join(' ').trim()
  return full || r.name || '—'
}
function fmtDay(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function TextingListView() {
  const { profile } = useUserProfile()
  const clientsVersion = useClientsVersion()
  const [rows, setRows] = useState<TxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [heard, setHeard] = useState('')
  const [city, setCity] = useState('')
  const [last, setLast] = useState<LastFilter>('any')
  const [showOut, setShowOut] = useState(false)
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; action: 'opt_in' | 'opt_out' } | null>(null)

  const load = useCallback(async () => {
    // Opted-in clients, plus opted-out ones (they have an opt_out_at) so the
    // office can see who left — hidden behind a toggle by default.
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, fname, lname, email, phone, address_city, address_state, how_heard, registered_at, sms_opt_in, sms_opt_in_at, sms_opt_in_phone, sms_opt_out_at')
      .or('sms_opt_in.eq.true,sms_opt_out_at.not.is.null')
      .order('sms_opt_in_at', { ascending: false, nullsFirst: false })
    if (!dbResult('Loading texting list', error)) { setLoading(false); return }
    const base = (data || []) as Omit<TxRow, 'last_session' | 'sessions'>[]
    const ids = base.map(r => r.id)
    const lastBy = new Map<string, string>()
    const countBy = new Map<string, number>()
    if (ids.length) {
      const { data: wos } = await supabase
        .from('work_orders')
        .select('client_id, session_date')
        .in('client_id', ids)
      for (const w of wos || []) {
        if (!w.client_id) continue
        countBy.set(w.client_id, (countBy.get(w.client_id) ?? 0) + 1)
        const d = (w.session_date ?? '').slice(0, 10)
        if (d && d > (lastBy.get(w.client_id) ?? '')) lastBy.set(w.client_id, d)
      }
    }
    setRows(base.map(r => ({ ...r, last_session: lastBy.get(r.id) ?? null, sessions: countBy.get(r.id) ?? 0 })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load, clientsVersion])

  const heardOptions = useMemo(() => Array.from(new Set(rows.map(r => (r.how_heard || '').trim()).filter(Boolean))).sort(), [rows])
  const cityOptions = useMemo(() => Array.from(new Set(rows.map(r => (r.address_city || '').trim()).filter(Boolean))).sort(), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const today = getLocalToday()
    const cutoff = (days: number) => {
      const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - days)
      return d.toISOString().slice(0, 10)
    }
    return rows.filter(r => {
      if (!showOut && !r.sms_opt_in) return false
      if (q) {
        const hay = [displayName(r), r.email, r.phone].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      const day = (r.sms_opt_in_at || '').slice(0, 10)
      if (from && day < from) return false
      if (to && day > to) return false
      if (heard && (r.how_heard || '').trim() !== heard) return false
      if (city && (r.address_city || '').trim() !== city) return false
      if (last === 'never' && r.last_session) return false
      if (last !== 'any' && last !== 'never') {
        if (!r.last_session || r.last_session < cutoff(Number(last))) return false
      }
      return true
    })
  }, [rows, search, from, to, heard, city, last, showOut])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const filterKey = `${search}|${from}|${to}|${heard}|${city}|${last}|${showOut}`
  const lastFilterKey = useRef(filterKey)
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) { lastFilterKey.current = filterKey; setPage(1) }
  }, [filterKey])
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const anyFilter = !!(search || from || to || heard || city || last !== 'any' || showOut)

  function exportCsv() {
    const head = ['Name', 'Phone', 'Email', 'City', 'State', 'How heard', 'Opted in', 'Consent phone', 'Last session', 'Sessions', 'Status']
    const lines = [head.join(',')].concat(filtered.map(r => [
      displayName(r), r.phone, r.email, r.address_city, r.address_state, r.how_heard,
      (r.sms_opt_in_at || '').slice(0, 10), r.sms_opt_in_phone, r.last_session, r.sessions,
      r.sms_opt_in ? 'opted in' : 'opted out',
    ].map(csvCell).join(',')))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `texting-list-${getLocalToday()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function act(id: string, action: 'opt_in' | 'opt_out') {
    const r = rows.find(x => x.id === id)
    if (!r || busy) return
    setBusy(id)
    const now = new Date().toISOString()
    const patch: Record<string, string | boolean | null> = action === 'opt_in'
      ? { sms_opt_in: true, sms_opt_in_at: now, sms_opt_in_phone: r.phone, sms_opt_out_at: null }
      : { sms_opt_in: false, sms_opt_out_at: now }
    const { error } = await supabase.from('clients').update(patch).eq('id', id)
    if (dbResult(action === 'opt_in' ? 'Recording opt-in' : 'Recording opt-out', error)) {
      const { error: logErr } = await supabase.from('sms_consent_log').insert({
        client_id: id, phone: r.phone || '', action, source: 'staff', by_staff: profile?.id ?? null,
        consent_text: action === 'opt_in' ? 'Recorded by staff' : 'STOP recorded by staff',
      })
      dbResult('Logging consent', logErr)
      await load()
    }
    setBusy(null); setConfirm(null)
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--c-wash)', borderRadius: 4,
    color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 11, padding: '6px 9px', outline: 'none',
  }
  const headCell: React.CSSProperties = {
    fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: 'var(--c-fg-3)',
  }
  const cell: React.CSSProperties = {
    fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-2)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  }
  const smallBtn: React.CSSProperties = {
    padding: '5px 10px', background: 'transparent', color: 'var(--c-fg-2)', borderRadius: 4,
    fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
  }
  const pagerBtn = (disabled: boolean): React.CSSProperties => ({
    ...smallBtn, padding: '4px 10px', color: disabled ? 'var(--c-fg-3)' : 'var(--c-fg)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
  })

  const optedIn = rows.filter(r => r.sms_opt_in).length

  return (
    <div className="c-panel" style={{ display: 'flex', flexDirection: 'column', background: 'var(--c-bg)', borderRadius: 10, overflow: 'hidden', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
        <SectionHeader
          title="Texting list"
          count={filtered.length > 0 ? filtered.length : undefined}
          action={filtered.length > 0 ? { label: 'Export CSV', onClick: exportCsv } : undefined}
        />
        <div style={{ fontSize: 10.5, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginBottom: 10 }}>
          {optedIn} opted in · grows as registrations come in with the “Yes, text me” box ticked. Promotional texts go to this list only.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email or phone…" style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={headCell}>Opted in</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} title="From" style={{ ...inputStyle, cursor: 'pointer' }} />
            <span style={{ color: 'var(--c-fg-3)', fontSize: 11 }}>–</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} title="To" style={{ ...inputStyle, cursor: 'pointer' }} />
          </div>
          <select value={heard} onChange={e => setHeard(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} title="How they heard about us">
            <option value="">Any source</option>
            {heardOptions.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
          <select value={city} onChange={e => setCity(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} title="City">
            <option value="">Any city</option>
            {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={last} onChange={e => setLast(e.target.value as LastFilter)} style={{ ...inputStyle, cursor: 'pointer' }} title="Last session">
            <option value="any">Any last session</option>
            <option value="90">Session in last 90 days</option>
            <option value="180">Session in last 6 months</option>
            <option value="365">Session in last year</option>
            <option value="never">Never had a session</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--c-fg-2)', fontFamily: 'Inter', cursor: 'pointer' }}>
            <input type="checkbox" checked={showOut} onChange={e => setShowOut(e.target.checked)} /> show opted out
          </label>
          {anyFilter && (
            <button onClick={() => { setSearch(''); setFrom(''); setTo(''); setHeard(''); setCity(''); setLast('any'); setShowOut(false) }} style={smallBtn}>Clear</button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, padding: '8px 16px', flexShrink: 0 }}>
        <div style={headCell}>Name</div>
        <div style={headCell}>Phone</div>
        <div style={headCell}>Email</div>
        <div style={headCell}>City</div>
        <div style={headCell}>Source</div>
        <div style={headCell}>Opted in</div>
        <div style={headCell}>Last session</div>
        <div style={headCell}></div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--c-fg-3)', fontSize: 11 }}>Loading…</div>
        ) : pageRows.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--c-fg-3)', fontSize: 11 }}>
            {rows.length === 0 ? 'Nobody has opted in yet — the box is on the registration form.' : 'Nobody matches those filters.'}
          </div>
        ) : pageRows.map(r => {
          const out = !r.sms_opt_in
          const phoneChanged = r.sms_opt_in && r.sms_opt_in_phone && r.phone && r.sms_opt_in_phone !== r.phone
          return (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, alignItems: 'center', padding: '10px 16px', opacity: out ? 0.5 : 1 }}>
              <div onClick={() => setOpenId(r.id)} title="Open registration record" style={{ ...cell, color: 'var(--c-fg)', fontWeight: 500, cursor: 'pointer' }}>{displayName(r)}</div>
              <div style={cell} title={phoneChanged ? `Consent was for ${r.sms_opt_in_phone} — number has changed since` : undefined}>
                {r.phone || '—'}{phoneChanged && <span style={{ color: 'var(--c-st-warm)', marginLeft: 4 }}>⚠</span>}
              </div>
              <div style={cell}>{r.email || '—'}</div>
              <div style={cell}>{r.address_city || '—'}</div>
              <div style={cell}>{r.how_heard || '—'}</div>
              <div style={cell}>{out ? <span style={{ color: 'var(--c-st-hot)' }}>out {fmtDay(r.sms_opt_out_at)}</span> : fmtDay(r.sms_opt_in_at)}</div>
              <div style={cell}>{r.last_session ? fmtDay(r.last_session) : 'never'}</div>
              <div style={{ justifySelf: 'end' }}>
                {confirm?.id === r.id ? (
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    <button className="c-bact" disabled={busy === r.id} onClick={() => act(r.id, confirm.action)} style={{ color: confirm.action === 'opt_out' ? 'var(--c-st-hot)' : undefined }}>Sure</button>
                    <button className="c-bact" onClick={() => setConfirm(null)}>No</button>
                  </span>
                ) : out ? (
                  <button className="c-bact" onClick={() => setConfirm({ id: r.id, action: 'opt_in' })} title="Record a yes the office took (logged as staff)">Opt in</button>
                ) : (
                  <button className="c-bact" onClick={() => setConfirm({ id: r.id, action: 'opt_out' })} title="Record a STOP (logged as staff)" style={{ opacity: 0.7 }}>Opt out</button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)' }}>
          {filtered.length === 0 ? '0 people' : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} style={pagerBtn(safePage <= 1)}>‹ Prev</button>
          <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)' }}>Page {safePage} of {pageCount}</span>
          <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount} style={pagerBtn(safePage >= pageCount)}>Next ›</button>
        </div>
      </div>

      {openId && <RegViewModal clientId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
