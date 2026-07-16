'use client'
import React, { useState, useEffect } from 'react'
import { Client, ClientContact, CLIENT_TYPE_LABELS } from '@/lib/supabase'

type TypeFilter = 'all' | 'label' | 'individual'
type SortOption = 'alpha' | 'recent' | 'bookings'

export type BookingCountMap = Record<string, number>
export type ContactsMap = Record<string, ClientContact[]>

const PAGE_SIZE = 50

interface Props {
  clients: Client[]
  contactsMap: ContactsMap
  bookingCountMap: BookingCountMap
  selectedId: string | null
  loading: boolean
  onSelect: (id: string) => void
}

export function ClientList({ clients, contactsMap, bookingCountMap, selectedId, loading, onSelect }: Props) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortOption>('alpha')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [typeFilter, sort, search])

  const labelCount = clients.filter(c => c.type === 'label').length
  const indCount = clients.filter(c => c.type === 'individual').length

  const q = search.trim().toLowerCase()
  let filtered: Client[] = clients

  if (typeFilter !== 'all') filtered = filtered.filter(c => c.type === typeFilter)

  if (q) {
    filtered = filtered.filter(c => {
      if (c.name.toLowerCase().includes(q)) return true
      if ((c.email || '').toLowerCase().includes(q)) return true
      if ((c.phone || '').toLowerCase().includes(q)) return true
      return (contactsMap[c.id] || []).some(ct =>
        `${ct.fname || ''} ${ct.lname || ''}`.toLowerCase().includes(q) ||
        (ct.email || '').toLowerCase().includes(q)
      )
    })
  }

  if (sort === 'alpha') filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  else if (sort === 'recent') filtered = [...filtered].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  else if (sort === 'bookings') filtered = [...filtered].sort((a, b) => (bookingCountMap[b.id] || 0) - (bookingCountMap[a.id] || 0))

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const startIdx = (safePage - 1) * PAGE_SIZE
  const paginated = filtered.slice(startIdx, startIdx + PAGE_SIZE)

  const filterDefs: { key: TypeFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: clients.length },
    { key: 'label', label: 'Labels', count: labelCount },
    { key: 'individual', label: CLIENT_TYPE_LABELS.individual, count: indCount },
  ]

  return (
    <div data-panel="clients-list" style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '10px 16px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, flexWrap: 'wrap' as const }}>
          {filterDefs.map(f => {
            const active = typeFilter === f.key
            return (
              <button key={f.key} onClick={() => setTypeFilter(f.key)} style={{
                padding: '4px 10px', cursor: 'pointer', borderRadius: 20,
                fontFamily: 'Syne', fontWeight: active ? 700 : 600, fontSize: 9,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                background: active ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                border: `1px solid ${active ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 40%, transparent)'}`,
                color: active ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 60%, transparent)',
                transition: 'all 0.15s',
              }}>
                {f.label} ({f.count})
              </button>
            )
          })}
          <div style={{ flex: 1 }} />
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortOption)}
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text2)', padding: '3px 8px', borderRadius: 5,
              fontFamily: 'Inter', fontSize: 10, outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="alpha">A–Z</option>
            <option value="recent">Recently Added</option>
            <option value="bookings">Most Bookings</option>
          </select>
        </div>
        <div style={{ paddingBottom: 8 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${clients.length} clients by name, email, or contact…`}
            style={{
              width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text)', padding: '5px 10px', borderRadius: 5,
              fontFamily: 'Inter', fontSize: 11, outline: 'none',
            }}
          />
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <>
            {[62, 48, 72, 55, 65, 50, 75, 58].map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ height: 11, borderRadius: 3, marginBottom: 5, background: 'var(--surface2)', animation: 'shimmer 1.4s ease-in-out infinite', width: `${w}%` }} />
                  <div style={{ height: 9, borderRadius: 3, background: 'var(--surface2)', animation: 'shimmer 1.4s ease-in-out infinite', width: `${[38, 45, 30, 52, 36, 42, 34, 48][i]}%`, opacity: 0.7 }} />
                </div>
              </div>
            ))}
          </>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 11 }}>
            {q ? 'No clients match.' : 'No clients.'}
          </div>
        ) : paginated.map(c => {
          const contacts = contactsMap[c.id] || []
          const bookings = bookingCountMap[c.id] || 0
          const isLabel = c.type === 'label'
          return (
            <div
              key={c.id}
              onClick={() => onSelect(c.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '11px 16px', cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
                background: selectedId === c.id ? 'rgba(var(--accent-rgb),0.04)' : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: 'var(--text)',
                  }}>
                    {c.name}
                  </span>
                  <span style={{
                    fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em',
                    padding: '2px 5px', borderRadius: 3, flexShrink: 0,
                    background: 'rgba(139,144,168,0.12)',
                    color: 'var(--text2)',
                    border: '1px solid var(--border)',
                  }}>
                    {CLIENT_TYPE_LABELS[c.type].toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'Inter' }}>
                  {isLabel
                    ? `${contacts.length} contact${contacts.length !== 1 ? 's' : ''} · ${(c.artists || []).length} artist${(c.artists || []).length !== 1 ? 's' : ''}`
                    : c.email || c.phone || '—'
                  }
                </div>
              </div>
              {bookings > 0 && (
                <span style={{
                  fontSize: 9, fontFamily: 'Inter', color: 'var(--text3)',
                  background: 'var(--surface2)', padding: '2px 7px', borderRadius: 3,
                  border: '1px solid var(--border)', flexShrink: 0, whiteSpace: 'nowrap',
                }}>
                  {bookings} booking{bookings !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {filtered.length > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            style={{ background: 'none', border: 'none', cursor: safePage <= 1 ? 'default' : 'pointer', fontFamily: 'Inter', fontSize: 10, color: safePage <= 1 ? 'var(--text3)' : 'var(--text2)', padding: '2px 4px' }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'Inter' }}>
            {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            style={{ background: 'none', border: 'none', cursor: safePage >= totalPages ? 'default' : 'pointer', fontFamily: 'Inter', fontSize: 10, color: safePage >= totalPages ? 'var(--text3)' : 'var(--text2)', padding: '2px 4px' }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
