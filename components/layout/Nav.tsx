'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useIsMobile } from '@/hooks/useIsMobile'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { Wordmark } from '@/components/layout/Wordmark'
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
  const roleNavItems = profile?.role === 'runner'
    ? []
    : profile?.role === 'tech'
      ? navItems.filter(item => item.href !== '/crm')
      : navItems
  // Nadine's is Eli-only for now — matched on his accounts, the same gate the CRM
  // Campaigns tab and DEV → Errors use. (Two addresses because his PIN login is
  // attached to eli@paramountrecording.com, not the Gmail address.)
  // This hides the NAV ITEM only; app/(main)/nadines/page.tsx guards the body so
  // typing the URL directly does nothing. Neither is a data boundary — the
  // `venue_open_items` RLS policy still allows any authenticated read and
  // owner/manager/billing/asst_manager write. Lock the table down separately if
  // that matters.
  const isEli = profile?.email === 'srv2129@gmail.com' || profile?.email === 'eli@paramountrecording.com'
  const visibleNavItems = roleNavItems.filter(item => item.href !== '/nadines' || isEli)

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
    <nav className="c-nav" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: isMobile ? '0 12px' : '0 32px', height: 52,
      position: 'sticky', top: 0, zIndex: 99999,
      // Hidden during the fresh-login welcome splash so it doesn't flash before the
      // splash covers it; fades in with the dashboard once the splash dismisses.
      opacity: hiddenForWelcome ? 0 : 1,
      pointerEvents: hiddenForWelcome ? 'none' : undefined,
      transition: 'opacity 0.3s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <PRSFloIcon size={38} />
        <Link href="/" style={{ textDecoration: 'none', cursor: 'pointer' }}>
          <Wordmark size={20} />
        </Link>
      </div>

      {!isMobile && (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {visibleNavItems.map(item => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          const badge = item.href === '/crm' && unreviewedRegs > 0
            ? unreviewedRegs
            : 0
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`c-navlink${active ? ' c-on' : ''}`}
              style={{ position: 'relative' }}
            >
              {item.label}
              {/* Ink badge, not red: a pending-registration count is not one of
                  the three things allowed to carry colour (§5). The DEV link's
                  lime is gone for the same reason — the accent no longer exists. */}
              {badge > 0 && <span className="c-count">{badge > 99 ? '99+' : badge}</span>}
            </Link>
          )
        })}
      </div>
      )}

      {!isMobile && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={toggleTheme} aria-label="Toggle light/dark theme" className="c-navbtn">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {/* The divider rule that used to separate these is gone (Law 1) — the
            gap does the separating now. */}
        <button onClick={handleSignOut} className="c-navbtn">
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
                  className={`c-navlink${active ? ' c-on' : ''}`}
                  style={{ height: 36 }}
                >
                  {item.label}
                </Link>
              )
            })}
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
            className="c-navbtn"
            style={{ width: 44, height: 44, fontSize: 24, opacity: 1 }}
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
          <div className="c-navmenu" style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 2,
            display: 'flex', flexDirection: 'column',
          }}>
            {visibleNavItems.map(item => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`c-navmenu-item${active ? ' c-on' : ''}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </Link>
              )
            })}
            {/* The 1px separator rules between these rows are gone (Law 1). */}
            <button onClick={toggleTheme} className="c-navmenu-item">
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <button
              onClick={async () => { setMenuOpen(false); await handleSignOut() }}
              className="c-navmenu-item"
            >
              Sign Out
            </button>
          </div>
        </>
      )}
    </nav>
  )
}
