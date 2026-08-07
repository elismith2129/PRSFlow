'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase, Lead, Booking, DashboardTask, DashboardTaskComment, Flag, FlagComment, UserProfile } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import { deleteSessionAndWO } from '@/lib/deleteSession'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Row, SoftButton, StatusDot, NewLeadPulse, statusFillClass } from '@/components/carved'
import { SessionCardBody, initials, sessionFillClass } from '@/components/calendar/SessionCard'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { ASSIGN_OPTIONS, resolveAssignTo, nameForId, visibleTabsForRole, idsForTab, fetchTasks, fetchMyTasks, fetchMyCompletedTasks, isOwnOnlyRole } from '@/lib/tasks'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { useWebInquiries } from '@/components/notifications/WebInquiryProvider'
import { SignedImage } from '@/components/shared/SignedImage'
import { fmtTimestamp } from '@/lib/format'

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
const ROOM_CARD_H = 120

// §14b: rooms are 12, in this order — PRS A,B,C,E,X,Nadine's → ARS A,B →
// ERS A,B → TRK N,S. Nadine's is PRS's sixth room but is not yet a bookable
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
  { venue: 'Track', studio: 'North', label: 'TRK · N' },
  { venue: 'Track', studio: 'South', label: 'TRK · S' },
]

// Location count chips for the sessions pane header (§14b — the old location
// strip is retired; these are its replacement).
const LOC_CHIPS = [
  { code: 'PRS', venue: 'Paramount' },
  { code: 'ARS', venue: 'Ameraycan' },
  { code: 'ERS', venue: 'Encore' },
  { code: 'TRK', venue: 'Track' },
]

