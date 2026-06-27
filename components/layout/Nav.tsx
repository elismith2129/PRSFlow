'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { UnifiedSessionForm } from '@/components/unified/UnifiedSessionForm'
import { useIsMobile } from '@/hooks/useIsMobile'

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/crm', label: 'CRM' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/admin', label: 'Admin' },
  { href: '/wo-hub', label: 'WO Hub' },
  { href: '/sop', label: 'SOP' },
]

export function Nav({ hiddenForWelcome = false }: { hiddenForWelcome?: boolean } = {}) {
  const pathname = usePathname()
  const router = useRouter()
  const [unreviewedRegs, setUnreviewedRegs] = useState(0)
  const [tentativeCount, setTentativeCount] = useState(0)
  const [isOwner, setIsOwner] = useState(false)
  const [showUSF, setShowUSF] = useState(false)
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)

  // Temp owner-only gate for the parallel UnifiedSessionForm build.
  // No auth yet (Chunk 9) — read role from localStorage.
  useEffect(() => {
    setIsOwner(localStorage.getItem('userRole') === 'owner')
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

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

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
      position: 'sticky', top: 0, zIndex: 99999,
      // Hidden during the fresh-login welcome splash so it doesn't flash before the
      // splash covers it; fades in with the dashboard once the splash dismisses.
      opacity: hiddenForWelcome ? 0 : 1,
      pointerEvents: hiddenForWelcome ? 'none' : undefined,
      transition: 'opacity 0.3s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/" style={{ textDecoration: 'none' }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 20, letterSpacing: -0.5, cursor: 'pointer' }}>
            <span style={{ color: 'var(--accent)' }}>PRS</span>
            <span style={{ color: 'var(--text)', opacity: 0.45, fontWeight: 500 }}>Flow</span>
          </div>
        </Link>
        {!isMobile && (
          <span style={{
            fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)',
            border: '1px solid var(--border)', borderRadius: 3,
            padding: '2px 6px', letterSpacing: '0.1em'
          }}>STUDIO OS</span>
        )}
      </div>

      {!isMobile && (
      <div style={{ display: 'flex', gap: 2, height: '100%', alignItems: 'center' }}>
        {navItems.map(item => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          const badge = item.href === '/crm' && unreviewedRegs > 0
            ? unreviewedRegs
            : 0
          return (
            <Link
              key={item.href}
              href={item.href}
              onMouseEnter={active ? undefined : (e) => { e.currentTarget.style.color = '#9ca3af' }}
              onMouseLeave={active ? undefined : (e) => { e.currentTarget.style.color = '#6B7280' }}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', height: '100%',
                padding: '0 10px', fontSize: 11,
                fontFamily: 'DM Mono', fontWeight: 500, letterSpacing: '0.04em',
                background: 'transparent',
                color: active ? '#e8eaf0' : '#6B7280',
                borderBottom: active ? '2px solid #c8f04e' : 'none',
                borderRadius: 0,
                textDecoration: 'none', transition: 'color 0.15s ease',
              }}
            >
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
        {isOwner && (
          <button
            onClick={() => setShowUSF(true)}
            style={{
              display: 'inline-block', marginLeft: 6,
              padding: '6px 16px', borderRadius: 6, fontSize: 11,
              fontFamily: 'DM Mono', fontWeight: 500, cursor: 'pointer',
              background: 'rgba(200,240,78,0.12)', color: 'var(--accent)',
              border: '1px solid rgba(200,240,78,0.4)',
            }}
          >
            ⚡ USF
          </button>
        )}
      </div>
      )}

      {!isMobile && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={handleSignOut}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#e8eaf0' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#6B7280' }}
          style={{
            background: 'transparent', border: 'none',
            borderLeft: '1px solid rgba(255,255,255,0.08)',
            padding: 0, paddingLeft: 12, marginLeft: 8,
            fontFamily: 'DM Mono', fontSize: 10, fontWeight: 500,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: '#6B7280', cursor: 'pointer', transition: 'color 0.15s ease',
          }}
        >
          Sign Out
        </button>
      </div>
      )}

      {/* Mobile: hamburger button (far right). Tap toggles the dropdown menu. */}
      {isMobile && (
        <button
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Menu"
          style={{
            width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#e8eaf0', fontSize: 24, lineHeight: 1, padding: 0,
          }}
        >
          ≡
        </button>
      )}

      {/* Mobile: full-width dropdown menu + outside-tap overlay */}
      {isMobile && menuOpen && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: 'fixed', top: 52, left: 0, right: 0, bottom: 0, background: 'transparent', zIndex: 1 }}
          />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 2,
            background: '#161920', borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', flexDirection: 'column',
          }}>
            {navItems.map(item => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center', height: 48, paddingLeft: 16,
                    fontFamily: 'DM Mono', fontSize: 13, textDecoration: 'none',
                    color: active ? '#e8eaf0' : '#9ca3af',
                    borderLeft: active ? '2px solid #c8f04e' : '2px solid transparent',
                  }}
                >
                  {item.label}
                </Link>
              )
            })}
            <button
              onClick={async () => { setMenuOpen(false); await handleSignOut() }}
              style={{
                display: 'flex', alignItems: 'center', height: 48, width: '100%', paddingLeft: 16,
                fontFamily: 'DM Mono', fontSize: 13, color: '#ef4444',
                background: 'transparent', border: 'none', borderTop: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              Sign Out
            </button>
          </div>
        </>
      )}

      {showUSF && (
        <UnifiedSessionForm bookingId={null} onClose={() => setShowUSF(false)} />
      )}
    </nav>
  )
}
