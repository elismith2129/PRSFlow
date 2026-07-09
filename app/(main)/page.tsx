'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase, Lead, Booking, DashboardTask, DashboardTaskComment, Flag, FlagComment, UserProfile } from '@/lib/supabase'
import { LocationStrip } from '@/components/dashboard/LocationStrip'
import { useRouter } from 'next/navigation'
import { BookingForm, type FormData, bookingToForm, emptyForm } from '@/components/calendar/BookingForm'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { ASSIGN_OPTIONS, resolveAssignTo, nameForId, visibleTabsForRole, idsForTab, fetchTasks, fetchMyTasks, fetchMyCompletedTasks, isOwnOnlyRole } from '@/lib/tasks'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { useWebInquiries } from '@/components/notifications/WebInquiryProvider'
import { SignedImage } from '@/components/shared/SignedImage'

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
function fullscreenCardOnMobile(isMobile: boolean): React.CSSProperties {
  return isMobile
    ? { width: '100vw', maxWidth: '100vw', height: '100dvh', maxHeight: '100dvh', margin: 0, borderRadius: 0 }
    : {}
}

const ROOMS = [
  { venue: 'Paramount', studio: 'Studio A', label: 'Paramount A' },
  { venue: 'Paramount', studio: 'Studio B', label: 'Paramount B' },
  { venue: 'Paramount', studio: 'Studio C', label: 'Paramount C' },
  { venue: 'Paramount', studio: 'Studio E', label: 'Paramount E' },
  { venue: 'Paramount', studio: 'Studio X', label: 'Paramount X' },
  { venue: 'Ameraycan', studio: 'Studio A', label: 'Ameraycan A' },
  { venue: 'Ameraycan', studio: 'Studio B', label: 'Ameraycan B' },
  { venue: 'Encore', studio: 'Studio A', label: 'Encore A' },
  { venue: 'Encore', studio: 'Studio B', label: 'Encore B' },
  { venue: 'Track', studio: 'North', label: 'Track North' },
  { venue: 'Track', studio: 'South', label: 'Track South' },
]

