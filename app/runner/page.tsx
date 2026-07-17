'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { PRSFloIcon } from '@/components/PRSFloIcon'

function getLocalToday(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

const STUDIOS = [
  { key: 'paramount', label: 'Paramount', abbr: 'PRS' },
  { key: 'ameraycan', label: 'Ameraycan', abbr: 'ARS' },
  { key: 'encore', label: 'Encore', abbr: 'ERS' },
  { key: 'track', label: 'Track', abbr: 'TRS' },
]

export default function RunnerPage() {
  const router = useRouter()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const today = getLocalToday()

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('bookings')
      .select('location, status')
      .lte('start_date', today)
      .gte('end_date', today)
      .eq('status', 'confirmed')

    const c: Record<string, number> = {}
    for (const s of STUDIOS) c[s.key] = 0
    for (const b of data ?? []) {
      const loc = (b.location ?? '').toLowerCase()
      for (const s of STUDIOS) {
        if (loc.includes(s.key) || loc.includes(s.abbr.toLowerCase())) {
          c[s.key] = (c[s.key] ?? 0) + 1
        }
      }
    }
    setCounts(c)
    setLoading(false)
  }, [today])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    console.log('[RT] Subscribing to bookings on /runner (hub), filter: start_date=eq.' + today)
    const channel = supabase
      .channel(`runner-hub-${today}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
      }, () => { load() })
      .subscribe()
    return () => {
      console.log('[RT] Unsubscribing from bookings on /runner (hub)')
      supabase.removeChannel(channel)
    }
  }, [today, load])

  return (
    <div style={{
      minHeight: '100dvh',
      maxWidth: '100vw',
      overflowX: 'hidden',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      fontFamily: 'Syne, sans-serif',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginBottom: 26 }}>
          <PRSFloIcon size={32} />
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, letterSpacing: -0.5 }}>
            <span style={{ color: 'var(--accent)' }}>PRS</span>
            <span style={{ color: 'var(--text)', opacity: 0.45, fontWeight: 500 }}>Flo</span>
          </div>
        </div>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--text2)', textTransform: 'uppercase', marginBottom: 6 }}>
          Paramount Recording Group
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', letterSpacing: '0.04em' }}>
          Runner Hub
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
        width: '100%',
        maxWidth: 380,
      }}>
        {STUDIOS.map(s => (
          <button
            key={s.key}
            onClick={() => router.push(`/runner/${s.key}`)}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: '28px 16px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              transition: 'border-color 0.15s',
              WebkitTapHighlightColor: 'transparent',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--text3)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            <div style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 800,
              color: 'rgba(232,234,240,0.7)',
              letterSpacing: '0.05em',
              fontFamily: 'Inter',
            }}>
              {s.abbr}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{s.label}</div>
            {!loading && (
              <div style={{
                fontSize: 11,
                color: counts[s.key] > 0 ? 'var(--accent)' : 'var(--cold)',
                fontFamily: 'Inter',
              }}>
                {counts[s.key] > 0
                  ? `${counts[s.key]} session${counts[s.key] !== 1 ? 's' : ''} today`
                  : 'no sessions today'}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
