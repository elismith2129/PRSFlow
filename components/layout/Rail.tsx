'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase, Lead } from '@/lib/supabase'
import { useIsMobile } from '@/hooks/useIsMobile'
import { Wordmark } from '@/components/layout/Wordmark'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useWoInvoicesVersion } from '@/hooks/useWoInvoicesVersion'
import { useWebInquiries } from '@/components/notifications/WebInquiryProvider'
import { fetchApprovalsQueue } from '@/lib/billing'
import { needsActionCounts } from '@/lib/crm'
import { useMyMemos } from '@/hooks/useMyMemos'
import { unreadCount } from '@/lib/memos'
import { Sun, Moon } from 'lucide-react'

/**
 * SIDE NAV RAIL — spec §14a, ported from docs/design-refs/dashboard-final.html.
 * Replaces the top nav (Nav.tsx) as the app frame.
 *
 * THE RAMP REWORK (Eli, 2026-10-12 — docs/design-refs/rail-header-real-pages.html).
 * Seven rows, top→bottom: wordmark → Dashboard → Calendar → CRM → Billing →
 * Operations → HR → Admin → foot pinned to bottom. The five named rows are
 * GROUPS: click one and a small panel opens under it with its pages.
 *   · ONE group open at a time (Ramp's rule). The open group sits on a soft
 *     panel and THE PAGE YOU ARE ON IS OUTLINED.
 *   · The rail must never scroll ("id like the rail to not have to scroll. its
 *     cleaner when it all fits") — which is why Operations and HR became groups
 *     too, and why the grey BUSINESS / OPERATIONS / HR headings are gone: the
 *     group names say it. Do not add an always-open row without checking the
 *     rail still fits a short laptop screen with the tallest group open.
 *   · A group that holds ONE page for this person is a plain link, not a
 *     one-item dropdown (CRM for everyone but the owners).
 * Badges are functional counts only (no badge without a real count behind it)
 * and sit on the PAGE they belong to; a closed group shows its page's count so
 * a number is never hidden behind a click.
 * Mobile: 52px top bar with a hamburger; the rail slides in as a drawer
 * (Eli's ruling 2026-08-06 — hamburger over bottom tabs).
 */

type RailItem = {
  href: string; label: string; ic: string; dim?: boolean
  /** The pages inside a group. A group's own href is a key ('#crm'), never a
   *  destination — the destinations are only the children. */
  children?: RailItem[]
}