function engInitials(name: string | null): string {
  if (!name?.trim()) return ''
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

function fmtSessionTime(t: string): string {
  if (!t) return ''
  const m = t.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
  if (!m) return t
  let h = parseInt(m[1])
  const min = m[2]
  const ap = m[3]?.toUpperCase()
  if (ap) return `${h}${min !== '00' ? ':' + min : ''}${ap === 'AM' ? 'A' : 'P'}`
  const suf = h >= 12 ? 'P' : 'A'
  if (h > 12) h -= 12
  if (h === 0) h = 12
  return `${h}${min !== '00' ? ':' + min : ''}${suf}`
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  )
}

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
  const [dashBkFormOpen, setDashBkFormOpen] = useState(false)
  const [dashEditBooking, setDashEditBooking] = useState<Booking | null>(null)
  const [dashFormInitial, setDashFormInitial] = useState<FormData>(() => emptyForm())
  // One-time post-login welcome splash (set by the login page in sessionStorage).
  // Initialize from the flag synchronously so the splash is in the dashboard's
  // FIRST paint — covering the nav bar before it can flash. The welcome effect
  // below still removes the flag and schedules the dismiss.
  const [showWelcome, setShowWelcome] = useState<boolean>(
    () => typeof window !== 'undefined' && sessionStorage.getItem('showWelcome') === 'true'
  )
  const [welcomeFading, setWelcomeFading] = useState(false)
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
  // (LocationStrip keeps its own bookings/work_orders channels for its own data.)
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
    setDashFormInitial(bookingToForm(bk))
    setDashBkFormOpen(true)
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

  async function handleDashSave(data: FormData) {
    if (!dashEditBooking) return
    await supabase.from('bookings').update({
      status: data.status, session_type: data.session_type,
      payment_type: data.payment_type, cod_method: data.cod_method,
      location: data.location, studio: data.studio,
      start_date: data.start_date, end_date: data.end_date,
      from_time: data.from_time, to_time: data.to_time,
      rate: data.rate, rate_daily: data.rate_daily,
      invoice_num: data.invoice_num,
      client_name: data.client_name, artist: data.artist, label: data.label,
      ordered_by: data.ordered_by, phone: data.phone, email: data.email,
      po: data.po, producer: data.producer,
      food_budget: data.food_budget, food_amount: data.food_amount,
      engineer_name: data.engineer_name, engineer_rate: data.engineer_rate, engineer_status: data.engineer_status,
      assistant_name: data.assistant_name, assistant_status: data.assistant_status,
      notes: data.notes, client_id: data.client_db_id, is_srs: data.is_srs,
      anr_contact_id: data.anr_contact_id, anr_admin_contact_id: data.anr_admin_contact_id,
    }).eq('id', dashEditBooking.id)
    const d = new Date(calDate)
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
    const today = d.toISOString().slice(0, 10)
    const { data: refreshed } = await supabase.from('bookings').select('*').lte('start_date', today).gte('end_date', today).order('from_time', { ascending: true })
    setBookings(refreshed || [])
  }

  async function handleDashDelete() {
    if (!dashEditBooking) return
    await supabase.from('bookings').delete().eq('id', dashEditBooking.id)
    const d = new Date(calDate)
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
    const today = d.toISOString().slice(0, 10)
    const { data: refreshed } = await supabase.from('bookings').select('*').lte('start_date', today).gte('end_date', today).order('from_time', { ascending: true })
    setBookings(refreshed || [])
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

  // Lock background page scroll while the create-flag modal is open. iOS Safari
  // ignores overflow:hidden on body, so use the documented position:fixed + top
  // offset pattern and restore the scroll position on close.
  useEffect(() => {
    if (!addingFlag) return
    const scrollY = window.scrollY
    const body = document.body
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    return () => {
      body.style.position = ''
      body.style.top = ''
      body.style.left = ''
      body.style.right = ''
      body.style.width = ''
      window.scrollTo({ top: scrollY, behavior: 'instant' as ScrollBehavior })
    }
  }, [addingFlag])

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
          style={{
            // Above the Nav (99999) so the splash fully covers the viewport — a
            // 9999 overlay would sit under the sticky nav bar and look broken.
            position: 'fixed', inset: 0, zIndex: 100000,
            background: '#0d0f14',
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
          <div style={{ fontFamily: 'DM Mono', fontSize: 13, letterSpacing: '0.2em', color: '#6B7280', textTransform: 'uppercase' }}>
            {greeting.toUpperCase()}
          </div>
          {/* nbsp fallback reserves the line height so the name appearing causes no layout shift */}
          <div style={{
            fontFamily: 'Syne', fontWeight: 800, fontSize: isMobile ? 48 : 64, color: '#e8eaf0', lineHeight: 1.1, marginTop: 14, marginBottom: 108, textAlign: 'center',
            opacity: nameVisible ? 1 : 0,
            transform: nameVisible ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.6s ease, transform 0.6s ease',
          }}>
            {profile?.display_name || ' '}
          </div>
        </div>
      )}

      <div id="dashboard-content" style={{ opacity: contentReady && !showWelcome ? 1 : 0, transition: 'opacity 0.3s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'flex-end', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'Syne', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 4 }}>
            {greeting}{greetingName} — here's your briefing
          </div>
          <h1 style={{ fontFamily: 'DM Serif Display', fontSize: isMobile ? 26 : 32, letterSpacing: -1, lineHeight: 1.05, whiteSpace: isMobile ? 'nowrap' : undefined }}>
            Paramount <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Recording Studios</em>
          </h1>
        </div>
        {/* Desktop-only live clock — date + time on one line, bottom-aligned with
            the heading, matching its Syne ExtraBold weight */}
        {!isMobile && (
          <div style={{ flexShrink: 0, paddingLeft: 24, textAlign: 'right', fontFamily: 'DM Serif Display', fontSize: 28, letterSpacing: '0.02em', lineHeight: 1.05, whiteSpace: 'nowrap' }}>
            <span style={{ color: '#c8f04e' }}>{clockDate.toUpperCase()}</span>
            <span style={{ marginLeft: 12, color: '#e8eaf0' }}>{clockTime}</span>
          </div>
        )}
      </div>

      {/* Location strip */}
      <LocationStrip />

      {/* 3-column grid — single column on mobile, reordered so Today's Sessions
          leads, then Needs Action, then Tasks (via the `order` overrides below). */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 2fr 1fr', gap: 14, alignItems: 'start', marginTop: 14 }}>

        {/* COL 1 — NEEDS ACTION */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', order: isMobile ? 2 : 0 }}>
          <div style={{ padding: '13px 16px 0', borderBottom: '1px solid var(--border)' }}>
            <SectionHeader
              title="NEEDS ACTION"
              action={{ label: 'View all in CRM →', onClick: () => router.push('/crm') }}
              actionColor="#6B7280"
            />
          </div>
          <div style={{ borderBottom: '1px solid var(--border)' }}>
            {loading ? (
              <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
            ) : needsActionLeads.length === 0 ? (
              <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>✓ All clear</div>
            ) : (
              needsActionLeads.map((l, i) => {
                const reason =
                  l.status === 'hot' ? 'Follow up now' :
                  l.status === 'warm' ? 'Follow up due' :
                  l.status === 'uncontacted' ? 'Never contacted' :
                  'Needs attention'
                // New unaddressed Web Inquiry → persistent lime pulse + NEW badge
                // (clears when the lead's status changes away from 'uncontacted').
                const isNewInquiry = isUnacked(l.id)
                return (
                  <div
                    key={l.id}
                    onClick={() => router.push(`/crm?lead=${l.id}`)}
                    style={{
                      position: 'relative',
                      padding: '9px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: i < needsActionLeads.length - 1 ? '1px solid var(--border)' : 'none',
                      cursor: 'pointer',
                      ...(isNewInquiry ? {
                        background: 'rgba(200, 240, 78, 0.05)',
                        animation: 'webInquiryPulse 2s ease-in-out infinite',
                        zIndex: 1,
                      } : {}),
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{l.fname} {l.lname}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{reason}</div>
                    </div>
                    <StatusBadge status={l.status} />
                    {isNewInquiry && (
                      <span style={{
                        position: 'absolute', top: 4, right: 4,
                        background: '#c8f04e', color: '#0d0f14',
                        fontSize: 8, fontFamily: 'DM Mono, monospace', fontWeight: 700,
                        letterSpacing: '0.08em', padding: '1px 4px', borderRadius: 3, lineHeight: 1.4,
                      }}>
                        NEW
                      </span>
                    )}
                  </div>
                )
              })
            )}
          </div>
          {/* Footer: new lead — opens the CRM New Lead modal via ?newLead=1 */}
          <div style={{ padding: '8px', borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => router.push('/crm?newLead=1')}
              style={{
                width: '100%', padding: isMobile ? '13px' : '8px', fontSize: 11, fontFamily: 'DM Mono',
                color: 'var(--text3)', background: 'transparent', letterSpacing: '0.04em',
                border: '1px dashed var(--border)', borderRadius: 8, cursor: 'pointer',
                minHeight: isMobile ? 44 : undefined,
                transition: 'all 0.15s',
              }}
            >
              + new lead
            </button>
          </div>
        </div>

        {/* COL 2 — TODAY'S SESSIONS */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', height: isMobile ? 'auto' : 556, order: isMobile ? 1 : 0 }}>
          <div style={{ padding: '13px 16px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <SectionHeader title="TODAY'S SESSIONS" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setCalDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n })}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text2)', cursor: 'pointer', padding: '2px 7px', fontSize: 13, lineHeight: 1, minWidth: isMobile ? 44 : undefined, minHeight: isMobile ? 44 : undefined }}
              >‹</button>
              <div style={{ fontSize: isMobile ? 11 : 10, fontFamily: 'DM Mono', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                {calDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
              <button
                onClick={() => setCalDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n })}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text2)', cursor: 'pointer', padding: '2px 7px', fontSize: 13, lineHeight: 1, minWidth: isMobile ? 44 : undefined, minHeight: isMobile ? 44 : undefined }}
              >›</button>
            </div>
          </div>
          {loading ? (
            <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr', gap: 4, padding: 8 }}>
              {ROOMS.map(room => {
                const booking = bookings.find(b =>
                  b.location === room.venue && b.studio === room.studio
                )
                const isBilling = booking?.payment_type === 'billing'
                const topColor = booking?.status === 'confirmed' ? '#14B8A6' : booking?.status === 'tentative' ? '#F97316' : null
                // Card state accent: orange (attention) takes priority over teal (occupied); null = empty
                const cardAccent = topColor === '#F97316' ? '#F97316' : booking ? '#14B8A6' : null
                const cardBorder = cardAccent === '#F97316' ? 'rgba(249, 115, 22, 0.35)'
                  : cardAccent === '#14B8A6' ? 'rgba(20, 184, 166, 0.35)'
                  : 'rgba(255, 255, 255, 0.08)'
                const cardGlow = cardAccent === '#F97316' ? 'inset 0 0 18px rgba(249, 115, 22, 0.06)'
                  : cardAccent === '#14B8A6' ? 'inset 0 0 18px rgba(20, 184, 166, 0.06)'
                  : 'none'
                const primaryName = booking
                  ? (isBilling ? (booking.artist || booking.label || booking.client_name || '') : (booking.client_name || ''))
                  : ''
                const labelLine = booking && isBilling && booking.label && booking.label !== primaryName ? booking.label : ''
                const timeStr = booking?.from_time && booking?.to_time
                  ? `${fmtSessionTime(booking.from_time)}–${fmtSessionTime(booking.to_time)}`
                  : booking?.from_time ? fmtSessionTime(booking.from_time) : ''
                const eng = booking?.engineer_name ? engInitials(booking.engineer_name) : ''
                const engColor = booking?.engineer_status === 'confirmed' ? '#4ef0a2'
                  : booking?.engineer_status === 'hold' ? '#f0a24e'
                  : 'rgba(255,255,255,0.4)'
                const asst = booking?.assistant_name ? engInitials(booking.assistant_name) : ''
                const asstColor = booking?.assistant_status === 'confirmed' ? '#4ef0a2'
                  : booking?.assistant_status === 'hold' ? '#f0a24e'
                  : 'rgba(255,255,255,0.4)'
                const isEmpty = !booking
                // Empty cards hint they're clickable by lightening slightly on hover.
                const emptyHover = isEmpty && hoverRoom === room.label
                return (
                  <div
                    key={room.label}
                    onClick={() => booking ? openBookingEdit(booking) : openNewRoomBooking(room)}
                    onMouseEnter={isEmpty ? () => setHoverRoom(room.label) : undefined}
                    onMouseLeave={isEmpty ? () => setHoverRoom(null) : undefined}
                    style={{
                      position: 'relative',
                      height: isMobile ? undefined : 120,
                      minHeight: isMobile ? 72 : undefined,
                      borderRadius: 6,
                      border: `1px solid ${cardBorder}`,
                      boxShadow: cardGlow,
                      background: booking ? '#0d0f14' : (emptyHover ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0,0,0,0.2)'),
                      padding: isMobile ? '8px 10px' : '7px 9px',
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                  >
                    {cardAccent && (
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: cardAccent }} />
                    )}
                    <div style={{ fontSize: 9, fontFamily: 'DM Mono', fontWeight: 600, color: 'var(--text2)', letterSpacing: '0.04em', opacity: booking ? 0.9 : 0.75, marginBottom: booking ? 4 : 0 }}>
                      {room.label}
                    </div>
                    {booking && (
                      <>
                        <div style={{
                          fontSize: isMobile ? 12 : 13, fontWeight: isMobile ? 600 : undefined, fontFamily: 'DM Serif Display', lineHeight: 1.2, color: 'var(--text)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {primaryName}
                        </div>
                        {labelLine && (
                          <div style={{
                            fontSize: 9, fontFamily: 'DM Mono', color: 'rgba(255,255,255,0.45)', lineHeight: 1.2, marginTop: 2,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {labelLine}
                          </div>
                        )}
                        {timeStr && (
                          <div style={{ fontSize: isMobile ? 10 : 9, fontFamily: 'DM Mono', color: 'rgba(255,255,255,0.75)', lineHeight: 1.2, marginTop: 2 }}>
                            {timeStr}
                          </div>
                        )}
                        {(eng || asst) && (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginTop: 'auto' }}>
                            {eng && <div style={{ fontSize: isMobile ? 10 : 8, fontFamily: 'DM Mono', color: engColor, whiteSpace: 'nowrap' }}>1ST-{eng}</div>}
                            {asst && <div style={{ fontSize: isMobile ? 10 : 8, fontFamily: 'DM Mono', color: asstColor, whiteSpace: 'nowrap' }}>2ND-{asst}</div>}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* COL 3 — TASKS */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', order: isMobile ? 3 : 0 }}>
          {/* Header */}
          <div style={{ padding: '13px 16px 0', borderBottom: '1px solid var(--border)' }}>
            <SectionHeader
              title="TASKS"
              count={tasks.length > 0 ? tasks.length : undefined}
              action={{ label: 'show all tasks →', onClick: () => router.push('/tasks') }}
              actionColor="#6B7280"
            />
          </div>
          {/* Tab row (owner/manager/billing) OR a single "My Tasks" label (own-only tiers) */}
          {ownOnly ? (
            <div style={{ display: 'flex', alignItems: 'center', padding: isMobile ? '10px 8px' : '8px 6px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
              <span style={{ fontSize: isMobile ? 11 : 9, fontFamily: 'Syne', fontWeight: 700, color: '#e8eaf2', textTransform: 'uppercase', letterSpacing: isMobile ? '0.06em' : '0.03em' }}>
                My Tasks
              </span>
            </div>
          ) : (
            <div className="hide-scrollbar" style={{ display: 'flex', gap: isMobile ? 3 : 2, justifyContent: 'space-between', padding: isMobile ? '6px 8px' : '6px 6px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', overflowX: isMobile ? 'hidden' : 'auto', whiteSpace: 'nowrap' }}>
              {visibleTabs.map(tab => {
                const isActive = activeTaskTab === tab.key
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTaskTab(tab.key)}
                    style={{
                      flexShrink: isMobile ? 1 : 0, flex: isMobile ? 1 : undefined, minWidth: isMobile ? 0 : undefined,
                      padding: '0 4px', fontSize: isMobile ? 10 : 9, fontFamily: 'Syne',
                      fontWeight: isActive ? 700 : 600,
                      color: isActive ? '#e8eaf2' : 'var(--text2)',
                      background: isActive ? '#1a1d27' : 'transparent',
                      border: 'none', cursor: 'pointer', borderRadius: 6, whiteSpace: 'nowrap',
                      overflow: isMobile ? 'hidden' : undefined, textOverflow: isMobile ? 'ellipsis' : undefined,
                      minHeight: isMobile ? 40 : undefined,
                      textTransform: 'uppercase', letterSpacing: isMobile ? '0.02em' : '0.03em', transition: 'all 0.1s',
                    }}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>
          )}
          {/* Task list */}
          <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 60 }}>
            {tasksLoading ? (
              <div style={{ padding: '8px', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
            ) : tasks.length === 0 ? (
              <div style={{ padding: '8px', color: 'var(--text3)', fontSize: 11 }}>No tasks</div>
            ) : (
              tasks.slice(0, 9).map(task => (
                <div
                  key={task.id}
                  onClick={() => handleOpenTask(task)}
                  style={{
                    display: 'flex', alignItems: isMobile ? 'center' : 'flex-start', gap: 10,
                    padding: isMobile ? '6px 10px' : '10px 12px',
                    background: 'var(--surface2)',
                    border: task.source !== 'manual' ? '0.5px solid var(--border)' : '0.5px solid var(--border)',
                    borderLeft: task.source !== 'manual' ? '2px solid #F97316' : '0.5px solid var(--border)',
                    borderRadius: task.source !== 'manual' ? '0 8px 8px 0' : 8,
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: '#F97316',
                    marginTop: isMobile ? 0 : 4, flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: isMobile ? 11 : 12, color: 'var(--text)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.text}
                    </div>
                    {task.due_date && (
                      <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 3, fontFamily: 'DM Mono' }}>
                        Due {task.due_date}
                      </div>
                    )}
                    {task.source !== 'manual' && task.source_label && (
                      <div style={{ fontSize: 9, color: 'var(--warm)', marginTop: 3, fontFamily: 'DM Mono' }}>
                        {task.source_label}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteTask(task) }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text3)', fontSize: isMobile ? 18 : 14, padding: '0 2px',
                      lineHeight: 1, flexShrink: 0, opacity: 0.4,
                      minWidth: isMobile ? 44 : undefined,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
            {!tasksLoading && tasks.length > 9 && (
              <div
                onClick={() => router.push('/tasks')}
                style={{ fontSize: 10, color: '#6B7280', fontFamily: 'DM Mono', padding: '2px 4px', cursor: 'pointer' }}
              >
                + {tasks.length - 9} more
              </div>
            )}
          </div>
          {/* Footer: add task — opens the full modal */}
          <div style={{ padding: '8px', borderTop: '1px solid var(--border)' }}>
            <button
              onClick={openAddTask}
              style={{
                width: '100%', padding: isMobile ? '13px' : '8px', fontSize: 11, fontFamily: 'DM Mono',
                color: 'var(--text3)', background: 'transparent', letterSpacing: '0.04em',
                border: '1px dashed var(--border)', borderRadius: 8, cursor: 'pointer',
                minHeight: isMobile ? 44 : undefined,
                transition: 'all 0.15s',
              }}
            >
              + add task
            </button>
          </div>
        </div>

      </div>

      {/* FLAGS PANEL */}
      <div style={{ marginTop: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '13px 16px 0', borderBottom: '1px solid var(--border)' }}>
          <SectionHeader
            title="FLAGS"
            count={flags.filter(f => f.status === 'pending').length > 0 ? flags.filter(f => f.status === 'pending').length : undefined}
            countColor="orange"
            action={{ label: '+ Flag', onClick: () => setAddingFlag(true) }}
            actionColor="#6B7280"
          />
        </div>
        {flagsLoading ? (
          <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
        ) : flags.length === 0 ? (
          <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>No open flags</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, padding: 12 }}>
            {flags.map(flag => {
              const statusColor = flag.status === 'pending' ? '#EF4444' : flag.status === 'acknowledged' ? '#F97316' : '#14B8A6'
              const borderColor = statusColor
              const categoryConfig: Record<string, { label: string; color: string; bg: string }> = {
                facility_general: { label: 'Facility / General', color: 'var(--text3)', bg: 'var(--surface2)' },
                gear_equipment: { label: 'Gear / Equipment', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
                client_billing: { label: 'Client / Billing', color: '#60A5FA', bg: 'rgba(96,165,250,0.12)' },
              }
              const catInfo = flag.category ? categoryConfig[flag.category] : null
              return (
                <div
                  key={flag.id}
                  onClick={() => handleOpenFlag(flag)}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--surface2)',
                    border: '0.5px solid var(--border)',
                    borderLeft: `2px solid ${borderColor}`,
                    borderRadius: '0 8px 8px 0',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', color: 'rgba(232,234,240,0.7)', textTransform: 'uppercase', background: 'var(--surface)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>
                        {flag.studio}
                      </span>
                      {catInfo && (
                        <span style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text3)', background: 'var(--surface2)', padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', border: '0.5px solid var(--border)' }}>
                          {catInfo.label}
                        </span>
                      )}
                    </div>
                    <StatusBadge status={flag.status} />
                  </div>
                  {flag.runner_note && (
                    <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {flag.runner_note}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8 }}>
                    {flag.source_label ? (
                      <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                        {flag.source_label}
                      </div>
                    ) : (
                      <div style={{ flex: 1 }} />
                    )}
                    <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {new Date(flag.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
          <button
            onClick={() => router.push('/admin?section=flags_log')}
            style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            View all flags →
          </button>
        </div>
      </div>

      {/* TASK MODAL */}
      {selectedTask && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) handleCancelTaskModal() }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 480, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...fullscreenCardOnMobile(isMobile) }}>

            {/* Header — Complete button only, right aligned */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                onClick={handleCompleteTask}
                disabled={taskSubmitting}
                style={{
                  border: '1px solid #14B8A6', background: 'transparent', color: '#14B8A6',
                  fontSize: 10, fontFamily: 'DM Mono', fontWeight: 700, textTransform: 'uppercase',
                  padding: '5px 12px', borderRadius: 4, cursor: 'pointer', letterSpacing: '0.04em',
                }}
              >
                Complete
              </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {/* Description */}
              <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.6, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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
              <div style={{ fontSize: 10, color: '#6B7280', fontFamily: 'DM Mono', marginTop: 12 }}>
                Assigned to: {nameForId(selectedTask.assigned_to, allProfiles)} · by {nameForId(selectedTask.assigned_by, allProfiles)} · {new Date(selectedTask.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>

              {/* Updates */}
              <div style={{ fontSize: 10, color: '#6B7280', fontFamily: 'DM Mono', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 18, marginBottom: 10 }}>
                Updates
              </div>
              {taskComments.length === 0 ? (
                <div style={{ fontSize: 12, color: '#6B7280', fontStyle: 'italic' }}>No updates yet</div>
              ) : (
                taskComments.map(c => (
                  <div key={c.id} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: '#6B7280', fontFamily: 'DM Mono', marginBottom: 3 }}>
                      {c.created_by_name && `${c.created_by_name} · `}{fmtTime(c.created_at)}
                    </div>
                    {c.text && (
                      <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>{c.text}</div>
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
                style={{
                  width: '100%', height: 72, padding: '10px 12px', fontSize: 12,
                  background: '#0d0f14', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                  outline: 'none', resize: 'none', boxSizing: 'border-box', marginTop: 16,
                }}
              />
              {commentPhotoPreview && (
                <img
                  src={commentPhotoPreview}
                  alt=""
                  style={{ display: 'block', maxHeight: 80, borderRadius: 4, marginBottom: 8, marginTop: 8 }}
                />
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <label style={{ fontSize: 11, color: '#9ca3af', cursor: 'pointer', fontFamily: 'DM Mono' }}>
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
                    border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#9ca3af',
                    fontSize: 11, fontFamily: 'DM Mono', padding: '6px 14px', borderRadius: 6,
                    cursor: (commentText.trim() || commentPhoto) ? 'pointer' : 'default',
                  }}
                >
                  {taskSubmitting ? 'Saving…' : 'Submit'}
                </button>
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {canAssign && (
                <button
                  onClick={handleDeleteSelectedTask}
                  style={{
                    border: '1px solid rgba(239,68,68,0.4)', background: 'transparent', color: '#ef4444',
                    fontSize: 11, fontFamily: 'DM Mono', padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button
                onClick={handleCancelTaskModal}
                style={{
                  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)',
                  fontSize: 11, fontFamily: 'DM Mono', padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAndCloseTask}
                disabled={taskSubmitting}
                style={{
                  background: '#c8f04e', color: '#0d0f14', border: 'none',
                  fontSize: 11, fontFamily: 'DM Mono', fontWeight: 600, padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowHistory(false); setHistorySearch('') } }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 520, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...fullscreenCardOnMobile(isMobile) }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15 }}>Completed Tasks</div>
              <button onClick={() => { setShowHistory(false); setHistorySearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
              <input
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                placeholder="Search completed tasks…"
                style={{ width: '100%', padding: '7px 10px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: 'DM Mono', outline: 'none', boxSizing: 'border-box' }}
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
                    style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, border: '0.5px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#14B8A6', marginTop: 4, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, flex: 1 }}>{t.text}</div>
                        <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--surface)', color: 'var(--text3)', border: '0.5px solid var(--border)', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {t.assigned_role.replace('_', ' ')}
                        </div>
                      </div>
                      {t.source !== 'manual' && t.source_label && (
                        <div style={{ fontSize: 9, color: 'var(--warm)', marginTop: 3, fontFamily: 'DM Mono' }}>{t.source_label}</div>
                      )}
                      <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4, fontFamily: 'DM Mono' }}>
                        Completed {t.completed_at ? new Date(t.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </div>
                    </div>
                  </div>
                ))
              }
              {completedTasks.filter(t => !historySearch || t.text.toLowerCase().includes(historySearch.toLowerCase())).length === 0 && (
                <div style={{ padding: '12px', color: 'var(--text3)', fontSize: 11 }}>No completed tasks found</div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedHistoryTask && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setSelectedHistoryTask(null); setHistoryTaskComments([]) } }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 480, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...fullscreenCardOnMobile(isMobile) }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
              <button
                onClick={() => { setSelectedHistoryTask(null); setHistoryTaskComments([]) }}
                style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1, padding: 0 }}
              >×</button>
              <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', color: '#14B8A6', textTransform: 'uppercase', marginBottom: 6 }}>COMPLETED</div>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15, color: 'var(--text)', paddingRight: 24, lineHeight: 1.3 }}>
                {selectedHistoryTask.text}
              </div>
              {selectedHistoryTask.photo_url && (
                <SignedImage path={selectedHistoryTask.photo_url} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: 8 }} />
              )}
              {selectedHistoryTask.source !== 'manual' && selectedHistoryTask.source_label && (
                <div style={{ fontSize: 10, color: 'var(--warm)', marginTop: 4, fontFamily: 'DM Mono' }}>{selectedHistoryTask.source_label}</div>
              )}
              {selectedHistoryTask.due_date && (
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, fontFamily: 'DM Mono' }}>Due {selectedHistoryTask.due_date}</div>
              )}
              {selectedHistoryTask.completed_at && (
                <div style={{ fontSize: 10, color: '#14B8A6', marginTop: 2, fontFamily: 'DM Mono' }}>
                  Completed {new Date(selectedHistoryTask.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
              {historyTaskComments.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>No updates</div>
              ) : (
                historyTaskComments.map(c => (
                  <div key={c.id} style={{ marginBottom: 14 }}>
                    {c.text && <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{c.text}</div>}
                    {c.photo_url && (
                      <SignedImage path={c.photo_url} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: c.text ? 6 : 0 }} />
                    )}
                    <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4, fontFamily: 'DM Mono' }}>
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setAddingFlag(false); setNewFlagText(''); setNewFlagCategory(null); setNewFlagStudio('paramount'); clearNewFlagPhoto() } }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 480, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...fullscreenCardOnMobile(isMobile), ...(isMobile ? { height: 'auto', maxHeight: '90dvh', paddingTop: 'calc(52px + env(safe-area-inset-top, 0px))', paddingBottom: 'env(safe-area-inset-bottom, 0px)' } : {}) }}>

            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: '#e8eaf2' }}>New Flag</span>
                <button
                  onClick={() => { setAddingFlag(false); setNewFlagText(''); setNewFlagCategory(null); setNewFlagStudio('paramount'); clearNewFlagPhoto() }}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1, padding: 0 }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Studio */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Studio
                </div>
                <select
                  value={newFlagStudio}
                  onChange={e => setNewFlagStudio(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono', outline: 'none' }}
                >
                  <option value="paramount">Paramount</option>
                  <option value="encore">Encore</option>
                  <option value="ameraycan">Ameraycan</option>
                  <option value="track">Track</option>
                </select>
              </div>

              {/* Category */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Category
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['facility_general', 'gear_equipment', 'client_billing'] as const).map(catKey => {
                    const catConfig = {
                      facility_general: { label: 'Facility / General', activeColor: '#0d0f14', activeBg: '#c8f04e', activeBorder: '#c8f04e' },
                      gear_equipment: { label: 'Gear / Equipment', activeColor: '#0d0f14', activeBg: '#c8f04e', activeBorder: '#c8f04e' },
                      client_billing: { label: 'Client / Billing', activeColor: '#0d0f14', activeBg: '#c8f04e', activeBorder: '#c8f04e' },
                    }[catKey]
                    const isSelected = newFlagCategory === catKey
                    return (
                      <button
                        key={catKey}
                        onClick={() => setNewFlagCategory(catKey)}
                        style={{
                          flex: 1, padding: '6px 4px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700,
                          letterSpacing: '0.04em', textTransform: 'uppercase',
                          color: isSelected ? catConfig.activeColor : 'var(--text3)',
                          background: isSelected ? catConfig.activeBg : 'transparent',
                          border: isSelected ? `1px solid ${catConfig.activeBorder}` : '1px solid var(--border)',
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
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Note
                </div>
                <textarea
                  value={newFlagText}
                  onChange={e => setNewFlagText(e.target.value)}
                  placeholder="Describe the issue…"
                  rows={3}
                  autoFocus
                  style={{ width: '100%', padding: '8px', fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono', outline: 'none', resize: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Photo */}
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Photo
                </div>
                {newFlagPhotoPreview && (
                  <img
                    src={newFlagPhotoPreview}
                    alt=""
                    style={{ display: 'block', maxHeight: 80, borderRadius: 4, objectFit: 'cover', marginBottom: 8 }}
                  />
                )}
                <label style={{ display: 'inline-block', fontSize: 11, color: 'var(--text2)', cursor: 'pointer', fontFamily: 'DM Mono', padding: '9px 14px', border: '1px dashed var(--border)', borderRadius: 6 }}>
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
            <div style={{ borderTop: '1px solid var(--border)' }} />

            {/* Footer */}
            <div style={{ padding: '12px 20px', display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setAddingFlag(false); setNewFlagText(''); setNewFlagCategory(null); setNewFlagStudio('paramount'); clearNewFlagPhoto() }}
                style={{ flex: 1, padding: '8px', fontSize: 11, fontFamily: 'DM Mono', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text2)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFlag}
                disabled={flagSubmitting || !newFlagText.trim() || !newFlagCategory}
                style={{
                  flex: 1, padding: '8px', fontSize: 11, fontFamily: 'DM Mono',
                  background: newFlagText.trim() && newFlagCategory ? '#c8f04e' : 'var(--surface2)',
                  color: newFlagText.trim() && newFlagCategory ? '#0d0f14' : 'var(--text3)',
                  border: 'none', borderRadius: 6,
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setSelectedFlag(null); setConfirmDeleteFlag(false) } }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 480, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...fullscreenCardOnMobile(isMobile) }}>

            {/* Modal header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              {/* Row 1: status badge + resolve + × */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <StatusBadge status={selectedFlag.status} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selectedFlag.status === 'acknowledged' && (
                    <button
                      onClick={() => setShowResolveModal(true)}
                      disabled={flagSubmitting}
                      style={{ fontSize: 10, fontFamily: 'DM Mono', background: 'transparent', color: '#14B8A6', border: '1px solid #14B8A6', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}
                    >
                      {flagSubmitting ? 'Saving…' : 'Resolve'}
                    </button>
                  )}
                  <button
                    onClick={() => { setSelectedFlag(null); setConfirmDeleteFlag(false) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1, padding: 0 }}
                  >
                    ×
                  </button>
                </div>
              </div>
              {/* Row 2: studio name · category */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'Syne', textTransform: 'uppercase', color: 'var(--text)' }}>
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
                      <span style={{ color: 'var(--text3)', fontSize: 11 }}>·</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
                        {c.label}
                      </span>
                    </>
                  ) : null
                })()}
              </div>
              {/* Row 3: source label */}
              {selectedFlag.source_label && (
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', marginTop: 2, opacity: 0.6 }}>
                  {selectedFlag.source_label}
                </div>
              )}
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Runner note — read only */}
              {selectedFlag.runner_note && (
                <div>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                    Runner Note
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                    {selectedFlag.runner_note}
                  </div>
                </div>
              )}

              {/* Category picker — pill buttons for pending/no category; dropdown for acknowledged */}
              {selectedFlag.category === null && selectedFlag.status === 'pending' && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                    Category
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['facility_general', 'gear_equipment', 'client_billing'] as const).map(catKey => {
                      const catConfig = {
                        facility_general: { label: 'Facility / General', activeColor: '#0d0f14', activeBg: '#c8f04e', activeBorder: '#c8f04e' },
                        gear_equipment: { label: 'Gear / Equipment', activeColor: '#0d0f14', activeBg: '#c8f04e', activeBorder: '#c8f04e' },
                        client_billing: { label: 'Client / Billing', activeColor: '#0d0f14', activeBg: '#c8f04e', activeBorder: '#c8f04e' },
                      }[catKey]
                      const isSelected = pendingCategory === catKey
                      return (
                        <button
                          key={catKey}
                          onClick={() => setPendingCategory(catKey)}
                          style={{
                            flex: 1, padding: '5px 4px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700,
                            letterSpacing: '0.04em', textTransform: 'uppercase',
                            color: isSelected ? catConfig.activeColor : 'var(--text3)',
                            background: isSelected ? catConfig.activeBg : 'transparent',
                            border: isSelected ? `1px solid ${catConfig.activeBorder}` : '1px solid var(--border)',
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
                  style={{ width: '100%', padding: '7px 8px', fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono', outline: 'none', marginBottom: 8 }}
                >
                  <option value="facility_general">Facility / General</option>
                  <option value="gear_equipment">Gear / Equipment</option>
                  <option value="client_billing">Client / Billing</option>
                </select>
              )}


              {/* Resolved box */}
              {selectedFlag.resolved_at && (
                <div style={{ background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#14B8A6', marginBottom: 4 }}>
                    Resolved
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono' }}>
                    {selectedFlag.resolved_by}
                    {selectedFlag.resolved_at && ` · ${new Date(selectedFlag.resolved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                  {selectedFlag.resolved_note && (
                    <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 6, lineHeight: 1.5 }}>
                      {selectedFlag.resolved_note}
                    </div>
                  )}
                  {selectedFlag.resolved_vendor && (
                    <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', marginTop: 4 }}>
                      Vendor: {selectedFlag.resolved_vendor}
                    </div>
                  )}
                  {selectedFlag.resolved_cost != null && (
                    <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', marginTop: 2 }}>
                      Cost: ${selectedFlag.resolved_cost}
                    </div>
                  )}
                </div>
              )}

              {/* Comment thread */}
              {flagComments.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>No updates yet</div>
              ) : (
                flagComments.map(c => (
                  <div key={c.id} style={{ marginBottom: 2 }}>
                    {c.text && (
                      <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{c.text}</div>
                    )}
                    {c.photo_url && (
                      <SignedImage
                        path={c.photo_url}
                        alt=""
                        style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: c.text ? 6 : 0 }}
                      />
                    )}
                    <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4, fontFamily: 'DM Mono' }}>
                      {c.created_by_name && `${c.created_by_name} · `}{fmtTime(c.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--border)' }} />

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
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                  outline: 'none', resize: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 8 }}>
                <label style={{ display: 'inline-block', fontSize: 10, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Mono' }}>
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
                    style={{ fontSize: 10, fontFamily: 'DM Mono', padding: '4px 10px', background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
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
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono' }}>Confirm delete?</span>
                    <button
                      onClick={handleDeleteFlag}
                      style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'DM Mono', background: '#EF4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteFlag(false)}
                      style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'DM Mono', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteFlag(true)}
                    style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'DM Mono', background: 'transparent', color: '#EF4444', border: '1px solid #EF4444', borderRadius: 6, cursor: 'pointer' }}
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
                          padding: '8px 16px', fontSize: 11, fontFamily: 'DM Mono',
                          background: canAck ? '#c8f04e' : 'var(--surface2)',
                          color: canAck ? '#0d0f14' : 'var(--text3)',
                          border: 'none', borderRadius: 6,
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
                        padding: '8px 16px', fontSize: 11, fontFamily: 'DM Mono',
                        background: '#c8f04e',
                        color: '#0d0f14',
                        border: 'none', borderRadius: 6,
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) closeAddTask() }}
        >
          <div style={{ background: '#161920', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, width: '100%', maxWidth: 600, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...fullscreenCardOnMobile(isMobile) }}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>New Task</span>
              <button
                onClick={closeAddTask}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 20, lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }}>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Task Description <span style={{ color: '#EF4444' }}>*</span>
                </div>
                <textarea
                  autoFocus
                  value={newTaskText}
                  onChange={e => setNewTaskText(e.target.value)}
                  placeholder="What needs to be done?"
                  rows={5}
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: 13,
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                    outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5,
                  }}
                />
              </div>
              {canAssign && (
                <div>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                    Assign To
                  </div>
                  <select
                    value={newTaskAssignTo}
                    onChange={e => setNewTaskAssignTo(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 12px', fontSize: 13,
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
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
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Photo
                </div>
                {newTaskPhotoPreview && (
                  <img
                    src={newTaskPhotoPreview}
                    alt=""
                    style={{ display: 'block', maxHeight: 80, borderRadius: 4, objectFit: 'cover', marginBottom: 8 }}
                  />
                )}
                <label style={{ display: 'inline-block', fontSize: 11, color: 'var(--text2)', cursor: 'pointer', fontFamily: 'DM Mono', padding: '9px 14px', border: '1px dashed var(--border)', borderRadius: 6 }}>
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
                    flex: 1, padding: '11px', fontSize: 12, fontFamily: 'DM Mono',
                    background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 6, cursor: 'pointer', color: 'var(--text2)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddTask}
                  disabled={taskSubmitting || !newTaskText.trim()}
                  style={{
                    flex: 1, padding: '11px', fontSize: 12, fontFamily: 'DM Mono',
                    background: newTaskText.trim() ? '#c8f04e' : 'var(--surface2)',
                    color: newTaskText.trim() ? '#0d0f14' : 'var(--text3)',
                    border: 'none', borderRadius: 6,
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowResolveModal(false) }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 420, margin: '0 20px', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...fullscreenCardOnMobile(isMobile) }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>Resolve Flag</span>
              <button
                onClick={() => setShowResolveModal(false)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Resolution Notes <span style={{ color: '#EF4444' }}>*</span>
                </div>
                <textarea
                  value={resolveNote}
                  onChange={e => setResolveNote(e.target.value)}
                  placeholder="Describe what was done…"
                  rows={3}
                  style={{
                    width: '100%', padding: '8px', fontSize: 11,
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                    outline: 'none', resize: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Vendor / Person
                </div>
                <input
                  type="text"
                  value={resolveVendor}
                  onChange={e => setResolveVendor(e.target.value)}
                  placeholder="Vendor or person who fixed it…"
                  style={{
                    width: '100%', padding: '8px', fontSize: 11,
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Cost
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'DM Mono' }}>$</span>
                  <input
                    type="number"
                    value={resolveCost}
                    onChange={e => setResolveCost(e.target.value)}
                    placeholder="0.00"
                    style={{
                      flex: 1, padding: '8px', fontSize: 11,
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => setShowResolveModal(false)}
                  style={{
                    flex: 1, padding: '9px', fontSize: 11, fontFamily: 'DM Mono',
                    background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 6, cursor: 'pointer', color: 'var(--text2)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleResolveFlag}
                  disabled={flagSubmitting || !resolveNote.trim()}
                  style={{
                    flex: 1, padding: '9px', fontSize: 11, fontFamily: 'DM Mono',
                    background: resolveNote.trim() ? '#c8f04e' : 'var(--surface2)',
                    color: resolveNote.trim() ? '#0d0f14' : 'var(--text3)',
                    border: 'none', borderRadius: 6,
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

      {/* BOOKING FORM MODAL */}
      {dashBkFormOpen && dashEditBooking && (
        <BookingForm
          bookingId={dashEditBooking.id}
          booking={dashEditBooking}
          initial={dashFormInitial}
          onSave={handleDashSave}
          onDelete={handleDashDelete}
          onClose={() => { setDashBkFormOpen(false); setDashEditBooking(null) }}
          onSaved={undefined}
        />
      )}

      </div>
    </>
  )
}
