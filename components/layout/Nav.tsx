'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useIsMobile } from '@/hooks/useIsMobile'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useClientsVersion } from '@/hooks/useClientsVersion'
import { Sun, Moon } from 'lucide-react'

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/crm', label: 'CRM' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/admin', label: 'Admin' },
  { href: '/wo-hub', label: 'WO Hub' },
  { href: '/nadines', label: "Nadine's" },
  { href: '/sop', label: 'SOP' },
  // TEMPORARY: remove when rollout period ends
  { href: '/feedback', label: 'DEV' },
]

export function Nav({ hiddenForWelcome = false }: { hiddenForWelcome?: boolean } = {}) {
  const pathname = usePathname()
  const router = useRouter()
  const [unreviewedRegs, setUnreviewedRegs] = useState(0)
  const [tentativeCount, setTentativeCount] = useState(0)
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const { profile } = useUserProfile()
  const clientsVersion = useClientsVersion()
  // Tech gets the full nav minus CRM; a runner gets no internal nav at all
  // (AuthGuard bounces them to /runner, so this is belt-and-braces for the
  // moment before that redirect lands); every other role sees all items.
  const visibleNavItems = profile?.role === 'runner'
    ? []
    : profile?.role === 'tech'
      ? navItems.filter(item => item.href !== '/crm')
      : navItems

  useEffect(() => {
    async function fetchCount() {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { count } = await supabase
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .not('registered_at', 'is', null)
        .is('profile_confirmed_at', null)
        .gt('registered_at', thirtyDaysAgo)
      setUnreviewedRegs(count ?? 0)
    }
    // Real-time (replaces the old 60s poll): refresh the reg badge on any clients
    // change. Driven by the shared `clients` channel (hooks/useClientsVersion)
    // rather than a Nav-local subscription — the Nav is mounted on every page
    // alongside the CRM's registration surfaces, and one channel serves them all.
    fetchCount()
  }, [clientsVersion])

  // Apply the saved theme on mount (default light). data-theme lives on <html>.
  useEffect(() => {
    const saved = localStorage.getItem('prsflo-theme')
    const t = saved === 'dark' ? 'dark' : 'light'
    setTheme(t)
    const root = document.documentElement
    if (t === 'light') root.setAttribute('data-theme', 'light')
    else root.removeAttribute('data-theme')
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    const root = document.documentElement
    if (next === 'light') root.setAttribute('data-theme', 'light')
    else root.removeAttribute('data-theme')
    localStorage.setItem('prsflo-theme', next)
  }

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
    // Real-time (replaces the old 60s poll): refresh the tentative count on any bookings change.
    const channel = supabase
      .channel('nav-tentative-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { fetchTentative() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: isMobile ? '0 12px' : '0 32px', height: 52,
      background: 'linear-gradient(180deg, var(--surface2) 0%, var(--bg) 100%)', borderBottom: '1px solid var(--border)',
      boxShadow: '0 1px 0 rgba(var(--accent-rgb), 0.07), 0 4px 24px rgba(0, 0, 0, 0.5)',
      position: 'sticky', top: 0, zIndex: 99999,
      // Hidden during the fresh-login welcome splash so it doesn't flash before the
      // splash covers it; fades in with the dashboard once the splash dismisses.
      opacity: hiddenForWelcome ? 0 : 1,
      pointerEvents: hiddenForWelcome ? 'none' : undefined,
      transition: 'opacity 0.3s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <PRSFloIcon size={38} />
        <Link href="/" style={{ textDecoration: 'none' }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 20, letterSpacing: -0.5, cursor: 'pointer' }}>
            <span style={{ color: 'var(--accent)' }}>PRS</span>
            <span style={{ color: 'var(--text)', opacity: 0.45, fontWeight: 500 }}>Flo</span>
          </div>
        </Link>
      </div>

      {!isMobile && (
      <div style={{ display: 'flex', gap: 2, height: '100%', alignItems: 'center' }}>
        {visibleNavItems.map(item => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          // TEMPORARY: remove when rollout period ends — Feedback stands out in lime
          const isFeedback = item.href === '/feedback'
          const badge = item.href === '/crm' && unreviewedRegs > 0
            ? unreviewedRegs
            : 0
          return (
            <Link
              key={item.href}
              href={item.href}
              data-feedback={isFeedback ? '' : undefined}
              onMouseEnter={active || isFeedback ? undefined : (e) => { e.currentTarget.style.color = 'var(--text2)' }}
              onMouseLeave={active || isFeedback ? undefined : (e) => { e.currentTarget.style.color = 'var(--cold)' }}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', height: '100%',
                padding: '0 10px', fontSize: 11,
                fontFamily: 'Inter', fontWeight: 500, letterSpacing: '0.04em',
                background: 'transparent',
                color: isFeedback ? 'var(--accent)' : active ? 'var(--text)' : 'var(--cold)',
                borderBottom: active ? '2px solid var(--accent)' : 'none',
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
                  fontSize: 9, fontFamily: 'Inter', fontWeight: 700,
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
      )}

      {!isMobile && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={toggleTheme}
          aria-label="Toggle light/dark theme"
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--cold)' }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--cold)', padding: 0, transition: 'color 0.15s ease',
          }}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          onClick={handleSignOut}
          data-signout=""
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--cold)' }}
          style={{
            background: 'transparent', border: 'none',
            borderLeft: '1px solid rgba(255,255,255,0.08)',
            padding: 0, paddingLeft: 12, marginLeft: 8,
            fontFamily: 'Inter', fontSize: 10, fontWeight: 500,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--cold)', cursor: 'pointer', transition: 'color 0.15s ease',
          }}
        >
          Sign Out
        </button>
      </div>
      )}

      {/* Mobile: CRM + Calendar quick links, then the hamburger (far right). */}
      {isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {visibleNavItems
            .filter(item => item.href === '/crm' || item.href === '/calendar')
            .map(item => {
              const active = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: 'flex', alignItems: 'center', height: 44, padding: '0 8px',
                    fontFamily: 'Inter', fontSize: 12, fontWeight: 500, letterSpacing: '0.04em',
                    textDecoration: 'none', whiteSpace: 'nowrap',
                    color: active ? 'var(--text)' : 'var(--cold)',
                    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  {item.label}
                </Link>
              )
            })}
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
            style={{
              width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text)', fontSize: 24, lineHeight: 1, padding: 0,
            }}
          >
            ≡
          </button>
        </div>
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
            background: 'var(--surface)', borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', flexDirection: 'column',
          }}>
            {visibleNavItems.map(item => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
              // TEMPORARY: remove when rollout period ends — Feedback stands out in lime
              const isFeedback = item.href === '/feedback'
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-feedback={isFeedback ? '' : undefined}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center', height: 48, paddingLeft: 16,
                    fontFamily: 'Inter', fontSize: 13, textDecoration: 'none',
                    color: isFeedback ? 'var(--accent)' : active ? 'var(--text)' : 'var(--text2)',
                    borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  {item.label}
                </Link>
              )
            })}
            <button
              onClick={toggleTheme}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, height: 48, width: '100%', paddingLeft: 16,
                fontFamily: 'Inter', fontSize: 13, color: 'var(--text2)',
                background: 'transparent', border: 'none', borderTop: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <button
              onClick={async () => { setMenuOpen(false); await handleSignOut() }}
              data-signout=""
              style={{
                display: 'flex', alignItems: 'center', height: 48, width: '100%', paddingLeft: 16,
                fontFamily: 'Inter', fontSize: 13, color: 'var(--hot)',
                background: 'transparent', border: 'none', borderTop: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              Sign Out
            </button>
          </div>
        </>
      )}
    </nav>
  )
}