// ─── STATIC console content (§14c/§14b) ──────────────────────────────────────
// The Flo briefing, My Day duties and staff grid are PLACEHOLDERS copied from
// docs/design-refs/dashboard-final.html — they go live with the HR layer
// (docs/HR-SPEC.md). "Ask Flo →" is a dead affordance for now, by design.
type FloBullet = { color: string; alert?: boolean; text: string }
const FLO_STATIC: Record<'eli' | 'fernando', { bullets: FloBullet[]; synopsis: string }> = {
  eli: {
    bullets: [
      { color: 'var(--c-st-hot)', alert: true, text: 'Aaron missed the AR follow-up queue again — 3-day backlog' },
      { color: 'var(--c-st-warm)', text: 'COD outstanding: 2 accounts · nothing over 31 days' },
      { color: 'var(--c-st-booked)', text: 'Fernando cleared all five duties yesterday' },
    ],
    synopsis: 'Quiet day overall — one thing needs you: Aaron’s AR backlog.',
  },
  fernando: {
    bullets: [
      { color: 'var(--c-st-hot)', alert: true, text: '3 punch requests waiting in your queue' },
      { color: 'var(--c-st-warm)', text: 'Onboarding: I-9 due Friday' },
      { color: 'var(--c-st-booked)', text: 'Tonight: Kestrel in PRS B, Harbor in ARS A' },
    ],
    synopsis: 'Steady day — clear the punch queue first, the rest can wait.',
  },
}
type MyDayItem = { text: string; done?: boolean; ct?: string; due?: string }
const MYDAY_STATIC: Record<'eli' | 'fernando', { prog: string; items: MyDayItem[]; backlog?: string }> = {
  eli: {
    prog: '2 of 4',
    items: [
      { text: 'Morning briefing reviewed', done: true },
      { text: 'Approve pending WOs', done: true, ct: '2 approved' },
      { text: 'Review staff grid' },
      { text: 'Sign vendor invoices', due: 'Due today' },
    ],
  },
  fernando: {
    prog: '3 of 5',
    items: [
      { text: "Review yesterday's timecards", done: true, ct: '4 cleared' },
      { text: 'Clear punch queue', done: true, ct: '2 done' },
      { text: "Confirm today's staffing", done: true },
      { text: 'Log missed punches' },
      { text: 'Onboarding items due', due: 'I-9 due Fri' },
    ],
    backlog: 'Timecard review: 2-day backlog — clear today to reset the streak',
  },
}
// Static 14-day staff grid (g = clear day, r = missed, n = non-working).
const DGRID_STATIC: { who: string; days: string; bk?: string }[] = [
  { who: 'Fernando', days: 'ggnggggngggggg' },
  { who: 'Aaron', days: 'ggnggrgnggggrr', bk: '3d' },
  { who: 'Quinn', days: 'ggnggggngggggg' },
  { who: 'Sierra', days: 'grnggggngggggg' },
]



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
  const { isUnacked, leadsVersion } = useWebInquiries()
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
  const [viewAs, setViewAs] = useState<'eli' | 'fernando'>('eli')
  const isEli = profile?.email === 'srv2129@gmail.com' || profile?.email === 'eli@paramountrecording.com'
  function switchViewAs(v: 'eli' | 'fernando') {
    setViewAs(v)
    // Follow with the matching task tab when it exists for this role.
    const tabs = visibleTabsForRole(profile?.role)
    if (tabs.some(t => t.key === v)) setActiveTaskTab(v)
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
  const needsActionLeads = leads
    .filter(l => {
      if (l.needs_contact === false) return false
      const uncontacted = l.status === 'uncontacted' || (!l.last_contact && l.status !== 'booked' && l.status !== 'dead')
      const hot = l.status === 'hot' && isKhuDue(l) && !isParked(l)
      const warm = l.status === 'warm' && isKhuDue(l) && !isParked(l)
      const incomplete = (l.status === 'hot' || l.status === 'warm' || l.status === 'uncontacted')
        && (!l.fname || !l.lname || !l.email || !l.phone || (!l.quote && !l.rate_daily))
      return uncontacted || hot || warm || incomplete
    })
    .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
    .slice(0, 6)
  useEffect(() => {
    async function load() {
      const d = new Date(calDate)
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
      const today = d.toISOString().slice(0, 10)
      const [{ data: leadsData }, { data: bookingsData }, { data: flagsData }] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('bookings').select('*').lte('start_date', today).gte('end_date', today).order('from_time', { ascending: true }),
        supabase.from('flags').select('*').in('status', ['pending', 'acknowledged']).is('deleted_at', null).order('created_at', { ascending: false }).limit(4),
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

  useEffect(() => {
    // Hold the first fetch until the default tab is settled, so a restricted user
    // (asst_manager / tech) never momentarily loads another tab's tasks.
    if (profileLoading || !tabReady) return
    async function load() {
      setTasksLoading(true)
      if (ownOnly && profile?.id) {
        setTasks(await fetchMyTasks(profile.id))
      } else {
        setTasks(await fetchTasks(idsForTab(activeTaskTab, allProfiles)))
      }
      setTasksLoading(false)
    }
    load()
  }, [activeTaskTab, allProfiles, profileLoading, tabReady, ownOnly, profile?.id])

  async function reloadTasks() {
    setTasksLoading(true)
    if (ownOnly && profile?.id) {
      setTasks(await fetchMyTasks(profile.id))
    } else {
      setTasks(await fetchTasks(idsForTab(activeTaskTab, allProfiles)))
    }
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
    // owner/manager/billing default to the active tab's option; own-only tiers
    // (asst_manager/tech/runner) default to "" = "Me" (self), and can pick anyone.
    setNewTaskAssignTo(canAssign ? (ownOnly ? '' : activeTaskTab) : '')
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
            {greeting}{viewAs === 'fernando' ? ' Fernando' : greetingName}
          </span>
          <h1 className="c-arch" style={{ fontSize: isMobile ? 20 : 26, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            Paramount Recording Studios
          </h1>
        </div>
        <div style={{ flex: 1 }} />
        {isEli && !isMobile && (
          <span className="c-seg" style={{ flexShrink: 0 }}>
            <button className={viewAs === 'eli' ? 'c-on' : ''} onClick={() => switchViewAs('eli')}>Eli</button>
            <button className={viewAs === 'fernando' ? 'c-on' : ''} onClick={() => switchViewAs('fernando')}>Fernando</button>
          </span>
        )}
        {!isMobile && (
          <div className="c-datechip c-anchor c-arch" style={{ flexShrink: 0 }}>
            {clockDate.toUpperCase()}
            <small>{clockTime}</small>
          </div>
        )}
      </div>

      {/* THIRDS (§14b): LEFT = the console (Flo → My Day → Tasks) + Flags below;
          MIDDLE = Needs Action + staff grid (Eli view only); RIGHT = Today's
          Sessions. Positions are explicit grid placements so the JSX order can
          stay stable; mobile is a single column reordered Sessions → Console →
          Needs Action → Flags. Packing law: panes hug content. */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.05fr 1fr 1fr', gap: 12, alignItems: 'start' }}>

        {/* MIDDLE — NEEDS ACTION */}
        <div className="c-panel" style={isMobile ? { order: 3 } : { gridColumn: '2', gridRow: '1' }}>
          <SectionHeader
            carved
            title="Needs action"
            action={{ label: 'View all in CRM →', onClick: () => router.push('/crm') }}
          />
          <div>
            {loading ? (
              <div className="c-sub" style={{ padding: '12px 4px' }}>Loading…</div>
            ) : needsActionLeads.length === 0 ? (
              <div className="c-sub" style={{ padding: '12px 4px' }}>✓ All clear</div>
            ) : (
              needsActionLeads.map(l => {
                const reason =
                  l.status === 'hot' ? 'Follow up now' :
                  l.status === 'warm' ? 'Follow up due' :
                  l.status === 'uncontacted' ? 'Never contacted' :
                  'Needs attention'
                // New unaddressed Web Inquiry → the §9 pulse dot in the leading
                // position (clears when the lead's status moves off 'uncontacted').
                // Replaces the old box-shadow row pulse + corner NEW badge: §9 makes
                // .c-newpulse the only animated element in the app, and the accent
                // colour the badge used no longer exists.
                const isNewInquiry = isUnacked(l.id)
                return (
                  <Row key={l.id} onClick={() => router.push(`/crm?lead=${l.id}`)}>
                    {isNewInquiry && <NewLeadPulse />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{l.fname} {l.lname}</div>
                      <div className="c-sub" style={{ fontSize: 11.5 }}>{reason}</div>
                    </div>
                    <StatusBadge carved status={l.status} />
                  </Row>
                )
              })
            )}
          </div>
          {/* Footer: new lead — opens the CRM New Lead modal via ?newLead=1 */}
          <div style={{ marginTop: 8 }}>
            <SoftButton onClick={() => router.push('/crm?newLead=1')} className="c-block">
              + new lead
            </SoftButton>
          </div>
        </div>

        {/* RIGHT — TODAY'S SESSIONS (§14b): loc counts as chips in the pane
            header (the old location strip is retired), rooms 2-wide, pane hugs
            its content. Day nav (‹ date ›) is kept — it's functionality the
            mock simply didn't draw. */}
        <div className="c-panel" style={isMobile ? { order: 1 } : { gridColumn: '3', gridRow: '1 / span 2' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SectionHeader carved title="Today's sessions" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexShrink: 0 }}>
              <span className="c-loccount">
                {LOC_CHIPS.map(lc => {
                  const n = bookings.filter(b => b.location === lc.venue).length
                  return <span key={lc.code} className={n > 0 ? 'c-live' : undefined}>{lc.code} {n}</span>
                })}
              </span>
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
                      minHeight: isMobile ? 84 : 76,
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

        {/* LEFT — THE CONSOLE (§14b/§14c): Flo briefing → My Day duties → Tasks,
            one pane. Flo + My Day are STATIC placeholders until the HR layer
            ships; Tasks is live (dashboard_tasks). */}
        <div className="c-panel" style={isMobile ? { order: 2 } : { gridColumn: '1', gridRow: '1' }}>

          {/* THE FLO BOX — the app's single AI mouthpiece. Flat, ringed, and the
              only glow in the system. "Ask Flo →" is a dead door for now. */}
          <div className="c-ringwrap"><div className="c-flo-inner">
            <div className="c-flohead">
              <svg width="22" height="14" viewBox="0 0 22 14" fill="none" style={{ flexShrink: 0 }}>
                <path d="M1 7c2.6-5.2 5.2-5.2 7.8 0s5.2 5.2 7.8 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M3 10.5c2.2-3.6 4.4-3.6 6.6 0s4.4 3.6 6.6 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".45" />
              </svg>
              <span className="c-fname">Flo</span>
              <span className="c-ftag">· Your briefing · {clockNow.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </div>
            {FLO_STATIC[viewAs].bullets.map((b, i) => (
              <div key={i} className={`c-flob${b.alert ? ' c-alert' : ''}`}>
                <span className="c-flodot" style={{ background: b.color }} />
                {b.text}
              </div>
            ))}
            <div className="c-flosyn">{FLO_STATIC[viewAs].synopsis}</div>
            <div className="c-askflo">Ask Flo →</div>
          </div></div>

          {/* MY DAY — duties (static stub; HR-SPEC §2). Duties ≠ tasks: fixed
              per role, reset daily. Never merge them into the task list. */}
          <div className="c-subhead">
            <b>My day — duties</b>
            <span className="c-myday-prog">{MYDAY_STATIC[viewAs].prog}</span>
          </div>
          {MYDAY_STATIC[viewAs].items.map((it, i) => (
            <div key={i} className={`c-myday-item${it.done ? ' c-done' : ''}`}>
              <span className="c-myday-bx" />
              <span className="c-myday-tx">{it.text}</span>
              {it.ct && <span className="c-myday-ct">{it.ct}</span>}
              {it.due && <span className="c-myday-due">{it.due}</span>}
            </div>
          ))}
          {MYDAY_STATIC[viewAs].backlog && (
            <div className="c-myday-backlog">{MYDAY_STATIC[viewAs].backlog}</div>
          )}

          {/* TASKS — to-dos (live) */}
          <div className="c-subhead">
            <b>Tasks — to-dos{tasks.length > 0 ? ` · ${tasks.length}` : ''}</b>
            <a onClick={() => router.push('/tasks')} style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', opacity: 0.4, cursor: 'pointer', color: 'var(--c-fg)' }}>
              Show all →
            </a>
          </div>
          {/* Tab row (owner/manager/billing) OR a single "My Tasks" label (own-only tiers) */}
          {ownOnly ? (
            <div className="c-label" style={{ marginBottom: 13 }}>My Tasks</div>
          ) : (
            // Grid, not flex-wrap: with 6 tabs a wrapping flex row left a ragged
            // last line with one orphan pill. Equal columns fill each row and the
            // pills stay the same width regardless of label length.
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 13 }}>
              {visibleTabs.map(tab => (
                <SoftButton
                  key={tab.key}
                  on={activeTaskTab === tab.key}
                  onClick={() => setActiveTaskTab(tab.key)}
                  className="c-soft-sm"
                >
                  {tab.label}
                </SoftButton>
              ))}
            </div>
          )}
          {/* Task list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minHeight: 60 }}>
            {tasksLoading ? (
              <div className="c-sub" style={{ padding: '4px' }}>Loading…</div>
            ) : tasks.length === 0 ? (
              <div className="c-sub" style={{ padding: '4px' }}>No tasks</div>
            ) : (
              tasks.slice(0, 9).map(task => (
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
            {!tasksLoading && tasks.length > 9 && (
              <div
                onClick={() => router.push('/tasks')}
                className="c-sub"
                style={{ fontSize: 11, padding: '2px 4px', cursor: 'pointer' }}
              >
                + {tasks.length - 9} more
              </div>
            )}
          </div>
          {/* Footer: add task — opens the full modal */}
          <div style={{ marginTop: 8 }}>
            <SoftButton onClick={openAddTask} className="c-block">+ add task</SoftButton>
          </div>
        </div>

      {/* LEFT, BELOW THE CONSOLE — FLAGS (separate pane per §14b) */}
      <div className="c-panel" style={isMobile ? { order: 4 } : { gridColumn: '1', gridRow: '2' }}>
        <SectionHeader
          carved
          title="Flags"
          count={flags.filter(f => f.status === 'pending').length > 0 ? flags.filter(f => f.status === 'pending').length : undefined}
          action={{ label: 'View all flags →', onClick: () => router.push('/admin?section=flags_log') }}
        />
        {flagsLoading ? (
          <div className="c-sub" style={{ padding: '12px 4px' }}>Loading…</div>
        ) : flags.length === 0 ? (
          <div className="c-sub" style={{ padding: '12px 4px' }}>No open flags</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {flags.map(flag => {
              const CATEGORY_LABELS: Record<string, string> = {
                facility_general: 'Facility / General',
                gear_equipment: 'Gear / Equipment',
                client_billing: 'Client / Billing',
              }
              const catLabel = flag.category ? CATEGORY_LABELS[flag.category] : null
              return (
                <div
                  key={flag.id}
                  onClick={() => handleOpenFlag(flag)}
                  className="c-inset2"
                  style={{ padding: '12px 14px', borderRadius: 18, cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      {/* Studio + category were bordered chips; carved uses plain
                          tracked-out labels — colour belongs to status only. */}
                      <span className="c-label" style={{ opacity: 0.7 }}>{flag.studio}</span>
                      {catLabel && <span className="c-label" style={{ fontSize: 9 }}>{catLabel}</span>}
                    </div>
                    <StatusBadge carved status={flag.status} />
                  </div>
                  {flag.runner_note && (
                    <div style={{ fontSize: 12.5, lineHeight: 1.4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {flag.runner_note}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8 }}>
                    {flag.source_label ? (
                      <div className="c-sub" style={{ fontSize: 11, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                        {flag.source_label}
                      </div>
                    ) : (
                      <div style={{ flex: 1 }} />
                    )}
                    <div className="c-mono" style={{ fontSize: 11, opacity: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {new Date(flag.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {/* Footer: add flag — opens the full modal */}
        <div style={{ marginTop: 8 }}>
          <SoftButton onClick={() => setAddingFlag(true)} className="c-block">+ add flag</SoftButton>
        </div>
      </div>

      {/* MIDDLE, BELOW NEEDS ACTION — STAFF 14-DAY GRID (§2.7 HR-SPEC). STATIC
          placeholder until punch data exists; Eli's view only, desktop only. */}
      {isEli && viewAs === 'eli' && !isMobile && (
        <div className="c-panel" style={{ gridColumn: '2', gridRow: '2' }}>
          <SectionHeader carved title="Staff — 14 days" action={{ label: 'HR →', onClick: () => router.push('/punches') }} />
          <div className="c-dgrid">
            <table>
              <tbody>
                {DGRID_STATIC.map(row => (
                  <tr key={row.who}>
                    <td className="c-who">{row.who}</td>
                    {row.days.split('').map((d, i) => (
                      <td key={i} className={`c-sq${d === 'g' ? ' c-g' : d === 'r' ? ' c-r' : ''}`} />
                    ))}
                    <td className="c-bk">{row.bk || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
