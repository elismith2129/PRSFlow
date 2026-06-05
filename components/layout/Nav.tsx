'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/crm', label: 'CRM' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/qc', label: 'Session QC' },
  { href: '/admin', label: 'Admin' },
  { href: '/sop', label: 'SOP' },
]

export function Nav() {
  const pathname = usePathname()
  const [time, setTime] = useState('')
  const [unreviewedRegs, setUnreviewedRegs] = useState(0)
  const [tentativeCount, setTentativeCount] = useState(0)

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    async function fetchCount() {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { count, error } = await supabase
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .not('registered_at', 'is', null)
        .is('profile_confirmed_at', null)
        .gt('registered_at', thirtyDaysAgo)
      console.log('[Nav] unreviewed regs count:', count, 'error:', error)
      setUnreviewedRegs(count ?? 0)
    }
    fetchCount()
    const id = setInterval(fetchCount, 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    async function fetchTentative() {
      const { count, error } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'tentative')
      if (!error) setTentativeCount(count ?? 0)
    }
    fetchTentative()
    const id = setInterval(fetchTentative, 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 32px', height: 52,
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 9999,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 20, letterSpacing: -0.5 }}>
          <span style={{ color: 'var(--accent)' }}>PRS</span>
          <span style={{ color: 'var(--text)', opacity: 0.45, fontWeight: 500 }}>Flow</span>
        </div>
        <span style={{
          fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)',
          border: '1px solid var(--border)', borderRadius: 3,
          padding: '2px 6px', letterSpacing: '0.1em'
        }}>STUDIO OS</span>
      </div>

      <div style={{ display: 'flex', gap: 2 }}>
        {navItems.map(item => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          const badge = item.href === '/crm' && unreviewedRegs > 0
            ? unreviewedRegs
            : item.href === '/calendar' && tentativeCount > 0
            ? tentativeCount
            : 0
          return (
            <Link key={item.href} href={item.href} style={{
              position: 'relative', display: 'inline-block',
              padding: '6px 16px', borderRadius: 6, fontSize: 11,
              fontFamily: 'DM Mono', fontWeight: 500,
              background: active ? 'var(--surface2)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text2)',
              border: active ? '1px solid var(--border)' : '1px solid transparent',
              textDecoration: 'none', transition: 'all 0.15s',
            }}>
              {item.label}
              {badge > 0 && (
                <span style={{
                  position: 'absolute', top: 2, right: 2,
                  background: 'var(--hot)', color: '#fff',
                  borderRadius: '50%', minWidth: 16, height: 16,
                  fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 3px', lineHeight: 1,
                }}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
        {time}
      </div>
    </nav>
  )
}
