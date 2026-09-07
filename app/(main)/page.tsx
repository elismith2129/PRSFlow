'use client'
// ─────────────────────────────────────────────────────────────────────────────
// THE NOIR DASHBOARD (2026-09-06) — design law: docs/design-refs/
// dashboard-anchor-noir.html, option A1, LOCKED after the six-round redesign
// session. Replaces the §14b console dashboard AND absorbs /my-day (which
// becomes a redirect stub — chunk 3).
//
// The rulings this page implements:
//   · HIGH CONTRAST IS THE GROUND — near-black stage, bright ivory ink, in
//     BOTH themes (html.n-page). The soft-skin greys stay everywhere else
//     until the site-wide contrast project.
//   · FLO IS A STATEMENT, not a box — the briefing leads the page, large,
//     composed from the same real numbers as before (composeBriefing output).
//   · EVERY PORTAL CLICKS THROUGH to its page. The biggest thing on screen
//     is never mere state.
//   · FIXED GEOMETRY — row 1 portals are 356px, row 2 are 200px, always.
//     Underfill reads as quiet (data-empty is legal); overflow scrolls
//     inside. No masonry, ever. Same frames for every viewer.
//   · LANDED & HOLDS CARRY NAMES, NEVER MONEY. The money box is the billing
//     pipeline itself (review → approval → send) + COD out, same derivations
//     as the billing page (lib/home.ts).
//   · Retired from the dashboard: studio squares (loc chips carry counts),
//     flags panel (rail item remains), staff grid (HR → Punches), the
//     approvals banner (the money box's amber tile is the queue), task/flag
//     modals (rows click through to /tasks and /billing).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, Lead, Booking, DashboardTask } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import { deleteSessionAndWO } from '@/lib/deleteSession'
import { initials } from '@/components/calendar/SessionCard'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { fetchMyTasks } from '@/lib/tasks'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { useWebInquiries } from '@/components/notifications/WebInquiryProvider'
import { formatCurrency } from '@/lib/format'
import { getLocalToday } from '@/lib/time'
import { fetchApprovalsQueue, type InvoiceRow } from '@/lib/billing'
import { useWoInvoicesVersion } from '@/hooks/useWoInvoicesVersion'
import {
  loadMyDayDashboard, fetchStaffGrid, completeDuty, uncompleteDuty,
  fetchBalancesQueue, shortDayLabel,
  type MyDayRole, type MyDayDashboard, type GridRow, type DutyView, type QueueBookingItem,
} from '@/lib/myday'
import {
  fetchLandedToday, fetchNewInquiries, fetchBillingPulse, fetchHoldsWeek,
  type LandedItem, type InquiryLead, type BillingPulse,
} from '@/lib/home'

type ViewAs = 'eli' | 'fernando' | 'aaron'
type QueueTab = 'mine' | 'fernando' | 'aaron'

// Needs Action predicates — mirror the CRM bucket logic so the pipeline number
// agrees with the CRM Needs Action tab.
function daysSince(d: string): number {
  if (!d) return 99999
  const t = new Date(d).getTime()
  if (isNaN(t)) return 99999
  return (Date.now() - t) / (1000 * 60 * 60 * 24)
}
function isParked(l: Lead): boolean {
  return !!(l.parked_until && new Date(l.parked_until) > new Date())
}
function isKhuDue(l: Lead): boolean {
  if (!l.keep_hot_until) return daysSince(l.last_contact || l.created_at) >= (l.status === 'hot' ? 5 : 3)
  return new Date(l.keep_hot_until) <= new Date()
}

