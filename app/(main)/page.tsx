'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, Lead, Booking, DashboardTask, DashboardTaskComment, Flag, FlagComment, UserProfile } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import { deleteSessionAndWO } from '@/lib/deleteSession'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Hint } from '@/components/ui/Hint'
import { Row, SoftButton, StatusDot, NewLeadPulse, statusFillClass } from '@/components/carved'
import { SessionCardBody, initials, sessionFillClass } from '@/components/calendar/SessionCard'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { ASSIGN_OPTIONS, resolveAssignTo, nameForId, visibleTabsForRole, idsForTab, fetchTasks, fetchMyTasks, fetchMyCompletedTasks, isOwnOnlyRole } from '@/lib/tasks'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { useWebInquiries } from '@/components/notifications/WebInquiryProvider'
import { SignedImage } from '@/components/shared/SignedImage'
import { fmtTimestamp } from '@/lib/format'
import { getLocalToday } from '@/lib/time'
import {
  loadMyDayDashboard, fetchStaffGrid, completeDuty, uncompleteDuty, setDutyCaptured,
  backlogScopeLabel, BACKLOG_FLAG_THRESHOLD,
  type MyDayRole, type MyDayDashboard, type GridRow, type DutyView,
} from '@/lib/myday'

/**
 * Dashboard view-as (§14b + RULING 2026-08-10). 'eli' is OVERSIGHT, not a
 * person's duty card — the briefing goes cross-role and the staff grid appears.
 * 'fernando' and 'aaron' map to the manager and billing duty cards.
 */
type ViewAs = 'eli' | 'fernando' | 'aaron'

// Needs Action predicates — mirror the CRM (app/(main)/crm/page.tsx) bucket logic
// so the dashboard surfaces the same leads as the CRM Needs Action tab.
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

// Mobile-only override spread for modal cards: full-screen sheet (100vw × 100dvh,
// no rounding, flush to the edges). Spread LAST into a card's style object so it
// wins over the desktop width/maxWidth/margin/maxHeight/borderRadius values.
// Returns {} on desktop, leaving the existing layout untouched.
function fullscreenCardOnMobile(isMobile: boolean, viewportHeight: number | null): React.CSSProperties {
  if (!isMobile) return {}
  const h = viewportHeight != null ? `${viewportHeight}px` : '100dvh'
  return {
    position: 'fixed', top: 0, left: 0,
    width: '100vw', height: h, maxWidth: '100vw', maxHeight: h,
    margin: 0, borderRadius: 0, boxSizing: 'border-box',
    paddingTop: 'calc(52px + env(safe-area-inset-top, 0px))',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  }
}

// Room-card geometry. The card must clear the shared session card's full
// anatomy (74px) plus the room-name line, or the dashboard would silently render
// the reduced ladder while the calendar showed the full one — the exact drift
// this grid was unified to stop.
// (engInitials/fmtSessionTime lived here as byte-identical twins of the
//  calendar's — both now come from the shared card module.)
const ROOM_NAME_H = 20
// 120 → 84 (Eli, 2026-08-20: "cal cards on the dashboard are a little big.
// lots of scrolling… 30% smaller"). At 84 the body is 64px, which per the
// SessionCardBody tier ladder keeps artist/client/times but drops the staff-
// initials footer (needs 74px) — accepted trade; the booking is one click away.
const ROOM_CARD_H = 84

// §14b: rooms are 12, in this order — PRS A,B,C,E,X,Nadine's → ARS A,B →
// ERS A,B → TRS N,S. Nadine's is PRS's sixth room but is not yet a bookable
// studio in the data model (STUDIO_LOCATIONS has no Nadine's), so its card is
// display-only (`bookable: false`) until that lands.
const ROOMS: { venue: string; studio: string; label: string; bookable?: boolean }[] = [
  { venue: 'Paramount', studio: 'Studio A', label: 'PRS · A' },
  { venue: 'Paramount', studio: 'Studio B', label: 'PRS · B' },
  { venue: 'Paramount', studio: 'Studio C', label: 'PRS · C' },
  { venue: 'Paramount', studio: 'Studio E', label: 'PRS · E' },
  { venue: 'Paramount', studio: 'Studio X', label: 'PRS · X' },
  { venue: 'Paramount', studio: "Nadine's", label: "PRS · Nadine's", bookable: false },
  { venue: 'Ameraycan', studio: 'Studio A', label: 'ARS · A' },
  { venue: 'Ameraycan', studio: 'Studio B', label: 'ARS · B' },
  { venue: 'Encore', studio: 'Studio A', label: 'ERS · A' },
  { venue: 'Encore', studio: 'Studio B', label: 'ERS · B' },
  { venue: 'Track', studio: 'North', label: 'TRS · N' },
  { venue: 'Track', studio: 'South', label: 'TRS · S' },
]

// Location count chips for the sessions pane header (§14b — the old location
// strip is retired; these are its replacement).
const LOC_CHIPS = [
  { code: 'PRS', venue: 'Paramount' },
  { code: 'ARS', venue: 'Ameraycan' },
  { code: 'ERS', venue: 'Encore' },
  { code: 'TRS', venue: 'Track' },
]

// (The FLO_STATIC / MYDAY_STATIC / DGRID_STATIC placeholders that used to live
// here — copied from docs/design-refs/dashboard-final.html — were deleted on
// 2026-08-10 when the console went live against real data. The briefing now
// comes from composeBriefing, the duty card from myday_duties/myday_entries,
// and the staff grid from fetchStaffGrid, all in lib/myday.ts.)

// Canonical formatter (lib/format). Local alias keeps existing call sites.
const fmtTime = fmtTimestamp

