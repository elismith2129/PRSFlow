'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import { DailyOpsModal, type DailyOpsSubmission } from '@/components/dashboard/DailyOpsModal'

const STUDIO_LABELS: Record<string, string> = {
  paramount: 'Paramount', ameraycan: 'Ameraycan',
  encore: 'Encore', track: 'Track',
}
const STUDIO_COLORS: Record<string, string> = {
  paramount: '#c8f04e', ameraycan: '#f04e7a',
  encore: '#4e8ff0', track: '#f0a24e',
}
const CAT_LABELS: Record<string, string> = {
  opening_checklist: 'Opening Checklist',
  closing_checklist: 'Closing Checklist',
  petty_cash: 'Petty Cash',
  stock_list: 'Stock List',
  mic_inventory: 'Mic Inventory',
}
const STUDIO_OPTIONS = [
  { key: 'all', label: 'All Studios' },
  { key: 'paramount', label: 'Paramount' },
  { key: 'ameraycan', label: 'Ameraycan' },
  { key: 'encore', label: 'Encore' },
  { key: 'track', label: 'Track' },
]
const TYPE_OPTIONS = [
  { key: 'all', label: 'All Types' },
  { key: 'wo', label: 'Work Order' },
  { key: 'opening_checklist', label: 'Opening Checklist' },
  { key: 'closing_checklist', label: 'Closing Checklist' },
  { key: 'petty_cash', label: 'Petty Cash' },
  { key: 'stock_list', label: 'Stock List' },
  { key: 'mic_inventory', label: 'Mic Inventory' },
]

function studioKeyFromLocation(loc: string | null): string {
  const l = (loc ?? '').toLowerCase()
  if (l.includes('paramount')) return 'paramount'
  if (l.includes('ameraycan')) return 'ameraycan'
  if (l.includes('encore')) return 'encore'
  if (l.includes('track')) return 'track'
  return ''
}

type LogRow = {
  key: string
  date: string
  studioKey: string
  type: string
  typeLabel: string
  runnerName: string | null
  approvedAt: string | null
  approvedBy: string | null
  needsAttention: boolean
  clientName: string | null
  artistName: string | null
  engineerName: string | null
  invoiceNum: string | null
  booking?: Booking
  opsCategory?: string
  opsStudio?: string
  opsDate?: string
  submission?: DailyOpsSubmission
}

