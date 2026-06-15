'use client'
import { useEffect, useState } from 'react'
import { supabase, Lead, Booking } from '@/lib/supabase'
import { LocationStrip } from '@/components/dashboard/LocationStrip'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTaskTab, setActiveTaskTab] = useState<'me' | 'mgr' | 'billing' | 'asst'>('me')
  const router = useRouter()
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const needsActionLeads = leads
    .filter(l => l.needs_contact === true && l.status !== 'dead' && l.status !== 'booked')
    .slice(0, 5)
  const confirmedSessions = bookings.filter(b => b.status === 'confirmed')
  const tentativeSessions = bookings.filter(b => b.status === 'tentative')

  useEffect(() => {
    async function load() {
      const d = new Date()
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
      const today = d.toISOString().slice(0, 10)
      const [{ data: leadsData }, { data: bookingsData }] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('bookings').select('*').lte('start_date', today).gte('end_date', today).order('from_time', { ascending: true }),
      ])
      setLeads(leadsData || [])
      setBookings(bookingsData || [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'Syne', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 4 }}>
            {greeting} — here's your briefing
          </div>
          <h1 style={{ fontFamily: 'DM Serif Display', fontSize: 32, letterSpacing: -1, lineHeight: 1.05 }}>
            Paramount <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Recording Studios</em>
          </h1>
        </div>
        <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--text2)', lineHeight: 1.8 }}>
          {now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          <br />
          <span style={{ color: 'var(--text3)' }}>
            {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Location strip */}
      <LocationStrip />

      {/* 3-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 14, alignItems: 'start', marginTop: 14 }}>

        {/* COL 1 — NEEDS ACTION */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 13 }}>NEEDS ACTION</div>
          </div>
          <div style={{ borderBottom: '1px solid var(--border)' }}>
            {loading ? (
              <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
            ) : needsActionLeads.length === 0 ? (
              <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>✓ All clear</div>
            ) : (
              needsActionLeads.map((l, i) => {
                const statusColor =
                  l.status === 'hot' ? 'var(--hot)' :
                  l.status === 'warm' ? 'var(--warm)' :
                  'var(--text3)'
                const reason =
                  l.status === 'hot' ? 'Follow up now' :
                  l.status === 'warm' ? 'Follow up due' :
                  l.status === 'uncontacted' ? 'Never contacted' :
                  'Needs attention'
                return (
                  <div
                    key={l.id}
                    style={{
                      padding: '9px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: i < needsActionLeads.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                        {l.fname} {l.lname}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{reason}</div>
                    </div>
                    <div style={{
                      fontSize: 9,
                      fontFamily: 'Syne',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      color: statusColor,
                      textTransform: 'uppercase',
                    }}>
                      {l.status}
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div style={{ padding: '10px 16px' }}>
            <button
              onClick={() => router.push('/crm')}
              style={{
                fontSize: 11,
                color: 'var(--accent)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'DM Mono',
              }}
            >
              View all in CRM →
            </button>
          </div>
        </div>

        {/* COL 2 — TODAY'S SESSIONS */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 13 }}>TODAY'S SESSIONS</div>
          </div>
          <div style={{ padding: '10px 0' }}>
            {loading ? (
              <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
            ) : confirmedSessions.length === 0 && tentativeSessions.length === 0 ? (
              <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>No sessions today</div>
            ) : (
              <>
                {confirmedSessions.length > 0 && (
                  <div style={{ marginBottom: tentativeSessions.length > 0 ? 10 : 0 }}>
                    <div style={{
                      padding: '2px 16px 6px',
                      fontSize: 9,
                      fontFamily: 'Syne',
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      color: '#14B8A6',
                      textTransform: 'uppercase',
                    }}>
                      Confirmed
                    </div>
                    {confirmedSessions.map(b => (
                      <div
                        key={b.id}
                        style={{
                          margin: '0 16px 6px 16px',
                          padding: '8px 12px',
                          borderLeft: '2px solid #14B8A6',
                          background: 'rgba(20,184,166,0.05)',
                          borderRadius: '0 6px 6px 0',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.artist || b.client_name || '—'}
                          </div>
                          <div style={{
                            fontSize: 9,
                            fontFamily: 'Syne',
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            color: 'var(--text3)',
                            textTransform: 'uppercase',
                            background: 'var(--surface2)',
                            padding: '2px 6px',
                            borderRadius: 4,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}>
                            {b.session_type}
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                          {b.from_time || '—'} – {b.to_time || '—'} · {b.location}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {tentativeSessions.length > 0 && (
                  <div>
                    <div style={{
                      padding: '2px 16px 6px',
                      fontSize: 9,
                      fontFamily: 'Syne',
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      color: '#F97316',
                      textTransform: 'uppercase',
                    }}>
                      Tentative
                    </div>
                    {tentativeSessions.map(b => (
                      <div
                        key={b.id}
                        style={{
                          margin: '0 16px 6px 16px',
                          padding: '8px 12px',
                          borderLeft: '2px solid #F97316',
                          background: 'rgba(249,115,22,0.05)',
                          borderRadius: '0 6px 6px 0',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.artist || b.client_name || '—'}
                          </div>
                          <div style={{
                            fontSize: 9,
                            fontFamily: 'Syne',
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            color: 'var(--text3)',
                            textTransform: 'uppercase',
                            background: 'var(--surface2)',
                            padding: '2px 6px',
                            borderRadius: 4,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}>
                            {b.session_type}
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                          {b.from_time || '—'} – {b.to_time || '—'} · {b.location}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* COL 3 — TASKS */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 13 }}>TASKS</div>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            {(['me', 'mgr', 'billing', 'asst'] as const).map(tab => {
              const labels = { me: 'Me', mgr: 'Mgr', billing: 'Billing', asst: 'Asst' }
              const isActive = activeTaskTab === tab
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTaskTab(tab)}
                  style={{
                    flex: 1,
                    padding: '5px 4px',
                    fontSize: 10,
                    fontFamily: 'Syne',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? '#0d0f14' : 'var(--text3)',
                    background: isActive ? '#c8f04e' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 6,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    transition: 'all 0.1s',
                  }}
                >
                  {labels[tab]}
                </button>
              )
            })}
          </div>
          <div style={{ padding: '16px', color: 'var(--text3)', fontSize: 11, minHeight: 80 }}>
            Tasks coming in next build
          </div>
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
            <button
              style={{
                width: '100%',
                padding: '7px',
                fontSize: 11,
                fontFamily: 'DM Mono',
                color: 'var(--text3)',
                background: 'transparent',
                border: '1px dashed var(--border)',
                borderRadius: 6,
                cursor: 'default',
              }}
            >
              + Add task
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