const ROOMS: { venue: string; studio: string; label: string; bookable?: boolean }[] = [
  { venue: 'Paramount', studio: 'Studio A', label: 'PRS · A' },
  { venue: 'Paramount', studio: 'Studio B', label: 'PRS · B' },
  { venue: 'Paramount', studio: 'Studio C', label: 'PRS · C' },
  { venue: 'Paramount', studio: 'Studio E', label: 'PRS · E' },
  { venue: 'Paramount', studio: 'Studio X', label: 'PRS · X' },
  { venue: 'Paramount', studio: "Nadine's", label: "Nadine's", bookable: false },
  { venue: 'Ameraycan', studio: 'Studio A', label: 'ARS · A' },
  { venue: 'Ameraycan', studio: 'Studio B', label: 'ARS · B' },
  { venue: 'Encore', studio: 'Studio A', label: 'ERS · A' },
  { venue: 'Encore', studio: 'Studio B', label: 'ERS · B' },
  { venue: 'Track', studio: 'North', label: 'TRS · N' },
  { venue: 'Track', studio: 'South', label: 'TRS · S' },
]
const LOC_CHIPS = [
  { code: 'PRS', venue: 'Paramount' },
  { code: 'ARS', venue: 'Ameraycan' },
  { code: 'ERS', venue: 'Encore' },
  { code: 'TRS', venue: 'Track' },
]
const VENUE_CODE: Record<string, string> = {
  Paramount: 'PRS', Ameraycan: 'ARS', Encore: 'ERS', Track: 'TRS',
}

/** Booking status → noir room-card class. Solid fill + chip ink (§5). */
function roomFill(status: string | null | undefined): string {
  if (status === 'confirmed' || status === 'lockout') return ' n-on'
  if (status === 'tentative') return ' n-warmc'
  if (status === 'cancelled') return ' n-hotc'
  return ''
}
/** "Paramount"+"Studio A" → "PRS·A" for the holds chips. */
function roomChip(location: string, studio: string): string {
  const code = VENUE_CODE[location] || location.slice(0, 3).toUpperCase()
  const letter = (studio || '').replace('Studio ', '').charAt(0).toUpperCase()
  return letter ? `${code}·${letter}` : code
}

/** One row of the merged queue: a duty, a task, or an approval. */
type QueueRow = {
  key: string
  kind: 'duty' | 'task' | 'approve'
  text: string
  mn?: string
  red?: boolean
  done?: boolean
  /** Duty rows tick in place; others navigate. */
  duty?: DutyView
  href?: string
}