export default function DashboardPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const { profile, loading: profileLoading } = useUserProfile()
  const isMobile = useIsMobile()
  // Real-time Web Inquiry notifications: unaddressed inquiry lead IDs pulse below.
  // leadsVersion bumps on any realtime leads INSERT/UPDATE so Needs Action re-fetches
  // live (see the load effect dep below) — no page refresh needed.
  const { isUnacked, leadsVersion, count: inquiryCount } = useWebInquiries()
  const ownOnly = isOwnOnlyRole(profile?.role)
  // Everyone with a profile can assign tasks to anyone (own-only tiers included).
  const canAssign = !!profile
  const visibleTabs = visibleTabsForRole(profile?.role)
  const [allProfiles, setAllProfiles] = useState<UserProfile[]>([])
  const [newTaskAssignTo, setNewTaskAssignTo] = useState<string>('')
  const [activeTaskTab, setActiveTaskTab] = useState<string>('eli')
  const defaultTabSetRef = useRef(false)
  const [tabReady, setTabReady] = useState(false)
  const [tasks, setTasks] = useState<DashboardTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  // Bumped by the dashboard realtime channel on bookings/flags changes → re-runs the
  // leads/bookings/flags load so Today's Sessions + Flags panels update live.
  const [dashDataVersion, setDashDataVersion] = useState(0)
  const [selectedTask, setSelectedTask] = useState<DashboardTask | null>(null)
  const [taskComments, setTaskComments] = useState<DashboardTaskComment[]>([])
  const [commentText, setCommentText] = useState('')
  const [commentPhoto, setCommentPhoto] = useState<File | null>(null)
  const [commentPhotoPreview, setCommentPhotoPreview] = useState<string | null>(null)
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [newTaskPhoto, setNewTaskPhoto] = useState<File | null>(null)
  const [newTaskPhotoPreview, setNewTaskPhotoPreview] = useState<string | null>(null)
  const [taskSubmitting, setTaskSubmitting] = useState(false)
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('Staff')
  const [showHistory, setShowHistory] = useState(false)
  const [completedTasks, setCompletedTasks] = useState<DashboardTask[]>([])
  const [historySearch, setHistorySearch] = useState('')
  const [selectedHistoryTask, setSelectedHistoryTask] = useState<DashboardTask | null>(null)
  const [historyTaskComments, setHistoryTaskComments] = useState<DashboardTaskComment[]>([])
  const [flags, setFlags] = useState<Flag[]>([])
  const [flagsLoading, setFlagsLoading] = useState(true)
  const [selectedFlag, setSelectedFlag] = useState<Flag | null>(null)
  const [flagComments, setFlagComments] = useState<FlagComment[]>([])
  const [flagCommentText, setFlagCommentText] = useState('')
  const [flagCommentPhoto, setFlagCommentPhoto] = useState<File | null>(null)
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [currentUserName, setCurrentUserName] = useState<string>('Staff')
  const [pendingCategory, setPendingCategory] = useState<'facility_general' | 'gear_equipment' | 'client_billing' | null>(null)
  const [addingFlag, setAddingFlag] = useState(false)
  const [newFlagText, setNewFlagText] = useState('')
  const [newFlagStudio, setNewFlagStudio] = useState<string>('paramount')
  const [newFlagCategory, setNewFlagCategory] = useState<'facility_general' | 'gear_equipment' | 'client_billing' | null>(null)
  const [newFlagPhoto, setNewFlagPhoto] = useState<File | null>(null)
  const [newFlagPhotoPreview, setNewFlagPhotoPreview] = useState<string | null>(null)
  const [modalViewportHeight, setModalViewportHeight] = useState<number | null>(null)
  const [showResolveModal, setShowResolveModal] = useState(false)
  const [confirmDeleteFlag, setConfirmDeleteFlag] = useState(false)
  const [resolveNote, setResolveNote] = useState('')
  const [resolveVendor, setResolveVendor] = useState('')
  const [resolveCost, setResolveCost] = useState('')
  const newTaskPhotoRef = useRef<HTMLInputElement>(null)
  const commentPhotoRef = useRef<HTMLInputElement>(null)
  const flagCommentPhotoRef = useRef<HTMLInputElement>(null)
  const newFlagPhotoRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [calDate, setCalDate] = useState(new Date())
  const [hoverRoom, setHoverRoom] = useState<string | null>(null)
  // §14b view-as toggle — Eli previews Fernando's console (greeting, briefing,
  // My Day, default task tab, staff-grid visibility). Only Eli sees the toggle;
  // everyone else gets their own view with no preview control.
  const [viewAs, setViewAs] = useState<ViewAs>('eli')
  const isEli = profile?.email === 'srv2129@gmail.com' || profile?.email === 'eli@paramountrecording.com'
  function switchViewAs(v: ViewAs) {
    setViewAs(v)
    // (Task-tab follow removed with the name tabs — the panel is personal now.)
  }

  // ── MY DAY (docs/MYDAY-BUILD.md) ───────────────────────────────────────────
  // Replaces the FLO_STATIC / MYDAY_STATIC / DGRID_STATIC placeholders.
  //
  // The view-as toggle now carries three options (RULING 2026-08-10): Fernando
  // and Aaron each show their real duty card; 'eli' is OVERSIGHT — the briefing
  // spans both roles and the staff grid shows, but there is no duty card,
  // because duties are scoped to manager + billing (MYDAY-BUILD §0) and Eli has
  // nothing of his own to tick.
  const myDayRole: MyDayRole | null =
    viewAs === 'fernando' ? 'manager' : viewAs === 'aaron' ? 'billing' : null

  const [myDay, setMyDay] = useState<MyDayDashboard | null>(null)
  const [gridRows, setGridRows] = useState<GridRow[]>([])
  const [savingDuty, setSavingDuty] = useState<string | null>(null)

  const loadMyDay = useCallback(async () => {
    // Grid first: it resolves the display names, and the briefing needs them to
    // say "Fernando missed…" rather than "The manager missed…".
    const grid = await fetchStaffGrid(14)
    setGridRows(grid)
    const dash = await loadMyDayDashboard({
      // With no card of his own, Eli's console still needs a role to render
      // duties FOR; 'manager' is the arbitrary pick and is never displayed
      // when myDayRole is null. The briefing is what he actually reads.
      role: myDayRole ?? 'manager',
      viewer: myDayRole ?? 'owner',
      names: {
        manager: grid.find(g => g.role === 'manager')?.who,
        billing: grid.find(g => g.role === 'billing')?.who,
      },
    })
    setMyDay(dash)
  }, [myDayRole])

  useEffect(() => { loadMyDay() }, [loadMyDay])

  // Realtime — the standing rule: every fetch pairs with a subscription.
  // One channel for all four tables; My Day is a single logical surface and
  // four channels would just be four round-trips to the same reload.
  useEffect(() => {
    const ch = supabase
      .channel('myday-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_entries' }, () => loadMyDay())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_duties' }, () => loadMyDay())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'myday_queue_steps' }, () => loadMyDay())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loadMyDay])

  // Tick a duty. Optimism is deliberately avoided — realtime brings the row
  // back in well under a second, and a card that flickers between states is
  // worse than one that takes a beat.
  async function toggleDuty(view: DutyView) {
    if (!myDay || savingDuty) return
    setSavingDuty(view.duty.id)
    const date = getLocalToday()
    if (view.done) {
      await uncompleteDuty(view.duty.id, date)
    } else {
      await completeDuty({
        duty: view.duty,
        date,
        completedBy: profile?.id ?? null,
        subState: view.entry?.sub_state,
        captured: view.entry?.captured,
        entries: myDay.entries,
      })
    }
    await loadMyDay()
    setSavingDuty(null)
  }

  // Captured numbers (Aaron's COD figures, Fernando's exceptions cleared).
  // These are typed in Phase 1 and computed once QuickBooks is connected
  // (HR-SPEC §4 / docs/AR-SCOPING.md) — the storage shape does not change when
  // that happens, so this input keeps working either way.
  async function saveCapture(view: DutyView, key: string, raw: string) {
    const next = { ...(view.entry?.captured ?? {}) }
    if (raw.trim() === '') delete next[key]
    else next[key] = Number(raw)
    await setDutyCaptured(view.duty.id, getLocalToday(), next)
    await loadMyDay()
  }
  // Step 8: booked room-grid cards open the Work Order directly (BookingForm deleted).
  const [dashEditBooking, setDashEditBooking] = useState<Booking | null>(null)
  // One-time post-login welcome splash (set by the login page in sessionStorage).
  // Initialize from the flag synchronously so the splash is in the dashboard's
  // FIRST paint — covering the nav bar before it can flash. The welcome effect
  // below still removes the flag and schedules the dismiss.
  const [showWelcome, setShowWelcome] = useState<boolean>(
    () => typeof window !== 'undefined' && sessionStorage.getItem('showWelcome') === 'true'
  )
  const [welcomeFading, setWelcomeFading] = useState(false)
  // Carved surfaces paint their own ground: mark <html> while this route is
  // mounted so the legacy page background (light gradient / dark #0d0f14) can't
  // frame the migrated page. Removed on unmount so un-migrated routes are
  // untouched. Dies with the legacy --bg once every surface is migrated.
  useEffect(() => {
    document.documentElement.classList.add('c-page')
    return () => document.documentElement.classList.remove('c-page')
  }, [])

  // Name fades in 300ms after the splash mounts (greeting + footer show immediately).
  const [nameVisible, setNameVisible] = useState(false)
  // Content starts hidden until the welcome check resolves, so the dashboard
  // never flashes at full opacity for a frame before the splash mounts.
  const [contentReady, setContentReady] = useState(false)
  const welcomeInit = useRef(false)
  // Live clock for the dashboard hero (desktop only); ticks every second.
  const [clockNow, setClockNow] = useState(() => new Date())

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  // Personalized: append the display name once the profile resolves; while loading
  // or when no profile is found, fall back to the bare time-of-day greeting.
  const greetingName = profile?.display_name ? ` ${profile.display_name}` : ''
  const clockDate = clockNow.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const clockTime = clockNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  // PIPELINE (ruling 2026-08-07): the needs-action list is demoted to an
  // INDICATOR — full count + heat breakdown, no names (you deal with leads in
  // the CRM). Same predicate as the CRM Needs Action bucket, un-capped.
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
  useEffect(() => {
    async function load() {
      const d = new Date(calDate)
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
      const today = d.toISOString().slice(0, 10)
      const [{ data: leadsData }, { data: bookingsData }, { data: flagsData }] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('bookings').select('*').lte('start_date', today).gte('end_date', today).order('from_time', { ascending: true }),
        supabase.from('flags').select('*').in('status', ['pending', 'acknowledged']).is('deleted_at', null).order('created_at', { ascending: false }),
      ])
      setLeads(leadsData || [])
      setBookings(bookingsData || [])
      setFlags(flagsData || [])
      setLoading(false)
      setFlagsLoading(false)
    }
    load()
  }, [calDate, leadsVersion, dashDataVersion])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.email) setCurrentUserEmail(data.user.email)
    })
  }, [])

  // Welcome splash: only when the login page flagged a fresh sign-in. Remove the
  // flag immediately so refresh / navigation never re-triggers it. Hold ~2s, then
  // fade out over 0.5s and reveal the dashboard. The ref guard makes this run once
  // (e.g. under React StrictMode's double-invoke in dev) so the timers aren't lost.
  useEffect(() => {
    if (welcomeInit.current) return
    welcomeInit.current = true
    if (typeof window !== 'undefined' && sessionStorage.getItem('showWelcome') === 'true') {
      sessionStorage.removeItem('showWelcome')
      setShowWelcome(true)
      setTimeout(() => setWelcomeFading(true), 2000)
      setTimeout(() => {
        setShowWelcome(false)
        // Tell the nav (hidden during the splash) it can fade in now.
        window.dispatchEvent(new Event('welcomeDone'))
      }, 2500)
    }
    // Mark the content ready whether or not the splash showed, so the wrapper can
    // transition in. Until this runs, the wrapper stays at opacity 0 (no flash).
    setContentReady(true)
  }, [])

  // Fade the name in once it has actually loaded (useUserProfile is async). Firing on
  // a blind timer made the 0.6s opacity fade animate the empty placeholder, so the real
  // name popped in at full opacity. Gating on display_name makes the fade animate the
  // real name — symmetric with the 0.6s ease fade-out. Keep a 300ms beat after the
  // greeting before the name fades in.
  useEffect(() => {
    if (showWelcome && profile?.display_name) {
      const t = setTimeout(() => setNameVisible(true), 300)
      return () => clearTimeout(t)
    }
  }, [showWelcome, profile?.display_name])

  // Once the welcome check has resolved and the splash is gone, undo the inline
  // script's pre-paint visibility:hidden on the content wrapper. Harmless when the
  // script never ran (no flag) — it just confirms the wrapper is visible.
  useEffect(() => {
    if (contentReady && !showWelcome) {
      const el = document.getElementById('dashboard-content')
      if (el) el.style.visibility = 'visible'
    }
  }, [contentReady, showWelcome])

  // Tick the dashboard hero clock once a second; cleaned up on unmount.
  useEffect(() => {
    const id = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Fetch the full user_profiles list once on mount — used to resolve tab ids
  // and to populate the Assign to dropdown.
  useEffect(() => {
    supabase
      .from('user_profiles')
      .select('*')
      .is('deleted_at', null)
      .order('display_name', { ascending: true })
      .then(({ data }) => setAllProfiles((data as UserProfile[]) || []))
  }, [])

  // Once the profile + profiles are loaded, default the active tab to the user's
  // own tab when it's visible, otherwise the first visible tab. Runs once.
  useEffect(() => {
    if (profileLoading || defaultTabSetRef.current || allProfiles.length === 0) return
    defaultTabSetRef.current = true
    // Own-only tiers use a single "My Tasks" view — no tab to select.
    if (ownOnly) { setTabReady(true); return }
    const tabs = visibleTabsForRole(profile?.role)
    let initial = tabs.length > 0 ? tabs[0].key : 'eli'
    const name = profile?.display_name?.toLowerCase()
    if (name) {
      const own = tabs.find(t => t.names.some(n => n.toLowerCase() === name))
      if (own) initial = own.key
    }
    setActiveTaskTab(initial)
    setTabReady(true)
  }, [profileLoading, profile, allProfiles])

  // PERSONAL LIST (Eli ruling 2026-08-07): the dashboard task panel is each
  // person's OWN to-do list — the per-person name tabs are shelved (not a good
  // system in practice). The tab/roster logic in lib/tasks is KEPT (the /tasks
  // page and the assign-on-create dropdown still use it); the dashboard just
  // stops rendering tabs and always fetches the viewer's own tasks.
  useEffect(() => {
    if (profileLoading || !tabReady) return
    async function load() {
      setTasksLoading(true)
      setTasks(profile?.id ? await fetchMyTasks(profile.id) : [])
      setTasksLoading(false)
    }
    load()
  }, [profileLoading, tabReady, profile?.id])

  async function reloadTasks() {
    setTasksLoading(true)
    setTasks(profile?.id ? await fetchMyTasks(profile.id) : [])
    setTasksLoading(false)
  }

  // Real-time dashboard data: one channel covering the three tables the dashboard
  // renders that aren't already live via the Needs Action (leadsVersion) path.
  // bookings/flags → re-run the leads/bookings/flags load (via dashDataVersion);
  // dashboard_tasks → reload the active task tab (via a ref so the channel is stable).
  // (The LocationStrip that used to keep its own channels is retired — §14b.)
  const reloadTasksRef = useRef(reloadTasks)
  useEffect(() => { reloadTasksRef.current = reloadTasks })
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => setDashDataVersion(v => v + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flags' }, () => setDashDataVersion(v => v + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_tasks' }, () => { reloadTasksRef.current() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  function openBookingEdit(bk: Booking) {
    setDashEditBooking(bk)
  }

  // Empty room card → open the calendar's new-booking form pre-filled with this
  // room and the viewed day. Reuses the calendar's existing new-booking flow
  // (openNew + handleSave) via query params rather than duplicating the form.
  function openNewRoomBooking(room: { venue: string; studio: string }) {
    const d = new Date(calDate)
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
    const date = d.toISOString().slice(0, 10)
    const params = new URLSearchParams({ newBooking: '1', location: room.venue, studio: room.studio, date })
    router.push(`/calendar?${params.toString()}`)
  }

  // Refetch the viewed day's bookings (WO saves/deletes happen inside the popup).
  async function refreshDayBookings() {
    const d = new Date(calDate)
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
    const today = d.toISOString().slice(0, 10)
    const { data: refreshed } = await supabase.from('bookings').select('*').lte('start_date', today).gte('end_date', today).order('from_time', { ascending: true })
    setBookings(refreshed || [])
  }

  async function handleDashDelete() {
    if (!dashEditBooking) return
    await deleteSessionAndWO(dashEditBooking)
    setDashEditBooking(null)
    await refreshDayBookings()
  }

  async function fetchCompletedTasks() {
    if (ownOnly && profile?.id) {
      setCompletedTasks(await fetchMyCompletedTasks(profile.id))
      return
    }
    const ids = idsForTab(activeTaskTab, allProfiles)
    if (ids.length === 0) { setCompletedTasks([]); return }
    const { data } = await supabase
      .from('dashboard_tasks')
      .select('*')
      .in('assigned_to', ids)
      .eq('completed', true)
      .is('deleted_at', null)
      .order('completed_at', { ascending: false })
      .limit(100)
    setCompletedTasks(data || [])
  }

  async function uploadPhoto(file: File): Promise<string | null> {
    const path = `dashboard-tasks/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
    const { data, error } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
    if (!data || error) {
      // Surface storage failures instead of silently saving a record with no photo.
      console.error('photo upload failed:', error)
      return null
    }
    // Store the storage PATH — checklist-photos is private; reads sign on demand.
    return data.path
  }

  async function loadComments(taskId: string) {
    const { data } = await supabase
      .from('dashboard_task_comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
    setTaskComments(data || [])
  }

  async function handleOpenTask(task: DashboardTask) {
    setSelectedTask(task)
    setCommentText('')
    clearCommentPhoto()
    await loadComments(task.id)
  }

  function openAddTask() {
    // Personal list: default the assign dropdown to "Me" for everyone; picking
    // someone else sends the task to THEIR list (the assign logic is kept).
    setNewTaskAssignTo('')
    setAddingTask(true)
  }

  // Set the selected add-task photo and its object-URL preview, revoking any prior
  // preview URL to avoid leaks.
  function pickNewTaskPhoto(file: File | null) {
    setNewTaskPhoto(file)
    setNewTaskPhotoPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return file ? URL.createObjectURL(file) : null
    })
  }

  function clearNewTaskPhoto() {
    setNewTaskPhoto(null)
    setNewTaskPhotoPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (newTaskPhotoRef.current) newTaskPhotoRef.current.value = ''
  }

  // Set the selected comment photo and its object-URL preview, revoking any prior
  // preview URL to avoid leaks.
  function pickCommentPhoto(file: File | null) {
    setCommentPhoto(file)
    setCommentPhotoPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return file ? URL.createObjectURL(file) : null
    })
  }

  function clearCommentPhoto() {
    setCommentPhoto(null)
    setCommentPhotoPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (commentPhotoRef.current) commentPhotoRef.current.value = ''
  }

  // Set the selected new-flag photo and its object-URL preview, revoking any prior
  // preview URL to avoid leaks.
  function pickNewFlagPhoto(file: File | null) {
    setNewFlagPhoto(file)
    setNewFlagPhotoPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return file ? URL.createObjectURL(file) : null
    })
  }

  function clearNewFlagPhoto() {
    setNewFlagPhoto(null)
    setNewFlagPhotoPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (newFlagPhotoRef.current) newFlagPhotoRef.current.value = ''
  }

  // Track the visual-viewport height while any modal is open on mobile, so each
  // full-screen card can size to it and its footer stays above the iOS keyboard
  // (the keyboard overlays the viewport rather than shrinking it).
  const anyModalOpen = !!(selectedTask || showHistory || selectedHistoryTask || addingFlag || selectedFlag || addingTask || showResolveModal)
  useEffect(() => {
    if (!isMobile || !anyModalOpen) { setModalViewportHeight(null); return }
    const vv = window.visualViewport
    if (!vv) return
    function onViewportChange() {
      setModalViewportHeight(vv.height)
    }
    onViewportChange()
    vv.addEventListener('resize', onViewportChange)
    vv.addEventListener('scroll', onViewportChange)
    return () => {
      vv.removeEventListener('resize', onViewportChange)
      vv.removeEventListener('scroll', onViewportChange)
      setModalViewportHeight(null)
    }
  }, [isMobile, anyModalOpen])

  function closeAddTask() {
    setAddingTask(false)
    setNewTaskText('')
    setNewTaskAssignTo('')
    clearNewTaskPhoto()
  }

  async function handleAddTask() {
    if (!newTaskText.trim() || taskSubmitting) return
    setTaskSubmitting(true)
    const photo_url = newTaskPhoto ? await uploadPhoto(newTaskPhoto) : null
    // Everyone assigns via the dropdown now. A selected option resolves to a
    // member id (Asst Mgr → Quinn, Tech → Sierra); own-only tiers default to
    // "Me" ("" → resolves to null → falls back to the creator's own id below).
    // assigned_by is always the creating user. assigned_role stays a vestigial
    // NOT NULL column — visibility is driven by assigned_to / assigned_by.
    const assigned_to = canAssign
      ? (resolveAssignTo(newTaskAssignTo, allProfiles) || profile?.id || null)
      : (profile?.id || null)
    const { data, error } = await supabase.from('dashboard_tasks').insert({
      text: newTaskText.trim(),
      assigned_role: 'admin',
      assigned_to,
      assigned_by: profile?.id ?? null,
      source: 'manual',
      photo_url,
    }).select()
    if (error) console.error('task insert failed:', error)
    else console.log('task insert result:', { data })
    setNewTaskText('')
    setNewTaskAssignTo('')
    clearNewTaskPhoto()
    setAddingTask(false)
    setTaskSubmitting(false)
    await reloadTasks()
  }

  async function handleDeleteTask(task: DashboardTask) {
    setTasks(prev => prev.filter(t => t.id !== task.id))
    await supabase.from('dashboard_tasks').update({ deleted_at: new Date().toISOString() }).eq('id', task.id)
  }

  async function handleComment() {
    if (!selectedTask || taskSubmitting) return
    if (!commentText.trim() && !commentPhoto) return
    setTaskSubmitting(true)
    const photo_url = commentPhoto ? await uploadPhoto(commentPhoto) : null
    await supabase.from('dashboard_task_comments').insert({
      task_id: selectedTask.id,
      text: commentText.trim() || null,
      photo_url,
      created_by_name: currentUserEmail,
    })
    setCommentText('')
    clearCommentPhoto()
    await loadComments(selectedTask.id)
    setTaskSubmitting(false)
  }

  async function handleCompleteTask() {
    if (!selectedTask || taskSubmitting) return
    setTaskSubmitting(true)
    const photo_url = commentPhoto ? await uploadPhoto(commentPhoto) : null
    if (commentText.trim() || photo_url) {
      await supabase.from('dashboard_task_comments').insert({
        task_id: selectedTask.id,
        text: commentText.trim() || null,
        photo_url,
        created_by_name: currentUserEmail,
      })
    }
    await supabase.from('dashboard_tasks').update({
      completed: true,
      completed_at: new Date().toISOString(),
    }).eq('id', selectedTask.id)
    setTasks(prev => prev.filter(t => t.id !== selectedTask.id))
    setSelectedTask(null)
    setCommentText('')
    clearCommentPhoto()
    setTaskSubmitting(false)
  }

  function handleCancelTaskModal() {
    setSelectedTask(null)
    setCommentText('')
    clearCommentPhoto()
  }

  async function handleSaveAndCloseTask() {
    if (!selectedTask || taskSubmitting) return
    // Persist any unsent note/photo, then close.
    if (commentText.trim() || commentPhoto) {
      await handleComment()
    }
    setSelectedTask(null)
    setCommentText('')
    clearCommentPhoto()
  }

  async function handleDeleteSelectedTask() {
    if (!selectedTask) return
    await handleDeleteTask(selectedTask)
    setSelectedTask(null)
    setCommentText('')
    clearCommentPhoto()
  }

  async function loadFlagComments(flagId: string) {
    const { data } = await supabase
      .from('flag_comments')
      .select('*')
      .eq('flag_id', flagId)
      .order('created_at', { ascending: true })
    setFlagComments(data || [])
  }

  async function handleOpenFlag(flag: Flag) {
    setSelectedFlag(flag)
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    setPendingCategory(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    await loadFlagComments(flag.id)
  }

  async function handleFlagComment() {
    if (!selectedFlag || flagSubmitting) return
    if (!flagCommentText.trim() && !flagCommentPhoto) return
    setFlagSubmitting(true)
    const photo_url = flagCommentPhoto ? await uploadPhoto(flagCommentPhoto) : null
    await supabase.from('flag_comments').insert({
      flag_id: selectedFlag.id,
      text: flagCommentText.trim() || null,
      photo_url,
      created_by_name: currentUserEmail,
    })
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    await loadFlagComments(selectedFlag.id)
    setFlagSubmitting(false)
  }

  async function handleAcknowledgeFlag() {
    if (!selectedFlag || flagSubmitting) return
    setFlagSubmitting(true)
    const updated = await supabase.from('flags').update({
      status: 'acknowledged',
      acknowledged_by: currentUserEmail,
      acknowledged_at: new Date().toISOString(),
      acknowledged_note: flagCommentText.trim() || null,
      ...(pendingCategory ? { category: pendingCategory } : {}),
    }).eq('id', selectedFlag.id).select().single()
    if (updated.data) {
      setFlags(prev => prev.map(f => f.id === selectedFlag.id ? updated.data : f))
      setSelectedFlag(updated.data)
    }
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    setPendingCategory(null)
    setFlagSubmitting(false)
  }

  async function handleResolveFlag() {
    if (!selectedFlag || flagSubmitting) return
    setFlagSubmitting(true)
    const photo_url = flagCommentPhoto ? await uploadPhoto(flagCommentPhoto) : null
    if (flagCommentText.trim() || photo_url) {
      await supabase.from('flag_comments').insert({
        flag_id: selectedFlag.id,
        text: flagCommentText.trim() || null,
        photo_url,
        created_by_name: currentUserEmail,
      })
    }
    await supabase.from('flags').update({
      status: 'resolved',
      resolved_by: currentUserEmail,
      resolved_at: new Date().toISOString(),
      resolved_note: resolveNote.trim() || null,
      resolved_vendor: resolveVendor.trim() || null,
      resolved_cost: resolveCost ? parseFloat(resolveCost) : null,
    }).eq('id', selectedFlag.id)
    setFlags(prev => prev.filter(f => f.id !== selectedFlag.id))
    setSelectedFlag(null)
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    setShowResolveModal(false)
    setResolveNote('')
    setResolveVendor('')
    setResolveCost('')
    setFlagSubmitting(false)
  }

  async function handleSaveFlag() {
    if (!selectedFlag || flagSubmitting) return
    setFlagSubmitting(true)
    if (pendingCategory && pendingCategory !== selectedFlag.category) {
      const { data: updatedData } = await supabase.from('flags')
        .update({ category: pendingCategory })
        .eq('id', selectedFlag.id).select().single()
      if (updatedData) {
        setFlags(prev => prev.map(f => f.id === selectedFlag.id ? updatedData : f))
      }
    }
    setFlagSubmitting(false)
    setSelectedFlag(null)
    setConfirmDeleteFlag(false)
  }

  async function handleDeleteFlag() {
    if (!selectedFlag) return
    const { error } = await supabase.from('flags').update({ deleted_at: new Date().toISOString() }).eq('id', selectedFlag.id)
    console.log('handleDeleteFlag:', { id: selectedFlag.id, error })
    setFlags(prev => prev.filter(f => f.id !== selectedFlag.id))
    setSelectedFlag(null)
    setConfirmDeleteFlag(false)
  }

  async function handleCreateFlag() {
    if (!newFlagText.trim() || !newFlagCategory) return
    setFlagSubmitting(true)
    const photo_url = newFlagPhoto ? await uploadPhoto(newFlagPhoto) : null
    await supabase.from('flags').insert({
      studio: newFlagStudio,
      source: 'manual',
      runner_note: newFlagText.trim(),
      category: newFlagCategory,
      status: 'pending',
      photo_url,
    })
    const { data } = await supabase
      .from('flags')
      .select('*')
      .in('status', ['pending', 'acknowledged'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(4)
    setFlags(data || [])
    setNewFlagText('')
    setNewFlagCategory(null)
    setNewFlagStudio('paramount')
    clearNewFlagPhoto()
    setAddingFlag(false)
    setFlagSubmitting(false)
  }

  return (
    <>
      {/* One-time post-login welcome splash */}
      {showWelcome && (
        <div
          data-splash=""
          style={{
            // Above the Nav (99999) so the splash fully covers the viewport — a
            // 9999 overlay would sit under the sticky nav bar and look broken.
            position: 'fixed', inset: 0, zIndex: 100000,
            background: 'var(--c-bg)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            opacity: welcomeFading ? 0 : 1,
            transition: 'opacity 0.6s ease',
            animation: welcomeFading ? undefined : 'welcomeFadeIn 0.4s ease',
          }}
        >
          <div style={{ marginBottom: 2 }}>
            <PRSFloIcon size={72} />
          </div>
          <div style={{ fontFamily: 'Inter', fontSize: 13, letterSpacing: '0.2em', color: 'var(--c-fg-3)', textTransform: 'uppercase' }}>
            {greeting.toUpperCase()}
          </div>
          {/* nbsp fallback reserves the line height so the name appearing causes no layout shift */}
          <div style={{
            fontFamily: 'Archivo Black', fontWeight: 400, fontSize: isMobile ? 48 : 64, color: 'var(--c-fg)', lineHeight: 1.1, marginTop: 14, marginBottom: 108, textAlign: 'center',
            opacity: nameVisible ? 1 : 0,
            transform: nameVisible ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.6s ease, transform 0.6s ease',
          }}>
            {profile?.display_name || ' '}
          </div>
        </div>
      )}

      <div id="dashboard-content" className="c-root" style={{ opacity: contentReady && !showWelcome ? 1 : 0, transition: 'opacity 0.3s ease' }}>
      {/* SOLO HEADER (§14b) — greeting micro-label over the Archivo title, then
          flex-grow, the view-as segmented toggle (Eli only), and the datechip
          anchor. Nothing else lives in the header. The old LocationStrip is
          retired — location counts moved into the sessions pane header. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '2px 4px 14px', flexWrap: isMobile ? 'wrap' : undefined }}>
        <div>
          <span className="c-label" style={{ display: 'block', marginBottom: 3 }}>
            {greeting}{myDayRole
              ? ` ${gridRows.find(g => g.role === myDayRole)?.who ?? ''}`
              : greetingName}
          </span>
          <h1 className="c-arch" style={{ fontSize: isMobile ? 20 : 26, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            Paramount Recording Studios
          </h1>
        </div>
        <div style={{ flex: 1 }} />
        {isEli && !isMobile && (
          <span className="c-seg" style={{ flexShrink: 0 }}>
            <button className={viewAs === 'eli' ? 'c-on' : ''} onClick={() => switchViewAs('eli')}>Eli</button>
            {/* Labels follow the roster, so Aaron's successor inherits the
                button without a code change — billing is a ROLE (MYDAY-BUILD §0). */}
            <button className={viewAs === 'fernando' ? 'c-on' : ''} onClick={() => switchViewAs('fernando')}>
              {gridRows.find(g => g.role === 'manager')?.who ?? 'Manager'}
            </button>
            <button className={viewAs === 'aaron' ? 'c-on' : ''} onClick={() => switchViewAs('aaron')}>
              {gridRows.find(g => g.role === 'billing')?.who ?? 'Billing'}
            </button>
          </span>
        )}
        {!isMobile && (
          <div className="c-datechip c-anchor c-arch" style={{ flexShrink: 0 }}>
            {clockDate.toUpperCase()}
            <small>{clockTime}</small>
          </div>
        )}
      </div>

      {/* COMMAND ROW (§14b, ruling 2026-08-07 — reference:
          docs/design-refs/dashboard-console-v2-options.html option A):
          Pipeline indicator + the four studio cards. The scan-in-two-seconds
          row: who needs me, what's running. */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1.35fr 1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div className="c-pipe" style={isMobile ? { gridColumn: '1 / -1' } : undefined} onClick={() => router.push('/crm')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="c-pipe-num">{loading ? '–' : pipelineLeads.length}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="c-pipe-name">Pipeline</div>
              <div className="c-pipe-sub">{pipeHot} hot · {pipeWarm} warm · {pipeUncon} uncontacted</div>
            </div>
            <span className="c-pipe-go">CRM →</span>
          </div>
          {/* THE LOUD BAR — only when unacked web inquiries exist. */}
          {inquiryCount > 0 ? (
            <div className="c-inqbar">
              <NewLeadPulse />
              {inquiryCount} new inquir{inquiryCount === 1 ? 'y' : 'ies'}
            </div>
          ) : (
            <div className="c-inqbar c-quiet">No new inquiries</div>
          )}
        </div>
        {LOC_CHIPS.map(lc => {
          const vs = bookings.filter(b => b.location === lc.venue)
          const live = vs.filter(b => b.status === 'confirmed').length
          return (
            <div key={lc.code} className={`c-stud${vs.length === 0 ? ' c-off' : ''}`} onClick={() => router.push('/daily-ops')}>
              <span className="c-stud-code">{lc.code}</span>
              <span className="c-stud-vn">{lc.venue}</span>
              <span className="c-stud-cnt">
                <span className="c-stud-n">{vs.length}</span>
                <span className="c-stud-u">session{vs.length === 1 ? '' : 's'}</span>
                {live > 0 && <span className="c-stud-live">{live} live</span>}
              </span>
            </div>
          )
        })}
      </div>

      {/* BELOW: two columns — the console (Flo → My Day | My Tasks) with the
          staff grid + Flags indicator under it, and Today's Sessions right. */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.35fr 1fr', gap: 12, alignItems: 'start' }}>

        {/* (The Needs Action list is retired — the Pipeline indicator in the
            command row replaced it, ruling 2026-08-07. Leads are worked in the
            CRM; "+ new lead" lives there.) */}

        {/* RIGHT — TODAY'S SESSIONS (§14b): rooms 2-wide, pane hugs its
            content. Day nav (‹ date ›) is kept — it's functionality the mock
            simply didn't draw. Loc-count chips dropped: the studio cards in
            the command row carry the counts now. */}
        {/* Explicit placement: this pane precedes the console in the JSX, and
            auto-placement was seating it in the WIDE left column — console
            belongs left (1.35fr), sessions right. */}
        <div className="c-panel" style={isMobile ? { order: 1 } : { gridColumn: '2', gridRow: '1' }}>
          {/* Day nav sits ON the title row (Eli 2026-08-14) — it had its own
              full-width row underneath, which cost ~34px of vertical padding
              at the top of the pane for three small controls. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, paddingLeft: 2 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SectionHeader carved title="Today's sessions" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <SoftButton onClick={() => setCalDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n })}>‹</SoftButton>
              <div className="c-mono" style={{ whiteSpace: 'nowrap', opacity: 0.6 }}>
                {calDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
              <SoftButton onClick={() => setCalDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n })}>›</SoftButton>
            </div>
          </div>
          {loading ? (
            <div className="c-sub" style={{ padding: '12px 4px' }}>Loading…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {ROOMS.map(room => {
                const booking = bookings.find(b =>
                  b.location === room.venue && b.studio === room.studio
                )
                // Status → colour is decided in ONE place (sessionFillClass).
                // This used to be a local ternary that only knew 'tentative',
                // so tech, tour, open hours and cancelled all came out green.
                // A BOOKED room card is the calendar's chip — same classes, same
                // fill, same body. It used to be a carved pool (dark alpha wash,
                // normal ink) while the calendar was a raised chip (bright fill,
                // chip ink), so the two read as different objects even once they
                // shared a body. Empty cells stay carved: an empty cell is a hole
                // in the surface, not a card.
                return booking ? (
                  <div
                    key={room.label}
                    onClick={() => openBookingEdit(booking)}
                    className={`c-ev c-control c-raised-chip ${sessionFillClass(booking.status)}`}
                    style={{
                      height: isMobile ? undefined : ROOM_CARD_H,
                      minHeight: isMobile ? 84 : undefined,
                      cursor: 'pointer', overflow: 'hidden', padding: 0,
                      display: 'flex', flexDirection: 'column',
                    }}
                  >
                    <span className="c-roomtag">{room.label}</span>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      <SessionCardBody
                        booking={booking}
                        height={(isMobile ? 84 : ROOM_CARD_H) - ROOM_NAME_H}
                        eng={initials(booking.engineer_name)}
                        asst={initials(booking.assistant_name)}
                        isMobile={isMobile}
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    key={room.label}
                    onClick={room.bookable === false ? undefined : () => openNewRoomBooking(room)}
                    className="c-room c-inset2 c-room-empty"
                    style={{
                      // Same fixed height as a BOOKED card (Eli 2026-08-14).
                      // Empty was 76 and booked 120, so a row containing a
                      // session grew and the whole grid shifted the moment
                      // anything was on the books. A room card is the same
                      // object whether or not it holds a session.
                      height: isMobile ? undefined : ROOM_CARD_H,
                      minHeight: isMobile ? 84 : undefined,
                      cursor: room.bookable === false ? 'default' : 'pointer', overflow: 'hidden',
                    }}
                  >
                    <span className="c-room-name">{room.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* LEFT — THE CONSOLE (§14b/§14c): Flo on top, then My Day and My Tasks
            SIDE BY SIDE (two stacked to-do lists bury the bottom one — ruling
            2026-08-07). Flo, My Day and the staff grid went LIVE on 2026-08-10
            (lib/myday.ts); Tasks is live (dashboard_tasks). Staff grid + Flags
            indicator sit under the console in this column. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, ...(isMobile ? { order: 2 } : { gridColumn: '1', gridRow: '1' }) }}>
        <div className="c-panel">

          {/* THE FLO BOX — the app's single AI mouthpiece. Flat, ringed, and the
              only glow in the system. "Ask Flo →" is a dead door for now. */}
          <div className="c-ringwrap"><div className="c-flo-inner">
            <div className="c-flohead">
              {/* The real PRSFlo wave mark — Eli's ruling 2026-08-07: the brand
                  icon is also Flo's mark (replaces the mock's placeholder squiggle). */}
              <PRSFloIcon size={22} />
              <span className="c-fname">Flo</span>
              <span className="c-ftag">· Your briefing · {clockNow.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              <Hint tip="Flo is computed from real data — no AI. Red lines clear by doing the duty they name; amber lines clear themselves when the pile behind them is gone; the grey line is tomorrow's heads-up." />
            </div>
            {/* Computed from real duties + queues (lib/myday composeBriefing).
                No AI yet — template sentences over true numbers. */}
            {(myDay?.briefing.bullets ?? []).map((b, i) => (
              <div key={i} className={`c-flob${b.alert ? ' c-alert' : ''}`}>
                <span className="c-flodot" style={{ background: b.color }} />
                {b.text}
              </div>
            ))}
            <div className="c-flosyn">{myDay?.briefing.synopsis ?? '…'}</div>
            <div className="c-askflo">Ask Flo →</div>
          </div></div>

          {/* MY DAY — real duties (docs/MYDAY-BUILD.md). Duties ≠ tasks: fixed
              per role, reset daily. Never merge them into the task list.
              Hidden entirely when viewing as Eli — oversight has no duty card,
              and an empty pane would violate the packing law (§14b). My tasks
              takes the full width in that case. */}
          <div className={myDayRole ? 'c-twoup' : undefined}>
          {myDayRole && (() => {
            const shown = (myDay?.views ?? []).filter(v => v.isShown)
            const worstBacklog = Math.max(0, ...shown.map(v => v.backlogDays))
            return (
              <div>
                <div className="c-subhead">
                  <b>My day — duties<Hint tip="Your recurring duties — they reset on their own schedule. Tick as you go; a missed day shows as 'covering N days' and one tick clears the whole backlog. The count on the right is only what's due today." /></b>
                  <span className="c-myday-prog">{myDay?.progress ?? '—'}</span>
                </div>

                {shown.length === 0 && (
                  <div className="c-myday-item"><span className="c-myday-tx" style={{ opacity: 0.5 }}>Nothing due today.</span></div>
                )}

                {shown.map(v => {
                  const scope = v.backlogDays > 0 && myDay
                    ? backlogScopeLabel(v.duty, myDay.entries, getLocalToday())
                    : null
                  return (
                    <div
                      key={v.duty.id}
                      className={`c-myday-item${v.done ? ' c-done' : ''}`}
                      onClick={() => toggleDuty(v)}
                      style={{ cursor: savingDuty ? 'default' : 'pointer', opacity: savingDuty === v.duty.id ? 0.5 : 1 }}
                    >
                      <span className="c-myday-bx" />
                      <span className="c-myday-tx">{v.duty.label}</span>

                      {/* Captured numbers appear once the duty is ticked — asking
                          for a count before the work is done is asking for a guess. */}
                      {v.done && v.duty.captures.map(f => (
                        <input
                          key={f.key}
                          type="number"
                          defaultValue={v.entry?.captured?.[f.key] ?? ''}
                          placeholder={f.label}
                          title={f.label}
                          onClick={e => e.stopPropagation()}
                          onBlur={e => saveCapture(v, f.key, e.target.value)}
                          className="c-tin c-tin-show c-tin-mono"
                          style={{ width: 58, fontSize: 10 }}
                        />
                      ))}

                      {/* Not due today, but on the card anyway (always_available). */}
                      {!v.isDue && !v.done && <span className="c-myday-due">Not due today</span>}
                      {scope && <span className="c-myday-due">{scope}</span>}
                    </div>
                  )
                })}

                {worstBacklog >= BACKLOG_FLAG_THRESHOLD && (
                  <div className="c-myday-backlog">
                    {worstBacklog} days behind — clear it today to reset the streak
                  </div>
                )}
              </div>
            )
          })()}

          <div>
          {/* MY TASKS — the viewer's own to-dos (name tabs shelved, ruling
              2026-08-07; assigning to others still happens in the add modal). */}
          <div className="c-subhead">
            <b>My tasks{tasks.length > 0 ? ` · ${tasks.length}` : ''}</b>
            <a onClick={() => router.push('/tasks')} style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', opacity: 0.4, cursor: 'pointer', color: 'var(--c-fg)' }}>
              Show all →
            </a>
          </div>
          {/* Task list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minHeight: 60 }}>
            {tasksLoading ? (
              <div className="c-sub" style={{ padding: '4px' }}>Loading…</div>
            ) : tasks.length === 0 ? (
              <div className="c-sub" style={{ padding: '4px' }}>No tasks</div>
            ) : (
              tasks.slice(0, 5).map(task => (
                <div
                  key={task.id}
                  onClick={() => handleOpenTask(task)}
                  className="c-inset2"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '7px 10px', borderRadius: 12,
                    fontSize: 12.5, cursor: 'pointer',
                  }}
                >
                  {/* Runner/WO-sourced tasks keep their warm status dot; the old
                      2px warm left border is gone (Law 1: no borders). */}
                  <StatusDot status={task.source !== 'manual' ? 'warm' : 'dead'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.text}
                    </div>
                    {task.due_date && (
                      <div className="c-sub" style={{ fontSize: 11 }}>Due {task.due_date}</div>
                    )}
                    {task.source !== 'manual' && task.source_label && (
                      <div className="c-sub" style={{ fontSize: 11 }}>{task.source_label}</div>
                    )}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteTask(task) }}
                    className="c-x"
                    style={{ minWidth: isMobile ? 44 : undefined }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
            {!tasksLoading && tasks.length > 5 && (
              <div
                onClick={() => router.push('/tasks')}
                className="c-sub"
                style={{ fontSize: 11, padding: '2px 4px', cursor: 'pointer' }}
              >
                + {tasks.length - 5} more →
              </div>
            )}
          </div>
          {/* Footer: add task — opens the full modal */}
          <div style={{ marginTop: 8 }}>
            <SoftButton onClick={openAddTask} className="c-block">+ add task</SoftButton>
          </div>
          </div>
          </div>{/* /c-twoup */}
        </div>{/* /console pane */}

        {/* Under the console: staff 14-day grid (live, Eli view only)
            + the Flags indicator (count + latest; "+ add" keeps quick
            reporting; the card grid moved to /flags). */}
        <div style={{ display: 'grid', gridTemplateColumns: (isEli && viewAs === 'eli' && !isMobile) ? '1.3fr 1fr' : '1fr', gap: 12, alignItems: 'end' }}>
          {isEli && viewAs === 'eli' && !isMobile && (
            <div className="c-panel">
              <SectionHeader carved title="Staff — 14 days" action={{ label: 'HR →', onClick: () => router.push('/punches') }} />
              <div className="c-dgrid">
                <table>
                  <tbody>
                    {/* Live from myday_entries. Green = every duty that was DUE
                        that day got done; red = one or more missed; blank =
                        nothing was due, or the duty didn't exist yet. Today is
                        never red — a day in progress isn't a failure. */}
                    {gridRows.map(row => (
                      <tr key={row.role}>
                        <td className="c-who">{row.who}</td>
                        {row.days.split('').map((d, i) => (
                          <td key={i} className={`c-sq${d === 'g' ? ' c-g' : d === 'r' ? ' c-r' : ''}`} />
                        ))}
                        <td className="c-bk">{row.backlog || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="c-flagmini" onClick={() => router.push('/flags')}>
            <span className="c-fm-num">{flagsLoading ? '–' : flags.length}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="c-fm-name">Flags</div>
              <div className="c-fm-sub">{flags[0]?.runner_note || 'No open flags'}</div>
            </div>
            <span className="c-fm-go" onClick={e => { e.stopPropagation(); setAddingFlag(true) }}>+ add</span>
            <span className="c-fm-go">All →</span>
          </div>
        </div>
        </div>{/* /left stack */}

      {/* (The full Flags card grid moved to /flags; the staff grid lives under
          the console. Both replaced by the left-stack row above — ruling
          2026-08-07, command-row layout.) */}

      </div>

      {/* TASK MODAL */}
      {selectedTask && (
        <div
          className="c-modal-backdrop" style={{ zIndex: 10000, background: isMobile ? 'var(--c-bg)' : undefined, padding: isMobile ? 0 : 24 }}
          onClick={e => { if (e.target === e.currentTarget) handleCancelTaskModal() }}
        >
          <div className="c-sheet" style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', ...fullscreenCardOnMobile(isMobile, modalViewportHeight) }}>

            {/* Header — Complete button only, right aligned */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '16px 20px' }}>
              <button
                onClick={handleCompleteTask}
                disabled={taskSubmitting}
                style={{
                  color: 'var(--c-fg)',
                  fontSize: 10, fontFamily: 'Inter', fontWeight: 700, textTransform: 'uppercase',
                  padding: '5px 12px', borderRadius: 4, cursor: 'pointer', letterSpacing: '0.04em',
                }}
              >
                Complete
              </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {/* Description */}
              <div style={{ fontSize: 13, color: 'var(--c-fg-2)', lineHeight: 1.6, paddingBottom: 16 }}>
                {selectedTask.text}
                {selectedTask.photo_url && (
                  <SignedImage
                    path={selectedTask.photo_url}
                    alt=""
                    style={{ display: 'block', maxWidth: '100%', maxHeight: 220, borderRadius: 8, objectFit: 'cover', marginTop: 10 }}
                  />
                )}
              </div>

              {/* Assigned meta */}
              <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 12 }}>
                Assigned to: {nameForId(selectedTask.assigned_to, allProfiles)} · by {nameForId(selectedTask.assigned_by, allProfiles)} · {new Date(selectedTask.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>

              {/* Updates */}
              <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 18, marginBottom: 10 }}>
                Updates
              </div>
              {taskComments.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--c-fg-3)', fontStyle: 'italic' }}>No updates yet</div>
              ) : (
                taskComments.map(c => (
                  <div key={c.id} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginBottom: 3 }}>
                      {c.created_by_name && `${c.created_by_name} · `}{fmtTime(c.created_at)}
                    </div>
                    {c.text && (
                      <div style={{ fontSize: 12, color: 'var(--c-fg-2)', lineHeight: 1.5 }}>{c.text}</div>
                    )}
                    {c.photo_url && (
                      <SignedImage
                        path={c.photo_url}
                        alt=""
                        style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: c.text ? 6 : 0 }}
                      />
                    )}
                  </div>
                ))
              )}

              {/* Comment input */}
              <textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Add a note..."
                className="c-textarea c-inset2" style={{ height: 72, marginTop: 16 }}
              />
              {commentPhotoPreview && (
                <img
                  src={commentPhotoPreview}
                  alt=""
                  style={{ display: 'block', maxHeight: 80, borderRadius: 4, marginBottom: 8, marginTop: 8 }}
                />
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <label style={{ fontSize: 11, color: 'var(--c-fg-2)', cursor: 'pointer', fontFamily: 'Inter' }}>
                  {commentPhoto ? commentPhoto.name : '+ Attach photo'}
                  <input
                    ref={commentPhotoRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => pickCommentPhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  onClick={handleComment}
                  disabled={taskSubmitting || (!commentText.trim() && !commentPhoto)}
                  style={{
                    color: 'var(--c-fg-2)',
                    fontSize: 11, fontFamily: 'Inter', padding: '6px 14px', borderRadius: 6,
                    cursor: (commentText.trim() || commentPhoto) ? 'pointer' : 'default',
                  }}
                >
                  {taskSubmitting ? 'Saving…' : 'Submit'}
                </button>
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px' }}>
              {canAssign && (
                <button
                  onClick={handleDeleteSelectedTask}
                  style={{
                    color: 'var(--c-fg)',
                    fontSize: 11, fontFamily: 'Inter', padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button
                onClick={handleCancelTaskModal}
                style={{
                  color: 'var(--c-fg-2)',
                  fontSize: 11, fontFamily: 'Inter', padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAndCloseTask}
                disabled={taskSubmitting}
                style={{
                  background: 'var(--c-fg)', color: 'var(--c-bg)', fontSize: 11, fontFamily: 'Inter', fontWeight: 600, padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                }}
              >
                Save &amp; Close
              </button>
            </div>

          </div>
        </div>
      )}

      {showHistory && (
        <div
          className="c-modal-backdrop" style={{ zIndex: 10000, background: isMobile ? 'var(--c-bg)' : undefined, padding: isMobile ? 0 : 24 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowHistory(false); setHistorySearch('') } }}
        >
          <div className="c-sheet" style={{ width: '100%', maxWidth: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column', ...fullscreenCardOnMobile(isMobile, modalViewportHeight) }}>
            <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 15 }}>Completed Tasks</div>
              <button onClick={() => { setShowHistory(false); setHistorySearch('') }} className="c-x" style={{ fontSize: 18 }}>×</button>
            </div>
            <div style={{ padding: '10px 20px' }}>
              <input
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                placeholder="Search completed tasks…"
                style={{ width: '100%', padding: '7px 10px', fontSize: 12, background: 'var(--c-wash)', borderRadius: 8, color: 'var(--c-fg)', fontFamily: 'Inter', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {completedTasks
                .filter(t => !historySearch || t.text.toLowerCase().includes(historySearch.toLowerCase()))
                .map(t => (
                  <div
                    key={t.id}
                    onClick={async () => {
                      const { data } = await supabase
                        .from('dashboard_task_comments')
                        .select('*')
                        .eq('task_id', t.id)
                        .order('created_at', { ascending: true })
                      setHistoryTaskComments(data || [])
                      setSelectedHistoryTask(t)
                    }}
                    style={{ padding: '10px 12px', background: 'var(--c-wash)', borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-fg)', marginTop: 4, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ fontSize: 12, color: 'var(--c-fg)', lineHeight: 1.4, flex: 1 }}>{t.text}</div>
                        <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, padding: '2px 6px', borderRadius: 4, background: 'var(--c-bg)', color: 'var(--c-fg-3)', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {t.assigned_role.replace('_', ' ')}
                        </div>
                      </div>
                      {t.source !== 'manual' && t.source_label && (
                        <div style={{ fontSize: 9, color: 'var(--c-fg-2)', marginTop: 3, fontFamily: 'Inter' }}>{t.source_label}</div>
                      )}
                      <div style={{ fontSize: 9, color: 'var(--c-fg-3)', marginTop: 4, fontFamily: 'Inter' }}>
                        Completed {t.completed_at ? new Date(t.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </div>
                    </div>
                  </div>
                ))
              }
              {completedTasks.filter(t => !historySearch || t.text.toLowerCase().includes(historySearch.toLowerCase())).length === 0 && (
                <div style={{ padding: '12px', color: 'var(--c-fg-3)', fontSize: 11 }}>No completed tasks found</div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedHistoryTask && (
        <div
          className="c-modal-backdrop" style={{ zIndex: 10001, background: isMobile ? 'var(--c-bg)' : undefined, padding: isMobile ? 0 : 24 }}
          onClick={e => { if (e.target === e.currentTarget) { setSelectedHistoryTask(null); setHistoryTaskComments([]) } }}
        >
          <div className="c-sheet" style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', ...fullscreenCardOnMobile(isMobile, modalViewportHeight) }}>
            <div style={{ padding: '16px 20px', position: 'relative' }}>
              <button
                onClick={() => { setSelectedHistoryTask(null); setHistoryTaskComments([]) }}
                style={{ position: 'absolute', top: 14, right: 16, cursor: 'pointer', color: 'var(--c-fg-3)', fontSize: 18, lineHeight: 1, padding: 0 }}
              >×</button>
              <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', color: 'var(--c-fg)', textTransform: 'uppercase', marginBottom: 6 }}>COMPLETED</div>
              <div style={{ fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 15, color: 'var(--c-fg)', paddingRight: 24, lineHeight: 1.3 }}>
                {selectedHistoryTask.text}
              </div>
              {selectedHistoryTask.photo_url && (
                <SignedImage path={selectedHistoryTask.photo_url} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: 8 }} />
              )}
              {selectedHistoryTask.source !== 'manual' && selectedHistoryTask.source_label && (
                <div style={{ fontSize: 10, color: 'var(--c-fg-2)', marginTop: 4, fontFamily: 'Inter' }}>{selectedHistoryTask.source_label}</div>
              )}
              {selectedHistoryTask.due_date && (
                <div style={{ fontSize: 10, color: 'var(--c-fg-3)', marginTop: 2, fontFamily: 'Inter' }}>Due {selectedHistoryTask.due_date}</div>
              )}
              {selectedHistoryTask.completed_at && (
                <div style={{ fontSize: 10, color: 'var(--c-fg)', marginTop: 2, fontFamily: 'Inter' }}>
                  Completed {new Date(selectedHistoryTask.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
              {historyTaskComments.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontStyle: 'italic' }}>No updates</div>
              ) : (
                historyTaskComments.map(c => (
                  <div key={c.id} style={{ marginBottom: 14 }}>
                    {c.text && <div style={{ fontSize: 12, color: 'var(--c-fg)', lineHeight: 1.5 }}>{c.text}</div>}
                    {c.photo_url && (
                      <SignedImage path={c.photo_url} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: c.text ? 6 : 0 }} />
                    )}
                    <div style={{ fontSize: 9, color: 'var(--c-fg-3)', marginTop: 4, fontFamily: 'Inter' }}>
                      {c.created_by_name && `${c.created_by_name} · `}{fmtTime(c.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* CREATE FLAG MODAL */}
      {addingFlag && (
        <div
          className="c-modal-backdrop" style={{ zIndex: 10000, background: isMobile ? 'var(--c-bg)' : undefined, padding: isMobile ? 0 : 24 }}
          onClick={e => { if (e.target === e.currentTarget) { setAddingFlag(false); setNewFlagText(''); setNewFlagCategory(null); setNewFlagStudio('paramount'); clearNewFlagPhoto() } }}
        >
          <div className="c-sheet" style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', ...fullscreenCardOnMobile(isMobile, modalViewportHeight) }}>

            {/* Header */}
            <div style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 13, color: 'var(--c-fg)' }}>New Flag</span>
                <button
                  onClick={() => { setAddingFlag(false); setNewFlagText(''); setNewFlagCategory(null); setNewFlagStudio('paramount'); clearNewFlagPhoto() }}
                  className="c-x" style={{ marginLeft: 'auto', fontSize: 18 }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Studio */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                  Studio
                </div>
                <select
                  value={newFlagStudio}
                  onChange={e => setNewFlagStudio(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', fontSize: 11, background: 'var(--c-wash)', borderRadius: 6, color: 'var(--c-fg)', fontFamily: 'Inter', outline: 'none' }}
                >
                  <option value="paramount">Paramount</option>
                  <option value="encore">Encore</option>
                  <option value="ameraycan">Ameraycan</option>
                  <option value="track">Track</option>
                </select>
              </div>

              {/* Category */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                  Category
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['facility_general', 'gear_equipment', 'client_billing'] as const).map(catKey => {
                    const catConfig = {
                      facility_general: { label: 'Facility / General', activeColor: 'var(--c-bg)', activeBg: 'var(--c-fg)', activeBorder: 'var(--c-fg)' },
                      gear_equipment: { label: 'Gear / Equipment', activeColor: 'var(--c-bg)', activeBg: 'var(--c-fg)', activeBorder: 'var(--c-fg)' },
                      client_billing: { label: 'Client / Billing', activeColor: 'var(--c-bg)', activeBg: 'var(--c-fg)', activeBorder: 'var(--c-fg)' },
                    }[catKey]
                    const isSelected = newFlagCategory === catKey
                    return (
                      <button
                        key={catKey}
                        onClick={() => setNewFlagCategory(catKey)}
                        style={{
                          flex: 1, padding: '6px 4px', fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400,
                          letterSpacing: '0.04em', textTransform: 'uppercase',
                          color: isSelected ? catConfig.activeColor : 'var(--c-fg-3)',
                          background: isSelected ? catConfig.activeBg : 'transparent',
                          borderRadius: 6, cursor: 'pointer',
                        }}
                      >
                        {catConfig.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Note */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                  Note
                </div>
                <textarea
                  value={newFlagText}
                  onChange={e => setNewFlagText(e.target.value)}
                  placeholder="Describe the issue…"
                  rows={3}
                  autoFocus
                  style={{ width: '100%', padding: '8px', fontSize: 11, background: 'var(--c-wash)', borderRadius: 6, color: 'var(--c-fg)', fontFamily: 'Inter', outline: 'none', resize: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Photo */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                  Photo
                </div>
                {newFlagPhotoPreview && (
                  <img
                    src={newFlagPhotoPreview}
                    alt=""
                    style={{ display: 'block', maxHeight: 80, borderRadius: 4, objectFit: 'cover', marginBottom: 8 }}
                  />
                )}
                <label style={{ display: 'inline-block', fontSize: 11, color: 'var(--c-fg-2)', cursor: 'pointer', fontFamily: 'Inter', padding: '9px 14px', borderRadius: 6 }}>
                  {newFlagPhoto ? newFlagPhoto.name : '+ Add Photo'}
                  <input
                    ref={newFlagPhotoRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => pickNewFlagPhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

            </div>

            {/* Divider */}

            {/* Footer */}
            <div style={{ padding: '20px 20px 12px', display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setAddingFlag(false); setNewFlagText(''); setNewFlagCategory(null); setNewFlagStudio('paramount'); clearNewFlagPhoto() }}
                style={{ flex: 1, padding: '8px', fontSize: 11, fontFamily: 'Inter', borderRadius: 6, cursor: 'pointer', color: 'var(--c-fg-2)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFlag}
                disabled={flagSubmitting || !newFlagText.trim() || !newFlagCategory}
                style={{
                  flex: 1, padding: '8px', fontSize: 11, fontFamily: 'Inter',
                  background: newFlagText.trim() && newFlagCategory ? 'var(--c-fg)' : 'var(--c-wash)',
                  color: newFlagText.trim() && newFlagCategory ? 'var(--c-bg)' : 'var(--c-fg-3)',
                  borderRadius: 6,
                  cursor: newFlagText.trim() && newFlagCategory ? 'pointer' : 'default',
                  fontWeight: 600,
                }}
              >
                {flagSubmitting ? 'Creating…' : 'Create Flag'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* FLAG MODAL */}
      {selectedFlag && (
        <div
          className="c-modal-backdrop" style={{ zIndex: 10000, background: isMobile ? 'var(--c-bg)' : undefined, padding: isMobile ? 0 : 24 }}
          onClick={e => { if (e.target === e.currentTarget) { setSelectedFlag(null); setConfirmDeleteFlag(false) } }}
        >
          <div className="c-sheet" style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', ...fullscreenCardOnMobile(isMobile, modalViewportHeight) }}>

            {/* Modal header */}
            <div style={{ padding: '16px 20px' }}>
              {/* Row 1: status badge + resolve + × */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <StatusBadge status={selectedFlag.status} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selectedFlag.status === 'acknowledged' && (
                    <button
                      onClick={() => setShowResolveModal(true)}
                      disabled={flagSubmitting}
                      style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}
                    >
                      {flagSubmitting ? 'Saving…' : 'Resolve'}
                    </button>
                  )}
                  <button
                    onClick={() => { setSelectedFlag(null); setConfirmDeleteFlag(false) }}
                    className="c-x" style={{ fontSize: 18 }}
                  >
                    ×
                  </button>
                </div>
              </div>
              {/* Row 2: studio name · category */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'Archivo Black', textTransform: 'uppercase', color: 'var(--c-fg)' }}>
                  {selectedFlag.studio.charAt(0).toUpperCase() + selectedFlag.studio.slice(1)}
                </span>
                {selectedFlag.category && (() => {
                  const catConf: Record<string, { label: string }> = {
                    facility_general: { label: 'Facility / General' },
                    gear_equipment:   { label: 'Gear / Equipment' },
                    client_billing:   { label: 'Client / Billing' },
                  }
                  const c = catConf[selectedFlag.category!]
                  return c ? (
                    <>
                      <span style={{ color: 'var(--c-fg-3)', fontSize: 11 }}>·</span>
                      <span style={{ fontSize: 11, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>
                        {c.label}
                      </span>
                    </>
                  ) : null
                })()}
              </div>
              {/* Row 3: source label */}
              {selectedFlag.source_label && (
                <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 2, opacity: 0.6 }}>
                  {selectedFlag.source_label}
                </div>
              )}
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Runner note — read only */}
              {selectedFlag.runner_note && (
                <div>
                  <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                    Runner Note
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--c-fg)', lineHeight: 1.5, background: 'var(--c-wash)', borderRadius: 8, padding: '10px 12px' }}>
                    {selectedFlag.runner_note}
                  </div>
                </div>
              )}

              {/* Category picker — pill buttons for pending/no category; dropdown for acknowledged */}
              {selectedFlag.category === null && selectedFlag.status === 'pending' && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                    Category
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['facility_general', 'gear_equipment', 'client_billing'] as const).map(catKey => {
                      const catConfig = {
                        facility_general: { label: 'Facility / General', activeColor: 'var(--c-bg)', activeBg: 'var(--c-fg)', activeBorder: 'var(--c-fg)' },
                        gear_equipment: { label: 'Gear / Equipment', activeColor: 'var(--c-bg)', activeBg: 'var(--c-fg)', activeBorder: 'var(--c-fg)' },
                        client_billing: { label: 'Client / Billing', activeColor: 'var(--c-bg)', activeBg: 'var(--c-fg)', activeBorder: 'var(--c-fg)' },
                      }[catKey]
                      const isSelected = pendingCategory === catKey
                      return (
                        <button
                          key={catKey}
                          onClick={() => setPendingCategory(catKey)}
                          style={{
                            flex: 1, padding: '5px 4px', fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400,
                            letterSpacing: '0.04em', textTransform: 'uppercase',
                            color: isSelected ? catConfig.activeColor : 'var(--c-fg-3)',
                            background: isSelected ? catConfig.activeBg : 'transparent',
                            borderRadius: 6, cursor: 'pointer',
                          }}
                        >
                          {catConfig.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {selectedFlag.status === 'acknowledged' && (
                <select
                  value={pendingCategory ?? selectedFlag.category ?? ''}
                  onChange={e => setPendingCategory(e.target.value as 'facility_general' | 'gear_equipment' | 'client_billing')}
                  style={{ width: '100%', padding: '7px 8px', fontSize: 11, background: 'var(--c-wash)', borderRadius: 6, color: 'var(--c-fg)', fontFamily: 'Inter', outline: 'none', marginBottom: 8 }}
                >
                  <option value="facility_general">Facility / General</option>
                  <option value="gear_equipment">Gear / Equipment</option>
                  <option value="client_billing">Client / Billing</option>
                </select>
              )}


              {/* Resolved box */}
              {selectedFlag.resolved_at && (
                <div style={{ background: 'rgba(20,184,166,0.06)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg)', marginBottom: 4 }}>
                    Resolved
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--c-fg-2)', fontFamily: 'Inter' }}>
                    {selectedFlag.resolved_by}
                    {selectedFlag.resolved_at && ` · ${new Date(selectedFlag.resolved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                  {selectedFlag.resolved_note && (
                    <div style={{ fontSize: 12, color: 'var(--c-fg)', marginTop: 6, lineHeight: 1.5 }}>
                      {selectedFlag.resolved_note}
                    </div>
                  )}
                  {selectedFlag.resolved_vendor && (
                    <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 4 }}>
                      Vendor: {selectedFlag.resolved_vendor}
                    </div>
                  )}
                  {selectedFlag.resolved_cost != null && (
                    <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 2 }}>
                      Cost: ${selectedFlag.resolved_cost}
                    </div>
                  )}
                </div>
              )}

              {/* Comment thread */}
              {flagComments.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontStyle: 'italic' }}>No updates yet</div>
              ) : (
                flagComments.map(c => (
                  <div key={c.id} style={{ marginBottom: 2 }}>
                    {c.text && (
                      <div style={{ fontSize: 12, color: 'var(--c-fg)', lineHeight: 1.5 }}>{c.text}</div>
                    )}
                    {c.photo_url && (
                      <SignedImage
                        path={c.photo_url}
                        alt=""
                        style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: c.text ? 6 : 0 }}
                      />
                    )}
                    <div style={{ fontSize: 9, color: 'var(--c-fg-3)', marginTop: 4, fontFamily: 'Inter' }}>
                      {c.created_by_name && `${c.created_by_name} · `}{fmtTime(c.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Divider */}

            {/* Input area */}
            <div style={{ padding: '12px 20px' }}>
              <textarea
                value={flagCommentText}
                onChange={e => setFlagCommentText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleFlagComment()
                  }
                }}
                placeholder="Add a note…"
                rows={2}
                style={{
                  width: '100%', padding: '8px', fontSize: 11,
                  background: 'var(--c-wash)', borderRadius: 6, color: 'var(--c-fg)', fontFamily: 'Inter',
                  outline: 'none', resize: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 8 }}>
                <label style={{ display: 'inline-block', fontSize: 10, color: 'var(--c-fg-3)', cursor: 'pointer', fontFamily: 'Inter' }}>
                  {flagCommentPhoto ? flagCommentPhoto.name : '+ Attach photo'}
                  <input
                    ref={flagCommentPhotoRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => setFlagCommentPhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
                {(flagCommentText.trim() || flagCommentPhoto) && (
                  <button
                    onClick={handleFlagComment}
                    disabled={flagSubmitting}
                    style={{ fontSize: 10, fontFamily: 'Inter', padding: '4px 10px', color: 'var(--c-fg-2)', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Submit
                  </button>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                {/* Delete flow — left side */}
                {confirmDeleteFlag ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>Confirm delete?</span>
                    <button
                      onClick={handleDeleteFlag}
                      style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'Inter', background: 'var(--c-fg)', color: '#fff', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteFlag(false)}
                      style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-3)', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteFlag(true)}
                    style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg)', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                )}
                {/* Right side: Acknowledge or Save */}
                <div style={{ display: 'flex', gap: 8 }}>
                  {selectedFlag.status === 'pending' && (() => {
                    const canAck = selectedFlag.category !== null || pendingCategory !== null
                    return (
                      <button
                        onClick={handleAcknowledgeFlag}
                        disabled={flagSubmitting || !canAck}
                        style={{
                          padding: '8px 16px', fontSize: 11, fontFamily: 'Inter',
                          background: canAck ? 'var(--c-fg)' : 'var(--c-wash)',
                          color: canAck ? 'var(--c-bg)' : 'var(--c-fg-3)',
                          borderRadius: 6,
                          cursor: canAck ? 'pointer' : 'default',
                          fontWeight: 600,
                        }}
                      >
                        {flagSubmitting ? 'Saving…' : 'Acknowledge'}
                      </button>
                    )
                  })()}
                  {selectedFlag.status === 'acknowledged' && (
                    <button
                      onClick={handleSaveFlag}
                      disabled={flagSubmitting}
                      style={{
                        padding: '8px 16px', fontSize: 11, fontFamily: 'Inter',
                        background: 'var(--c-fg)',
                        color: 'var(--c-bg)',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {flagSubmitting ? 'Saving…' : 'Save & Close'}
                    </button>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ADD TASK MODAL */}
      {addingTask && (
        <div
          className="c-modal-backdrop" style={{ zIndex: 10001, background: isMobile ? 'var(--c-bg)' : undefined, padding: isMobile ? 0 : 24 }}
          onClick={e => { if (e.target === e.currentTarget) closeAddTask() }}
        >
          <div className="c-sheet" style={{ width: '100%', maxWidth: 600, maxHeight: '85vh', display: 'flex', flexDirection: 'column', ...fullscreenCardOnMobile(isMobile, modalViewportHeight) }}>
            <div style={{ padding: '18px 24px', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 14, color: 'var(--c-fg)' }}>New Task</span>
              <button
                onClick={closeAddTask}
                style={{ marginLeft: 'auto', cursor: 'pointer', color: 'var(--c-fg-3)', fontSize: 20, lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }}>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                  Task Description <span style={{ color: 'var(--c-fg)' }}>*</span>
                </div>
                <textarea
                  autoFocus
                  value={newTaskText}
                  onChange={e => setNewTaskText(e.target.value)}
                  placeholder="What needs to be done?"
                  rows={5}
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: 13,
                    background: 'var(--c-wash)', borderRadius: 6, color: 'var(--c-fg)', fontFamily: 'Inter',
                    outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5,
                  }}
                />
              </div>
              {canAssign && (
                <div>
                  <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                    Assign To
                  </div>
                  <select
                    value={newTaskAssignTo}
                    onChange={e => setNewTaskAssignTo(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 12px', fontSize: 13,
                      background: 'var(--c-wash)', borderRadius: 6, color: 'var(--c-fg)', fontFamily: 'Inter',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  >
                    {ownOnly && <option value="">Me</option>}
                    {ASSIGN_OPTIONS.map(opt => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                  Photo
                </div>
                {newTaskPhotoPreview && (
                  <img
                    src={newTaskPhotoPreview}
                    alt=""
                    style={{ display: 'block', maxHeight: 80, borderRadius: 4, objectFit: 'cover', marginBottom: 8 }}
                  />
                )}
                <label style={{ display: 'inline-block', fontSize: 11, color: 'var(--c-fg-2)', cursor: 'pointer', fontFamily: 'Inter', padding: '9px 14px', borderRadius: 6 }}>
                  {newTaskPhoto ? newTaskPhoto.name : '+ Add Photo'}
                  <input
                    ref={newTaskPhotoRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => pickNewTaskPhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={closeAddTask}
                  style={{
                    flex: 1, padding: '11px', fontSize: 12, fontFamily: 'Inter',
                    borderRadius: 6, cursor: 'pointer', color: 'var(--c-fg-2)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddTask}
                  disabled={taskSubmitting || !newTaskText.trim()}
                  style={{
                    flex: 1, padding: '11px', fontSize: 12, fontFamily: 'Inter',
                    background: newTaskText.trim() ? 'var(--c-fg)' : 'var(--c-wash)',
                    color: newTaskText.trim() ? 'var(--c-bg)' : 'var(--c-fg-3)',
                    borderRadius: 6,
                    cursor: newTaskText.trim() ? 'pointer' : 'default',
                    fontWeight: 600,
                  }}
                >
                  {taskSubmitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESOLVE MODAL */}
      {showResolveModal && selectedFlag && (
        <div
          className="c-modal-backdrop" style={{ zIndex: 10001, background: isMobile ? 'var(--c-bg)' : undefined, padding: isMobile ? 0 : 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowResolveModal(false) }}
        >
          <div className="c-sheet" style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', ...fullscreenCardOnMobile(isMobile, modalViewportHeight) }}>
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 13, color: 'var(--c-fg)' }}>Resolve Flag</span>
              <button
                onClick={() => setShowResolveModal(false)}
                className="c-x" style={{ marginLeft: 'auto', fontSize: 18 }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, ...(isMobile ? { flex: 1, overflowY: 'auto' } : {}) }}>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                  Resolution Notes <span style={{ color: 'var(--c-fg)' }}>*</span>
                </div>
                <textarea
                  value={resolveNote}
                  onChange={e => setResolveNote(e.target.value)}
                  placeholder="Describe what was done…"
                  rows={3}
                  style={{
                    width: '100%', padding: '8px', fontSize: 11,
                    background: 'var(--c-wash)', borderRadius: 6, color: 'var(--c-fg)', fontFamily: 'Inter',
                    outline: 'none', resize: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                  Vendor / Person
                </div>
                <input
                  type="text"
                  value={resolveVendor}
                  onChange={e => setResolveVendor(e.target.value)}
                  placeholder="Vendor or person who fixed it…"
                  style={{
                    width: '100%', padding: '8px', fontSize: 11,
                    background: 'var(--c-wash)', borderRadius: 6, color: 'var(--c-fg)', fontFamily: 'Inter',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Archivo Black', fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
                  Cost
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>$</span>
                  <input
                    type="number"
                    value={resolveCost}
                    onChange={e => setResolveCost(e.target.value)}
                    placeholder="0.00"
                    style={{
                      flex: 1, padding: '8px', fontSize: 11,
                      background: 'var(--c-wash)', borderRadius: 6, color: 'var(--c-fg)', fontFamily: 'Inter',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => setShowResolveModal(false)}
                  style={{
                    flex: 1, padding: '9px', fontSize: 11, fontFamily: 'Inter',
                    borderRadius: 6, cursor: 'pointer', color: 'var(--c-fg-2)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleResolveFlag}
                  disabled={flagSubmitting || !resolveNote.trim()}
                  style={{
                    flex: 1, padding: '9px', fontSize: 11, fontFamily: 'Inter',
                    background: resolveNote.trim() ? 'var(--c-fg)' : 'var(--c-wash)',
                    color: resolveNote.trim() ? 'var(--c-bg)' : 'var(--c-fg-3)',
                    borderRadius: 6,
                    cursor: resolveNote.trim() ? 'pointer' : 'default',
                    fontWeight: 600,
                  }}
                >
                  {flagSubmitting ? 'Saving…' : 'Confirm Resolve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WORK ORDER — booked room-grid cards open the WO directly (Step 8) */}
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
