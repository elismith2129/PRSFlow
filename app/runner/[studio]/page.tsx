'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import type { Booking } from '@/lib/supabase'
import { getLocalToday } from '@/lib/time'



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
      // ── Resolving a booking card → its work order ────────────────────────
      // Since the July 2026 rebuild the WO is the source of truth and `bookings`
      // rows are PROJECTION CARDS it writes on save — one per consecutive
      // same-room run, ALL carrying `work_order_id`. But `work_orders.booking_id`
      // points at only ONE of them (the original).
      //
      // So the old lookup — "which WO has booking_id = this card?" — resolved
      // for the original card and silently failed for every other one, sending
      // the runner to /wo/new and the dead-end "Work order not yet created"
      // screen. Any multi-day or multi-room session hit it.
      //
      // Read the card's OWN forward link first; keep the reverse link as a
      // fallback for pre-rebuild rows whose work_order_id was never populated.
      const bookingIds = filtered.map((b: Booking) => b.id)
      const woIds = Array.from(
        new Set(filtered.map((b: Booking) => b.work_order_id).filter(Boolean)),
      ) as string[]

      const [byWoId, byBookingId] = await Promise.all([
        woIds.length
          ? supabase.from('work_orders').select('id, status').in('id', woIds)
          : Promise.resolve({ data: [] as { id: string; status: string }[] }),
        supabase
          .from('work_orders')
          .select('id, booking_id, status, created_at')
          .in('booking_id', bookingIds)
          .order('created_at', { ascending: true }),
      ])

      const woById: Record<string, WOStatus> = {}
      for (const wo of byWoId.data ?? []) woById[wo.id] = { id: wo.id, status: wo.status }

      const legacyByBooking: Record<string, WOStatus> = {}
      for (const wo of byBookingId.data ?? []) {
        // First-wins (earliest created): deterministic if legacy duplicate WOs
        // exist, and the same row the WO page adopts when the card is tapped.
        if (wo.booking_id && !legacyByBooking[wo.booking_id]) {
          legacyByBooking[wo.booking_id] = { id: wo.id, status: wo.status }
        }
      }

      const map: Record<string, WOStatus> = {}
      for (const b of filtered) {
        const found = (b.work_order_id ? woById[b.work_order_id] : undefined)
          ?? legacyByBooking[b.id]
        if (found) map[b.id] = found
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


  // ── Presentation ───────────────────────────────────────────────────────────
  // SOFT SKIN PORT, 2026-08-13 (spec §15, option A "Day card"). Everything above
  // this line — the queries, the booking→WO resolution, both realtime channels —
  // is UNTOUCHED. This half was the old skin: legacy --bg/--surface tokens, 1px
  // borders everywhere (Law 1), DM Serif Display and Syne (both retired, §4),
  // per-studio colour, and emoji tiles.
  //
  // Phone-first: every tap target clears 44px, nothing scrolls sideways.

  /** The work order's state, as a status pill. Same three cases as before. */
  function woPill(wo: WOStatus) {
    if (!wo) return <span className="c-pill" style={dimPill}>No WO</span>
    if (wo.status === 'completed') {
      return <span className="c-pill c-fill-booked">Completed</span>
    }
    return <span className="c-pill c-fill-warm">{wo.status}</span>
  }

  const dimPill: React.CSSProperties = {
    background: 'var(--c-wash2)', color: 'var(--c-fg)', opacity: 0.7,
  }

  // A card surface. Flat + soft shadow (§7c) — no carving, no borders.
  const surface: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))',
    boxShadow: 'var(--c-softsh)',
    borderRadius: 18,
    padding: '13px 14px',
  }

  const TILES = [
    { label: 'Opening checklist', route: `/runner/${studio}/checklist/opening`, category: 'opening' },
    { label: 'Closing checklist', route: `/runner/${studio}/checklist/closing`, category: 'closing' },
    { label: 'Mic inventory', route: `/runner/${studio}/mics`, category: 'mic_inventory' },
    { label: 'Petty cash', route: `/runner/${studio}/petty-cash`, category: 'petty_cash' },
    { label: 'Stock list', route: `/runner/${studio}/stock`, category: 'stock' },
  ]

  return (
    <div style={{
      minHeight: '100dvh',
      maxWidth: '100vw',
      overflowX: 'hidden',
      background: 'var(--c-bg)',
      color: 'var(--c-fg)',
      paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
    }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '14px 16px 10px',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--c-bg)',
      }}>
        <button
          onClick={() => router.push('/runner')}
          aria-label="Back to studio list"
          className="c-control c-raised"
          style={{
            width: 38, height: 38, borderRadius: 99, flexShrink: 0,
            background: 'var(--c-wash)', color: 'var(--c-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, cursor: 'pointer',
          }}
        >←</button>
        <div style={{ minWidth: 0 }}>
          <div className="c-arch" style={{ fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {meta.label}
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.5 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      <div style={{ padding: '4px 14px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Today's sessions ────────────────────────────────────────────── */}
        <div>
          <div className="c-label" style={{ marginBottom: 9 }}>
            Today{!loading && ` · ${bookings.length} ${bookings.length === 1 ? 'session' : 'sessions'}`}
          </div>

          {loading ? (
            <div style={{ ...surface, textAlign: 'center', opacity: 0.5, fontSize: 13, padding: 28 }}>
              Loading…
            </div>
          ) : bookings.length === 0 ? (
            <div style={{ ...surface, textAlign: 'center', opacity: 0.5, fontSize: 13, padding: 28 }}>
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
                      if (wo) router.push(`/runner/${studio}/wo/${wo.id}`)
                      else router.push(`/runner/${studio}/wo/new?booking_id=${b.id}`)
                    }}
                    style={{ ...surface, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        {/* The ROOM is the hero — a runner's first question on any
                            card is "which one". `bookings.studio` already holds
                            the full room label ("Studio X", "North"), so never
                            prefix "Studio " onto it. */}
                        {b.studio && (
                          <div className="c-arch" style={{ fontSize: 21, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                            {b.studio}
                          </div>
                        )}
                        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {b.artist || b.client_name || '—'}
                        </div>
                        {b.artist && b.client_name && (
                          <div style={{ fontSize: 11.5, opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.client_name}
                          </div>
                        )}
                      </div>
                      {woPill(wo)}
                    </div>

                    <div style={{ display: 'flex', gap: 14, marginTop: 9, fontSize: 11.5, opacity: 0.6, flexWrap: 'wrap' }}>
                      <span className="c-mono" style={{ fontSize: 11.5 }}>
                        {b.from_time ?? '?'} – {b.to_time ?? '?'}
                      </span>
                      {b.engineer_name && <span>1ST {b.engineer_name}</span>}
                      {b.assistant_name && <span>2ND {b.assistant_name}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Tonight ─────────────────────────────────────────────────────── */}
        <div>
          <div className="c-label" style={{ marginBottom: 9 }}>Tonight</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            {TILES.map(t => {
              const done = submittedCategories.has(t.category)
              return (
                <button
                  key={t.route}
                  onClick={() => router.push(t.route)}
                  style={{
                    ...surface,
                    minHeight: 72,
                    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                    textAlign: 'left', cursor: 'pointer', color: 'var(--c-fg)',
                    border: 'none', font: 'inherit',
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t.label}</span>
                  {/* Status is the only colour on this surface (§5) — done is
                      booked-green, everything else is just quiet text. */}
                  <span style={{
                    fontSize: 10, marginTop: 4,
                    color: done ? 'var(--c-st-booked)' : 'var(--c-fg)',
                    opacity: done ? 1 : 0.45,
                    fontWeight: done ? 700 : 400,
                  }}>
                    {done ? 'Submitted' : 'Not started'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}
