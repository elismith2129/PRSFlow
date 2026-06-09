'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'

// ─── Types ────────────────────────────────────────────────────────────────────

type WoStatus = 'in_progress' | 'submitted' | 'approved' | 'archived'

type WoEntry = {
  woId: string
  woDbStatus: string
  invoiceNum: string | null
  booking: Booking
  status: WoStatus
  total: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<WoStatus, string> = {
  in_progress: '#6B7280',
  submitted:   '#F97316',
  approved:    '#14B8A6',
  archived:    '#3B82F6',
}

const STATUS_BG: Record<WoStatus, string> = {
  in_progress: 'rgba(107,114,128,0.13)',
  submitted:   'rgba(249,115,22,0.13)',
  approved:    'rgba(20,184,166,0.13)',
  archived:    'rgba(59,130,246,0.13)',
}

const STATUS_LABELS: Record<WoStatus, string> = {
  in_progress: 'IN PROGRESS',
  submitted:   'SUBMITTED',
  approved:    'APPROVED',
  archived:    'ARCHIVED',
}

const STUDIO_PILLS = ['ALL', 'PRS', 'ARS', 'ERS', 'TRK'] as const
const STATUS_PILLS  = ['ALL', 'IN PROGRESS', 'SUBMITTED', 'APPROVED', 'ARCHIVED'] as const

type StudioFilter = typeof STUDIO_PILLS[number]
type StatusFilter  = typeof STATUS_PILLS[number]

const VENUE_MAP: Record<string, StudioFilter> = {
  Paramount: 'PRS',
  Ameraycan: 'ARS',
  Encore:    'ERS',
  Track:     'TRK',
}

const STATUS_FILTER_MAP: Partial<Record<StatusFilter, WoStatus>> = {
  'IN PROGRESS': 'in_progress',
  'SUBMITTED':   'submitted',
  'APPROVED':    'approved',
  'ARCHIVED':    'archived',
}

// session_type values to exclude (historical import data uses these)
const EXCLUDED_TYPES = new Set(['tech', 'tour', 'open_hours'])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVenuePill(location: string): StudioFilter | null {
  const venue = (location || '').split(' · ')[0]
  return VENUE_MAP[venue] ?? null
}

function deriveStatus(
  stRows: { status: string | null }[],
  woDbStatus: string,
): WoStatus {
  if (woDbStatus === 'archived') return 'archived'
  if (stRows.length === 0) return 'in_progress'
  if (stRows.every(r => r.status === 'approved')) return 'approved'
  if (stRows.some(r => r.status === 'submitted')) return 'submitted'
  return 'in_progress'
}

function computeTotal(
  stRows: { charge: number | null; eng_charge: number | null }[],
): number {
  return stRows.reduce(
    (s, r) => s + (Number(r.charge) || 0) + (Number(r.eng_charge) || 0),
    0,
  )
}

function fmtDateRange(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  const base = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (start === end) return base
  if (
    s.getMonth() === e.getMonth() &&
    s.getFullYear() === e.getFullYear()
  ) {
    return `${base}–${e.getDate()}`
  }
  return `${base}–${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isCod(paymentType: string): boolean {
  const t = (paymentType || '').toLowerCase()
  return t === 'cod' || t === 'individual'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WoHubPage() {
  const [entries, setEntries]           = useState<WoEntry[]>([])
  const [loading, setLoading]           = useState(true)
  const [studioFilter, setStudioFilter] = useState<StudioFilter>('ALL')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)

  const load = useCallback(async () => {
    const { data: wos } = await supabase
      .from('work_orders')
      .select('id, booking_id, invoice_number, status')
      .not('booking_id', 'is', null)

    if (!wos?.length) {
      setEntries([])
      setLoading(false)
      return
    }

    const seenIds: Record<string, true> = {}
    wos.forEach((w: any) => { if (w.booking_id) seenIds[w.booking_id] = true })
    const bookingIds = Object.keys(seenIds)
    const woIds      = wos.map((w: any) => w.id) as string[]

    const [{ data: bookings }, { data: stRowsRaw }] = await Promise.all([
      supabase.from('bookings').select('*').in('id', bookingIds),
      supabase
        .from('studio_time_rows')
        .select('work_order_id, status, charge, eng_charge')
        .in('work_order_id', woIds),
    ])

    const bookingMap = new Map<string, Booking>(
      (bookings || []).map((b: any) => [b.id, b as Booking]),
    )

    const stRowMap = new Map<string, any[]>()
    for (const r of (stRowsRaw || [])) {
      const arr = stRowMap.get(r.work_order_id) ?? []
      arr.push(r)
      stRowMap.set(r.work_order_id, arr)
    }

    const result: WoEntry[] = []
    for (const wo of wos) {
      const booking = bookingMap.get(wo.booking_id)
      if (!booking) continue

      const st = (booking.session_type || '').toLowerCase()
      if (EXCLUDED_TYPES.has(st)) continue

      const rows   = stRowMap.get(wo.id) ?? []
      const status = deriveStatus(rows, wo.status || '')
      const total  = computeTotal(rows)

      result.push({
        woId:       wo.id,
        woDbStatus: wo.status || '',
        invoiceNum: wo.invoice_number,
        booking,
        status,
        total,
      })
    }

    // Most recent sessions first
    result.sort((a, b) =>
      b.booking.start_date > a.booking.start_date ? 1 : -1,
    )

    setEntries(result)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Realtime: re-derive status when runner submits or admin approves a row
  useEffect(() => {
    const channel = supabase
      .channel('wo-hub-strows')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'studio_time_rows' },
        () => load(),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const filtered = entries.filter(e => {
    if (studioFilter !== 'ALL' && getVenuePill(e.booking.location) !== studioFilter) return false
    const target = STATUS_FILTER_MAP[statusFilter]
    if (target && e.status !== target) return false
    return true
  })

  // ─── Styles ─────────────────────────────────────────────────────────────────

  function pillStyle(active: boolean) {
    return {
      padding: '5px 14px',
      borderRadius: 20,
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background: active ? 'rgba(200,240,78,0.12)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text3)',
      fontSize: 11,
      fontFamily: 'DM Mono',
      fontWeight: 500,
      cursor: 'pointer',
      transition: 'all 0.1s',
    } as const
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'Syne', fontWeight: 800, fontSize: 28,
          letterSpacing: -1, color: 'var(--text)', margin: 0,
        }}>
          WO HUB
        </h1>
        <p style={{
          margin: '4px 0 0', fontSize: 12,
          color: 'var(--text3)', fontFamily: 'DM Mono',
        }}>
          All work orders across all studios
        </p>
      </div>

      {/* Studio filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {STUDIO_PILLS.map(s => (
          <button key={s} onClick={() => setStudioFilter(s)} style={pillStyle(studioFilter === s)}>
            {s}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 28, flexWrap: 'wrap' }}>
        {STATUS_PILLS.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s as StatusFilter)}
            style={pillStyle(statusFilter === s)}
          >
            {s}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{
          textAlign: 'center', color: 'var(--text3)',
          fontFamily: 'DM Mono', fontSize: 13, padding: '60px 0',
        }}>
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', color: 'var(--text3)',
          fontFamily: 'DM Mono', fontSize: 13, padding: '60px 0',
        }}>
          No work orders found
        </div>
      ) : (
        <div>
          {filtered.map(e => {
            const cod  = isCod(e.booking.payment_type)
            const pill = getVenuePill(e.booking.location)

            return (
              <div
                key={e.woId}
                onClick={() => setSelectedBooking(e.booking)}
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  overflow: 'hidden',
                  marginBottom: 6,
                }}
              >
                {/* Left status bar */}
                <div style={{
                  width: 4,
                  background: STATUS_COLORS[e.status],
                  flexShrink: 0,
                }} />

                {/* Row content */}
                <div style={{
                  flex: 1,
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  minWidth: 0,
                }}>
                  {/* Client + artist */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'DM Mono', fontWeight: 700, fontSize: 13,
                      color: 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {e.booking.client_name || '—'}
                    </div>
                    {e.booking.artist && e.booking.artist !== e.booking.client_name && (
                      <div style={{
                        fontSize: 11, color: 'var(--text2)',
                        fontFamily: 'DM Mono', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {e.booking.artist}
                      </div>
                    )}
                  </div>

                  {/* Studio pill */}
                  {pill && (
                    <div style={{
                      fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700,
                      letterSpacing: '0.06em',
                      background: 'var(--surface2)', color: 'var(--text2)',
                      border: '1px solid var(--border)',
                      borderRadius: 4, padding: '2px 6px', flexShrink: 0,
                    }}>
                      {pill}
                    </div>
                  )}

                  {/* Date range */}
                  <div style={{
                    fontSize: 11, color: 'var(--text2)',
                    fontFamily: 'DM Mono', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {fmtDateRange(e.booking.start_date, e.booking.end_date)}
                  </div>

                  {/* Invoice number */}
                  <div style={{
                    fontSize: 11, color: 'var(--text3)',
                    fontFamily: 'DM Mono', flexShrink: 0,
                  }}>
                    {e.invoiceNum ? `#${e.invoiceNum}` : '—'}
                  </div>

                  {/* Payment type badge */}
                  <div style={{
                    fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700,
                    letterSpacing: '0.06em',
                    background: cod ? 'rgba(109,127,199,0.15)' : 'rgba(150,169,255,0.15)',
                    color: cod ? '#6D7FC7' : '#96A9FF',
                    border: `1px solid ${cod ? '#6D7FC7' : '#96A9FF'}`,
                    borderRadius: 4, padding: '2px 6px', flexShrink: 0,
                  }}>
                    {cod ? 'COD' : 'LABEL'}
                  </div>

                  {/* Total */}
                  <div style={{
                    fontSize: 13, fontFamily: 'DM Mono', fontWeight: 700,
                    color: 'var(--text)', flexShrink: 0, minWidth: 90, textAlign: 'right',
                  }}>
                    {e.total > 0 ? fmtMoney(e.total) : '—'}
                  </div>

                  {/* Status badge */}
                  <div style={{
                    fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700,
                    letterSpacing: '0.06em',
                    background: STATUS_BG[e.status],
                    color: STATUS_COLORS[e.status],
                    border: `1px solid ${STATUS_COLORS[e.status]}`,
                    borderRadius: 4, padding: '2px 8px',
                    flexShrink: 0, whiteSpace: 'nowrap',
                  }}>
                    {STATUS_LABELS[e.status]}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* WO Popup */}
      {selectedBooking && (
        <WorkOrderPopup
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  )
}
