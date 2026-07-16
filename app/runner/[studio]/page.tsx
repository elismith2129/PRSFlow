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


const STUDIO_META: Record<string, { label: string; abbr: string }> = {
  paramount: { label: 'Paramount', abbr: 'PRS' },
  ameraycan: { label: 'Ameraycan', abbr: 'ARS' },
  encore: { label: 'Encore', abbr: 'ERS' },
  track: { label: 'Track', abbr: 'TRS' },
}

type WOStatus = { id: string; status: string } | null

export default function StudioDailyOpsPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio, abbr: '?' }

  const [bookings, setBookings] = useState<Booking[]>([])
  const [woMap, setWoMap] = useState<Record<string, WOStatus>>({})
  const [loading, setLoading] = useState(true)
  const [submittedCategories, setSubmittedCategories] = useState<Set<string>>(new Set())

  // Stable today string — local calendar date matching how bookings are stored
  const today = getLocalToday()

  const load = useCallback(async () => {
    // ── Today ──────────────────────────────────────────────────────────────
    const { data: bData } = await supabase
      .from('bookings')
      .select('*')
      .lte('start_date', today)
      .gte('end_date', today)
      .eq('status', 'confirmed')
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
        .select('id, booking_id, status, created_at')
        .in('booking_id', ids)
        .order('created_at', { ascending: true })
      const map: Record<string, WOStatus> = {}
      for (const wo of wos ?? []) {
        // First-wins (earliest created): deterministic if legacy duplicate WOs exist,
        // and the same earliest row the runner WO page adopts when the card is tapped.
        // The unique constraint on booking_id makes one-WO-per-booking the steady state.
        // `.in('booking_id', ids)` already excludes null booking_id rows, so the guard
        // below is defensive only — every row here maps to a real booking.
        if (wo.booking_id && !map[wo.booking_id]) map[wo.booking_id] = { id: wo.id, status: wo.status }
      }
      setWoMap(map)
    } else {
      setWoMap({})
    }

    setLoading(false)

    const [{ data: checklistData }, { data: opsData }] = await Promise.all([
      supabase
        .from('checklists')
        .select('type, completed_at')
        .eq('studio', studio)
        .eq('date', today),
      supabase
        .from('daily_ops_submissions')
        .select('category, submitted_at')
        .eq('studio', studio)
        .eq('date', today),
    ])
    const submitted = new Set([
      ...(checklistData ?? [])
        .filter((s: { type: string; completed_at: string | null }) => s.completed_at !== null)
        .map((s: { type: string }) => s.type),
      ...(opsData ?? [])
        .filter((s: { category: string; submitted_at: string | null }) => s.submitted_at !== null)
        .map((s: { category: string }) => s.category),
    ])
    setSubmittedCategories(submitted)
  }, [studio, today, meta.abbr]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load
  useEffect(() => { load() }, [load])

  // Real-time: re-run load on any booking change
  useEffect(() => {
    const channel = supabase
      .channel(`runner-bookings-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studio, load])

  // Real-time: re-run load when a WO for today is updated (e.g. admin approves)
  useEffect(() => {
    console.log(`[RT] Subscribing to work_orders on /runner/${studio}, filter: session_date=eq.${today}`)
    const channel = supabase
      .channel(`runner-wos-${studio}-${today}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'work_orders',
        filter: `session_date=eq.${today}`,
      }, (payload) => {
        console.log(`[RT] Real-time event received on /runner/${studio}, work_orders:`, payload)
        load()
      })
      .subscribe((status, err) => {
        console.log(`[RT] work_orders subscription status on /runner/${studio}:`, status, err ?? '')
      })
    return () => {
      console.log(`[RT] Unsubscribing from work_orders on /runner/${studio}`)
      supabase.removeChannel(channel)
    }
  }, [studio, today, load])


  function statusBadge(status: string) {
    const colors: Record<string, string> = {
      confirmed: 'var(--accent)',
      tentative: '#f0a24e',
      tour: 'var(--accent2)',
      tech: '#a24ef0',
      open_hours: 'var(--text2)',
    }
    return (
      <span style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: colors[status] ?? 'var(--text2)',
        background: (colors[status] ?? 'var(--text2)') + '22',
        padding: '2px 7px',
        borderRadius: 4,
        fontFamily: 'Inter',
      }}>
        {status}
      </span>
    )
  }

  function woStatusBadge(wo: WOStatus) {
    if (!wo) return <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'Inter' }}>No WO</span>
    if (wo.status === 'completed') return null
    const colors: Record<string, string> = { draft: 'var(--text2)', submitted: '#f0a24e', approved: 'var(--accent)' }
    const c = colors[wo.status] ?? 'var(--text2)'
    return (
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: c, background: c + '22', padding: '2px 7px', borderRadius: 4,
        fontFamily: 'Inter',
      }}>
        {wo.status}
      </span>
    )
  }

  return (
    <div style={{
      minHeight: '100dvh',
      maxWidth: '100vw',
      overflowX: 'hidden',
      background: 'var(--bg)',
      fontFamily: 'Syne, sans-serif',
      padding: '0 0 80px',
    }}>
      {/* Header */}
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
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
          style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}
        >
          ←
        </button>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, color: 'rgba(232,234,240,0.7)', fontFamily: 'Inter',
        }}>
          {meta.abbr}
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{meta.label}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'Inter' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 16px' }}>
        {/* Today's Sessions */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 12 }}>
            Today's Sessions{!loading && ` · ${bookings.length}`}
          </div>

          {loading ? (
            <div style={{ color: 'var(--text2)', fontSize: 13, textAlign: 'center', padding: 32 }}>Loading…</div>
          ) : bookings.length === 0 ? (
            <div style={{ color: 'var(--text2)', fontSize: 13, textAlign: 'center', padding: 32, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
              No sessions today
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {bookings.map(b => {
                const wo = woMap[b.id] ?? null
                const completed = wo?.status === 'completed'
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
                      background: 'var(--surface)',
                      border: completed ? '1px solid var(--booked)' : '1px solid var(--border)',
                      borderRadius: 12,
                      padding: '14px 16px',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
                          {b.artist || b.client_name || '—'}
                        </div>
                        {b.artist && b.client_name && (
                          <div style={{ fontSize: 11, color: 'var(--text2)' }}>{b.client_name}</div>
                        )}
                      </div>
                      {completed && (
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--booked)', background: '#14B8A622', padding: '2px 7px', borderRadius: 4, fontFamily: 'Inter' }}>COMPLETED</span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'Inter' }}>
                        {b.from_time ?? '?'} – {b.to_time ?? '?'}
                      </span>
                      {b.studio && (
                        <span style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'Inter' }}>
                          Studio {b.studio}
                        </span>
                      )}
                      {b.engineer_name && (
                        <span style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'Inter' }}>
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
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 12 }}>
            Quick Actions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Opening Checklist', icon: '☑', route: `/runner/${studio}/checklist/opening`, category: 'opening' },
              { label: 'Closing Checklist', icon: '☑', route: `/runner/${studio}/checklist/closing`, category: 'closing' },
              { label: 'Petty Cash', icon: '$', route: `/runner/${studio}/petty-cash`, category: 'petty_cash' },
              { label: 'Stock List', icon: '📦', route: `/runner/${studio}/stock`, category: 'stock' },
              { label: 'Mic Inventory', icon: '🎙', route: `/runner/${studio}/mics`, category: 'mic_inventory' },
            ].map(a => (
              <button
                key={a.route}
                onClick={() => router.push(a.route)}
                style={{
                  background: 'var(--surface)',
                  border: submittedCategories.has(a.category) ? '1px solid var(--booked)' : '1px solid var(--border)',
                  borderRadius: 12,
                  padding: '16px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--text)',
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
