'use client'
// ─── CLIENT LIST (rebuild 2026-09-30, mock docs/design-refs/crm-clients-v3.html)
// The billing hub's anatomy: search bar on top (it outranks the filters), pill
// filters with counts, then one carved list panel with a lozenge header.
//
// "Needs fixing" is the clean-up queue for the database: a label with no
// contacts or whose rep on file isn't one of its contacts (the 10 Summers /
// Dijon shape), or a COD client with no way to reach them.
import React, { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { Client, ClientContact } from '@/lib/supabase'
import { fullName } from '@/lib/clientEdits'

type Filter = 'all' | 'label' | 'individual' | 'registered' | 'fix'
type SortOption = 'alpha' | 'recent' | 'bookings'

export type BookingCountMap = Record<string, number>
export type ContactsMap = Record<string, ClientContact[]>

// THE PAGE IS THE BOX (Eli, 2026-10-01: "paginate the left column at the
// same length as the right… no weird bottoms of boxes that differ"). The list
// never scrolls inside its panel; it shows exactly as many rows as fit the
// height the grid gives it and pages the rest. Row height is measured from
// the first rendered row, so a font or padding change can't silently cut a
// row in half. Fallback until measured: 55px (34 avatar + 2×9 pad + 3 gap).
const ROW_H_FALLBACK = 55

interface Props {
  clients: Client[]
  contactsMap: ContactsMap
  bookingCountMap: BookingCountMap
  selectedId: string | null
  loading: boolean
  onSelect: (id: string) => void
  /** Rendered beside the search bar (the page's + New client). */
  searchAction?: React.ReactNode
}

/** Why a client is in "Needs fixing" — null when it isn't. */
export function fixReason(c: Client, contacts: ClientContact[]): string | null {
  if (c.type === 'label') {
    // A LABEL HAS NO "REP" (Eli, 2026-10-01: "for labels really need just
    // A&R and admin and then the artists roster"). The label row's
    // fname/lname is a leftover from the individuals schema; NO REP / REP
    // NOT A CONTACT enforced a concept the business doesn't have (10K
    // Projects has a dozen A&Rs and no primary one). The only honest flags
    // are about the contacts themselves.
    if (contacts.length === 0) return 'NO CONTACTS'
    if (!contacts.some(ct => ct.contact_type !== 'admin')) return 'NO A&R'
    return null
  }
  if (!c.email && !c.phone) return 'NO EMAIL / PHONE'
  return null
}

function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return '—'
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase()
  return (w[0][0] + w[1][0]).toUpperCase()
}