export default function DashboardPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const { profile } = useUserProfile()
  const isMobile = useIsMobile()
  const { leadsVersion, count: inquiryCount } = useWebInquiries()
  const router = useRouter()
  const [calDate, setCalDate] = useState(new Date())
  const [dashDataVersion, setDashDataVersion] = useState(0)
  const woVersion = useWoInvoicesVersion()

  // ── View-as (§14b): Eli previews any seat; everyone else IS their seat. ────
  const [viewAs, setViewAs] = useState<ViewAs>('eli')
  const isEli = profile?.email === 'eli@paramountrecording.com'
  const effectiveView: ViewAs = isEli
    ? viewAs
    : profile?.role === 'manager' ? 'fernando'
    : profile?.role === 'billing' ? 'aaron'
    : 'eli'
  const isOwnerHere = isEli || profile?.role === 'owner'

  // ── The merged queue's tab (Eli gets Mine | Fernando | Aaron). ─────────────
  const [qTab, setQTab] = useState<QueueTab>('mine')
  useEffect(() => {
    setQTab(effectiveView === 'eli' ? 'mine' : effectiveView)
  }, [effectiveView])
  const dutyRole: MyDayRole | null =
    qTab === 'fernando' ? 'manager' : qTab === 'aaron' ? 'billing' : null

  // ── My Day machinery (duties + briefing) — unchanged from the console. ─────
  const [myDay, setMyDay] = useState<MyDayDashboard | null>(null)
  const [gridRows, setGridRows] = useState<GridRow[]>([])
  const [savingDuty, setSavingDuty] = useState<string | null>(null)
  const briefingViewer: MyDayRole | 'owner' =
    effectiveView === 'fernando' ? 'manager' : effectiveView === 'aaron' ? 'billing' : 'owner'

  const loadMyDay = useCallback(async () => {
    const grid = await fetchStaffGrid(14)
    setGridRows(grid)
    const dash = await loadMyDayDashboard({
      role: dutyRole ?? 'manager',
      viewer: briefingViewer,
      names: {
        manager: grid.find(g => g.role === 'manager')?.who,
        billing: grid.find(g => g.role === 'billing')?.who,
      },
    })
    setMyDay(dash)
  }, [dutyRole, briefingViewer])
  useEffect(() => { loadMyDay() }, [loadMyDay])
  useEffect(() => {
    const ch = supabase
      .channel('myday-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_entries' }, () => loadMyDay())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_duties' }, () => loadMyDay())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loadMyDay])

  async function toggleDuty(view: DutyView) {
    if (!myDay || savingDuty) return
    setSavingDuty(view.duty.id)
    const date = getLocalToday()
    if (view.done) {
      await uncompleteDuty(view.duty.id, date)
    } else {
      await completeDuty({
        duty: view.duty, date,
        completedBy: profile?.id ?? null,
        subState: view.entry?.sub_state,
        captured: view.entry?.captured,
        entries: myDay.entries,
      })
    }
    await loadMyDay()
    setSavingDuty(null)
  }

  // ── Tasks (viewer's own) + approvals (owners) for the merged queue. ────────
  const [tasks, setTasks] = useState<DashboardTask[]>([])
  useEffect(() => {
    if (profile?.id) fetchMyTasks(profile.id).then(setTasks)
  }, [profile?.id, dashDataVersion])
  const [approvals, setApprovals] = useState<InvoiceRow[]>([])
  useEffect(() => {
    if (!isOwnerHere) { setApprovals([]); return }
    let live = true
    fetchApprovalsQueue().then(q => { if (live) setApprovals(q) })
    return () => { live = false }
  }, [isOwnerHere, woVersion])

  // ── Home data (lib/home.ts): landed · inquiries · pulse · holds · COD out. ─
  const [landed, setLanded] = useState<LandedItem[]>([])
  const [holds, setHolds] = useState<QueueBookingItem[]>([])
  const [inquiries, setInquiries] = useState<InquiryLead[]>([])
  const [pulse, setPulse] = useState<BillingPulse | null>(null)
  const [codOut, setCodOut] = useState<{ total: number; worst: number }>({ total: 0, worst: 0 })

  useEffect(() => {
    // Paired with the page's bookings channel (dashDataVersion).
    fetchLandedToday().then(v => { if (v) setLanded(v) })
    fetchHoldsWeek().then(setHolds)
  }, [dashDataVersion])
  useEffect(() => {
    // Paired with WebInquiryProvider's leads channel.
    fetchNewInquiries().then(v => { if (v) setInquiries(v) })
  }, [leadsVersion])
  useEffect(() => {
    // Paired with the shared work_orders/payment_rows channel.
    fetchBillingPulse().then(v => { if (v) setPulse(v) })
    fetchBalancesQueue().then(b => {
      const total = b.reduce((s, x) => s + x.balance, 0)
      const worst = b.reduce((s, x) => {
        if (!x.sessionDate) return s
        return Math.max(s, Math.floor(daysSince(x.sessionDate)))
      }, 0)
      setCodOut({ total, worst })
    })
  }, [woVersion, dashDataVersion])

  // ── Leads + the viewed day's bookings. ─────────────────────────────────────
  useEffect(() => {
    async function load() {
      const d = new Date(calDate)
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
  }, [calDate, leadsVersion, dashDataVersion])

  // Realtime — bookings drive Tonight + landed + holds re-fetches.
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => setDashDataVersion(v => v + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_tasks' }, () => setDashDataVersion(v => v + 1))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Noir ground + welcome splash + clock (carried over). ───────────────────
  useEffect(() => {
    document.documentElement.classList.add('n-page')
    return () => document.documentElement.classList.remove('n-page')
  }, [])
  const [showWelcome, setShowWelcome] = useState<boolean>(
    () => typeof window !== 'undefined' && sessionStorage.getItem('showWelcome') === 'true'
  )
  const [welcomeFading, setWelcomeFading] = useState(false)
  const [nameVisible, setNameVisible] = useState(false)
  const [contentReady, setContentReady] = useState(false)
  const welcomeInit = useRef(false)
  const [clockNow, setClockNow] = useState(() => new Date())
  useEffect(() => {
    if (welcomeInit.current) return
    welcomeInit.current = true
    if (typeof window !== 'undefined' && sessionStorage.getItem('showWelcome') === 'true') {
      sessionStorage.removeItem('showWelcome')
      setShowWelcome(true)
      setTimeout(() => setWelcomeFading(true), 2000)
      setTimeout(() => {
        setShowWelcome(false)
        window.dispatchEvent(new Event('welcomeDone'))
      }, 2500)
    }
    setContentReady(true)
  }, [])
  useEffect(() => {
    if (showWelcome && profile?.display_name) {
      const t = setTimeout(() => setNameVisible(true), 300)
      return () => clearTimeout(t)
    }
  }, [showWelcome, profile?.display_name])
  useEffect(() => {
    if (contentReady && !showWelcome) {
      const el = document.getElementById('dashboard-content')
      if (el) el.style.visibility = 'visible'
    }
  }, [contentReady, showWelcome])
  useEffect(() => {
    const id = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const viewedName =
    effectiveView === 'fernando' ? gridRows.find(g => g.role === 'manager')?.who
    : effectiveView === 'aaron' ? gridRows.find(g => g.role === 'billing')?.who
    : profile?.display_name
  const clockDate = clockNow.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const clockTime = clockNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })

  // ── Pipeline numbers (same predicate as the CRM Needs Action bucket). ──────
  const pipelineLeads = leads.filter(l => {
    if (l.needs_contact === false) return false
    const uncontacted = l.status === 'uncontacted' || (!l.last_contact && l.status !== 'booked' && l.status !== 'dead')
    const hot = l.status === 'hot' && isKhuDue(l) && !isParked(l)
    const warm = l.status === 'warm' && isKhuDue(l) && !isParked(l)
    const incomplete = (l.status === 'hot' || l.status === 'warm' || l.status === 'uncontacted')
      && (!l.fname || !l.lname || !l.email || !l.phone || (!l.quote && !l.rate_daily))
    return uncontacted || hot || warm || incomplete
  })
  const pipeHot = pipelineLeads.filter(l => l.status === 'hot').length
  const pipeWarm = pipelineLeads.filter(l => l.status === 'warm').length
  const pipeUncon = pipelineLeads.filter(l => l.status === 'uncontacted').length

  // ── THE STATEMENT — the briefing's real sentences, sized to be read.
  //    Red bullets lead (max 2), the landed line follows when we landed
  //    anything, then the synopsis as the quiet coda. Same numbers as ever
  //    (composeBriefing); only the volume changed.
  const alertLines = (myDay?.briefing.bullets ?? []).filter(b => b.alert).slice(0, 3)
  // THE REVIEW LINE (Eli, 2026-09-07 — "Monday: he's got a ton from the
  // weekend; prioritize getting the WOs reviewed and ready for approval").
  // Same billingStage-derived count as the money tile, so Flo and the tile
  // can never disagree. Monday gets the weekend framing.
  const isMonday = clockNow.getDay() === 1
  const reviewLine = pulse && pulse.review > 0
    ? `${isMonday ? 'Weekend catch-up: ' : ''}${pulse.review} work order${pulse.review === 1 ? '' : 's'} need${pulse.review === 1 ? 's' : ''} review — get ${pulse.review === 1 ? 'it' : 'them'} ready for approval.`
    : null
  const calmLine = (myDay?.briefing.bullets ?? []).find(b => !b.alert)
  const landedNames = Array.from(new Set(landed.map(l => l.client)))
  const landedLine = landedNames.length > 0
    ? landedNames.length === 1
      ? `We landed ${landedNames[0]} today.`
      : `We landed ${landedNames.slice(0, -1).join(', ')} and ${landedNames[landedNames.length - 1]} today.`
    : null

  // ── The merged queue rows for the active tab. ──────────────────────────────
  function queueRows(): QueueRow[] {
    const rows: QueueRow[] = []
    if (qTab === 'mine') {
      for (const r of approvals) {
        rows.push({
          key: `ap-${r.workOrderId}`, kind: 'approve',
          text: `Approve — ${r.client}`,
          mn: formatCurrency(String(r.total)),
          href: '/billing',
        })
      }
      for (const t of tasks) {
        rows.push({ key: `t-${t.id}`, kind: 'task', text: t.text || '', href: '/tasks' })
      }
      return rows
    }
    // A staff tab: the role's duty card (+ the viewer's own tasks when this IS
    // the viewer's seat — Eli peeking at Fernando doesn't see Fernando's tasks;
    // task visibility is RLS's job, not the dashboard's).
    const views = (myDay?.views ?? []).filter(v => v.isShown)
    for (const v of views) {
      const red = !v.done && (v.overdueDays > 0 || v.backlogDays > 0)
      rows.push({
        key: `d-${v.duty.id}`, kind: 'duty',
        text: v.duty.label,
        mn: v.overdueDays > 0 ? `${v.overdueDays}D LATE`
          : v.backlogDays > 0 ? `${v.backlogDays + 1} DAYS`
          : !v.isDue && !v.done ? 'NOT DUE' : undefined,
        red, done: v.done, duty: v,
      })
    }
    if (qTab === effectiveView) {
      for (const t of tasks) {
        rows.push({ key: `t-${t.id}`, kind: 'task', text: t.text || '', href: '/tasks' })
      }
    }
    return rows
  }
  const qRows = queueRows()
  const qDone = qRows.filter(r => r.done).length

  // ── Tonight's rooms. ───────────────────────────────────────────────────────
  const [dashEditBooking, setDashEditBooking] = useState<Booking | null>(null)
  function openNewRoomBooking(room: { venue: string; studio: string }) {
    const d = new Date(calDate)
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
    const date = d.toISOString().slice(0, 10)
    const params = new URLSearchParams({ newBooking: '1', location: room.venue, studio: room.studio, date })
    router.push(`/calendar?${params.toString()}`)
  }
  async function refreshDayBookings() {
    const d = new Date(calDate)
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
    const today = d.toISOString().slice(0, 10)
    const { data } = await supabase.from('bookings').select('*').lte('start_date', today).gte('end_date', today).order('from_time', { ascending: true })
    setBookings(data || [])
  }
  async function handleDashDelete() {
    if (!dashEditBooking) return
    await deleteSessionAndWO(dashEditBooking)
    setDashEditBooking(null)
    await refreshDayBookings()
  }

  const holdsWeek = holds.slice(0, 6)

  return (
    <>
      {/* One-time post-login welcome splash (unchanged). */}
      {showWelcome && (
        <div
          data-splash=""
          style={{
            position: 'fixed', inset: 0, zIndex: 100000,
            background: '#0b0a09',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            opacity: welcomeFading ? 0 : 1,
            transition: 'opacity 0.6s ease',
            animation: welcomeFading ? undefined : 'welcomeFadeIn 0.4s ease',
          }}
        >
          <div style={{ marginBottom: 2 }}><PRSFloIcon size={72} /></div>
          <div style={{ fontFamily: 'Inter', fontSize: 13, letterSpacing: '0.2em', color: 'rgba(242,239,231,.34)', textTransform: 'uppercase' }}>
            {greeting.toUpperCase()}
          </div>
          <div style={{
            fontFamily: 'Archivo Black', fontWeight: 400, fontSize: isMobile ? 48 : 64, color: '#f2efe7', lineHeight: 1.1, marginTop: 14, marginBottom: 108, textAlign: 'center',
            opacity: nameVisible ? 1 : 0,
            transform: nameVisible ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.6s ease, transform 0.6s ease',
          }}>
            {profile?.display_name || ' '}
          </div>
        </div>
      )}

      <div
        id="dashboard-content"
        className={`n-home${isMobile ? ' n-mobile' : ''}`}
        style={{ opacity: contentReady && !showWelcome ? 1 : 0, transition: 'opacity 0.3s ease', maxWidth: 1280, margin: '0 auto' }}
      >

      {/* HEADER — greeting label, title, view-as (Eli), datechip. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '2px 4px 16px', flexWrap: isMobile ? 'wrap' : undefined }}>
        <div>
          {/* THE STONE HEADER (locked T1, 2026-09-07): PARAMOUNT in Bebas — the
              building's own voice, distinct from Flo's Archivo. No motion, no
              glow up here; the header is stone. */}
          <h1 className="n-title" style={isMobile ? { fontSize: 30 } : undefined}>
            Paramount Recording Studios
          </h1>
          <div className="n-titlesub">
            {greeting}{viewedName ? ` ${viewedName}` : ''} · Hollywood, CA
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {isEli && !isMobile && (
          <span className="n-seg" style={{ flexShrink: 0 }}>
            <button className={viewAs === 'eli' ? 'n-on' : ''} onClick={() => setViewAs('eli')}>Eli</button>
            <button className={viewAs === 'fernando' ? 'n-on' : ''} onClick={() => setViewAs('fernando')}>
              {gridRows.find(g => g.role === 'manager')?.who ?? 'Manager'}
            </button>
            <button className={viewAs === 'aaron' ? 'n-on' : ''} onClick={() => setViewAs('aaron')}>
              {gridRows.find(g => g.role === 'billing')?.who ?? 'Billing'}
            </button>
          </span>
        )}
        {!isMobile && (
          <div className="n-datechip" style={{ flexShrink: 0 }}>
            {clockDate.toUpperCase()}
            <small>{clockTime}</small>
          </div>
        )}
      </div>

      {/* ── THE STATEMENT ── */}
      <div className="n-statement">
        <div className="n-fhead">
          <PRSFloIcon size={26} />
          <span className="n-fname">Flo</span>
          <span className="n-label">· Your briefing · {clockNow.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
        {alertLines.map((b, i) => (
          <span key={i} className="n-ln n-red" style={{ fontSize: isMobile ? 17 : undefined }}>{b.text}</span>
        ))}
        {reviewLine && (
          <span className="n-ln n-warmln" style={{ fontSize: isMobile ? 17 : undefined }}>{reviewLine}</span>
        )}
        {landedLine && (
          <span className="n-ln" style={{ fontSize: isMobile ? 17 : undefined }}>
            We landed <span className="n-grad">{landedNames.slice(0, -1).join(', ')}{landedNames.length > 1 ? ' and ' : ''}{landedNames[landedNames.length - 1]}</span> today.
          </span>
        )}
        {alertLines.length === 0 && !landedLine && calmLine && (
          <span className="n-ln" style={{ fontSize: isMobile ? 17 : undefined }}>{calmLine.text}</span>
        )}
        <span className="n-ln n-dim">{myDay?.briefing.synopsis ?? '…'}</span>
        <div className="n-askflo">Ask Flo →</div>
      </div>

      {/* ── ROW 1 (Eli 2026-09-07): CRM + Money LEAD — the business numbers outrank the day view. Slimmed to ~1/4 of the page. ── */}
      <div className="n-row2">

        <div className="n-portal" onClick={() => router.push('/crm')}>
          <div className="n-pt"><b>CRM — pipeline</b><span className="n-arrow">→</span></div>
          <div className="n-pbody">
            <div className="n-pleft">
              <div>
                <div className="n-pipebig">{loading ? '–' : pipelineLeads.length}</div>
                <div className="n-pipesub">active leads</div>
              </div>
              <div className="n-pstat">
                <span className="n-chip n-h">{pipeHot} hot</span>
                <span className="n-chip n-wchip">{pipeWarm} warm</span>
                <span className="n-chip n-u">{pipeUncon} uncon</span>
              </div>
            </div>
            <div className={`n-inqblock${inquiries.length === 0 ? ' n-quietblock' : ''}`}>
              {inquiries.length === 0 ? (
                <div className="n-inqk">No new inquiries</div>
              ) : (
                <>
                  <div className="n-inqk"><span className="n-pulse" />{inquiryCount || inquiries.length} new inquir{(inquiryCount || inquiries.length) === 1 ? 'y' : 'ies'}</div>
                  {inquiries.slice(0, 2).map(q => (
                    <div key={q.id} className="n-who">
                      {q.name} <span className="n-src">· web form{q.createdAt ? ` · ${shortDayLabel(q.createdAt.slice(0, 10))}` : ''}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="n-portal" onClick={() => router.push('/billing')}>
          <div className="n-pt"><b>The money — where billing is at</b><span className="n-arrow">→</span></div>
          <div className="n-stagegrid">
            <div className="n-stile n-hotf">
              {/* Whole dollars — cents made the figure bleed out of its tile. */}
              <div className="n-bn">${Math.round(codOut.total).toLocaleString('en-US')}</div>
              <div className="n-bk">COD out{codOut.worst > 0 ? ` · worst ${codOut.worst}d` : ''}</div>
            </div>
            <div className="n-stile n-coldt">
              <div className="n-bn">{pulse?.review ?? '–'}</div>
              <div className="n-bk">WOs need review</div>
            </div>
            <div className="n-stile n-warmt">
              <div className="n-bn">{pulse?.approval ?? '–'}</div>
              <div className="n-bk">Wait on approval{pulse && pulse.approvalTotal > 0 ? ` · ${formatCurrency(String(pulse.approvalTotal))}` : ''}</div>
            </div>
            <div className="n-stile n-okt">
              <div className="n-bn">{pulse?.send ?? '–'}</div>
              <div className="n-bk">Ready to go out</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── ROW 2: Tonight · Your list · Landed & in the air ── */}
      <div className="n-row1">

        <div className="n-portal" style={{ cursor: 'default' }}>
          <div className="n-pt">
            <b>Your list</b>
            {effectiveView === 'eli' && isEli && (
              <span className="n-qtabs" onClick={e => e.stopPropagation()}>
                <button className={qTab === 'mine' ? 'n-on' : ''} onClick={() => setQTab('mine')}>Mine</button>
                <button className={qTab === 'fernando' ? 'n-on' : ''} onClick={() => setQTab('fernando')}>
                  {gridRows.find(g => g.role === 'manager')?.who ?? 'Mgr'}
                </button>
                <button className={qTab === 'aaron' ? 'n-on' : ''} onClick={() => setQTab('aaron')}>
                  {gridRows.find(g => g.role === 'billing')?.who ?? 'Billing'}
                </button>
              </span>
            )}
            <span className="n-prog">{qDone} of {qRows.length}</span>
            <span className="n-arrow" style={{ marginLeft: 8 }} onClick={() => router.push('/tasks')}>→</span>
          </div>
          <div className="n-qscroll">
            {qRows.map(r => (
              <div
                key={r.key}
                className={`n-q${r.done ? ' n-done' : ''}${r.red ? ' n-redq' : ''}`}
                style={{ opacity: savingDuty && r.duty?.duty.id === savingDuty ? 0.5 : undefined }}
                onClick={() => {
                  if (r.duty) toggleDuty(r.duty)
                  else if (r.href) router.push(r.href)
                }}
              >
                <span className="n-bx" />
                <span className={`n-tag${r.kind === 'approve' ? ' n-ap' : ''}`}>{r.kind}</span>
                <span className="n-tx">{r.text}</span>
                {r.mn && <span className="n-mn">{r.mn}</span>}
              </div>
            ))}
            {qRows.length === 0 && <div className="n-quiet">Quiet — nothing on you today.</div>}
            {qRows.length > 0 && qRows.length < 6 && qRows.every(r => r.done) && (
              <div className="n-quiet">All clear.</div>
            )}
          </div>
        </div>

        <div className="n-portal" onClick={() => router.push('/calendar')}>
          <div className="n-pt">
            <b>{calDate.toDateString() === new Date().toDateString() ? "Today's sessions" : calDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</b>
            <span className="n-loccount" style={{ marginLeft: 'auto' }} onClick={e => e.stopPropagation()}>
              {LOC_CHIPS.map(lc => {
                const n = bookings.filter(b => b.location === lc.venue && b.status === 'confirmed').length
                return <span key={lc.code} className={n > 0 ? 'n-live' : ''}>{lc.code} {n}</span>
              })}
            </span>
            <span className="n-arrow">→</span>
          </div>
          {loading ? (
            <div className="n-quiet">Loading…</div>
          ) : (
            <div className="n-rgrid" onClick={e => e.stopPropagation()}>
              {ROOMS.map(room => {
                const booking = bookings.find(b => b.location === room.venue && b.studio === room.studio)
                if (!booking) {
                  return (
                    <div
                      key={room.label}
                      className="n-rc"
                      style={{ cursor: room.bookable === false ? 'default' : 'pointer', opacity: .55 }}
                      onClick={room.bookable === false ? undefined : () => openNewRoomBooking(room)}
                    >
                      <span className="n-rn">{room.label}</span>
                    </div>
                  )
                }
                const eng = initials(booking.engineer_name)
                const asst = initials(booking.assistant_name)
                return (
                  <div
                    key={room.label}
                    className={`n-rc${roomFill(booking.status)}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setDashEditBooking(booking)}
                  >
                    <span className="n-rn">{room.label}</span>
                    <div className="n-a">{booking.artist || booking.client_name || booking.label || '—'}</div>
                    <div className="n-c">{booking.label || booking.client_name || ''}</div>
                    <div className="n-tm">{[booking.from_time, booking.to_time].filter(Boolean).join('–')}</div>
                    {(eng || asst) && <span className="n-eng">{eng ? `1ST-${eng}` : `2ND-${asst}`}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="n-portal" onClick={() => router.push('/calendar')}>
          <div className="n-pt"><b>Landed & in the air</b><span className="n-arrow">→</span></div>
          <div className="n-landhead">Landed today</div>
          {landedNames.length === 0 ? (
            <div className="n-quiet" style={{ paddingBottom: 10 }}>Nothing landed yet today.</div>
          ) : (
            <div className="n-landed">
              {landedNames.map(n => <span key={n} className="n-land">{n}</span>)}
            </div>
          )}
          <div className="n-landhead">Holds to check — next 7 days</div>
          <div className="n-qscroll">
            {holdsWeek.length === 0 && <div className="n-quiet">No holds — the week is open.</div>}
            {holdsWeek.map(h => (
              <div key={h.bookingId} className="n-holdrow">
                <span className="n-d">{shortDayLabel(h.date)}</span>
                <b>{h.artist || h.client}</b>
                <span className="n-chip n-w">{roomChip(h.location, h.studio)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Booked room card → the Work Order directly (Step 8 — the WO IS the booking). */}
      {dashEditBooking && (
        <WorkOrderPopup
          booking={dashEditBooking}
          onClose={() => { setDashEditBooking(null); refreshDayBookings() }}
          onSaved={refreshDayBookings}
          onDelete={handleDashDelete}
        />
      )}

      </div>
    </>
  )
}
