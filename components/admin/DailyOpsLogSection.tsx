'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'

const STUDIO_META: Record<string, { label: string; abbr: string }> = {
  paramount: { label: 'Paramount', abbr: 'PRS' },
  encore:    { label: 'Encore',    abbr: 'ERS' },
  ameraycan: { label: 'Ameraycan', abbr: 'ARS' },
  track:     { label: 'Track',     abbr: 'TRS' },
}

const OPS_CATS = [
  { key: 'opening_checklist', label: 'Opening Checklist' },
  { key: 'closing_checklist', label: 'Closing Checklist' },
  { key: 'petty_cash',        label: 'Petty Cash' },
  { key: 'stock',             label: 'Stock List' },
  { key: 'mic_inventory',     label: 'Mic Inventory' },
]

const SESSION_TYPE_LABELS: Record<string, string> = {
  recording:      'Recording',
  filming:        'Filming',
  event_playback: 'Event/Playback',
}

function fmtDate(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function StatusDot({ status }: { status: 'all' | 'partial' | 'none' }) {
  const color = status === 'all' ? '#14B8A6' : status === 'partial' ? '#F97316' : '#6B7280'
  return (
    <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
  )
}

function CheckBox({ label, checked, color = '#14B8A6' }: { label: string; checked: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{
        width: 11, height: 11, borderRadius: 3, flexShrink: 0,
        border: `1.5px solid ${checked ? color : '#6B7280'}`,
        background: checked ? color : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && <span style={{ fontSize: 7, color: '#0d0f14', fontWeight: 900, lineHeight: 1 }}>✓</span>}
      </div>
      <span style={{
        fontSize: 9, fontFamily: 'DM Mono, monospace', fontWeight: 700,
        letterSpacing: '0.05em', color: checked ? color : '#6B7280',
      }}>
        {label}
      </span>
    </div>
  )
}

export function DailyOpsLogSection() {
  const [activeStudio, setActiveStudio] = useState<'paramount' | 'encore' | 'ameraycan' | 'track'>('paramount')
  const [dates, setDates] = useState<string[]>([])
  const [datesLoading, setDatesLoading] = useState(true)
  const [visibleCount, setVisibleCount] = useState(25)
  const [statusMap, setStatusMap] = useState<Record<string, 'all' | 'partial' | 'none'>>({})
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [dayData, setDayData] = useState<{ bookings: Booking[]; wos: any[]; opsRows: any[]; checklists: any[] } | null>(null)
  const [dayLoading, setDayLoading] = useState(false)
  const [woBooking, setWoBooking] = useState<Booking | null>(null)

  useEffect(() => {
    fetchDates()
  }, [activeStudio]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedDate) fetchDayData(selectedDate)
  }, [selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time: refresh the date list (and the open day, if any) when ops submissions
  // or work orders change. Read-only historical view, so a full refetch is safe.
  const fetchDatesRef = useRef(fetchDates)
  const fetchDayDataRef = useRef(fetchDayData)
  const selectedDateRef = useRef(selectedDate)
  useEffect(() => {
    fetchDatesRef.current = fetchDates
    fetchDayDataRef.current = fetchDayData
    selectedDateRef.current = selectedDate
  })
  useEffect(() => {
    const refresh = () => {
      fetchDatesRef.current()
      if (selectedDateRef.current) fetchDayDataRef.current(selectedDateRef.current)
    }
    const channel = supabase
      .channel('admin-ops-log')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_ops_submissions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, refresh)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchDates() {
    setDatesLoading(true)
    const meta = STUDIO_META[activeStudio]
    const [{ data: bookingDates }, { data: opsDates }, { data: checklistDates }] = await Promise.all([
      supabase.from('bookings').select('start_date').eq('status', 'confirmed'),
      supabase.from('daily_ops_submissions').select('date').eq('studio', activeStudio),
      supabase.from('checklists').select('date').eq('studio', activeStudio),
    ])
    const loc = activeStudio
    const abbr = meta.abbr.toLowerCase()
    const filteredBookingDates = (bookingDates ?? [])
      .filter((b: any) => (b.location ?? '').toLowerCase().includes(loc) || (b.location ?? '').toLowerCase().includes(abbr))
      .map((b: any) => b.start_date)
    const allDates = new Set([
      ...filteredBookingDates,
      ...(opsDates ?? []).map((o: any) => o.date),
      ...(checklistDates ?? []).map((c: any) => c.date),
    ])
    const sorted = Array.from(allDates).sort((a, b) => b.localeCompare(a))
    setDates(sorted)
    if (sorted.length === 0) {
      setStatusMap({})
      setDatesLoading(false)
      return
    }
    const { data: allOps } = await supabase
      .from('daily_ops_submissions')
      .select('date, category, submitted_at, admin_approved_at')
      .eq('studio', activeStudio)
      .in('date', sorted)
    const map: Record<string, 'all' | 'partial' | 'none'> = {}
    for (const date of sorted) {
      const rows = (allOps ?? []).filter((o: any) => o.date === date)
      const approvedCount = rows.filter((o: any) => o.admin_approved_at).length
      if (approvedCount >= OPS_CATS.length) map[date] = 'all'
      else if (rows.some((o: any) => o.submitted_at)) map[date] = 'partial'
      else map[date] = 'none'
    }
    setStatusMap(map)
    setDatesLoading(false)
  }

  async function fetchDayData(date: string) {
    setDayLoading(true)
    const meta = STUDIO_META[activeStudio]
    const loc = activeStudio
    const abbr = meta.abbr.toLowerCase()
    const [{ data: bData }, { data: opsData }, { data: clData }] = await Promise.all([
      supabase.from('bookings').select('*').lte('start_date', date).gte('end_date', date).eq('status', 'confirmed'),
      supabase.from('daily_ops_submissions').select('*').eq('studio', activeStudio).eq('date', date),
      supabase.from('checklists').select('*').eq('studio', activeStudio).eq('date', date),
    ])
    const bookings = (bData ?? []).filter((b: any) =>
      (b.location ?? '').toLowerCase().includes(loc) || (b.location ?? '').toLowerCase().includes(abbr)
    ) as Booking[]
    const bookingIds = bookings.map((b: any) => b.id)
    const { data: woData } = bookingIds.length
      ? await supabase.from('work_orders').select('*').in('booking_id', bookingIds)
      : { data: [] as any[] }
    setDayData({ bookings, wos: woData ?? [], opsRows: opsData ?? [], checklists: clData ?? [] })
    setDayLoading(false)
  }

  const meta = STUDIO_META[activeStudio]
  const visibleDates = dates.slice(0, visibleCount)

  return (
    <>
      {/* Section header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 4 }}>
          Daily Ops Log
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>
          Historical daily operations by studio
        </div>
      </div>

      {/* Studio tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {Object.entries(STUDIO_META).map(([key, m]) => {
          const active = activeStudio === key
          return (
            <button
              key={key}
              onClick={() => {
                if (activeStudio === key) return
                setActiveStudio(key as 'paramount' | 'encore' | 'ameraycan' | 'track')
                setDates([])
                setVisibleCount(25)
                setStatusMap({})
                setSelectedDate(null)
                setDayData(null)
              }}
              style={{
                padding: '6px 18px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontFamily: 'Syne', fontWeight: 700, fontSize: 11, letterSpacing: '0.05em',
                background: active ? '#1a1d27' : 'var(--surface)',
                color: active ? '#e8eaf2' : 'var(--text3)',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      {/* Date list */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {datesLoading ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>
            Loading…
          </div>
        ) : dates.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>
            No activity found for {meta.label}
          </div>
        ) : (
          <>
            {visibleDates.map((date, i) => {
              const status = statusMap[date] ?? 'none'
              return (
                <div
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 18px', cursor: 'pointer', transition: 'background 0.1s',
                    background: 'transparent',
                    borderBottom: i < visibleDates.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <StatusDot status={status} />
                    <span style={{ fontSize: 13, fontFamily: 'DM Mono, monospace', color: 'var(--text)' }}>
                      {fmtDate(date)}
                    </span>
                  </div>
                  <span style={{ fontSize: 14, color: 'var(--text3)' }}>›</span>
                </div>
              )
            })}
            {dates.length > visibleCount && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '12px 18px', textAlign: 'center' }}>
                <button
                  onClick={() => setVisibleCount(v => v + 25)}
                  style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                    padding: '6px 20px', color: 'var(--text3)', fontSize: 11,
                    fontFamily: 'DM Mono, monospace', cursor: 'pointer',
                  }}
                >
                  Load More ({dates.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Day modal */}
      {selectedDate && (
        <div
          onClick={e => e.target === e.currentTarget && setSelectedDate(null)}
          style={{
            position: 'fixed', inset: 0, background: '#000000cc', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px',
          }}
        >
          <div style={{
            background: 'var(--bg)', width: '100%', maxWidth: 760,
            maxHeight: '88dvh', borderRadius: 16, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 32px 96px #0009',
            border: '1px solid var(--border)',
          }}>
            {/* Modal header */}
            <div style={{
              padding: '18px 26px 14px', borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
            }}>
              <div>
                <div style={{ fontFamily: 'Syne', fontWeight: 900, fontSize: 18, color: 'var(--text)' }}>
                  {meta.label}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
                  {fmtDate(selectedDate)} · Daily Ops
                </div>
              </div>
              <button
                onClick={() => setSelectedDate(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            {/* Modal body */}
            {dayLoading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontFamily: 'Syne' }}>
                Loading…
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Sessions / WO cards */}
                <div>
                  <SectionHeader title="Sessions" />
                  {dayData && dayData.bookings.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {dayData.bookings.map(booking => {
                        const wo = dayData.wos.find((w: any) => w.booking_id === booking.id) ?? null
                        const completed = wo?.status === 'completed'
                        const needsAttn = !!(wo?.needs_attention_notes)
                        const borderColor = completed ? '#14B8A6' : needsAttn ? '#F97316' : 'var(--border)'
                        return (
                          <div
                            key={booking.id}
                            onClick={() => setWoBooking(booking)}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface)')}
                            style={{
                              background: 'var(--surface)',
                              border: `1px solid ${borderColor}`,
                              borderRadius: 10, padding: '12px 14px',
                              cursor: 'pointer', transition: 'background 0.1s',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'Syne' }}>
                                  {booking.artist || booking.client_name || '—'}
                                </div>
                                {booking.artist && booking.client_name && (
                                  <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 1, fontFamily: 'DM Mono, monospace' }}>
                                    {booking.client_name}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {needsAttn && (
                                  <span style={{ fontSize: 9, fontWeight: 700, color: '#F97316', background: '#F9731622', padding: '2px 7px', borderRadius: 4, fontFamily: 'DM Mono, monospace' }}>
                                    ⚠ Needs Attention
                                  </span>
                                )}
                                {completed ? (
                                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#14B8A6', background: '#14B8A622', padding: '2px 7px', borderRadius: 4, fontFamily: 'DM Mono, monospace' }}>
                                    COMPLETED
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B7280', background: '#6B728022', padding: '2px 7px', borderRadius: 4, fontFamily: 'DM Mono, monospace' }}>
                                    OPEN
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
                              {booking.from_time && (
                                <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono, monospace' }}>
                                  {booking.from_time}–{booking.to_time ?? '?'}
                                </span>
                              )}
                              {booking.studio && (
                                <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono, monospace' }}>
                                  Studio {booking.studio}
                                </span>
                              )}
                              {booking.session_type && (
                                <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>
                                  {SESSION_TYPE_LABELS[booking.session_type] ?? booking.session_type}
                                </span>
                              )}
                              {booking.engineer_name && (
                                <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono, monospace' }}>
                                  Eng: {booking.engineer_name}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingTop: 9, borderTop: '1px solid var(--border)' }}>
                              {wo && (
                                <a
                                  href={`/wo/${wo.id}/print`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'Syne, sans-serif', textDecoration: 'none', padding: '4px 9px', border: '1px solid var(--border)', borderRadius: 6 }}
                                >
                                  PDF
                                </a>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', padding: '8px 0' }}>
                      No confirmed sessions for this date.
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: 'var(--border)', flexShrink: 0 }} />

                {/* Daily tasks checklist rows */}
                <div>
                  <SectionHeader title="Daily Tasks" />
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    {OPS_CATS.map((cat, i) => {
                      const row = dayData?.opsRows.find((o: any) => o.category === cat.key) ?? null
                      const clType = cat.key.replace('_checklist', '')
                      const cl = dayData?.checklists.find((c: any) => c.type === clType) ?? null
                      const runnerDone = !!row?.submitted_at
                      const adminDone = !!row?.admin_approved_at
                      const isChecklist = cat.key === 'opening_checklist' || cat.key === 'closing_checklist'
                      const items: any[] = cl?.items ?? []
                      const checkedCount = items.filter((it: any) => it.checked).length
                      const totalCount = items.length
                      return (
                        <div
                          key={cat.key}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '12px 16px',
                            borderBottom: i < OPS_CATS.length - 1 ? '1px solid var(--border)' : 'none',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'Syne', fontWeight: 600 }}>
                              {cat.label}
                            </div>
                            {isChecklist && totalCount > 0 && (
                              <div style={{ fontSize: 9, color: runnerDone ? '#4ade80' : 'var(--text3)', fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
                                {checkedCount}/{totalCount} checked
                              </div>
                            )}
                            {row?.staff_name && (
                              <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
                                {row.staff_name}{row.submitted_at ? ` · ${fmtTime(row.submitted_at)}` : ''}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <CheckBox label="Runner" checked={runnerDone} color="#c8f04e" />
                            <CheckBox label="Admin" checked={adminDone} color="#14B8A6" />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      )}

      {/* WO popup */}
      {woBooking && (
        <WorkOrderPopup
          booking={woBooking}
          onClose={() => setWoBooking(null)}
          onSaved={() => setWoBooking(null)}
        />
      )}
    </>
  )
}
