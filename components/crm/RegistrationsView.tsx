'use client'
// REGISTRATIONS — every completed client registration in one searchable list.
//
// Registrations previously surfaced only as a transient "needs review" banner
// (30-day window, cleared on confirm), so there was no way to look one up after
// the fact. This is the permanent record: everything with a registered_at, newest
// first, 25 to a page. A row opens the existing RegViewModal (full record, ID
// image, Copy Address), so there is exactly one registration-detail UI.
//
// Filtering and paging are client-side on purpose: the row count is small (one
// studio group's clients), and keeping the full set in memory makes search
// instant and keeps the realtime subscription a single plain re-fetch.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { RegViewModal } from '@/components/shared/RegViewModal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { useClientsVersion } from '@/hooks/useClientsVersion'

const PAGE_SIZE = 25

interface RegRow {
  id: string
  name: string | null
  fname: string | null
  lname: string | null
  email: string | null
  phone: string | null
  address_city: string | null
  address_state: string | null
  registered_at: string
  id_file_url: string | null
  terms_accepted: boolean | null
}

const COLS = '1.6fr 1.8fr 1fr 1.1fr 0.9fr 0.7fr'

function displayName(r: RegRow): string {
  return (r.name || [r.fname, r.lname].filter(Boolean).join(' ') || '—').trim()
}

function fmtSubmitted(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function RegistrationsView() {
  const [rows, setRows] = useState<RegRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  // Shared `clients` channel — see hooks/useClientsVersion.
  const clientsVersion = useClientsVersion()

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('clients')
      .select('id, name, fname, lname, email, phone, address_city, address_state, registered_at, id_file_url, terms_accepted')
      .not('registered_at', 'is', null)
      .order('registered_at', { ascending: false })
    setRows((data || []) as RegRow[])
    setLoading(false)
  }, [])

  // Standing rule: every fetch pairs with a realtime signal — a client completing
  // the form should appear here without a refresh. clientsVersion is that signal.
  useEffect(() => { load() }, [load, clientsVersion])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (q) {
        const hay = [displayName(r), r.email, r.phone].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      // registered_at is a timestamp; compare on its date part so an inclusive
      // "to" date covers the whole day rather than cutting off at midnight.
      const day = r.registered_at.slice(0, 10)
      if (from && day < from) return false
      if (to && day > to) return false
      return true
    })
  }, [rows, search, from, to])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // Snap back to page 1 whenever the filters change the result set, so you can't
  // be stranded on a page that no longer exists.
  const filterKey = `${search}|${from}|${to}`
  const lastFilterKey = useRef(filterKey)
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey
      setPage(1)
    }
  }, [filterKey])
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text)', fontFamily: 'Inter', fontSize: 11, padding: '6px 9px', outline: 'none',
  }
  const headCell: React.CSSProperties = {
    fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: 'var(--text3)',
  }
  const cell: React.CSSProperties = {
    fontSize: 11, fontFamily: 'Inter', color: 'var(--text2)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  }
  const pagerBtn = (disabled: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
    background: 'transparent', color: disabled ? 'var(--text3)' : 'var(--text)',
    fontFamily: 'Syne', fontWeight: 700, fontSize: 9, letterSpacing: '0.08em',
    textTransform: 'uppercase', cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  })

  return (
    <div data-panel="crm-registrations" style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', flex: 1, minHeight: 0 }}>

      {/* Header + filters */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <SectionHeader title="Registrations" count={filtered.length > 0 ? filtered.length : undefined} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email or phone…"
            style={{ ...inputStyle, flex: 1, minWidth: 180 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ ...headCell }}>Submitted</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} title="From" style={{ ...inputStyle, cursor: 'pointer' }} />
            <span style={{ color: 'var(--text3)', fontSize: 11 }}>–</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} title="To" style={{ ...inputStyle, cursor: 'pointer' }} />
          </div>
          {(search || from || to) && (
            <button
              onClick={() => { setSearch(''); setFrom(''); setTo('') }}
              style={{ padding: '5px 10px', background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'Syne', fontWeight: 700, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={headCell}>Name</div>
        <div style={headCell}>Email</div>
        <div style={headCell}>Phone</div>
        <div style={headCell}>City / State</div>
        <div style={headCell}>Submitted</div>
        <div style={headCell}>ID</div>
      </div>

      {/* Rows */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
        ) : pageRows.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 11 }}>
            {rows.length === 0 ? 'No registrations yet.' : 'No registrations match those filters.'}
          </div>
        ) : pageRows.map(r => (
          <div
            key={r.id}
            onClick={() => setOpenId(r.id)}
            title="Open registration record"
            style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
          >
            <div style={{ ...cell, color: 'var(--text)', fontWeight: 500 }}>{displayName(r)}</div>
            <div style={cell}>{r.email || '—'}</div>
            <div style={cell}>{r.phone || '—'}</div>
            <div style={cell}>{[r.address_city, r.address_state].filter(Boolean).join(', ') || '—'}</div>
            <div style={cell}>{fmtSubmitted(r.registered_at)}</div>
            <div>
              {r.id_file_url ? (
                <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent)', background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.25)', padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap' }}>
                  ON FILE
                </span>
              ) : (
                <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap' }}>
                  NONE
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pager */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text3)' }}>
          {filtered.length === 0
            ? '0 registrations'
            : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} style={pagerBtn(safePage <= 1)}>‹ Prev</button>
          <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text2)' }}>Page {safePage} of {pageCount}</span>
          <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount} style={pagerBtn(safePage >= pageCount)}>Next ›</button>
        </div>
      </div>

      {openId && <RegViewModal clientId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
