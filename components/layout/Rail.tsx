'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useIsMobile } from '@/hooks/useIsMobile'
import { Wordmark } from '@/components/layout/Wordmark'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useClientsVersion } from '@/hooks/useClientsVersion'
import { Sun, Moon } from 'lucide-react'

/**
 * SIDE NAV RAIL — spec §14a, ported from docs/design-refs/dashboard-final.html.
 * Replaces the top nav (Nav.tsx) as the app frame. Structure top→bottom:
 * wordmark → ungrouped trio → BUSINESS → STUDIO → HR → foot pinned to bottom.
 * Badges are functional counts only (no badge without a real count behind it).
 * Mobile: 52px top bar with a hamburger; the rail slides in as a drawer
 * (Eli's ruling 2026-08-06 — hamburger over bottom tabs).
 */

type RailItem = { href: string; label: string; ic: string; dim?: boolean }

const TOP: RailItem[] = [
  { href: '/', label: 'Dashboard', ic: '▦' },
  // My Day sits directly under Dashboard (MYDAY-BUILD §6.3). NOT "Daily Ops" —
  // that name is taken by the session/room view (HR-SPEC §2.5a).
  { href: '/my-day', label: 'My Day', ic: '◑' },
  { href: '/calendar', label: 'Calendar', ic: '▤' },
  { href: '/daily-ops', label: 'Daily Ops', ic: '◔' },
]
const BUSINESS: RailItem[] = [
  { href: '/crm', label: 'CRM', ic: '◎' },
  { href: '/wo-hub', label: 'WO Hub', ic: '▽' },
  { href: '/tasks', label: 'Tasks', ic: '✓' },
  { href: '/flags', label: 'Flags', ic: '⚑' },
]
const STUDIO: RailItem[] = [
  { href: '/mic-inventory', label: 'Mic Inventory', ic: '◌' },
  { href: '/runner', label: 'Runner Hub', ic: '▷' },
  { href: '/nadines', label: "Nadine's", ic: '♫' },
]
const HR: RailItem[] = [
  { href: '/punches', label: 'Punches', ic: '◷' },
  { href: '/hiring', label: 'Hiring', ic: '✎' },
  { href: '/training', label: 'Training', ic: '✦' },
]
const FOOT: RailItem[] = [
  { href: '/admin', label: 'Admin', ic: '⚙' },
  { href: '/sop', label: 'SOP', ic: '✧' },
  // TEMPORARY nav item (rollout feedback board) — dimmed like the mock's DEV entry.
  { href: '/feedback', label: 'DEV', ic: '∴', dim: true },
]

export function Rail({ hiddenForWelcome = false }: { hiddenForWelcome?: boolean } = {}) {
  const pathname = usePathname()
  const router = useRouter()
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [unreviewedRegs, setUnreviewedRegs] = useState(0)
  const { profile } = useUserProfile()
  const clientsVersion = useClientsVersion()

  // Same role gating as the old Nav: tech loses CRM; a runner gets no internal
  // nav at all (AuthGuard bounces them to /runner — belt and braces here).
  // Nadine's is Eli-only (nav item only; the page body guards itself).
  const isEli = profile?.email === 'srv2129@gmail.com' || profile?.email === 'eli@paramountrecording.com'
  const isRunner = profile?.role === 'runner'
  const filterItems = (items: RailItem[]) => items.filter(item => {
    if (profile?.role === 'tech' && item.href === '/crm') return false
    if (item.href === '/nadines' && !isEli) return false
    // My Day exists for the two role cards it was built around (MYDAY-BUILD §0)
    // plus Eli, who oversees both. Nobody else has duties, so the page would be
    // an empty room.
    if (item.href === '/my-day'
      && !isEli
      && profile?.role !== 'manager'
      && profile?.role !== 'billing'
      && profile?.role !== 'owner') return false
    return true
  })

  // CRM badge: unreviewed registrations (neutral count). Refreshed by the
  // shared clients channel (hooks/useClientsVersion) — never open another one.
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
    fetchCount()
  }, [clientsVersion])

  // Apply the saved theme on mount (DEFAULT DARK). Must agree with the
  // pre-paint script in app/layout.tsx or the page flips on hydration.
  useEffect(() => {
    const saved = localStorage.getItem('prsflo-theme')
    const t = saved === 'light' ? 'light' : 'dark'
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

  function isActive(href: string) {
    return href === '/' ? pathname === '/' : pathname.startsWith(href)
  }

  function renderItem(item: RailItem) {
    const active = isActive(item.href)
    const badge = item.href === '/crm' && unreviewedRegs > 0 ? unreviewedRegs : 0
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`c-rail-link${active ? ' c-on' : ''}`}
        style={item.dim && !active ? { opacity: 0.35 } : undefined}
        onClick={() => setMenuOpen(false)}
      >
        <span className="c-rail-ic">{item.ic}</span>
        {item.label}
        {badge > 0 && <span className="c-rail-badge c-dim">{badge > 99 ? '99+' : badge}</span>}
      </Link>
    )
  }

  const railBody = (
    <>
      <div className="c-rail-wm">
        <Link href="/" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setMenuOpen(false)}>
          <PRSFloIcon size={26} />
          <Wordmark size={16} />
        </Link>
      </div>
      {!isRunner && (
        <>
          {filterItems(TOP).map(renderItem)}
          <div className="c-rail-grp">Business</div>
          {filterItems(BUSINESS).map(renderItem)}
          <div className="c-rail-grp">Studio</div>
          {filterItems(STUDIO).map(renderItem)}
          <div className="c-rail-grp">HR</div>
          {filterItems(HR).map(renderItem)}
        </>
      )}
      <div className="c-rail-foot">
        {!isRunner && filterItems(FOOT).map(renderItem)}
        <button onClick={toggleTheme} className="c-rail-link" aria-label="Toggle light/dark theme">
          <span className="c-rail-ic">{theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}</span>
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <button onClick={async () => { setMenuOpen(false); await handleSignOut() }} className="c-rail-link">
          <span className="c-rail-ic">↩</span>
          Sign Out
        </button>
      </div>
    </>
  )

  // Hidden during the fresh-login welcome splash (same contract as the old Nav).
  const hideStyle = {
    opacity: hiddenForWelcome ? 0 : 1,
    pointerEvents: hiddenForWelcome ? ('none' as const) : undefined,
    transition: 'opacity 0.3s ease',
  }

  if (isMobile) {
    return (
      <>
        <div className="c-mobilebar" style={hideStyle}>
          <Link href="/" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <PRSFloIcon size={26} />
            <Wordmark size={16} />
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {!isRunner && filterItems(BUSINESS)
              .filter(item => item.href === '/crm')
              .concat(TOP.filter(item => item.href === '/calendar'))
              .map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`c-rail-link${isActive(item.href) ? ' c-on' : ''}`}
                  style={{ width: 'auto', padding: '6px 12px' }}
                >
                  {item.label}
                </Link>
              ))}
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Menu"
              className="c-rail-link"
              style={{ width: 44, height: 44, fontSize: 24, opacity: 1, justifyContent: 'center', padding: 0 }}
            >
              ≡
            </button>
          </div>
        </div>
        {menuOpen && (
          <>
            <div className="c-rail-overlay" onClick={() => setMenuOpen(false)} />
            <nav className="c-rail c-drawer">{railBody}</nav>
          </>
        )}
      </>
    )
  }

  return (
    <nav className="c-rail" style={hideStyle}>
      {railBody}
    </nav>
  )
}