const TOP: RailItem[] = [
  { href: '/', label: 'Dashboard', ic: '▦' },
  { href: '/calendar', label: 'Calendar', ic: '▤' },
  // My Day is RETIRED (2026-09-06, the dashboard∪my-day merge) — the Noir
  // dashboard IS my day now. /my-day redirects home.
]
const GROUPS: RailItem[] = [
  // CRM became a group on 2026-10-12. The five title-words on /crm split in
  // two: Leads, Clients and Registrations stay on one page; Texting and
  // Campaigns got their own (/texting, Eli only). Lakers moved here out of
  // Admin — owners + Eli, filtered below.
  {
    href: '#crm', label: 'CRM', ic: '◎',
    children: [
      { href: '/crm', label: 'Leads & clients', ic: '·' },
      { href: '/texting', label: 'Texting & campaigns', ic: '·' },
      { href: '/lakers', label: 'Lakers', ic: '·' },
    ],
  },
  // Billing replaces WO Hub (ruling 2026-08-11). /wo-hub still exists and still
  // works; it is simply no longer in the nav.
  {
    href: '#billing', label: 'Billing', ic: '▽',
    children: [
      { href: '/billing', label: 'Billing Hub', ic: '·' },
      { href: '/petty-cash', label: 'Petty Cash', ic: '·' },
      // SRS payouts (2026-10-01) — owner/manager/billing only (filtered below;
      // RLS says the same).
      { href: '/srs', label: 'SRS', ic: '·' },
      { href: '/ap-protocols', label: 'Client AP Protocols', ic: '·' },
    ],
  },
  {
    href: '#operations', label: 'Operations', ic: '◔',
    children: [
      { href: '/memos', label: 'Memos', ic: '·' },
      { href: '/shift-notes', label: 'Shift Notes', ic: '·' },
      // FLAGS IS NOT A RAIL ITEM (2026-10-05). It is the second tab of
      // /daily-ops. /flags and /tasks are redirect stubs — do not re-add
      // either. A tech still gets a "Flags" row: see techItem() below.
      { href: '/daily-ops', label: 'Daily Ops', ic: '·' },
      // Leaves the framed app: /runner is the runner's own phone layout.
      { href: '/runner', label: 'Runner Hub', ic: '·' },
      { href: '/mic-inventory', label: 'Mic Inventory', ic: '·' },
      { href: '/engineers', label: 'Engineers', ic: '·' },
      { href: '/nadines', label: "Nadine's", ic: '·' },
    ],
  },
  {
    href: '#hr', label: 'HR', ic: '◷',
    children: [
      { href: '/punches', label: 'Punches', ic: '·' },
      { href: '/hiring', label: 'Hiring', ic: '·' },
      { href: '/training', label: 'Training', ic: '·' },
    ],
  },
  // ADMIN — settings-shaped pages, edited rarely, read often. Owner / manager /
  // billing only (the pages here change what things cost). Lakers LEFT this
  // group for CRM on 2026-10-12.
  {
    href: '#admin', label: 'Admin', ic: '⚙',
    children: [
      { href: '/rates', label: 'Rates', ic: '·' },
      // Job titles and what each carries — read by Hiring.
      { href: '/positions', label: 'Positions', ic: '·' },
    ],
  },
]
// Rarely-used items live behind the foot's Settings disclosure (Eli,
// 2026-08-17): DEV, the theme toggle, Sign Out. SOP + the hints toggle live on
// /training (they are learning tools, not settings).
const SETTINGS_LINKS: RailItem[] = [
  // TEMPORARY nav item (rollout feedback board) — dimmed like the mock's DEV entry.
  { href: '/feedback', label: 'DEV', ic: '∴', dim: true },
]

/** The columns needsActionCounts reads — nothing else is fetched for the badge. */
type BadgeLead = Pick<Lead, 'status' | 'last_contact' | 'created_at' | 'keep_hot_until' | 'parked_until' | 'needs_contact'>

