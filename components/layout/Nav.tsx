'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/crm', label: 'CRM' },
  { href: '/clients', label: 'Clients' },
  { href: '/qc', label: 'Session QC' },
  { href: '/admin', label: 'Admin' },
]

export function Nav() {
  const pathname = usePathname()
  const [time, setTime] = useState('')

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 32px', height: 52,
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 100,
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
          return (
            <Link key={item.href} href={item.href} style={{
              padding: '6px 16px', borderRadius: 6, fontSize: 11,
              fontFamily: 'DM Mono', fontWeight: 500,
              background: active ? 'var(--surface2)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text2)',
              border: active ? '1px solid var(--border)' : '1px solid transparent',
              textDecoration: 'none', transition: 'all 0.15s',
            }}>
              {item.label}
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
