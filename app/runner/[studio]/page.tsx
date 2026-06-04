'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import type { Booking } from '@/lib/supabase'

function getLocalToday(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

const STUDIO_META: Record<string, { label: string; abbr: string; color: string }> = {
  paramount: { label: 'Paramount', abbr: 'PRS', color: '#c8f04e' },
  ameraycan: { label: 'Ameraycan', abbr: 'ARS', color: '#f04e7a' },
  encore: { label: 'Encore', abbr: 'ERS', color: '#4e8ff0' },
  track: { label: 'Track', abbr: 'TRS', color: '#f0a24e' },
}

type WOStatus = { id: string; status: string } | null

export default function StudioDailyOpsPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio, abbr: '?', color: '#c8f04e' }

  const [bookings, setBookings] = useState<Booking[]>([])
  const [woMap, setWoMap] = useState<Record<string, WOStatus>>({})
  const [loading, setLoading] = useState(true)

  // Stable today string — local calendar date matching how bookings are stored
  const today = getLocalToday()

  const load = useCallback(async () => {
    const { data: bData } = await supabase
      .from('bookings')
      .select('*')
      .eq('start_date', today)
      .not('status', 'eq', 'cancelled')
      .order('from_time', { ascending: true })

    const filtered = (bData ?? []).filter((b: Booking) => {
      const loc = (b.location ?? '').toLowerCase()
      return loc.includes(studio) || loc.includes(meta.abbr.toLowerCase())
    })
    setBookings(filtered)

    if (filtered.length > 0) {
      const ids = filtered.map((b: Booking) => b.id)
      const { data: wos } = await supabase
        .from('work_orders')
        .select('id, booking_id, status')
        .in('booking_id', ids)
      const map: Record<string, WOStatus> = {}
      for (const wo of wos ?? []) {
        if (wo.booking_id) map[wo.booking_id] = { id: wo.id, status: wo.status }
      }
      setWoMap(map)
    } else {
      setWoMap({})
    }
    setLoading(false)
  }, [studio, today, meta.abbr]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load
  useEffect(() => { load() }, [load])

  // Real-time: re-run load on any booking change for today
  useEffect(() => {
    const channel = supabase
      .channel(`runner-bookings-${studio}-${today}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
        filter: `start_date=eq.${today}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studio, today, load])

  // Real-time: re-run load when a WO for today is updated (e.g. admin approves)
  useEffect(() => {
    const channel = supabase
      .channel(`runner-wos-${studio}-${today}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'work_orders',
        filter: `session_date=eq.${today}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studio, today, load])

  function statusBadge(status: string) {
    const colors: Record<string, string> = {
      confirmed: '#c8f04e',
      tentative: '#f0a24e',
      tour: '#4e8ff0',
      tech: '#a24ef0',
      open_hours: '#8b90a8',
    }
    return (
      <span style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: colors[status] ?? '#8b90a8',
        background: (colors[status] ?? '#8b90a8') + '22',
        padding: '2px 7px',
        borderRadius: 4,
        fontFamily: 'DM Mono, monospace',
      }}>
        {status}
      </span>
    )
  }

  function woStatusBadge(wo: WOStatus) {
    if (!wo) return <span style={{ fontSize: 10, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>No WO</span>
    const colors: Record<string, string> = { draft: '#8b90a8', submitted: '#f0a24e', approved: '#c8f04e' }
    const c = colors[wo.status] ?? '#8b90a8'
    return (
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: c, background: c + '22', padding: '2px 7px', borderRadius: 4,
        fontFamily: 'DM Mono, monospace',
      }}>
        {wo.status}
      </span>
    )
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#0d0f14',
      fontFamily: 'Syne, sans-serif',
      padding: '0 0 80px',
    }}>
      {/* Header */}
      <div style={{
        background: '#161920',
        borderBottom: `3px solid ${meta.color}`,
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <button
          onClick={() => router.push('/runner')}
          style={{ background: 'none', border: 'none', color: '#8b90a8', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}
        >
          ←
        </button>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: meta.color + '20',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, color: meta.color, fontFamily: 'DM Mono, monospace',
        }}>
          {meta.abbr}
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#e8eaf2' }}>{meta.label}</div>
          <div style={{ fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 16px' }}>
        {/* Today's Sessions */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b90a8', marginBottom: 12 }}>
            Today's Sessions{!loading && ` · ${bookings.length}`}
          </div>

          {loading ? (
            <div style={{ color: '#8b90a8', fontSize: 13, textAlign: 'center', padding: 32 }}>Loading…</div>
          ) : bookings.length === 0 ? (
            <div style={{ color: '#8b90a8', fontSize: 13, textAlign: 'center', padding: 32, background: '#161920', borderRadius: 12, border: '1px solid #2a2e3d' }}>
              No sessions today
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {bookings.map(b => {
                const wo = woMap[b.id] ?? null
                return (
                  <div
                    key={b.id}
                    onClick={() => {
                      if (wo) {
                        router.push(`/runner/${studio}/wo/${wo.id}`)
                      } else {
                        router.push(`/runner/${studio}/wo/new?booking_id=${b.id}`)
                      }
                    }}
                    style={{
                      background: '#161920',
                      border: '1px solid #2a2e3d',
                      borderRadius: 12,
                      padding: '14px 16px',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#e8eaf2', marginBottom: 2 }}>
                          {b.client_name || b.artist || '—'}
                        </div>
                        {b.artist && b.client_name && (
                          <div style={{ fontSize: 11, color: '#8b90a8' }}>{b.artist}</div>
                        )}
                      </div>
                      {statusBadge(b.status)}
                    </div>

                    <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>
                        {b.from_time ?? '?'} – {b.to_time ?? '?'}
                      </span>
                      {b.studio && (
                        <span style={{ fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>
                          Studio {b.studio}
                        </span>
                      )}
                      {b.engineer_name && (
                        <span style={{ fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>
                          Eng: {b.engineer_name}
                        </span>
                      )}
                    </div>

                    {woStatusBadge(wo)}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b90a8', marginBottom: 12 }}>
            Quick Actions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Opening Checklist', icon: '☑', route: `/runner/${studio}/checklist/opening` },
              { label: 'Closing Checklist', icon: '☑', route: `/runner/${studio}/checklist/closing` },
              { label: 'Petty Cash', icon: '$', route: `/runner/${studio}/petty-cash` },
              { label: 'Stock List', icon: '📦', route: `/runner/${studio}/stock` },
              { label: 'Mic Inventory', icon: '🎙', route: `/runner/${studio}/mics` },
            ].map(a => (
              <button
                key={a.route}
                onClick={() => router.push(a.route)}
                style={{
                  background: '#161920',
                  border: '1px solid #2a2e3d',
                  borderRadius: 12,
                  padding: '16px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: '#e8eaf2',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 20 }}>{a.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