export function ClientList({ clients, contactsMap, bookingCountMap, selectedId, loading, onSelect, searchAction }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<SortOption>('alpha')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [pageSize, setPageSize] = useState(12)

  useEffect(() => { setPage(1) }, [filter, sort, search])

  // Fit rows to the panel body. ResizeObserver so a window resize, the CRM
  // tab strip appearing, or the filter tabs wrapping all re-fit live.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const fit = () => {
      const first = el.firstElementChild as HTMLElement | null
      const rowH = first && first.dataset.row === '1'
        ? first.offsetHeight + parseFloat(getComputedStyle(first).marginBottom || '0')
        : ROW_H_FALLBACK
      const n = Math.max(1, Math.floor(el.clientHeight / Math.max(1, rowH)))
      setPageSize(prev => (prev === n ? prev : n))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

  const q = search.trim().toLowerCase()
  const searching = q.length > 0

  const matchesFilter = (c: Client, f: Filter) => {
    if (f === 'all') return true
    if (f === 'label') return c.type === 'label'
    if (f === 'individual') return c.type !== 'label'
    if (f === 'registered') return !!c.registered_at
    return !!fixReason(c, contactsMap[c.id] || [])
  }

  const filterDefs: { key: Filter; label: string; warn?: boolean }[] = [
    { key: 'all', label: 'All' },
    { key: 'label', label: 'Labels' },
    { key: 'individual', label: 'COD' },
    { key: 'registered', label: 'Registered' },
    { key: 'fix', label: 'Needs fixing', warn: true },
  ]
  const counts: Record<Filter, number> = { all: 0, label: 0, individual: 0, registered: 0, fix: 0 }
  for (const c of clients) for (const f of filterDefs) if (matchesFilter(c, f.key)) counts[f.key]++

  // Search ignores the pill (like the billing hub): you look for a client, not
  // a client-in-a-filter.
  let filtered: Client[] = searching ? clients : clients.filter(c => matchesFilter(c, filter))
  if (searching) {
    filtered = filtered.filter(c => {
      if (c.name.toLowerCase().includes(q)) return true
      if (fullName(c.fname, c.lname).toLowerCase().includes(q)) return true
      if ((c.email || '').toLowerCase().includes(q)) return true
      if ((c.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '\u0000')) return true
      if ((c.artist_name || '').toLowerCase().includes(q)) return true
      if ((c.artists || []).some(a => a.toLowerCase().includes(q))) return true
      return (contactsMap[c.id] || []).some(ct =>
        fullName(ct.fname, ct.lname).toLowerCase().includes(q) ||
        (ct.email || '').toLowerCase().includes(q) ||
        (ct.artists || []).some(a => a.toLowerCase().includes(q))
      )
    })
  }

  if (sort === 'alpha') filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  else if (sort === 'recent') filtered = [...filtered].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  else filtered = [...filtered].sort((a, b) => (bookingCountMap[b.id] || 0) - (bookingCountMap[a.id] || 0))

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const startIdx = (safePage - 1) * pageSize
  const paginated = filtered.slice(startIdx, startIdx + pageSize)

  const lozengeTitle = searching ? 'Search results' : filterDefs.find(f => f.key === filter)?.label ?? 'All'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexShrink: 0 }}>
        <div className="c-bsearch" style={{ flex: 1 }}>
          <span style={{ opacity: 0.4, fontSize: 12 }}>⌕</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients — name, label, A&R, artist, email, phone…"
          />
          {searching && <span className="c-bclr" onClick={() => setSearch('')}>clear ✕</span>}
        </div>
        {searchAction}
      </div>

      <div className={`c-btabs${searching ? ' c-dim' : ''}`} style={{ flexShrink: 0 }}>
        {filterDefs.map(f => (
          <span key={f.key} className={`c-btab${filter === f.key ? ' c-on' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}{' '}
            <span className="c-bn" style={f.warn && counts[f.key] > 0 ? { color: 'var(--c-st-warm)', opacity: 1 } : undefined}>
              {counts[f.key]}
            </span>
          </span>
        ))}
      </div>

      <div className="c-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="c-lozenge" style={{ alignItems: 'center', flexShrink: 0 }}>
          <b>{lozengeTitle} <span className="c-ct" style={{ marginLeft: 6 }}>{filtered.length}</span></b>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortOption)}
            style={{ background: 'none', border: 'none', color: 'var(--c-fg)', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', outline: 'none', boxShadow: 'none', padding: 0, height: 'auto', width: 'auto' }}
          >
            <option value="alpha">A–Z</option>
            <option value="recent">Recently added</option>
            <option value="bookings">Most bookings</option>
          </select>
        </div>

        <div ref={bodyRef} style={{ overflow: 'hidden', flex: 1, minHeight: 0 }}>
          {loading ? (
            <div className="c-bempty" style={{ padding: 16, opacity: 0.5, fontSize: 12 }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 16, opacity: 0.5, fontSize: 12 }}>{searching ? 'Nothing matches that.' : 'Nothing here.'}</div>
          ) : paginated.map(c => {
            const contacts = contactsMap[c.id] || []
            const isLabel = c.type === 'label'
            const fix = fixReason(c, contacts)
            const rep = fullName(c.fname, c.lname)
            const artists = isLabel ? (c.artists || []) : (c.artist_name ? [c.artist_name] : [])
            const sub = isLabel
              ? [rep || null, artists.length ? `${artists.slice(0, 2).join(', ')}${artists.length > 2 ? ` +${artists.length - 2}` : ''}` : null].filter(Boolean).join(' · ') || `${contacts.length} contact${contacts.length === 1 ? '' : 's'}`
              : [artists[0], c.email || c.phone].filter(Boolean).join(' · ') || '—'
            const sel = selectedId === c.id
            const bookings = bookingCountMap[c.id] || 0
            return (
              <div
                key={c.id}
                data-row="1"
                onClick={() => onSelect(c.id)}
                style={{
                  display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) auto', gap: 11, alignItems: 'center',
                  padding: '9px 10px', borderRadius: 12, cursor: 'pointer', marginBottom: 3,
                  background: sel ? 'var(--c-srf, var(--c-wash2))' : undefined,
                  boxShadow: sel ? 'var(--c-softsh)' : undefined,
                }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'var(--c-wash)' }}
                onMouseLeave={e => { if (!sel) e.currentTarget.style.background = '' }}
              >
                <div className="c-mono" style={{ width: 34, height: 34, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, boxShadow: 'inset 0 0 0 1.5px var(--c-wash2)', opacity: 0.85 }}>
                  {initials(c.name)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {sub}{bookings > 0 ? ` · ${bookings} booked` : ''}
                  </div>
                </div>
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '.06em', padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap',
                  background: fix ? 'color-mix(in srgb, var(--c-st-warm) 15%, transparent)'
                    : (!isLabel && c.registered_at) ? 'color-mix(in srgb, var(--c-st-booked) 15%, transparent)' : 'var(--c-wash2)',
                  color: fix ? 'var(--c-st-warm)' : (!isLabel && c.registered_at) ? 'var(--c-st-booked)' : undefined,
                }}>
                  {fix ?? (isLabel ? 'LABEL' : c.registered_at ? '✓ REG' : 'COD')}
                </span>
              </div>
            )
          })}
        </div>

        {/* Pager always present once there's more than a page, pinned to the
            panel's foot so the box ends where the profile's does. */}
        {filtered.length > pageSize && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 6px 0', flexShrink: 0, fontSize: 11, marginTop: 'auto' }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
              style={{ background: 'none', padding: '2px 4px', cursor: safePage <= 1 ? 'default' : 'pointer', opacity: safePage <= 1 ? 0.3 : 0.7, color: 'var(--c-fg)', boxShadow: 'none' }}>← Prev</button>
            <span className="c-mono" style={{ fontSize: 10.5, opacity: 0.5 }}>{startIdx + 1}–{Math.min(startIdx + pageSize, filtered.length)} of {filtered.length}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
              style={{ background: 'none', padding: '2px 4px', cursor: safePage >= totalPages ? 'default' : 'pointer', opacity: safePage >= totalPages ? 0.3 : 0.7, color: 'var(--c-fg)', boxShadow: 'none' }}>Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