export function Rail({ hiddenForWelcome = false }: { hiddenForWelcome?: boolean } = {}) {
  const pathname = usePathname()
  const router = useRouter()
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)
  /** The group the user opened or closed BY HAND, and the page they did it on.
   *  It only holds while they stay on that page: navigate anywhere and the rail
   *  goes back to "open the group you are inside", so it always shows where you
   *  are. `group: null` = they closed everything. */
  const [handOpen, setHandOpen] = useState<{ at: string; group: string | null } | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [badgeLeads, setBadgeLeads] = useState<BadgeLead[]>([])
  const [approvalsDue, setApprovalsDue] = useState(0)
  const { profile } = useUserProfile()
  // Memos unread (2026-09-14) — the shared memos channel, same as the gate.
  const { memos: myMemos } = useMyMemos(profile)
  const memosUnread = unreadCount(myMemos)
  const { leadsVersion } = useWebInquiries()
  const woVersion = useWoInvoicesVersion()

  // Role gating. A runner gets no internal nav at all (AuthGuard bounces them
  // to /runner — belt and braces here). Nadine's and Texting & campaigns are
  // Eli-only (nav item only; each page body guards itself).
  const isEli = profile?.email === 'eli@paramountrecording.com'
  const isRunner = profile?.role === 'runner'
  const isTech = profile?.role === 'tech'
  const filterItems = (items: RailItem[]): RailItem[] => items.filter(item => {
    // Tech gets neither the money nor the CRM (Eli, 2026-09-16: "they don't
    // need much but cal and flags").
    if (isTech && (item.href === '/crm' || item.href === '/texting')) return false
    if (isTech && (item.href.startsWith('/billing') || item.href === '/ap-protocols' || item.href === '/petty-cash')) return false
    if (item.href === '/nadines' && !isEli) return false
    // Texting & campaigns is Eli's (ruling 2026-10-12). Campaigns always was;
    // Texting used to be open to every CRM role.
    if (item.href === '/texting' && !isEli) return false
    // Hiring holds pay and separations — owner/manager only (2026-09-21); the
    // page body and RLS say the same.
    if (item.href === '/hiring'
      && profile?.role !== 'owner'
      && profile?.role !== 'manager') return false
    if (item.href === '/positions'
      && profile?.role !== 'owner'
      && profile?.role !== 'manager') return false
    if (item.href === '/srs'
      && profile?.role !== 'owner'
      && profile?.role !== 'manager'
      && profile?.role !== 'billing') return false
    if (item.href === '/lakers' && profile?.role !== 'owner' && !isEli) return false
    if (item.href === '/rates'
      && profile?.role !== 'owner'
      && profile?.role !== 'manager'
      && profile?.role !== 'billing') return false
    // Shift Notes inherits /my-day's audience (2026-08-24) — owner/manager/
    // billing/asst manager. tech/runner get nothing (runners have their own
    // channel).
    if (item.href === '/shift-notes'
      && !isEli
      && profile?.role !== 'manager'
      && profile?.role !== 'billing'
      && profile?.role !== 'asst_manager'
      && profile?.role !== 'owner') return false
    // A group whose children are all filtered out disappears with them.
    if (item.children && filterItems(item.children).length === 0) return false
    return true
  })

  // Whether the CRM is this person's to see. `crmShown` is the nav answer (it
  // is true while the profile is still loading, like every un-gated row, so the
  // phone bar doesn't blink); `canSeeCrm` waits for the profile before a query.
  const crmShown = !isRunner && filterItems([{ href: '/crm', label: '', ic: '' }]).length > 0
  const canSeeCrm = !!profile && crmShown

  // LEADS & CLIENTS BADGE: leads that need action — the same number the CRM's
  // Leads word and Needs Action pill show (lib/crm needsActionCounts is the one
  // source; never re-derive it here). It replaced the grey unreviewed-
  // registrations count, which now sits on the CRM's Registrations word.
  // Only the six columns the count reads are fetched, and only leads that can
  // still be in the queue. Paged: a bare select stops at 1,000 rows. Refreshed
  // by the shared leads channel (WebInquiryProvider) — never open another one.
  // The rows are kept, not the number: a lead becomes DUE by the clock with no
  // database event, so the count is taken at render (see leadsDue below).
  useEffect(() => {
    if (!canSeeCrm) { setBadgeLeads([]); return }
    let live = true
    ;(async () => {
      let all: BadgeLead[] = []
      let from = 0
      const BATCH = 1000
      while (true) {
        const { data, error } = await supabase
          .from('leads')
          .select('status, last_contact, created_at, keep_hot_until, parked_until, needs_contact')
          // Booked, DNB and leasing leads are never in the queue. A null status
          // is kept so this filter can never drop a row the count would keep.
          .or('status.is.null,status.not.in.(booked,dead,leasing)')
          .order('id', { ascending: true })
          .range(from, from + BATCH - 1)
        if (error || !data || data.length === 0) break
        all = all.concat(data as BadgeLead[])
        if (data.length < BATCH) break
        from += BATCH
      }
      if (live) setBadgeLeads(all)
    })()
    return () => { live = false }
  }, [canSeeCrm, leadsVersion])
  const leadsDue = needsActionCounts(badgeLeads).total

  // Billing Hub badge: invoices waiting on an owner's approval — the Dropbox
  // "need approvals" folder filling up, visible from every page (Eli,
  // 2026-09-01; option A of billing-approval-notify-options.html). OWNERS
  // ONLY: nobody else can approve, so for them it would be someone else's
  // to-do. Teal, not hot — work is waiting, nothing is wrong. Same derivation
  // as the hub's strip (lib/billing approvalQueue) so they always agree.
  const isOwnerForBadge = profile?.role === 'owner' || profile?.email === 'eli@paramountrecording.com'
  useEffect(() => {
    if (!isOwnerForBadge) { setApprovalsDue(0); return }
    let live = true
    fetchApprovalsQueue().then(q => { if (live) setApprovalsDue(q.length) })
    return () => { live = false }
  }, [isOwnerForBadge, woVersion])

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

  /** A tech's only business on /daily-ops is the Flags tab (the page shows
   *  them nothing else), so their rail row says so and lands there. Same
   *  route, honest label — everyone else sees "Daily Ops". */
  function techItem(item: RailItem): RailItem {
    return isTech && item.href === '/daily-ops'
      ? { ...item, href: '/daily-ops?tab=flags', label: 'Flags' }
      : item
  }

  function isActive(href: string) {
    // Links may carry a query (/daily-ops?tab=flags); match on the path part
    // only, since usePathname() never includes the query string.
    const base = href.split('?')[0]
    return base === '/' ? pathname === '/' : pathname.startsWith(base)
  }

  /** The count that belongs to a PAGE, and its colour. Hot = needs you now
   *  (leads going stale). Teal = yours to act on, nothing wrong (approvals,
   *  memos). One place, so a page's row and its closed group can't disagree. */
  function badgeFor(href: string): { n: number; cls: string; title: string } | null {
    const base = href.split('?')[0]
    if (base === '/crm' && leadsDue > 0) return { n: leadsDue, cls: 'c-hot', title: 'Leads that need action' }
    if (base === '/billing' && approvalsDue > 0) return { n: approvalsDue, cls: 'c-ok', title: 'Invoices ready for your approval' }
    if (base === '/memos' && memosUnread > 0) return { n: memosUnread, cls: 'c-ok', title: 'Memos waiting for you' }
    return null
  }
  function renderBadge(b: { n: number; cls: string; title: string } | null) {
    return b ? <span className={`c-rail-badge ${b.cls}`} title={b.title}>{b.n > 99 ? '99+' : b.n}</span> : null
  }

  function renderItem(item: RailItem) {
    const active = isActive(item.href)
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
        {renderBadge(badgeFor(item.href))}
      </Link>
    )
  }

  // Which group you are standing in, and which one is open. A hand toggle wins
  // only on the page it was made on.
  const visibleGroups = filterItems(GROUPS).map(g => ({ ...g, children: filterItems(g.children ?? []).map(techItem) }))
  const hereGroup = visibleGroups.find(g => g.children.length > 1 && g.children.some(c => isActive(c.href)))?.href ?? null
  const openGroup = handOpen && handOpen.at === pathname ? handOpen.group : hereGroup

  /** A group: a parent plus its pages, as a CLICK disclosure — never hover.
   *
   *  Hover menus do not exist on a touchscreen, and the managers work off an
   *  iPad; a hover-only destination is a destination they cannot reach. Tap the
   *  parent to open, tap again to close. Opening one closes the other.
   *
   *  The parent is a BUTTON, not a link (Eli, 2026-09-08: "make it a hidden
   *  drop down but on click not hover"): nothing navigates by surprise while
   *  you are looking for a page.
   *
   *  THE LINES (ruling 2026-10-12: "i like the lines"). The outline on the
   *  current page is one of two sanctioned exceptions to the design spec's
   *  no-lines law (the other is the underline on view tabs). It is an inset
   *  box-shadow in ink, not a border — see .c-rail-kid.c-on. */
  function renderGroup(group: RailItem & { children: RailItem[] }) {
    const kids = group.children
    // One page for this person → a plain link wearing the group's name and
    // icon. A dropdown with a single row is a click that buys nothing.
    if (kids.length === 1) {
      return renderItem({ ...kids[0], label: group.label, ic: group.ic })
    }
    const open = openGroup === group.href
    const childActive = kids.some(c => isActive(c.href))
    // Closed: the group carries the first count among its pages.
    const closedBadge = open ? null : kids.map(c => badgeFor(c.href)).find(Boolean) ?? null
    return (
      <div key={group.href} className={`c-rail-group${open ? ' c-open' : ''}`}>
        <button
          type="button"
          onClick={() => setHandOpen({ at: pathname, group: open ? null : group.href })}
          className={`c-rail-link${childActive || open ? ' c-on' : ''}`}
          // No `font: inherit` here. The old Billing / Admin buttons carried it and
          // it overrode .c-rail-link's 12.5px / 600 with the page's 14px / 400, so
          // a group read bigger and lighter than the links beside it — easy to
          // miss with two groups, obvious with five (fixed 2026-10-12).
          style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
          aria-expanded={open}
        >
          <span className="c-rail-ic">{group.ic}</span>
          {group.label}
          {renderBadge(closedBadge)}
          <span className="c-rail-caret">{open ? '▾' : '▸'}</span>
        </button>
        {open && (
          <div className="c-rail-kids">
            {kids.map(child => (
              <Link
                key={child.href}
                href={child.href}
                className={`c-rail-kid${isActive(child.href) ? ' c-on' : ''}`}
                aria-current={isActive(child.href) ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {child.label}
                {renderBadge(badgeFor(child.href))}
              </Link>
            ))}
          </div>
        )}
      </div>
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
          {filterItems(TOP).map(i => renderItem(i))}
          {visibleGroups.map(g => renderGroup(g))}
        </>
      )}
      <div className="c-rail-foot">
        {/* SETTINGS — one quiet home for everything used once a week or less
            (Eli, 2026-08-17). Collapsed by default; state is per-render on
            purpose (it should never persist open). */}
        {settingsOpen && (
          <>
            {!isRunner && filterItems(SETTINGS_LINKS).map(i => renderItem(i))}
            <button onClick={toggleTheme} className="c-rail-link" aria-label="Toggle light/dark theme">
              <span className="c-rail-ic">{theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}</span>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <button onClick={async () => { setMenuOpen(false); await handleSignOut() }} className="c-rail-link">
              <span className="c-rail-ic">↩</span>
              Sign Out
            </button>
          </>
        )}
        <button
          onClick={() => setSettingsOpen(o => !o)}
          className={`c-rail-link${settingsOpen ? ' c-on' : ''}`}
          aria-expanded={settingsOpen}
        >
          <span className="c-rail-ic">⚙</span>
          Settings
          <span className="c-rail-caret">{settingsOpen ? '▾' : '▸'}</span>
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
    // The phone bar keeps its two shortcuts: CRM and Calendar. CRM is a group
    // now, so its shortcut lands on Leads & clients and stays lit on any page
    // inside the group.
    const crmGroup = visibleGroups.find(g => g.href === '#crm')
    const crmLit = !!crmGroup && crmGroup.children.some(c => isActive(c.href))
    return (
      <>
        <div className="c-mobilebar" style={hideStyle}>
          <Link href="/" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <PRSFloIcon size={26} />
            <Wordmark size={16} />
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {crmShown && (
              <Link
                href="/crm"
                className={`c-rail-link${crmLit ? ' c-on' : ''}`}
                style={{ width: 'auto', padding: '6px 12px' }}
              >
                CRM
              </Link>
            )}
            {!isRunner && (
              <Link
                href="/calendar"
                className={`c-rail-link${isActive('/calendar') ? ' c-on' : ''}`}
                style={{ width: 'auto', padding: '6px 12px' }}
              >
                Calendar
              </Link>
            )}
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