function fmtTime(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export function DailyOpsLogSection() {
  const [rows, setRows] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStudio, setFilterStudio] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [woBooking, setWoBooking] = useState<Booking | null>(null)
  const [opsDetail, setOpsDetail] = useState<LogRow | null>(null)

  useEffect(() => { fetchLog() }, [])

  async function fetchLog() {
    setLoading(true)
    const [{ data: wos }, { data: ops }] = await Promise.all([
      supabase.from('work_orders').select('*')
        .or('admin_approved.eq.true,status.eq.approved')
        .order('admin_approved_at', { ascending: false, nullsFirst: false })
        .limit(500),
      supabase.from('daily_ops_submissions').select('*')
        .not('admin_approved_at', 'is', null)
        .order('admin_approved_at', { ascending: false })
        .limit(500),
    ])

    const bookingIds = (wos ?? []).map((w: any) => w.booking_id).filter(Boolean)
    let bookings: any[] = []
    if (bookingIds.length > 0) {
      const { data: bData } = await supabase.from('bookings').select('*').in('id', bookingIds)
      bookings = bData ?? []
    }
    const bookingMap: Record<string, Booking> = {}
    for (const b of bookings) bookingMap[b.id] = b as Booking

    const woRows: LogRow[] = (wos ?? []).map((w: any) => {
      const booking = w.booking_id ? bookingMap[w.booking_id] : undefined
      return {
        key: `wo-${w.id}`,
        date: w.session_date ?? w.created_at?.slice(0, 10) ?? '',
        studioKey: studioKeyFromLocation(booking?.location ?? null),
        type: 'wo',
        typeLabel: 'Work Order',
        runnerName: w.submitted_by ?? null,
        approvedAt: w.admin_approved_at ?? w.approved_at ?? null,
        approvedBy: w.approved_by ?? null,
        needsAttention: !!(w.needs_attention_notes),
        clientName: w.client ?? (booking as any)?.client_name ?? null,
        artistName: (booking as any)?.artist ?? null,
        engineerName: (booking as any)?.engineer_name ?? null,
        invoiceNum: w.invoice_number ?? null,
        booking,
      }
    })

    const opsRows: LogRow[] = (ops ?? []).map((o: any) => ({
      key: `ops-${o.id}`,
      date: o.date ?? '',
      studioKey: o.studio ?? '',
      type: o.category ?? '',
      typeLabel: CAT_LABELS[o.category] ?? o.category ?? '',
      runnerName: o.staff_name ?? null,
      approvedAt: o.admin_approved_at ?? null,
      approvedBy: o.admin_approved_by ?? null,
      needsAttention: !!(o.needs_attention),
      clientName: null,
      artistName: null,
      engineerName: null,
      invoiceNum: null,
      opsCategory: o.category,
      opsStudio: o.studio,
      opsDate: o.date,
      submission: {
        id: o.id, studio: o.studio, category: o.category, date: o.date,
        staff_name: o.staff_name, submitted_at: o.submitted_at,
        admin_approved_at: o.admin_approved_at, admin_approved_by: o.admin_approved_by,
      },
    }))

    const all = [...woRows, ...opsRows].sort((a, b) =>
      (b.approvedAt ?? '').localeCompare(a.approvedAt ?? '')
    )
    setRows(all)
    setLoading(false)
  }

  const filtered = rows.filter(r => {
    if (filterStudio !== 'all' && r.studioKey !== filterStudio) return false
    if (filterType !== 'all' && r.type !== filterType) return false
    if (filterFrom && r.date < filterFrom) return false
    if (filterTo && r.date > filterTo) return false
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const searchable = [r.clientName, r.artistName, STUDIO_LABELS[r.studioKey] ?? r.studioKey, r.engineerName, r.invoiceNum]
        .filter(Boolean).join(' ').toLowerCase()
      if (!searchable.includes(q)) return false
    }
    return true
  })

  const hasFilters = filterStudio !== 'all' || filterType !== 'all' || !!filterFrom || !!filterTo || !!searchQuery.trim()

  const inp: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '6px 10px', color: 'var(--text)',
    fontFamily: 'DM Mono, monospace', fontSize: 11, outline: 'none',
  }

  return (
    <>
      {/* Section header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 4 }}>Daily Ops Log</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>Approved work orders and daily task submissions</div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search client, artist, studio, engineer, invoice…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ ...inp, width: 280 }}
        />
        <select value={filterStudio} onChange={e => setFilterStudio(e.target.value)} style={inp}>
          {STUDIO_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={inp}>
          {TYPE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ ...inp, colorScheme: 'dark' }} />
        <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>→</span>
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ ...inp, colorScheme: 'dark' }} />
        {hasFilters && (
          <button
            onClick={() => { setFilterStudio('all'); setFilterType('all'); setFilterFrom(''); setFilterTo(''); setSearchQuery('') }}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', color: 'var(--text3)', fontSize: 11, fontFamily: 'DM Mono, monospace', cursor: 'pointer' }}
          >
            Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>
          {loading ? 'Loading…' : `${filtered.length} record${filtered.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '88px 110px 170px 1fr 150px 110px 24px',
          background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
          padding: '8px 16px', gap: 8,
        }}>
          {['Date', 'Studio', 'Type', 'Client / Runner', 'Approved', 'By', ''].map(h => (
            <span key={h} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', fontFamily: 'Syne' }}>{h}</span>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text3)', fontFamily: 'Syne' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text2)', fontFamily: 'Syne', marginBottom: 6 }}>
              {hasFilters ? 'No records match the current filters.' : 'No approved records yet.'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>
              Records appear here after admin approval in the daily ops panel.
            </div>
          </div>
        ) : (
          filtered.map((r, i) => {
            const color = STUDIO_COLORS[r.studioKey] ?? 'var(--text3)'
            const isWO  = r.type === 'wo'
            const canOpen = isWO ? !!r.booking : !!r.submission
            return (
              <div
                key={r.key}
                onClick={() => {
                  if (isWO && r.booking) setWoBooking(r.booking)
                  else if (!isWO && r.submission) setOpsDetail(r)
                }}
                onMouseEnter={e => (e.currentTarget.style.background = canOpen ? 'var(--surface2)' : 'transparent')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                style={{
                  display: 'grid', gridTemplateColumns: '88px 110px 170px 1fr 150px 110px 24px',
                  padding: '11px 16px', gap: 8,
                  cursor: canOpen ? 'pointer' : 'default',
                  transition: 'background 0.1s', background: 'transparent',
                  borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'DM Mono, monospace', alignSelf: 'center' }}>{r.date || '—'}</span>
                <span style={{ fontSize: 11, color, fontFamily: 'DM Mono, monospace', fontWeight: 700, alignSelf: 'center' }}>
                  {STUDIO_LABELS[r.studioKey] ?? (r.studioKey || '—')}
                </span>
                <div style={{ alignSelf: 'center' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, fontFamily: 'DM Mono, monospace', padding: '2px 7px', borderRadius: 4, color: isWO ? '#c8f04e' : 'var(--text2)', background: isWO ? '#c8f04e22' : 'var(--surface2)' }}>
                    {r.typeLabel}
                  </span>
                </div>
                <div style={{ alignSelf: 'center', overflow: 'hidden' }}>
                  {r.clientName && (
                    <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'Syne', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.clientName}</div>
                  )}
                  {r.runnerName && (
                    <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', marginTop: r.clientName ? 1 : 0 }}>
                      {r.clientName ? `Runner: ${r.runnerName}` : r.runnerName}
                    </div>
                  )}
                  {!r.clientName && !r.runnerName && <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>—</span>}
                </div>
                <div style={{ alignSelf: 'center' }}>
                  <div style={{ fontSize: 10, color: '#4ade80', fontFamily: 'DM Mono, monospace' }}>✓ {r.approvedAt ? fmtTime(r.approvedAt) : 'Approved'}</div>
                  {r.approvedAt && <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', marginTop: 1 }}>{r.approvedAt.slice(0, 10)}</div>}
                </div>
                <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', alignSelf: 'center' }}>{r.approvedBy ?? '—'}</span>
                <span style={{ alignSelf: 'center', textAlign: 'center' }}>
                  {r.needsAttention && <span style={{ fontSize: 13, color: '#f97316' }} title="Needs Attention">⚠</span>}
                </span>
              </div>
            )
          })
        )}
      </div>

      {woBooking && (
        <WorkOrderPopup
          booking={woBooking}
          onClose={() => setWoBooking(null)}
          onSaved={() => { setWoBooking(null); fetchLog() }}
        />
      )}
      {opsDetail?.submission && (
        <DailyOpsModal
          category={opsDetail.opsCategory ?? ''}
          studio={opsDetail.opsStudio ?? ''}
          today={opsDetail.opsDate ?? ''}
          color={STUDIO_COLORS[opsDetail.studioKey] ?? '#c8f04e'}
          studioLabel={STUDIO_LABELS[opsDetail.studioKey] ?? opsDetail.studioKey}
          submission={opsDetail.submission}
          onClose={() => setOpsDetail(null)}
          onApprove={async () => {}}
        />
      )}
    </>
  )
}
