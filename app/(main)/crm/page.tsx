'use client'
import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Lead, LeadStatus, Client, ClientContact, BillingType, StaffMode } from '@/lib/supabase'
import { StaffPicker } from '@/components/shared/StaffPicker'
import { TOUCH_INTERVAL_DAYS } from '@/lib/settings'
import { ContactPicker } from '@/components/shared/ContactPicker'
import { ArtistPicker } from '@/components/shared/ArtistPicker'
import PhoneInput from '@/components/shared/PhoneInput'
import TimeInput from '@/components/shared/TimeInput'
import StudioSelect from '@/components/shared/StudioSelect'
import { RegViewModal, RegField } from '@/components/shared/RegViewModal'
import { combineLocation, parseLocation } from '@/lib/studios'
import { STARTER_TAGS } from '@/lib/tags'
import { StatusDot, NewLeadPulse, statusFillClass } from '@/components/carved'
import { addArtistToLabel } from '@/lib/roster'
import { ClientsPageInner } from '@/app/(main)/clients/page'
import { RegistrationBanner } from '@/components/clients/RegistrationBanner'
import { RegistrationsView } from '@/components/crm/RegistrationsView'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useWebInquiries } from '@/components/notifications/WebInquiryProvider'
import { dbResult } from '@/lib/db'

const STATUS_COLORS: Record<string, string> = {
  hot: 'var(--c-st-hot)', warm: 'var(--c-st-warm)', cold: 'var(--c-fg-3)',
  uncontacted: 'var(--c-st-uncon)', booked: 'var(--c-st-booked)', dead: 'var(--c-fg-3)'
}

// Temperature color per status — used for both the avatar ring and its text.
const LEAD_AVATAR_COLORS: Record<string, string> = {
  hot: 'var(--c-st-hot)',
  warm: 'var(--c-st-warm)',
  uncontacted: 'var(--c-st-uncon)',
  booked: 'var(--c-st-booked)',
  cold: 'var(--c-st-cold)',
  dead: 'var(--c-fg-3)',
}

// Display label per status. DB value stays 'dead'; UI shows "DNB" (Did Not Book),
// mirroring the 'individual'→"COD" convention. Only overrides need entries.
const STATUS_LABELS: Record<string, string> = { dead: 'DNB' }
const statusLabel = (s: string) => STATUS_LABELS[s] || s

// First letter of fname + first letter of lname, uppercased.
function leadInitials(l: { fname?: string | null; lname?: string | null }): string {
  const f = (l.fname || '').trim()[0] || ''
  const ln = (l.lname || '').trim()[0] || ''
  return (f + ln).toUpperCase()
}

// Circular initials avatar for lead-list cards: colored ring + matching text,
// no fill. 36px circle, DM Mono per spec; ring/text keyed to lead temperature.
// Lead temperature IS one of the three things allowed to carry colour (§5) — but
// as a solid fill, never as a ring of coloured text. The 2px temperature ring is
// gone (Law 1: no borders) and the avatar is now a filled status disc with chip
// ink initials, which also makes the heat readable at a glance from further away.
function LeadAvatar({ lead }: { lead: Lead }) {
  return (
    <div
      className={`c-dot ${statusFillClass(lead.status)}`}
      style={{
        width: 36, height: 36, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'DM Mono, monospace', fontSize: 12, fontWeight: 700,
        letterSpacing: '0.02em', color: 'var(--c-chip-ink)',
      }}
    >
      {leadInitials(lead) || '—'}
    </div>
  )
}

// Shared row style for BOTH lead lists (Needs Action + All Leads) — they had
// byte-identical inline style objects, so a change to one silently diverged from
// the other. One definition now.
//
// Carved: a capsule row. Selection is a CARVE, not a tint — the row presses into
// the surface rather than lightening (Law 2: it holds content, so it goes in).
//
// The old `webInquiryPulse` box-shadow ring is gone. It pulsed in the retired
// accent colour, and §9 makes `.c-newpulse` the single animated element in the
// app: a new inquiry now shows the pulse DOT at the head of the row instead.
// `isUnacked` still drives it — WebInquiryProvider owns that set; presentation only.
function leadRowClass(opts: { selected: boolean }): string {
  return `c-row${opts.selected ? ' c-selected' : ''}`
}

function leadRowStyle(opts: { prompting: boolean }): React.CSSProperties {
  return { cursor: 'pointer', marginBottom: opts.prompting ? 0 : 4 }
}

// First letter of display_name's first word + first letter of its last word,
// uppercased. Used to auto-populate staff initials from the logged-in profile.
function profileInitials(displayName: string | null | undefined): string {
  if (!displayName) return ''
  const words = displayName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const first = words[0][0] || ''
  const last = words.length > 1 ? words[words.length - 1][0] || '' : ''
  return (first + last).toUpperCase()
}

function leadNameColor(_l: { billing?: string | null }): string {
  return 'var(--c-fg)'
}

const BOOKING_ICONS: Record<string, string> = {
  'Recording Session': '🎙', 'Filming': '🎬', 'Event/Playback': '🎛'
}

const TOUCH_METHODS = ['Call', 'Text', 'Email'] as const
type TouchMethod = typeof TOUCH_METHODS[number]

const aBtnStyle = (color: string): React.CSSProperties => ({
  padding: '2px 7px', borderRadius: 3, background: 'var(--c-bg)', color, fontFamily: 'Inter', fontSize: 9,
  textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap' as const,
})

const CHART_COLORS = [
  'var(--c-fg)', 'var(--c-st-cold)', 'var(--c-st-hot)', 'var(--c-st-warm)',
  'var(--c-st-booked)', 'var(--c-fg-3)', 'var(--c-st-uncon)', 'var(--c-fg-2)',
]

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 9, color: 'var(--c-fg-3)', letterSpacing: '0.08em',
  textTransform: 'uppercase', marginBottom: 2,
}

function daysSince(d: string) {
  if (!d) return 999
  const n = new Date(d).getTime()
  if (isNaN(n)) return 999
  return Math.floor((Date.now() - n) / 86400000)
}

function fmtActivityTime(ts: string) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

function activityColor(note: string): string {
  const n = (note || '').toLowerCase()
  if (n.includes('call')) return 'var(--c-st-hot)'
  if (n.includes('text')) return 'var(--c-st-warm)'
  if (n.includes('email')) return 'var(--c-st-uncon)'
  if (n.includes('kept hot') || n.includes('keep hot')) return 'var(--c-st-hot)'
  if (n.includes('kept warm') || n.includes('keep warm')) return 'var(--c-st-warm)'
  if (n.includes('registration returned') || n.includes('reg returned')) return 'var(--c-st-booked)'
  if (n.includes('registration') || n.includes('reg link') || n.includes('reg sent')) return 'var(--c-fg)'
  return 'var(--c-fg-2)'
}

type AnalyticsRangePreset = 'all' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'last_year' | 'custom'

// Returns null for 'all' (no filter). Quarters are calendar quarters (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec).
// End of range is always end-of-day (23:59:59.999) so the end date is inclusive.
function getAnalyticsRange(preset: AnalyticsRangePreset, customStart?: string, customEnd?: string): { start: Date; end: Date } | null {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  switch (preset) {
    case 'all': return null
    case 'this_month': return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: endOfDay(now) }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0) // day 0 = last day of prev month
      return { start, end: endOfDay(end) }
    }
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3)
      return { start: new Date(now.getFullYear(), q * 3, 1), end: endOfDay(now) }
    }
    case 'last_quarter': {
      const q = Math.floor(now.getMonth() / 3) - 1
      const year = q < 0 ? now.getFullYear() - 1 : now.getFullYear()
      const qq = (q + 4) % 4
      const start = new Date(year, qq * 3, 1)
      const end = new Date(year, qq * 3 + 3, 0)
      return { start, end: endOfDay(end) }
    }
    case 'this_year': return { start: new Date(now.getFullYear(), 0, 1), end: endOfDay(now) }
    case 'last_year': return { start: new Date(now.getFullYear() - 1, 0, 1), end: endOfDay(new Date(now.getFullYear() - 1, 11, 31)) }
    case 'custom': {
      if (!customStart || !customEnd) return null
      return { start: startOfDay(new Date(customStart + 'T00:00:00')), end: endOfDay(new Date(customEnd + 'T00:00:00')) }
    }
  }
}

const ANALYTICS_RANGE_LABELS: Record<AnalyticsRangePreset, string> = {
  all: 'All Time', this_month: 'This Month', last_month: 'Last Month',
  this_quarter: 'This Quarter', last_quarter: 'Last Quarter',
  this_year: 'This Year', last_year: 'Last Year', custom: 'Custom Range',
}

function fmtDate(d: string) {
  return d ? new Date(d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '—'
}

function fmtDateTime(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).replace(',', '').toLowerCase()
}

function isParked(l: Lead) {
  return !!(l.parked_until && new Date(l.parked_until) > new Date())
}

function isKhuDue(l: Lead) {
  if (!l.keep_hot_until) return daysSince(l.last_contact || l.created_at) >= (l.status === 'hot' ? TOUCH_INTERVAL_DAYS.hot : TOUCH_INTERVAL_DAYS.warm)
  return new Date(l.keep_hot_until) <= new Date()
}

function daysUntilKhu(l: Lead): number | null {
  if (!l.keep_hot_until) return null
  return Math.ceil((new Date(l.keep_hot_until).getTime() - Date.now()) / 86400000)
}

function dateKey(d: string) {
  const dt = new Date(d)
  return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`
}

function dateSepLabel(d: string) {
  const dt = new Date(d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yest = new Date(today); yest.setDate(yest.getDate() - 1)
  const target = new Date(dt); target.setHours(0, 0, 0, 0)
  if (target.getTime() === today.getTime()) return 'Today'
  if (target.getTime() === yest.getTime()) return 'Yesterday'
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtMoney(v: string): string {
  if (!v?.trim()) return ''
  const n = parseFloat(v.replace(/[^0-9.]/g, ''))
  if (isNaN(n)) return v
  return `$${Math.round(n)}`
}

function fmtPhone(v: string): string {
  if (!v) return v
  const d = v.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return v
}

function fmtTime12(t: string | null | undefined): string {
  if (!t) return ''
  if (/\s*(am|pm)$/i.test(t)) return t.trim()
  const parts = t.split(':')
  const h = Number(parts[0])
  const m = Number(parts[1] ?? 0)
  if (isNaN(h)) return ''
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = ((h % 12) || 12)
  return m === 0 ? `${h12}${suffix}` : `${h12}:${m.toString().padStart(2, '0')}${suffix}`
}

function to24h(t12: string): string {
  const match = t12.match(/(\d+):(\d+)\s*(am|pm)/i)
  if (!match) return '00:00'
  let h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  if (/pm/i.test(match[3]) && h !== 12) h += 12
  if (/am/i.test(match[3]) && h === 12) h = 0
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}


function fmtSessionLine(l: Lead): string | null {
  const parts: string[] = []
  if (l.rate_daily) parts.push(`${fmtMoney(l.rate_daily)}/day`)
  else if (l.quote) parts.push(fmtMoney(l.quote))
  if (l.location) parts.push(l.location)
  if (l.session_date) {
    const short = (iso: string) =>
      new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    // Multi-day leads read as a range ("Aug 4–Aug 9"). An end date equal to or
    // earlier than the start is treated as single-day rather than printing a
    // backwards range.
    const endDate = l.session_end_date && l.session_end_date > l.session_date ? l.session_end_date : ''
    const dateStr = endDate ? `${short(l.session_date)}–${short(endDate)}` : short(l.session_date)
    const start = fmtTime12(l.session_start)
    const end = fmtTime12(l.session_end)
    const timeStr = start && end ? `${start}–${end}` : start || end
    parts.push(timeStr ? `${dateStr} ${timeStr}` : dateStr)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

// Compact age for the identity meta line: "2h", "3d", "just now". Mono, lower
// case — it's a measurement, not a label.
function touchAge(iso: string | null | undefined): string {
  if (!iso) return ''
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function getMissing(l: Lead) {
  const m: string[] = []
  if (!l.fname) m.push('first name')
  if (!l.lname) m.push('last name')
  if (!l.email) m.push('email')
  if (!l.phone) m.push('phone')
  if (!l.quote && !l.rate_daily) m.push('quote')
  return m
}

function parseTouchNote(note: string): { initials: string, method: string } {
  const parts = note.split(' - ')
  return { initials: parts[0]?.trim() || '', method: parts[1]?.trim() || '' }
}

function fuzzyMatch(query: string, target: string): boolean {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const t = target.toLowerCase()
  return words.length > 0 && words.every(w => t.includes(w))
}

function groupBy(arr: Lead[], key: keyof Lead): Record<string, number> {
  const result: Record<string, number> = {}
  for (const item of arr) {
    const v = ((item[key] as string) || '').trim() || '—'
    result[v] = (result[v] || 0) + 1
  }
  return result
}

function toSegments(groups: Record<string, number>) {
  return Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }))
}

type TouchMap = Record<number, { initials: string, method: string, created_at: string }>
type CrmView = 'needs-action' | 'all-leads' | 'analytics'
type LabelSuggestion = Client & { _anrName?: string; _anrContactId?: string; _anrEmail?: string | null; _anrPhone?: string | null }

// Universal client search result (label mode) — one row per label / A&R / artist match.
// Mirrors the booking form's combined client search.
type UniSuggestion = {
  clientId: string
  labelName: string
  artist: string
  anrName: string
  anrContactId: string | null
  anrEmail: string | null
  anrPhone: string | null
}

export default function CRMPage() {
  // Carved surfaces paint their own ground. Without this the page sits on the
  // LEGACY background — #0d0f14 in dark, the blue→orange gradient in light —
  // while the panels on top of it are carved paper. Same mount/unmount marker the
  // dashboard uses; every migrated route needs it until the legacy --bg dies.
  useEffect(() => {
    document.documentElement.classList.add('c-page')
    return () => document.documentElement.classList.remove('c-page')
  }, [])

  const [leads, setLeads] = useState<Lead[]>([])
  const [latestTouches, setLatestTouches] = useState<TouchMap>({})
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [view, setView] = useState<CrmView>('all-leads')
  const [loading, setLoading] = useState(true)
  const [emailModal, setEmailModal] = useState(false)
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [focusField, setFocusField] = useState<string | null>(null)
  const [toast, setToast] = useState<{ clientId: string } | null>(null)
  const router = useRouter()
  const isMobile = useIsMobile()
  const { profile } = useUserProfile()
  // Real-time: leadsVersion bumps on any realtime leads INSERT/UPDATE (from the
  // shared WebInquiryProvider channel), so the leads list re-fetches live.
  const { leadsVersion } = useWebInquiries()
  const [tab, setTab] = useState<'leads' | 'clients' | 'registrations' | 'campaigns'>('leads')
  const [initialClientId, setInitialClientId] = useState<string | null>(null)

  // Switch to clients tab if ?clientId= or ?id= is present on load;
  // open the New Lead modal (on the leads tab) if ?newLead=1 (e.g. from the dashboard).
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const cid = params.get('clientId') || params.get('id')
      if (cid) { setTab('clients'); setInitialClientId(cid) }
      if (params.get('newLead') === '1') { setTab('leads'); setNewLeadOpen(true) }
    } catch {}
  }, [])

  // Restore persisted state after mount only — reading sessionStorage in a useState lazy
  // initializer runs on the client before hydration completes, causing a server/client mismatch
  // on style-conditional elements (view tab buttons, selected lead). Same pattern as AllLeadsSection.
  useEffect(() => {
    try {
      const v = sessionStorage.getItem('crm_view') as CrmView
      const s = sessionStorage.getItem('crm_selected')
      if (v) setView(v)
      if (s) setSelectedId(Number(s))
    } catch {}
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem('crm_selected', selectedId != null ? String(selectedId) : '') } catch {}
  }, [selectedId])
  useEffect(() => {
    try { sessionStorage.setItem('crm_view', view) } catch {}
  }, [view])

  const load = useCallback(async () => {
    let allLeads: Lead[] = []
    let from = 0
    const BATCH = 1000
    while (true) {
      const { data, error } = await supabase
        .from('leads').select('*')
        .order('created_at', { ascending: false })
        .range(from, from + BATCH - 1)
      if (error || !data || data.length === 0) break
      allLeads = allLeads.concat(data)
      if (data.length < BATCH) break
      from += BATCH
    }
    const { data: activityData } = await supabase
      .from('lead_activity').select('lead_id, note, created_at')
      .eq('type', 'touch').order('created_at', { ascending: false })
      .range(0, 4999)
    setLeads(allLeads)
    const touchMap: TouchMap = {}
    for (const row of (activityData || [])) {
      if (!touchMap[row.lead_id]) {
        const parsed = parseTouchNote(row.note || '')
        touchMap[row.lead_id] = { ...parsed, created_at: row.created_at }
      }
    }
    setLatestTouches(touchMap)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load, leadsVersion])

  const hasAutoSelected = useRef(false)
  // Pre-select a lead passed via ?lead= (e.g. from the dashboard Needs Action panel).
  // Runs once after leads load; marks hasAutoSelected so the default Needs Action
  // auto-select below doesn't override it. Same window.location pattern as the
  // ?clientId=/?id= handling above (avoids a useSearchParams Suspense boundary).
  const leadParamHandled = useRef(false)
  useEffect(() => {
    if (loading || leadParamHandled.current || leads.length === 0) return
    leadParamHandled.current = true
    try {
      const leadParam = new URLSearchParams(window.location.search).get('lead')
      if (!leadParam) return
      const lead = leads.find(l => l.id === Number(leadParam))
      if (lead) {
        setTab('leads')
        // The detail panel only renders in a list view, so move off analytics.
        setView(v => v === 'analytics' ? 'all-leads' : v)
        setSelectedId(lead.id)
        hasAutoSelected.current = true
      }
    } catch {}
  }, [loading, leads])
  useEffect(() => {
    // On mobile the detail panel replaces the list entirely, so a lead must only
    // open by explicit tap (or the ?lead= deep-link above) — never auto-selected.
    if (isMobile || loading || hasAutoSelected.current || leads.length === 0) return
    const uncontacted = leads.filter(l => l.status === 'uncontacted' || (!l.last_contact && !['booked', 'dead'].includes(l.status)))
    const hotDue = leads.filter(l => l.status === 'hot' && isKhuDue(l) && !isParked(l))
    const warmDue = leads.filter(l => l.status === 'warm' && isKhuDue(l) && !isParked(l))
    // Matches the Needs Action buckets exactly. The old "incomplete" fallback was
    // dropped with that tab — it only ever re-listed hot/warm/uncontacted leads.
    const first = uncontacted[0] || hotDue[0] || warmDue[0]
    if (first) { setSelectedId(first.id); hasAutoSelected.current = true }
  }, [loading, leads, isMobile])

  async function markTouched(id: number, initials: string, method: TouchMethod, notes = '', statusOverride?: string) {
    const now = new Date().toISOString()
    const lead = leads.find(l => l.id === id)
    const updateData: Partial<Lead> = { last_contact: now, needs_contact: false }
    if (statusOverride) {
      updateData.status = statusOverride as LeadStatus
      if (statusOverride === 'hot') {
        const khu = new Date(); khu.setDate(khu.getDate() + 5)
        updateData.keep_hot_until = khu.toISOString()
      } else if (statusOverride === 'warm') {
        const khu = new Date(); khu.setDate(khu.getDate() + 3)
        updateData.keep_hot_until = khu.toISOString()
      }
    } else if (lead?.status === 'uncontacted') {
      updateData.status = 'hot'
      const khu = new Date(); khu.setDate(khu.getDate() + 5)
      updateData.keep_hot_until = khu.toISOString()
    }
    const activityNote = notes.trim() ? `${initials} - ${method} - ${notes.trim()}` : `${initials} - ${method}`
    const { error: e1 } = await supabase.from('leads').update(updateData).eq('id', id)
    if (!dbResult('Logging contact', e1)) return
    const { error: e2 } = await supabase.from('lead_activity').insert({ lead_id: id, type: 'touch', note: activityNote })
    dbResult('Saving activity note', e2)
    await load()
  }

  async function keepHot(id: number, initials: string, notes = '', status?: string) {
    const lead = leads.find(l => l.id === id)
    const isWarm = (status || lead?.status) === 'warm'
    const label = isWarm ? 'Kept Warm' : 'Kept Hot'
    const days = isWarm ? 3 : 5
    const now = new Date().toISOString()
    const keepHotUntil = new Date(); keepHotUntil.setDate(keepHotUntil.getDate() + days)
    const activityNote = notes.trim() ? `${initials} - ${label} - ${notes.trim()}` : `${initials} - ${label}`
    const { error: e1 } = await supabase.from('leads').update({ last_contact: now, keep_hot_until: keepHotUntil.toISOString() }).eq('id', id)
    if (!dbResult(label, e1)) return
    const { error: e2 } = await supabase.from('lead_activity').insert({ lead_id: id, type: 'touch', note: activityNote })
    dbResult('Saving activity note', e2)
    await load()
  }

  async function markDead(id: number, initials: string) {
    const { error: e1 } = await supabase.from('leads').update({ status: 'dead' }).eq('id', id)
    if (!dbResult('Marking DNB', e1)) return
    const { error: e2 } = await supabase.from('lead_activity').insert({ lead_id: id, type: 'touch', note: `${initials} - Marked DNB` })
    dbResult('Saving activity note', e2)
    await load()
  }

  async function markDidNotAnswer(id: number, initials: string) {
    const { error } = await supabase.from('leads').update({ needs_contact: false }).eq('id', id)
    if (!dbResult('Updating lead', error)) return
    await load()
  }

  async function createLead(data: Partial<Lead>) {
    const insertData: Partial<Lead> = { ...data, created_by: profile?.id ?? null }
    // A blank end date means "single day" — persist NULL rather than '', so every
    // range check (session_end_date > session_date) sees an absent value instead
    // of an empty string that sorts before every real date.
    if (!insertData.session_end_date) insertData.session_end_date = null
    // "Role chosen, person TBD" is normal — store NULL rather than an empty
    // string so the WO seed sees an absent name instead of a blank one.
    if (!insertData.staff_name) insertData.staff_name = null
    if (!insertData.staff_role) insertData.staff_role = 'assistant'
    if (!insertData.status) insertData.status = 'uncontacted'
    if (insertData.status === 'hot') {
      const khu = new Date(); khu.setDate(khu.getDate() + 5)
      insertData.keep_hot_until = khu.toISOString()
    } else if (insertData.status === 'warm') {
      const khu = new Date(); khu.setDate(khu.getDate() + 3)
      insertData.keep_hot_until = khu.toISOString()
    }
    const { data: rows, error } = await supabase.from('leads').insert(insertData).select('id').single()
    if (!dbResult('Creating lead', error)) return null
    await load()
    return (rows as { id: number } | null)?.id ?? null
  }

  const selected = leads.find(l => l.id === selectedId) || null

  async function updateStatus(id: number, status: string) {
    const { error } = await supabase.from('leads').update({ status }).eq('id', id)
    if (!dbResult('Updating status', error)) return
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status: status as LeadStatus } : l))
  }

  function selectAndFocus(id: number, field?: string) {
    setSelectedId(id)
    if (field) setFocusField(field)
  }

  const distinctLabels = Array.from(new Set(leads.map(l => l.label).filter((v): v is string => !!v))).sort()
  const distinctCompanies = Array.from(new Set(leads.map(l => l.company).filter((v): v is string => !!v))).sort()
  const allTags = Array.from(new Set([...STARTER_TAGS, ...leads.flatMap(l => l.tags || [])])).sort((a, b) => a.localeCompare(b))

  // Badge count for the Needs Action tab — must mirror NeedsActionSection's
  // buckets exactly. The old "incomplete" term was dropped along with that tab:
  // its leads were already counted in the three below, so the badge overstated
  // the real queue.
  const naUncontacted = leads.filter(l => (l.status === 'uncontacted' || (!l.last_contact && !['booked', 'dead'].includes(l.status))) && l.needs_contact !== false)
  const naHot = leads.filter(l => l.status === 'hot' && isKhuDue(l) && !isParked(l) && l.needs_contact !== false)
  const naWarm = leads.filter(l => l.status === 'warm' && isKhuDue(l) && !isParked(l) && l.needs_contact !== false)
  const needsActionCount = naUncontacted.length + naHot.length + naWarm.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px - 24px)' }}>
      {emailModal && selected && <EmailModal lead={selected} onClose={() => setEmailModal(false)} />}
      {newLeadOpen && (
        <NewLeadModal
          leads={leads}
          onClose={() => setNewLeadOpen(false)}
          onSave={async (data) => { const id = await createLead(data); setNewLeadOpen(false); return id }}
        />
      )}

      {/* Pending registrations — page level, above the tabs, so a returned
          registration is visible while working leads. (It used to live inside
          ClientsPageInner and only appeared on the CLIENTS tab.) */}
      <RegistrationBanner
        onNavigate={(clientId) => { setTab('clients'); setInitialClientId(clientId) }}
      />

      {/* LEADS / CLIENTS / REGISTRATIONS / CAMPAIGNS toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexShrink: 0, flexWrap: 'wrap' }}>
        {(['leads', 'clients', 'registrations', ...(profile?.role === 'owner' && (profile?.email === 'srv2129@gmail.com' || profile?.email === 'eli@paramountrecording.com') ? ['campaigns'] : [])] as const).map((t: 'leads' | 'clients' | 'registrations' | 'campaigns') => (
          <button key={t} onClick={() => setTab(t)} className={`c-soft c-control c-raised${tab === t ? ' c-on' : ''}`} style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.05em' }}>
            {t === 'leads' ? 'Leads' : t === 'clients' ? 'Clients' : t === 'registrations' ? 'Registrations' : 'Campaigns'}
          </button>
        ))}
      </div>

      {tab === 'leads' && (
        <>
          {/* Sub-nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'nowrap', marginBottom: 14, flexShrink: 0 }}>
            <div className={isMobile ? 'hide-scrollbar' : undefined} style={{ display: 'flex', gap: 6, maxWidth: '100%', flex: isMobile ? 1 : undefined, minWidth: isMobile ? 0 : undefined, overflowX: isMobile ? 'auto' : undefined }}>
              {(['needs-action', 'all-leads', 'analytics'] as CrmView[]).map(v => {
                const labels: Record<CrmView, string> = { 'needs-action': 'Needs Action', 'all-leads': 'All Leads', 'analytics': 'Analytics' }
                const active = view === v
                return (
                  <button key={v} onClick={() => setView(v)} className={`c-soft c-control c-raised${active ? ' c-on' : ''}`} style={{ position: 'relative', flexShrink: 0 }}>
                    {labels[v]}
                    {v === 'needs-action' && needsActionCount > 0 && (
                      <span className="c-count" style={{ marginLeft: 6 }}>
                        {needsActionCount > 99 ? '99+' : needsActionCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {view !== 'analytics' && (
              <button onClick={() => setNewLeadOpen(true)} className="c-btn c-control c-raised-primary" style={{ minHeight: isMobile ? 44 : undefined, flexShrink: 0 }}>+ New Lead</button>
            )}
          </div>

          {(view === 'needs-action' || view === 'all-leads') && (
            // On mobile this is a single-panel flow: the list and the detail panel
            // never show at once — the list is hidden once a lead is selected, and
            // the detail panel is hidden until one is. On desktop both render in the
            // unchanged 60/40 two-column grid.
            <div style={isMobile
              ? { display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }
              : { display: 'grid', gridTemplateColumns: '60fr 40fr', gap: 14, flex: 1, minHeight: 0 }}>
              {!(isMobile && selected) && (
                view === 'needs-action' ? (
                  <NeedsActionSection
                    leads={leads}
                    latestTouches={latestTouches}
                    selectedId={selectedId}
                    onSelect={selectAndFocus}
                    onMarkTouched={markTouched}
                    onKeepHot={keepHot}
                    onUpdateStatus={updateStatus}
                    loading={loading}
                    isMobile={isMobile}
                  />
                ) : (
                  <AllLeadsView
                    leads={leads}
                    latestTouches={latestTouches}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onMarkTouched={markTouched}
                    onKeepHot={keepHot}
                    onUpdateStatus={updateStatus}
                    loading={loading}
                  />
                )
              )}

              {/* Detail panel — full-screen on mobile, right column on desktop */}
              {(!isMobile || selected) && (
                <div className="c-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, flex: isMobile ? 1 : undefined }}>
                  {isMobile && selected && (
                    <button
                      onClick={() => setSelectedId(null)}
                      className="c-soft c-control c-raised" style={{ alignSelf: 'flex-start', margin: '0 0 10px', minHeight: 44, flexShrink: 0 }}
                    >
                      ← Leads
                    </button>
                  )}
                  {!selected ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--c-fg-3)', fontSize: 11 }}>
                      Select a lead to view details
                    </div>
                  ) : (
                    <div style={{ overflowY: 'auto', flex: 1, padding: '14px 16px 16px' }}>
                      <LeadDetail
                        key={selected.id}
                        lead={selected}
                        missing={getMissing(selected)}
                        latestTouch={latestTouches[selected.id]}
                        focusField={focusField}
                        onFocusConsumed={() => setFocusField(null)}
                        distinctLabels={distinctLabels}
                        distinctCompanies={distinctCompanies}
                        allTags={allTags}
                        onUpdate={(field, val) => {
                          setLeads(prev => prev.map(l => l.id === selected.id ? { ...l, [field]: val } : l))
                        }}
                        onSendEmail={() => setEmailModal(true)}
                        onDelete={() => {
                          setLeads(prev => prev.filter(l => l.id !== selected.id))
                          setSelectedId(null)
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {view === 'analytics' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <AnalyticsView leads={leads} />
            </div>
          )}
        </>
      )}

      {tab === 'clients' && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <Suspense>
            <ClientsPageInner initialClientId={initialClientId} embedded />
          </Suspense>
        </div>
      )}

      {tab === 'registrations' && (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <RegistrationsView />
        </div>
      )}

      {tab === 'campaigns' && profile?.role === 'owner' && (profile?.email === 'srv2129@gmail.com' || profile?.email === 'eli@paramountrecording.com') && (
        <CampaignsPanel leads={leads} allTags={allTags} profile={profile} />
      )}
    </div>
  )
}

// ─── Campaigns panel ──────────────────────────────────────────────────────────

function CampaignsPanel({ leads, allTags, profile }: {
  leads: Lead[]
  allTags: string[]
  profile: import('@/lib/supabase').UserProfile
}) {
  // Segment filters
  const [segTags, setSegTags] = useState<string[]>([])
  const [segStatuses, setSegStatuses] = useState<LeadStatus[]>([])
  const [segBilling, setSegBilling] = useState<'COD' | 'Billing' | ''>('')

  // Compose
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  // UI state
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [history, setHistory] = useState<import('@/lib/supabase').EmailCampaign[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Compute recipient list from current leads
  const recipients = leads.filter(l => {
    if (l.email_opt_out) return false
    if (!l.email) return false
    if (segStatuses.length > 0 && !segStatuses.includes(l.status)) return false
    // exclude dead/DNB unless explicitly selected
    if (segStatuses.length === 0 && l.status === 'dead') return false
    if (segBilling && l.billing !== segBilling) return false
    if (segTags.length > 0 && !segTags.every(t => (l.tags || []).includes(t))) return false
    return true
  })

  // Dedupe by email
  const seen = new Set<string>()
  const uniqueRecipients = recipients.filter(l => {
    const key = l.email.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key); return true
  })

  async function loadHistory() {
    setHistoryLoading(true)
    const { data } = await supabase.from('email_campaigns').select('*').order('sent_at', { ascending: false }).limit(20)
    setHistory((data || []) as import('@/lib/supabase').EmailCampaign[])
    setHistoryLoading(false)
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim() || uniqueRecipients.length === 0 || sending) return
    setSending(true)
    setSendResult(null)
    try {
      const res = await fetch('/api/send-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          recipients: uniqueRecipients.map(l => ({ email: l.email, name: `${l.fname} ${l.lname}`.trim() })),
          segment_tags: segTags,
          segment_statuses: segStatuses,
          segment_billing: segBilling || null,
          sent_by: profile.display_name,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setSendResult({ ok: true, message: `Sent to ${json.sent} recipient${json.sent !== 1 ? 's' : ''}${json.failed > 0 ? ` · ${json.failed} failed` : ''}` })
        setSubject('')
        setBody('')
        if (historyOpen) loadHistory()
      } else {
        setSendResult({ ok: false, message: json.error || 'Send failed' })
      }
    } catch (e) {
      setSendResult({ ok: false, message: 'Network error — try again' })
    }
    setSending(false)
  }

  const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
    { value: 'hot', label: 'Hot' },
    { value: 'warm', label: 'Warm' },
    { value: 'cold', label: 'Cold' },
    { value: 'uncontacted', label: 'Uncontacted' },
    { value: 'booked', label: 'Booked' },
    { value: 'dead', label: 'DNB' },
  ]

  const sectionLabel: React.CSSProperties = { fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 8, display: 'block' }
  const chipBase: React.CSSProperties = { borderRadius: 20, padding: '3px 10px', fontSize: 10, fontFamily: 'Inter', cursor: 'pointer', background: 'transparent', color: 'var(--c-fg-3)', transition: 'all 0.12s' }
  const chipActive: React.CSSProperties = { ...chipBase, background: 'var(--c-wash2)', color: 'var(--c-fg)' }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 40 }}>

      {/* ── Segment picker ── */}
      <div style={{ background: 'var(--c-bg)', borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 13, marginBottom: 16 }}>Segment</div>

        {/* Status */}
        <div style={{ marginBottom: 14 }}>
          <span style={sectionLabel}>Lead Status</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {STATUS_OPTIONS.map(s => {
              const active = segStatuses.includes(s.value)
              return (
                <button key={s.value} onClick={() => setSegStatuses(prev => active ? prev.filter(x => x !== s.value) : [...prev, s.value])} style={active ? chipActive : chipBase}>
                  {s.label}
                </button>
              )
            })}
          </div>
          {segStatuses.length === 0 && <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 5 }}>All statuses (except Dead)</div>}
        </div>

        {/* Billing */}
        <div style={{ marginBottom: 14 }}>
          <span style={sectionLabel}>Billing Type</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['', 'COD', 'Billing'] as const).map(b => {
              const active = segBilling === b
              return (
                <button key={b} onClick={() => setSegBilling(b)} style={active ? chipActive : chipBase}>
                  {b === '' ? 'All' : b}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tags */}
        <div>
          <span style={sectionLabel}>Tags</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allTags.map(tag => {
              const active = segTags.includes(tag)
              return (
                <button key={tag} onClick={() => setSegTags(prev => active ? prev.filter(t => t !== tag) : [...prev, tag])} style={active ? chipActive : chipBase}>
                  {tag}
                </button>
              )
            })}
          </div>
          {segTags.length === 0 && <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 5 }}>All tags</div>}
        </div>
      </div>

      {/* ── Recipient preview ── */}
      <div style={{ background: 'var(--c-bg)', borderRadius: 10, padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 30, letterSpacing: '-0.025em', color: uniqueRecipients.length === 0 ? 'var(--c-fg-3)' : 'var(--c-fg)' }}>{uniqueRecipients.length}</span>
            <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--c-fg-3)', marginLeft: 8 }}>recipient{uniqueRecipients.length !== 1 ? 's' : ''} match this segment</span>
          </div>
          {uniqueRecipients.length > 0 && (
            <button onClick={() => setPreviewOpen(o => !o)} style={{ background: 'none', color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 10, cursor: 'pointer', padding: 0 }}>
              {previewOpen ? 'Hide list ▲' : 'Preview list ▼'}
            </button>
          )}
        </div>
        {previewOpen && (
          <div style={{ marginTop: 12, maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {uniqueRecipients.map(l => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 11, fontFamily: 'Inter' }}>
                <span style={{ color: 'var(--c-fg)', minWidth: 140 }}>{l.fname} {l.lname}</span>
                <span style={{ color: 'var(--c-fg-3)' }}>{l.email}</span>
                {(l.tags || []).length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(l.tags || []).map(t => <span key={t} style={{ fontSize: 9, background: 'var(--c-wash)', borderRadius: 10, padding: '1px 6px', color: 'var(--c-fg-3)' }}>{t}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Compose ── */}
      <div style={{ background: 'var(--c-bg)', borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 13, marginBottom: 16 }}>Compose</div>
        <div style={{ marginBottom: 10 }}>
          <span style={sectionLabel}>Subject</span>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="e.g. Studio availability this month at Paramount"
            className="c-input c-inset2" style={{ fontSize: 12 }}
          />
        </div>
        <div>
          <span style={sectionLabel}>Body</span>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={`Hi [First Name],\n\nJust wanted to reach out…`}
            rows={10}
            className="c-textarea c-inset2" style={{ fontSize: 12, resize: 'vertical' }}
          />
          <div style={{ fontSize: 9, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 4 }}>Use [First Name] to personalize — it will be replaced per recipient.</div>
        </div>
      </div>

      {/* ── Send ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sendResult && (
          <div style={{ padding: '10px 14px', borderRadius: 6, background: sendResult.ok ? 'rgba(20,184,166,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${sendResult.ok ? 'rgba(20,184,166,0.3)' : 'rgba(239,68,68,0.3)'}`, fontSize: 11, fontFamily: 'Inter', color: sendResult.ok ? 'var(--c-st-booked)' : 'var(--c-st-hot)' }}>
            {sendResult.message}
          </div>
        )}
        <button
          onClick={handleSend}
          disabled={sending || !subject.trim() || !body.trim() || uniqueRecipients.length === 0}
          style={{ padding: '11px 0', background: 'var(--c-fg)', color: 'var(--c-bg)', borderRadius: 8, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: (sending || !subject.trim() || !body.trim() || uniqueRecipients.length === 0) ? 'not-allowed' : 'pointer', opacity: (sending || !subject.trim() || !body.trim() || uniqueRecipients.length === 0) ? 0.5 : 1, transition: 'opacity 0.15s' }}
        >
          {sending ? 'Sending…' : `Send to ${uniqueRecipients.length} Recipient${uniqueRecipients.length !== 1 ? 's' : ''}`}
        </button>
      </div>

      {/* ── History ── */}
      <div>
        <button
          onClick={() => { setHistoryOpen(o => !o); if (!historyOpen) loadHistory() }}
          style={{ background: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          <span style={{ fontSize: 9, transform: historyOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
          Campaign History
        </button>
        {historyOpen && (
          <div style={{ marginTop: 12 }}>
            {historyLoading ? (
              <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>Loading…</div>
            ) : history.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>No campaigns sent yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map(c => (
                  <div key={c.id} style={{ background: 'var(--c-bg)', borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                      <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 12, color: 'var(--c-fg)' }}>{c.subject}</div>
                      <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'DM Mono', whiteSpace: 'nowrap' }}>{new Date(c.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>
                      {c.recipient_count} recipient{c.recipient_count !== 1 ? 's' : ''} · sent by {c.sent_by}
                      {c.segment_tags.length > 0 && <> · tags: {c.segment_tags.join(', ')}</>}
                      {c.segment_billing && <> · {c.segment_billing}</>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Touch prompt ─────────────────────────────────────────────────────────────

function TouchPrompt({ leadId, phone, email, onSubmit, onCancel }: {
  leadId: number
  phone?: string | null
  email?: string | null
  onSubmit: (id: number, initials: string, method: TouchMethod, notes: string) => Promise<void>
  onCancel: () => void
}) {
  const { profile } = useUserProfile()
  const myInitials = profile?.initials || profileInitials(profile?.display_name)
  const [method, setMethod] = useState<TouchMethod | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = myInitials.length > 0 && method !== null

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    await onSubmit(leadId, myInitials, method!, notes)
    setSubmitting(false)
  }

  const methodDefs: { m: TouchMethod; actionHref?: string; actionLabel?: string }[] = [
    { m: 'Call',  actionHref: phone ? `tel:${phone.replace(/\D/g, '')}` : undefined,  actionLabel: '→ Dial' },
    { m: 'Text',  actionHref: phone ? `sms:${phone.replace(/\D/g, '')}` : undefined,  actionLabel: '→ Text' },
    { m: 'Email', actionHref: email ? `mailto:${email}` : undefined, actionLabel: '→ Mail' },
  ]

  return (
    <div onClick={e => e.stopPropagation()} style={{ padding: '10px 16px 12px 38px', background: 'var(--c-wash)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Row 1: initials + method buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div
          title="Logged in as"
          className="c-input c-inset2" style={{ width: 70, padding: '6px 10px', fontSize: 12, textAlign: 'center', letterSpacing: '0.12em' }}
        >
          {myInitials || '—'}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {methodDefs.map(({ m, actionHref, actionLabel }) => {
            const active = method === m
            return (
              <React.Fragment key={m}>
                <button onClick={() => setMethod(active ? null : m)} style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase', border: `1px solid ${active ? 'var(--c-fg)' : 'var(--c-wash2)'}`, background: 'transparent', color: active ? 'var(--c-fg)' : 'var(--c-fg-3)', transition: 'all 0.1s' }}>
                  {m}
                </button>
                {active && actionHref && (
                  <a href={actionHref} style={{ padding: '3px 8px', borderRadius: 4, background: 'transparent', color: 'var(--c-fg-2)', fontSize: 8, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.05em', textTransform: 'uppercase', textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {actionLabel}
                  </a>
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>
      <textarea
        value={notes} onChange={e => setNotes(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
        placeholder="Optional: add context about this touch"
        rows={2}
        style={{ width: '100%', background: 'var(--c-bg)', color: 'var(--c-fg)', padding: '5px 8px', borderRadius: 4, fontFamily: 'Inter', fontSize: 11, outline: 'none', resize: 'none', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={{ padding: '4px 14px', background: canSubmit ? 'var(--c-fg)' : 'var(--c-bg)', color: canSubmit ? 'var(--c-bg)' : 'var(--c-fg-3)', border: `1px solid ${canSubmit ? 'var(--c-fg)' : 'var(--c-wash2)'}`, borderRadius: 4, fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, cursor: canSubmit ? 'pointer' : 'not-allowed', letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'all 0.15s' }}>
          {submitting ? '…' : 'Log Touch'}
        </button>
        <button onClick={onCancel} style={{ padding: '4px 10px', background: 'transparent', color: 'var(--c-fg-3)', borderRadius: 4, fontSize: 9, fontFamily: 'Inter', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Keep Hot prompt ──────────────────────────────────────────────────────────

function KeepHotPrompt({ leadId, onSubmit, onCancel, label = 'Keep Hot', status = 'hot' }: {
  leadId: number
  onSubmit: (id: number, initials: string, notes: string) => Promise<void>
  onCancel: () => void
  label?: string
  status?: string
}) {
  const { profile } = useUserProfile()
  const myInitials = profile?.initials || profileInitials(profile?.display_name)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = myInitials.length > 0
  const color = status === 'warm' ? 'var(--c-st-warm)' : 'var(--c-st-hot)'
  const bgTint = status === 'warm' ? 'rgba(249,115,22,0.07)' : 'rgba(239,68,68,0.07)'

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    await onSubmit(leadId, myInitials, notes)
    setSubmitting(false)
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{ padding: '10px 16px 12px 38px', background: bgTint, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          title="Logged in as"
          className="c-input c-inset2" style={{ width: 70, padding: '6px 10px', fontSize: 12, textAlign: 'center', letterSpacing: '0.12em' }}
        >
          {myInitials || '—'}
        </div>
        <span style={{ fontSize: 10, color, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <textarea
        value={notes} onChange={e => setNotes(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
        placeholder="Optional: add context (e.g. waiting on budget approval)"
        rows={2}
        style={{ width: '100%', background: 'var(--c-bg)', color: 'var(--c-fg)', padding: '5px 8px', borderRadius: 4, fontFamily: 'Inter', fontSize: 11, outline: 'none', resize: 'none', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={{ padding: '4px 14px', background: canSubmit ? color : 'var(--c-bg)', color: canSubmit ? '#fff' : 'var(--c-fg-3)', border: `1px solid ${canSubmit ? color : 'var(--c-wash2)'}`, borderRadius: 4, fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, cursor: canSubmit ? 'pointer' : 'not-allowed', letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'all 0.15s' }}>
          {submitting ? '…' : label}
        </button>
        <button onClick={onCancel} style={{ padding: '4px 10px', background: 'transparent', color: 'var(--c-fg-3)', borderRadius: 4, fontSize: 9, fontFamily: 'Inter', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Dead Lead prompt ─────────────────────────────────────────────────────────

function DeadLeadPrompt({ leadId, onSubmit, onCancel }: {
  leadId: number
  onSubmit: (id: number, initials: string) => Promise<void>
  onCancel: () => void
}) {
  const { profile } = useUserProfile()
  const myInitials = profile?.initials || profileInitials(profile?.display_name)
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = myInitials.length > 0

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    await onSubmit(leadId, myInitials)
    setSubmitting(false)
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{ padding: '10px 16px 12px 38px', background: 'rgba(58,63,82,0.5)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginRight: 4 }}>Mark DNB?</span>
      <div
        title="Logged in as"
        className="c-input c-inset2" style={{ width: 70, padding: '6px 10px', fontSize: 12, textAlign: 'center', letterSpacing: '0.12em' }}
      >
        {myInitials || '—'}
      </div>
      <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={{ padding: '4px 14px', background: canSubmit ? 'var(--c-st-dead)' : 'var(--c-bg)', color: canSubmit ? 'var(--c-fg-2)' : 'var(--c-fg-3)', border: `1px solid ${canSubmit ? 'var(--c-wash2)' : 'var(--c-wash2)'}`, borderRadius: 4, fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, cursor: canSubmit ? 'pointer' : 'not-allowed', letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'all 0.15s' }}>
        {submitting ? '…' : 'Confirm'}
      </button>
      <button onClick={onCancel} style={{ padding: '4px 10px', background: 'transparent', color: 'var(--c-fg-3)', borderRadius: 4, fontSize: 9, fontFamily: 'Inter', cursor: 'pointer' }}>
        Cancel
      </button>
    </div>
  )
}

// ─── Needs Action section ─────────────────────────────────────────────────────

// Needs Action buckets. There was a fourth "Incomplete" tab; it was removed as
// redundant — every lead it listed was already sitting in Uncontacted, Hot or
// Warm (its filter was literally those three statuses plus a missing-field
// check), so it double-counted the queue and inflated the header total. Missing
// fields still surface on the lead itself via getMissing().
type NeedsActionTab = 'uncontacted' | 'hot' | 'warm'
const NEEDS_ACTION_TABS: NeedsActionTab[] = ['uncontacted', 'hot', 'warm']

function NeedsActionSection({ leads, latestTouches, selectedId, onSelect, onMarkTouched, onKeepHot, onUpdateStatus, loading, isMobile }: {
  leads: Lead[]
  latestTouches: TouchMap
  selectedId: number | null
  onSelect: (id: number, field?: string) => void
  onMarkTouched: (id: number, initials: string, method: TouchMethod, notes: string, statusOverride?: string) => Promise<void>
  onKeepHot: (id: number, initials: string, notes: string, status?: string) => Promise<void>
  onUpdateStatus: (id: number, status: string) => Promise<void>
  loading: boolean
  isMobile?: boolean
}) {
  // Same unacked set the dashboard pulses on — a web inquiry should be just as
  // obvious in the CRM list as it is on the dashboard, since the CRM is where
  // it actually gets worked.
  const { isUnacked } = useWebInquiries()
  const [activeTab, setActiveTab] = useState<NeedsActionTab>('uncontacted')
  useEffect(() => {
    try {
      // Guard the restore: a session saved before the Incomplete tab was removed
      // still holds 'incomplete', which would select a bucket that no longer
      // exists and crash on activeBucket.
      const stored = sessionStorage.getItem('crm_na_tab') as NeedsActionTab
      if (stored && NEEDS_ACTION_TABS.includes(stored)) setActiveTab(stored)
    } catch {}
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem('crm_na_tab', activeTab) } catch {}
  }, [activeTab])
  const [touchPromptId, setTouchPromptId] = useState<number | null>(null)
  const [keepHotPromptId, setKeepHotPromptId] = useState<number | null>(null)

  const uncontacted = leads.filter(l => (l.status === 'uncontacted' || (!l.last_contact && !['booked', 'dead'].includes(l.status))) && l.needs_contact !== false)
  const hotDue = leads.filter(l => l.status === 'hot' && isKhuDue(l) && !isParked(l) && l.needs_contact !== false)
  const warmDue = leads.filter(l => l.status === 'warm' && isKhuDue(l) && !isParked(l) && l.needs_contact !== false)
  const totalCount = uncontacted.length + hotDue.length + warmDue.length

  const tabs: { key: NeedsActionTab; label: string; color: string; items: Lead[]; emptyMsg: string }[] = [
    { key: 'uncontacted', label: 'Uncontacted', color: 'var(--c-st-uncon)', items: uncontacted, emptyMsg: 'No fresh uncontacted leads.' },
    { key: 'hot', label: 'Hot', color: 'var(--c-st-hot)', items: hotDue, emptyMsg: 'All hot leads are up to date.' },
    { key: 'warm', label: 'Warm', color: 'var(--c-st-warm)', items: warmDue, emptyMsg: 'All warm leads are up to date.' },
  ]
  const activeBucket = tabs.find(t => t.key === activeTab)!

  // Auto-select first lead when switching tabs
  const didMountRef = useRef(false)
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return }
    setTouchPromptId(null)
    setKeepHotPromptId(null)
    // On mobile, auto-selecting on tab switch would yank the user into the detail
    // view just for changing filters — keep them in the list until they tap a lead.
    if (isMobile) return
    const items = tabs.find(t => t.key === activeTab)?.items || []
    if (items[0]) onSelect(items[0].id)
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="c-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div style={{ flexShrink: 0 }}>
        <SectionHeader carved title="Needs Action" count={totalCount > 0 ? totalCount : undefined} />
        {/* Tab bar */}
        <div className={isMobile ? 'hide-scrollbar' : undefined} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', overflowX: isMobile ? 'auto' : undefined }}>
          {tabs.map(tab => {
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`c-soft c-soft-sm c-control c-raised${active ? ' c-on' : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <StatusDot status={tab.key} />
                {tab.label} ({tab.items.length})
              </button>
            )
          })}
        </div>
      </div>
      {/* Content */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div className="c-sub" style={{ padding: 20, textAlign: 'center' }}>Loading…</div>
        ) : activeBucket.items.length === 0 ? (
          <div className="c-sub" style={{ padding: 20, textAlign: 'center' }}>{activeBucket.emptyMsg}</div>
        ) : activeBucket.items.map(l => {
          const touch = latestTouches[l.id]
          const isTouchPrompting = touchPromptId === l.id
          const isKeepHotPrompting = keepHotPromptId === l.id
          const isPrompting = isTouchPrompting || isKeepHotPrompting
          const keepColor = l.status === 'warm' ? 'var(--c-st-warm)' : 'var(--c-st-hot)'
          return (
            <React.Fragment key={l.id}>
              <div onClick={() => onSelect(l.id)} className={leadRowClass({ selected: selectedId === l.id })} style={leadRowStyle({ prompting: isPrompting })}>
                {isUnacked(l.id) && <NewLeadPulse />}
                <LeadAvatar lead={l} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: leadNameColor(l) }}>
                    {l.label && l.artist_name
                      ? <>{l.label} <span style={{ color: 'var(--c-fg-3)' }}>/</span> {l.fname} {l.lname} <span style={{ color: 'var(--c-fg-3)' }}>/</span> {l.artist_name}</>
                      : l.artist_name && !l.label
                        ? <>{l.fname} {l.lname} <span style={{ color: 'var(--c-fg-3)' }}>·</span> {l.artist_name}</>
                        : <>{l.fname} {l.lname}{l.company && <span style={{ color: 'var(--c-fg-3)', fontWeight: 400 }}> · {l.company}</span>}</>}
                  </div>
                  {fmtSessionLine(l) && (
                    <div style={{ fontSize: 10, color: 'var(--c-fg-2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fmtSessionLine(l)}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--c-fg-2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.booking && <span>{BOOKING_ICONS[l.booking] || ''} {l.booking} · </span>}
                    {activeBucket.key === 'uncontacted'
                      ? <span style={{ color: 'var(--c-fg-3)' }}>never contacted · added {fmtDate(l.created_at)}</span>
                      : <>{daysSince(l.last_contact || l.created_at)}d ago{touch?.initials && <span style={{ color: 'var(--c-fg-2)' }}> · {touch.initials}{touch.method ? ` via ${touch.method}` : ''}</span>}</>}
                  </div>
                </div>
                {(l.status === 'hot' || l.status === 'warm') && daysUntilKhu(l) !== null && (daysUntilKhu(l) as number) <= 1 && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setTouchPromptId(null)
                      setKeepHotPromptId(isKeepHotPrompting ? null : l.id)
                    }}
                    style={{ flexShrink: 0, padding: '3px 8px', background: 'transparent', color: 'var(--c-fg)', borderRadius: 4, fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {isKeepHotPrompting ? 'Cancel' : l.status === 'warm' ? 'Keep Warm?' : 'Keep Hot?'}
                  </button>
                )}
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setKeepHotPromptId(null)
                    setTouchPromptId(isTouchPrompting ? null : l.id)
                    if (!isTouchPrompting) onSelect(l.id)
                  }}
                  style={{ flexShrink: 0, padding: '3px 8px', background: 'transparent', color: isTouchPrompting ? 'var(--c-fg-3)' : 'var(--c-fg)', borderRadius: 4, fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {isTouchPrompting ? 'Cancel' : 'Contact'}
                </button>
              </div>
              {isTouchPrompting && (
                <TouchPrompt
                  leadId={l.id}
                  phone={l.phone}
                  email={l.email}
                  onSubmit={async (id, init, meth, notes) => { setTouchPromptId(null); await onMarkTouched(id, init, meth, notes) }}
                  onCancel={() => setTouchPromptId(null)}
                />
              )}
              {isKeepHotPrompting && (
                <KeepHotPrompt
                  leadId={l.id}
                  label={l.status === 'warm' ? 'Keep Warm' : 'Keep Hot'}
                  status={l.status}
                  onSubmit={async (id, init, notes) => { setKeepHotPromptId(null); await onKeepHot(id, init, notes, l.status) }}
                  onCancel={() => setKeepHotPromptId(null)}
                />
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

// ─── All Leads view ───────────────────────────────────────────────────────────

const PAGE_SIZE = 25

type StatusFilter = 'uncontacted' | 'hot' | 'warm' | 'cold' | 'dnb' | 'booked'

// Maps a lead to its tab-filter key (cold + dead collapse into one bucket).
function leadStatusKey(l: Lead): StatusFilter {
  if (l.status === 'dead') return 'dnb'
  return l.status as StatusFilter
}

const ALL_STATUS_FILTERS: StatusFilter[] = ['uncontacted', 'hot', 'warm', 'cold', 'dnb', 'booked']
const DEFAULT_STATUS_FILTERS: StatusFilter[] = ['uncontacted', 'hot', 'warm']

function AllLeadsView({ leads, latestTouches, selectedId, onSelect, onMarkTouched, onKeepHot, onUpdateStatus, loading }: {
  leads: Lead[]
  latestTouches: TouchMap
  selectedId: number | null
  onSelect: (id: number) => void
  onMarkTouched: (id: number, initials: string, method: TouchMethod, notes: string, statusOverride?: string) => Promise<void>
  onKeepHot: (id: number, initials: string, notes: string, status?: string) => Promise<void>
  onUpdateStatus: (id: number, status: string) => Promise<void>
  loading: boolean
}) {
  const isMobile = useIsMobile()
  // See NeedsActionSection — new web inquiries pulse in this list too.
  const { isUnacked } = useWebInquiries()
  const [active, setActive] = useState<Set<StatusFilter>>(() => new Set(DEFAULT_STATUS_FILTERS))
  const [search, setSearch] = useState('')
  const skipFilterReset = useRef(false)

  // Restore persisted active-set + search after mount — lazy initializers read sessionStorage
  // during SSR where it doesn't exist, causing a hydration mismatch on the style-conditional
  // filter buttons. Start with stable defaults and restore client-side only.
  useEffect(() => {
    try {
      const a = sessionStorage.getItem('crm_al_active')
      const s = sessionStorage.getItem('crm_al_search')
      if (a !== null || s) {
        skipFilterReset.current = true
        if (a !== null) {
          const raw = JSON.parse(a) as string[]
          if (Array.isArray(raw)) {
            const migrated = new Set<StatusFilter>()
            for (const k of raw) {
              if (k === 'cold-dead') { migrated.add('cold'); migrated.add('dnb') }
              else if ((ALL_STATUS_FILTERS as string[]).includes(k)) migrated.add(k as StatusFilter)
            }
            setActive(migrated)
          } else {
            setActive(new Set(DEFAULT_STATUS_FILTERS))
          }
        }
        if (s) setSearch(s)
      }
    } catch {}
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem('crm_al_active', JSON.stringify(Array.from(active))) } catch {}
  }, [active])
  useEffect(() => {
    try { sessionStorage.setItem('crm_al_search', search) } catch {}
  }, [search])
  const [page, setPage] = useState(1)
  const [touchPromptId, setTouchPromptId] = useState<number | null>(null)
  const [keepHotPromptId, setKeepHotPromptId] = useState<number | null>(null)

  useEffect(() => { setPage(1) }, [search])
  useEffect(() => {
    if (skipFilterReset.current) { skipFilterReset.current = false; return }
    setPage(1)
  }, [active])

  // Independent toggles: clicking flips a status in/out of the active set.
  function toggleFilter(key: StatusFilter) {
    setActive(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const uncontactedLeads = leads.filter(l => l.status === 'uncontacted')
  const hotLeads = leads.filter(l => l.status !== 'uncontacted' && l.status === 'hot')
  const warmLeads = leads.filter(l => l.status !== 'uncontacted' && l.status === 'warm')
  const coldLeads = leads.filter(l => l.status === 'cold')
  const dnbLeads = leads.filter(l => l.status === 'dead')
  const bookedLeads = leads.filter(l => l.status === 'booked')

  // Per-status counts for the tab badges — independent of which tabs are active.
  const filterMap: Record<StatusFilter, Lead[]> = {
    uncontacted: uncontactedLeads, hot: hotLeads, warm: warmLeads, cold: coldLeads, dnb: dnbLeads, booked: bookedLeads,
  }

  const filterDefs: { key: StatusFilter; label: string; color: string }[] = [
    { key: 'uncontacted', label: 'Uncontacted', color: 'var(--c-st-uncon)' },
    { key: 'hot', label: 'Hot', color: 'var(--c-st-hot)' },
    { key: 'warm', label: 'Warm', color: 'var(--c-st-warm)' },
    { key: 'cold', label: 'Cold', color: 'var(--c-st-cold)' },
    { key: 'dnb', label: 'DNB', color: 'var(--c-fg-3)' },
    { key: 'booked', label: 'Booked', color: 'var(--c-st-booked)' },
  ]

  // Show leads matching ANY active status. Empty set falls back to all statuses
  // so the list is never blank.
  const effectiveActive = active.size === 0 ? new Set(ALL_STATUS_FILTERS) : active
  const activeLeads = leads.filter(l => effectiveActive.has(leadStatusKey(l)))
  const q = search.trim().toLowerCase()
  const filtered = activeLeads.filter(l => {
    if (!q) return true
    return `${l.fname || ''} ${l.lname || ''} ${l.email || ''} ${l.phone || ''} ${l.company || ''} ${l.label || ''}`.toLowerCase().includes(q)
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const startIdx = (safePage - 1) * PAGE_SIZE
  const paginated = filtered.slice(startIdx, startIdx + PAGE_SIZE)

  return (
    <div className="c-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
      {/* Header: filter pills + search */}
      <div style={{ flexShrink: 0 }}>
        <div className={isMobile ? 'hide-scrollbar' : undefined} style={{ display: 'flex', gap: 5, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : undefined, marginBottom: 8 }}>
          {filterDefs.map(f => {
            const isActive = active.has(f.key)
            return (
              <button
                key={f.key}
                onClick={() => toggleFilter(f.key)}
                className={`c-pill c-control ${statusFillClass(f.key)} ${isActive ? 'c-pressed' : 'c-raised-chip'}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, whiteSpace: 'nowrap', opacity: isActive ? 1 : 0.55 }}
              >
                {f.label} ({filterMap[f.key].length})
              </button>
            )
          })}
        </div>
        <div style={{ padding: '0 0 8px' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${activeLeads.length} leads…`}
            className="c-input c-inset2" style={{ fontSize: 12 }}
          />
        </div>
      </div>

      {/* Lead list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div className="c-sub" style={{ padding: 20, textAlign: 'center' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="c-sub" style={{ padding: 20, textAlign: 'center' }}>
            {search ? 'No leads match.' : 'No leads.'}
          </div>
        ) : paginated.map((l, idx) => {
          const touch = latestTouches[l.id]
          const missing = getMissing(l)
          const isTouchPrompting = touchPromptId === l.id
          const isKeepHotPrompting = keepHotPromptId === l.id
          const isPrompting = isTouchPrompting || isKeepHotPrompting
          const showKeepHot = (l.status === 'hot' || l.status === 'warm') && daysUntilKhu(l) !== null && (daysUntilKhu(l) as number) <= 1
          const keepLabel = l.status === 'warm' ? 'Keep Warm?' : 'Keep Hot?'
          const keepColor = l.status === 'warm' ? 'var(--c-st-warm)' : 'var(--c-st-hot)'
          const prevLead = idx > 0 ? paginated[idx - 1] : null
          const showDateSep = !!l.created_at && (!prevLead || new Date(l.created_at).toDateString() !== new Date(prevLead.created_at).toDateString())
          return (
            <React.Fragment key={l.id}>
              {showDateSep && (
                <div className="c-label" style={{ margin: '16px 4px 6px' }}>
                  {dateSepLabel(l.created_at)}
                  </div>
              )}
              <div onClick={() => onSelect(l.id)} className={leadRowClass({ selected: selectedId === l.id })} style={leadRowStyle({ prompting: isPrompting })}>
                {isUnacked(l.id) && <NewLeadPulse />}
                <LeadAvatar lead={l} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: leadNameColor(l) }}>
                    {l.label && l.artist_name
                      ? <>{l.label} <span style={{ color: 'var(--c-fg-3)' }}>/</span> {l.fname} {l.lname} <span style={{ color: 'var(--c-fg-3)' }}>/</span> {l.artist_name}</>
                      : l.artist_name && !l.label
                        ? <>{l.fname} {l.lname} <span style={{ color: 'var(--c-fg-3)' }}>·</span> {l.artist_name}</>
                        : <>{l.fname} {l.lname}{l.company && <span style={{ color: 'var(--c-fg-3)', fontWeight: 400 }}> · {l.company}</span>}</>}
                  </div>
                  {fmtSessionLine(l) && (
                    <div style={{ fontSize: 10, color: 'var(--c-fg-2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fmtSessionLine(l)}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--c-fg-2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.booking && <span>{BOOKING_ICONS[l.booking] || ''} {l.booking} · </span>}
                    {l.last_contact ? `${daysSince(l.last_contact)}d ago` : `added ${fmtDate(l.created_at)}`}
                    {touch?.initials && <span style={{ color: 'var(--c-fg-3)' }}> · {touch.initials}{touch.method ? ` via ${touch.method}` : ''}</span>}
                  </div>
                </div>
                {showKeepHot && (
                  <button onClick={e => { e.stopPropagation(); setTouchPromptId(null); setKeepHotPromptId(isKeepHotPrompting ? null : l.id) }}
                    style={{ flexShrink: 0, padding: '3px 8px', background: 'transparent', color: 'var(--c-fg)', borderRadius: 4, fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {isKeepHotPrompting ? 'Cancel' : keepLabel}
                  </button>
                )}
                <button onClick={e => { e.stopPropagation(); setKeepHotPromptId(null); setTouchPromptId(isTouchPrompting ? null : l.id); if (!isTouchPrompting) onSelect(l.id) }}
                  style={{ flexShrink: 0, padding: '3px 8px', background: 'transparent', color: isTouchPrompting ? 'var(--c-fg-3)' : 'var(--c-fg)', borderRadius: 4, fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {isTouchPrompting ? 'Cancel' : 'Contact'}
                </button>
              </div>
              {isTouchPrompting && (
                <TouchPrompt leadId={l.id}
                  phone={l.phone}
                  email={l.email}
                  onSubmit={async (id, init, meth, notes) => { setTouchPromptId(null); await onMarkTouched(id, init, meth, notes) }}
                  onCancel={() => setTouchPromptId(null)} />
              )}
              {isKeepHotPrompting && (
                <KeepHotPrompt leadId={l.id}
                  label={l.status === 'warm' ? 'Keep Warm' : 'Keep Hot'}
                  status={l.status}
                  onSubmit={async (id, init, notes) => { setKeepHotPromptId(null); await onKeepHot(id, init, notes, l.status) }}
                  onCancel={() => setKeepHotPromptId(null)} />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Pagination */}
      {filtered.length > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', flexShrink: 0 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
            style={{ background: 'none', cursor: safePage <= 1 ? 'default' : 'pointer', fontFamily: 'Inter', fontSize: 10, color: safePage <= 1 ? 'var(--c-fg-3)' : 'var(--c-fg-2)', padding: '2px 4px' }}>
            ← Prev
          </button>
          <span style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>
            {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
            style={{ background: 'none', cursor: safePage >= totalPages ? 'default' : 'pointer', fontFamily: 'Inter', fontSize: 10, color: safePage >= totalPages ? 'var(--c-fg-3)' : 'var(--c-fg-2)', padding: '2px 4px' }}>
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Section helpers ──────────────────────────────────────────────────────────

function FieldGroupLabel({ label, mt }: { label: string; mt?: number }) {
  return (
    <div style={{ fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 4, marginTop: mt ?? 8 }}>
      {label}
    </div>
  )
}

function FieldPair({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>{children}</div>
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div>
      <div style={fieldLabelStyle}>{label}</div>
      {children}
    </div>
  )
}

// ─── Lead detail ──────────────────────────────────────────────────────────────

function LeadDetail({ lead, missing, latestTouch, focusField, onFocusConsumed, distinctLabels, distinctCompanies, allTags, onUpdate, onSendEmail, onDelete }: {
  lead: Lead
  missing: string[]
  latestTouch?: { initials: string, method: string, created_at: string }
  focusField?: string | null
  onFocusConsumed?: () => void
  distinctLabels: string[]
  distinctCompanies: string[]
  allTags: string[]
  onUpdate: (f: string, v: any) => void
  onSendEmail?: () => void
  onDelete?: () => void
}) {
  const isMobile = useIsMobile()
  const [local, setLocal] = useState<Partial<Lead>>({ ...lead })
  const [notesVal, setNotesVal] = useState(lead.notes || '')
  const [savedField, setSavedField] = useState<string | null>(null)
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const [showLabelDD, setShowLabelDD] = useState(false)
  const [showCompanyDD, setShowCompanyDD] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  // Why the confirm-client modal was opened. 'book' = the user pressed Start
  // Booking and expects to land in the Work Order; 'status' = they just flipped
  // the lead to Booked on the temperature pill and should stay put. Both paths
  // share the modal, so without this the pill would fling you to the calendar.
  const [confirmIntent, setConfirmIntent] = useState<'book' | 'status'>('status')
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [showBookedModal, setShowBookedModal] = useState(false)
  const [markingBooked, setMarkingBooked] = useState(false)
  const leadRouter = useRouter()
  const [regLinkUrl, setRegLinkUrl] = useState<string | null>(null)
  const [regLinkCopied, setRegLinkCopied] = useState(false)
  const [regLinkGenerating, setRegLinkGenerating] = useState(false)
  const [existingTokenStr, setExistingTokenStr] = useState<string | null>(null)
  const [regPanelOpen, setRegPanelOpen] = useState(false)
  const [regActioned, setRegActioned] = useState(false)
  const [regViewOpen, setRegViewOpen] = useState(false)
  const [localTags, setLocalTags] = useState<string[]>(lead.tags || [])
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tagDDOpen, setTagDDOpen] = useState(false)
  const [fnameVal, setFnameVal] = useState(lead.fname || '')
  const [lnameVal, setLnameVal] = useState(lead.lname || '')
const parsedLoc0 = parseLocation(lead.location || '')
  const [localVenue, setLocalVenue] = useState(parsedLoc0.venue)
  const [localStudio, setLocalStudio] = useState(parsedLoc0.studio)
  const [detailRateType, setDetailRateType] = useState<'hourly' | 'daily'>(() => lead.rate_daily ? 'daily' : 'hourly')
  const [activityLog, setActivityLog] = useState<Array<{ ts: string; label: string; color: string }>>([])
  const [creatorInitials, setCreatorInitials] = useState<string | null>(null)
  const [regTokenDates, setRegTokenDates] = useState<{ created_at: string; used_at: string | null } | null>(null)
  const [statusDDOpen, setStatusDDOpen] = useState(false)
  const statusPillRef = useRef<HTMLDivElement>(null)

  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const quoteRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLocal({ ...lead })
    setFnameVal(lead.fname || '')
    setLnameVal(lead.lname || '')
    const loc = parseLocation(lead.location || '')
    setLocalVenue(loc.venue)
    setLocalStudio(loc.studio)
    setDetailRateType(lead.rate_daily ? 'daily' : 'hourly')
    setLocalTags(lead.tags || [])
    setTagInput('')
    setTagsOpen(false)
  }, [lead.id])
  useEffect(() => { setNotesVal(lead.notes || '') }, [lead.notes])
  useEffect(() => {
    setRegLinkUrl(null); setRegLinkCopied(false); setRegLinkGenerating(false); setExistingTokenStr(null)
    setRegTokenDates(null); setRegPanelOpen(false); setRegActioned(false)
    const base = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
    (async () => {
      // 1. Try to find a token for this specific lead
      const { data: byLead } = await supabase.from('registration_tokens')
        .select('token, created_at, used_at').eq('lead_id', lead.id).maybeSingle()
      if (byLead) {
        setExistingTokenStr(byLead.token)
        setRegLinkUrl(`${base}/register/${byLead.token}`)
        setRegTokenDates({ created_at: byLead.created_at, used_at: byLead.used_at })
        return
      }
      if (!lead.client_id) return
      // 2. No lead-scoped token — search by client_id (covers returning clients whose
      //    completed registration token was generated from a different lead, and tokens
      //    created after this fix where client_id is stored on the token).
      const { data: byClient } = await supabase.from('registration_tokens')
        .select('token, created_at, used_at').eq('client_id', lead.client_id)
        .order('created_at', { ascending: false }).limit(1)
      const tokenRow = byClient?.[0] ?? null
      if (tokenRow) {
        setExistingTokenStr(tokenRow.token)
        if (!tokenRow.used_at) setRegLinkUrl(`${base}/register/${tokenRow.token}`)
        setRegTokenDates({ created_at: tokenRow.created_at, used_at: tokenRow.used_at })
        return
      }
      // 3. No token at all — check clients.registered_at as final fallback
      //    (covers clients who used "Use & Link this Profile" where registered_at
      //    is already set from their original registration)
      const { data: c } = await supabase.from('clients')
        .select('registered_at').eq('id', lead.client_id).maybeSingle()
      if (c?.registered_at) setRegTokenDates({ created_at: c.registered_at, used_at: c.registered_at })
    })()
  }, [lead.id, lead.client_id])

  useEffect(() => {
    setActivityLog([])
    supabase.from('lead_activity').select('note, created_at').eq('lead_id', lead.id)
      .order('created_at', { ascending: false }).then(({ data }) => {
        const items = (data || []).map(row => ({
          ts: row.created_at,
          label: row.note || '',
          color: activityColor(row.note || ''),
        }))
        // Lead Created is rendered as a dedicated always-last row below the log, not injected here.
        const synth: Array<{ ts: string; label: string; color: string }> = []
        if (regTokenDates?.created_at) synth.push({ ts: regTokenDates.created_at, label: 'Reg Link Sent', color: 'var(--c-fg)' })
        if (regTokenDates?.used_at) synth.push({ ts: regTokenDates.used_at, label: 'Registration Returned', color: 'var(--c-st-booked)' })
        const all = [...items, ...synth].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
        setActivityLog(all)
      })
  }, [lead.id, lead.last_contact, regTokenDates])

  // Resolve the creator's initials for the dedicated "Lead Created" row.
  // Web Inquiry rows are attributed to "Inquiry" (no staff lookup). Otherwise
  // join created_by → user_profiles.id (the surrogate PK stored at insert) for
  // initials / display_name.
  useEffect(() => {
    setCreatorInitials(null)
    if (!lead.created_by || lead.source === 'Web Inquiry') return
    supabase.from('user_profiles').select('initials, display_name').eq('id', lead.created_by).maybeSingle()
      .then(({ data }) => {
        if (data) setCreatorInitials(data.initials || profileInitials(data.display_name) || null)
      })
  }, [lead.id, lead.created_by, lead.source])

  const creationLabel = lead.source === 'Web Inquiry'
    ? 'Inquiry · Lead Created'
    : creatorInitials
      ? `${creatorInitials} · Lead Created`
      : 'Lead Created'

  useEffect(() => {
    if (!focusField) return
    const refMap: Record<string, React.RefObject<HTMLInputElement>> = {
      'email/phone': emailRef, 'quote': quoteRef,
    }
    const ref = refMap[focusField]
    if (ref?.current) {
      ref.current.focus()
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    onFocusConsumed?.()
  }, [focusField])

  useEffect(() => {
    if (!statusDDOpen) return
    function onDocClick(e: MouseEvent) {
      if (statusPillRef.current && !statusPillRef.current.contains(e.target as Node)) setStatusDDOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [statusDDOpen])

  const notesDirty = notesVal !== (lead.notes || '')

  function update(key: keyof Lead, val: any) {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  async function save(key: string, val: any) {
    if (val === (lead as any)[key]) return
    const { error } = await supabase.from('leads').update({ [key]: val }).eq('id', lead.id)
    if (!dbResult('Saving lead', error)) return
    onUpdate(key, val)
    setSavedField(key)
    setTimeout(() => setSavedField(null), 600)
  }

  async function addTag(tag: string) {
    const trimmed = tag.trim()
    if (!trimmed || localTags.includes(trimmed)) return
    const newTags = [...localTags, trimmed]
    setLocalTags(newTags)
    const { error } = await supabase.from('leads').update({ tags: newTags }).eq('id', lead.id)
    if (!dbResult('Saving tag', error)) { setLocalTags(localTags); return }
    onUpdate('tags', newTags)
  }

  async function removeTag(tag: string) {
    const newTags = localTags.filter(t => t !== tag)
    setLocalTags(newTags)
    const { error } = await supabase.from('leads').update({ tags: newTags }).eq('id', lead.id)
    if (!dbResult('Removing tag', error)) { setLocalTags(localTags); return }
    onUpdate('tags', newTags)
  }

  // Start Booking — hand the lead off to the calendar, which opens a real Work
  // Order seeded from it (dates, times, rate, studio, client). A lead with no
  // client profile gets the confirm-client step first, so a session is always
  // attached to a real client record — that link is what keeps the lead, the
  // booking and later renames in sync.
  function startBooking() {
    if (lead.client_id) {
      leadRouter.push(`/calendar?newBooking=1&clientId=${lead.client_id}&leadId=${lead.id}`)
      return
    }
    setConfirmIntent('book')
    setShowConfirmModal(true)
  }

  async function saveStatus(newStatus: string) {
    if (newStatus === lead.status) return
    const updates: Partial<Lead> = { status: newStatus as LeadStatus }
    if (newStatus === 'hot') {
      const khu = new Date(); khu.setDate(khu.getDate() + 5)
      updates.keep_hot_until = khu.toISOString()
    } else if (newStatus === 'warm') {
      const khu = new Date(); khu.setDate(khu.getDate() + 3)
      updates.keep_hot_until = khu.toISOString()
    } else {
      updates.keep_hot_until = null
    }
    const { error } = await supabase.from('leads').update(updates).eq('id', lead.id)
    if (!dbResult('Updating status', error)) return
    onUpdate('status', newStatus)
    onUpdate('keep_hot_until', updates.keep_hot_until ?? null)
    setSavedField('status')
    setTimeout(() => setSavedField(null), 600)
  }

  const selStyle: React.CSSProperties = {
    background: 'var(--c-bg)', color: 'var(--c-fg)', padding: '8px 14px', fontFamily: 'Inter',
    fontSize: 12, outline: 'none', borderRadius: 99, cursor: 'pointer', flex: 1, minWidth: 0,
    boxShadow: 'inset 3px 3px 9px rgba(0,0,0,.34), inset -3px -3px 9px rgba(255,255,255,.03)',
  }

  async function generateRegLink() {
    setRegLinkGenerating(true)
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('registration_tokens').insert({
      token,
      lead_id: lead.id,
      client_id: lead.client_id || null,
      prefill_email: lead.email || null,
      prefill_name: `${lead.fname || ''} ${lead.lname || ''}`.trim() || null,
      expires_at: expiresAt,
    })
    setExistingTokenStr(token)
    setRegLinkUrl(`${process.env.NEXT_PUBLIC_BASE_URL || window.location.origin}/register/${token}`)
    setRegLinkGenerating(false)
    setRegPanelOpen(true)
  }

  // Re-queries the DB for the current token status. Returns true if registration
  // is now complete so the caller can skip opening the pending panel.
  async function refreshRegStatus(): Promise<boolean> {
    const base = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin
    const { data: byLead } = await supabase.from('registration_tokens')
      .select('token, created_at, used_at').eq('lead_id', lead.id).maybeSingle()
    if (byLead) {
      setRegTokenDates({ created_at: byLead.created_at, used_at: byLead.used_at })
      if (byLead.used_at) return true
      setRegLinkUrl(`${base}/register/${byLead.token}`)
      return false
    }
    if (lead.client_id) {
      const { data: byClient } = await supabase.from('registration_tokens')
        .select('token, created_at, used_at').eq('client_id', lead.client_id)
        .order('created_at', { ascending: false }).limit(1)
      const row = byClient?.[0] ?? null
      if (row) {
        setRegTokenDates({ created_at: row.created_at, used_at: row.used_at })
        if (row.used_at) return true
        setRegLinkUrl(`${base}/register/${row.token}`)
        return false
      }
      const { data: c } = await supabase.from('clients').select('registered_at').eq('id', lead.client_id).maybeSingle()
      if (c?.registered_at) {
        setRegTokenDates({ created_at: c.registered_at, used_at: c.registered_at })
        return true
      }
    }
    return false
  }

  async function copyRegLink() {
    if (!regLinkUrl) return
    try { await navigator.clipboard.writeText(regLinkUrl) } catch (_) {}
    setRegLinkCopied(true)
    setRegActioned(true)
    setRegPanelOpen(false)
    setTimeout(() => setRegLinkCopied(false), 2000)
  }

  function emailRegLink() {
    if (!regLinkUrl) return
    const subject = encodeURIComponent('Your Paramount Recording Studios registration link')
    const body = encodeURIComponent(
      `Hi ${lead.fname || 'there'},\n\nPlease complete your registration for Paramount Recording Studios using the link below:\n\n${regLinkUrl}\n\nThis link expires in 7 days.\n\n— Paramount Recording Studios`
    )
    setRegActioned(true)
    setRegPanelOpen(false)
    window.location.href = `mailto:${lead.email || ''}?subject=${subject}&body=${body}`
  }

  const pillBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center',
    padding: '3px 10px', borderRadius: 20,
    fontSize: 10, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400,
    letterSpacing: '0.08em', textTransform: 'uppercase',
    cursor: 'pointer', outline: 'none',
  }

  function iStyle(key: string): React.CSSProperties {
    return {
      background: focusedInput === key ? 'var(--c-wash)' : 'transparent',
      color: 'var(--c-fg)', padding: '4px 6px',
      fontFamily: 'Inter', fontSize: 12, outline: 'none',
      width: '100%', borderRadius: 4, transition: 'background 0.1s',
    }
  }

  const enterBlur = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === 'Enter') (e.target as HTMLElement).blur()
  }

  const labelSuggestions = (local.label || '').length >= 1
    ? distinctLabels.filter(v => v.toLowerCase().includes((local.label || '').toLowerCase())).slice(0, 6)
    : []
  const companySuggestions = (local.company || '').length >= 1
    ? distinctCompanies.filter(v => v.toLowerCase().includes((local.company || '').toLowerCase())).slice(0, 6)
    : []

  const ddStyle: React.CSSProperties = {
    position: 'absolute', top: '100%', left: 0, right: 0,
    background: 'var(--c-bg)', borderRadius: 20, zIndex: 50, overflow: 'hidden', marginTop: 4,
    boxShadow: '0 14px 34px rgba(0,0,0,.5)',
  }
  const ddItemStyle: React.CSSProperties = {
    padding: '9px 14px', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter',
  }

  return (
    <div>
      {/* ═══ Zone 1 (transparent — lets the panel gradient show through) — identity + contact ═══════════ */}
      <div style={{ background: 'transparent', padding: isMobile ? '2px 0 4px' : '2px 0 6px' }}>
      {/* ─── Status strip ─────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div ref={statusPillRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setStatusDDOpen(o => !o)}
            className={`c-pill c-control c-raised-chip ${statusFillClass(local.status || lead.status)}`}
            style={{ gap: 5 }}
          >
            <span>{statusLabel(local.status || lead.status)}</span>
            <span style={{ fontSize: 8, lineHeight: 1, transform: statusDDOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
          </button>
          {statusDDOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--c-bg)', borderRadius: 8, zIndex: 60, overflow: 'hidden', boxShadow: '0 6px 20px rgba(0,0,0,0.45)', minWidth: 150 }}>
              {['uncontacted', 'hot', 'warm', 'cold', 'booked', 'dead'].map(s => {
                const c = LEAD_AVATAR_COLORS[s] || LEAD_AVATAR_COLORS.uncontacted
                const active = (local.status || lead.status) === s
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setStatusDDOpen(false)
                      // Selecting Booked triggers the client-confirmation flow (QC
                      // modal for a new client, "Mark as Booked" for a returning
                      // one) instead of writing status directly; those modals set
                      // status:'booked' on confirm. All other statuses update
                      // directly.
                      //
                      // This is KEPT deliberately (it was marked temporary while
                      // there was no booking form). Marking a lead booked is not
                      // the same act as booking a session — the deal can be closed
                      // before the dates are settled. Booking a session is the
                      // Start Booking button, which lands in the Work Order.
                      if (s === 'booked') {
                        if (lead.client_id) setShowBookedModal(true)
                        else { setConfirmIntent('status'); setShowConfirmModal(true) }
                        return
                      }
                      update('status', s); saveStatus(s)
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-wash)' }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: active ? 'var(--c-wash)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: c }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, flexShrink: 0 }} />
                    {statusLabel(s)}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        {lead.needs_contact !== false && (<>
          <span style={{ color: 'var(--c-fg-3)', fontSize: 9, flexShrink: 0 }}>·</span>
          <button
            onClick={() => { save('needs_contact', false); onUpdate('needs_contact', false) }}
            style={{ background: 'transparent', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const, flexShrink: 0 }}
          >
            Needs Contact
          </button>
        </>)}
      </div>

      {savedField && <span className="c-label" style={{ display: 'block', marginBottom: 4 }}>saved</span>}

      {/* ─── Missing warning ─────────────────────────────── */}
      

      {/* ─── Identity + Contact ─────────────────────────────── */}
      <div>
        {/* Row 1: hero name/label + reg button + Start Booking */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0, flex: 1, flexWrap: 'wrap' }}>
            {lead.billing !== 'COD' ? (
              <>
                <div className="c-field-inline" style={{ display: 'inline-grid', minWidth: '3ch', position: 'relative' }}>
                  <span aria-hidden style={{ visibility: 'hidden', gridArea: '1/1', fontFamily: "'Archivo Black', sans-serif", fontSize: 22, letterSpacing: -0.5, padding: '4px 0', whiteSpace: 'pre' }}>
                    {local.label || 'Label'}
                  </span>
                  <input
                    value={local.label || ''}
                    onChange={e => { update('label', e.target.value); setShowLabelDD(true) }}
                    onFocus={() => { setFocusedInput('label'); setShowLabelDD(true) }}
                    onKeyDown={enterBlur}
                    onBlur={e => { setFocusedInput(null); setShowLabelDD(false); save('label', e.target.value) }}
                    placeholder="Label"
                    style={{ gridArea: '1/1', width: 0, minWidth: '100%', background: focusedInput === 'label' ? 'var(--c-wash)' : 'transparent', outline: 'none', color: 'var(--c-fg)', fontFamily: "'Archivo Black', sans-serif", fontSize: 22, letterSpacing: -0.5, padding: '4px 0', borderRadius: 4 }}
                  />
                  {showLabelDD && labelSuggestions.length > 0 && (
                    <div style={{ ...ddStyle, right: 'auto', width: 'max-content', minWidth: 220, maxWidth: 320 }}>
                      {labelSuggestions.map(s => (
                        <div key={s} onMouseDown={e => { e.preventDefault(); update('label', s); save('label', s); setShowLabelDD(false) }} style={ddItemStyle}>{s}</div>
                      ))}
                    </div>
                  )}
                </div>
                <span style={{ color: 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif", fontSize: 22, letterSpacing: -0.5, flexShrink: 0 }}> — </span>
                <div className="c-field-inline" style={{ display: 'inline-grid', minWidth: '3ch' }}>
                  <span aria-hidden style={{ visibility: 'hidden', gridArea: '1/1', fontFamily: "'Archivo Black', sans-serif", fontSize: 22, letterSpacing: -0.5, padding: '4px 0', whiteSpace: 'pre' }}>
                    {local.artist_name || 'Artist'}
                  </span>
                  <input
                    value={local.artist_name || ''}
                    onChange={e => update('artist_name', e.target.value)}
                    onFocus={() => setFocusedInput('artist_name')}
                    onKeyDown={enterBlur}
                    onBlur={e => { setFocusedInput(null); save('artist_name', e.target.value) }}
                    placeholder="Artist"
                    style={{ gridArea: '1/1', width: 0, minWidth: '100%', background: focusedInput === 'artist_name' ? 'var(--c-wash)' : 'transparent', outline: 'none', color: 'var(--c-fg)', fontFamily: "'Archivo Black', sans-serif", fontSize: 22, letterSpacing: -0.5, padding: '4px 0', borderRadius: 4 }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="c-field-inline" style={{ display: 'inline-grid', minWidth: '3ch' }}>
                  <span aria-hidden style={{ visibility: 'hidden', gridArea: '1/1', fontFamily: "'Archivo Black', sans-serif", fontSize: 22, letterSpacing: -0.5, padding: '4px 0', whiteSpace: 'pre' }}>
                    {fnameVal || 'First'}
                  </span>
                  <input
                    value={fnameVal}
                    onChange={e => setFnameVal(e.target.value)}
                    onFocus={() => setFocusedInput('fname')}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur() }}
                    onBlur={() => { setFocusedInput(null); save('fname', fnameVal.trim()) }}
                    placeholder="First"
                    style={{ gridArea: '1/1', width: 0, minWidth: '100%', background: focusedInput === 'fname' ? 'var(--c-wash)' : 'transparent', outline: 'none', color: leadNameColor(lead), fontFamily: "'Archivo Black', sans-serif", fontSize: 22, letterSpacing: -0.5, padding: '4px 0', borderRadius: 4 }}
                  />
                </div>
                <div className="c-field-inline" style={{ display: 'inline-grid', minWidth: '3ch' }}>
                  <span aria-hidden style={{ visibility: 'hidden', gridArea: '1/1', fontFamily: "'Archivo Black', sans-serif", fontSize: 22, letterSpacing: -0.5, padding: '4px 0', whiteSpace: 'pre' }}>
                    {lnameVal || 'Last'}
                  </span>
                  <input
                    value={lnameVal}
                    onChange={e => setLnameVal(e.target.value)}
                    onFocus={() => setFocusedInput('lname')}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur() }}
                    onBlur={() => { setFocusedInput(null); save('lname', lnameVal.trim()) }}
                    placeholder="Last"
                    style={{ gridArea: '1/1', width: 0, minWidth: '100%', background: focusedInput === 'lname' ? 'var(--c-wash)' : 'transparent', outline: 'none', color: leadNameColor(lead), fontFamily: "'Archivo Black', sans-serif", fontSize: 22, letterSpacing: -0.5, padding: '4px 0', borderRadius: 4 }}
                  />
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 4 }}>
            {/* Start Booking — restored July 28, 2026. It was swapped out for the
                temporary Confirm-Client flow back when there was no booking form
                to send anyone to; the Work Order is that destination now. */}
            <button
              onClick={startBooking}
              title={lead.client_id ? 'Open a Work Order for this lead' : 'Confirm the client profile, then open a Work Order'}
              className="c-btn c-control c-raised-primary" style={{ whiteSpace: 'nowrap' as const }}
            >
              Start Booking
            </button>
            {lead.billing !== 'Billing' && (regTokenDates?.used_at ? (
              <button onClick={() => setRegViewOpen(true)} className="c-pill c-fill-booked c-control c-raised-chip" style={{ cursor: 'pointer' }}>
                ✓ Registered
              </button>
            ) : existingTokenStr && regActioned ? (
              <button onClick={async () => { const done = await refreshRegStatus(); if (!done) setRegPanelOpen(v => !v) }} className={`c-pill c-fill-warm c-control ${regPanelOpen ? 'c-pressed' : 'c-raised-chip'}`} style={{ cursor: 'pointer' }}>
                Reg Sent
              </button>
            ) : (
              <button onClick={generateRegLink} disabled={regLinkGenerating} style={{ padding: '5px 12px', background: 'transparent', color: 'var(--c-fg-3)', borderRadius: 4, fontFamily: 'Inter', fontSize: 10, cursor: regLinkGenerating ? 'default' : 'pointer' }}>
                {regLinkGenerating ? '…' : 'Send Reg'}
              </button>
            ))}
          </div>
        </div>

        {/* Reg link panel — expands directly below the hero name row */}
        {regPanelOpen && regLinkUrl && !regTokenDates?.used_at && (
          <div style={{ marginBottom: 8, background: 'var(--c-wash)', borderRadius: 5, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <a href={regLinkUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, fontFamily: 'Inter', color: 'var(--c-st-booked)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                Register Here
              </a>
              <button onClick={() => setRegPanelOpen(false)} style={{ padding: '2px 6px', background: 'transparent', color: 'var(--c-fg-3)', borderRadius: 3, fontFamily: 'Inter', fontSize: 11, cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={copyRegLink} style={{ padding: '3px 10px', background: 'var(--c-fg)', color: 'var(--c-bg)', borderRadius: 3, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 8, letterSpacing: '0.08em', cursor: 'pointer' }}>
                {regLinkCopied ? 'Copied!' : 'Copy Link'}
              </button>
              <button onClick={emailRegLink} style={{ padding: '3px 10px', background: 'transparent', color: 'var(--c-fg-2)', borderRadius: 3, fontFamily: 'Inter', fontSize: 8, cursor: 'pointer' }}>
                Email
              </button>
              <button onClick={generateRegLink} disabled={regLinkGenerating} style={{ padding: '3px 10px', background: 'transparent', color: 'var(--c-st-warm)', borderRadius: 3, fontFamily: 'Inter', fontSize: 8, cursor: regLinkGenerating ? 'default' : 'pointer' }}>
                {regLinkGenerating ? '…' : 'Resend'}
              </button>
            </div>
          </div>
        )}

        {/* V3 meta line — payment · source · last-touch age. Payment type is
            client classification and has to be readable at first glance, so it
            sits directly under the name at full opacity; source and age trail it
            at reduced weight. Middots are the separator, not chips. */}
        <div className="c-metaline">
          <span
            className="c-pay"
            onClick={() => { const nb = (local.billing || lead.billing) === 'COD' ? 'Billing' : 'COD'; update('billing', nb); save('billing', nb) }}
            title="Click to switch between COD and Billing"
          >
            {local.billing || lead.billing || 'COD'}
          </span>
          {lead.source && (<>
            <span className="c-sep">·</span>
            <span className="c-src">{lead.source}</span>
          </>)}
          {latestTouch && (<>
            <span className="c-sep">·</span>
            <span className="c-age">{touchAge(latestTouch.created_at)} since contact</span>
          </>)}
        </div>

        {/* Stage name (COD only) */}
        {lead.billing === 'COD' && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 6, minWidth: 0 }}>
            <div className="c-field-inline" style={{ display: 'inline-grid', minWidth: '3ch' }}>
              <span aria-hidden style={{ visibility: 'hidden', gridArea: '1/1', fontFamily: 'Inter', fontSize: 12, padding: '2px 0', whiteSpace: 'pre' }}>
                {local.artist_name || 'Artist name'}
              </span>
              <input
                value={local.artist_name || ''}
                onChange={e => update('artist_name', e.target.value)}
                onFocus={() => setFocusedInput('artist_name')}
                onKeyDown={enterBlur}
                onBlur={e => { setFocusedInput(null); save('artist_name', e.target.value) }}
                placeholder="Artist name"
                style={{ gridArea: '1/1', width: 0, minWidth: '100%', background: focusedInput === 'artist_name' ? 'var(--c-wash)' : 'transparent', outline: 'none', color: 'var(--c-fg-2)', fontFamily: 'Inter', fontSize: 12, padding: '2px 0', borderRadius: 4 }}
              />
            </div>
          </div>
        )}

        {/* Row 2 (Label/Billing only): A&R name line */}
        {lead.billing !== 'COD' && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 6, minWidth: 0, flexWrap: 'wrap' }}>
            <div className="c-field-inline" style={{ display: 'inline-grid', minWidth: '3ch' }}>
              <span aria-hidden style={{ visibility: 'hidden', gridArea: '1/1', fontFamily: 'Inter', fontSize: 12, padding: '2px 0', whiteSpace: 'pre' }}>
                {fnameVal || 'First'}
              </span>
              <input
                value={fnameVal}
                onChange={e => setFnameVal(e.target.value)}
                onFocus={() => setFocusedInput('fname')}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur() }}
                onBlur={() => { setFocusedInput(null); save('fname', fnameVal.trim()) }}
                placeholder="First"
                style={{ gridArea: '1/1', width: 0, minWidth: '100%', background: focusedInput === 'fname' ? 'var(--c-wash)' : 'transparent', outline: 'none', color: 'var(--c-fg-2)', fontFamily: 'Inter', fontSize: 12, padding: '2px 0', borderRadius: 4 }}
              />
            </div>
            <div className="c-field-inline" style={{ display: 'inline-grid', minWidth: '3ch' }}>
              <span aria-hidden style={{ visibility: 'hidden', gridArea: '1/1', fontFamily: 'Inter', fontSize: 12, padding: '2px 0', whiteSpace: 'pre' }}>
                {lnameVal || 'Last'}
              </span>
              <input
                value={lnameVal}
                onChange={e => setLnameVal(e.target.value)}
                onFocus={() => setFocusedInput('lname')}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur() }}
                onBlur={() => { setFocusedInput(null); save('lname', lnameVal.trim()) }}
                placeholder="Last"
                style={{ gridArea: '1/1', width: 0, minWidth: '100%', background: focusedInput === 'lname' ? 'var(--c-wash)' : 'transparent', outline: 'none', color: 'var(--c-fg-2)', fontFamily: 'Inter', fontSize: 12, padding: '2px 0', borderRadius: 4 }}
              />
            </div>
            <span style={{ fontSize: 9, color: 'var(--c-fg-3)', letterSpacing: '0.08em', textTransform: 'uppercase' as const, fontFamily: 'Inter', flexShrink: 0 }}>A&amp;R</span>
          </div>
        )}

        {/* Tight contact line: email + Email · phone + Call/Text */}
        <div style={isMobile
          ? { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, marginTop: 6 }
          : { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <div style={isMobile
            ? { display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 6, minWidth: 0 }
            : { display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 200px', minWidth: 0 }}>
            <input ref={emailRef} value={local.email || ''} onChange={e => update('email', e.target.value)}
              onFocus={() => setFocusedInput('email')} onBlur={e => { setFocusedInput(null); save('email', e.target.value) }}
              onKeyDown={enterBlur} placeholder="Add email" style={{ ...iStyle('email'), ...(isMobile ? { flex: '0 1 auto', width: 190, minWidth: 0, paddingLeft: 0 } : { flex: 1, minWidth: 0, paddingLeft: 0 }) }} />
            {local.email && (
              <a href={`mailto:${local.email}`} style={{ ...aBtnStyle('var(--c-fg-2)'), flexShrink: 0 }}>Email</a>
            )}
          </div>
          {!isMobile && <span style={{ color: 'var(--c-fg-3)', fontSize: 11, flexShrink: 0 }}>·</span>}
          <div style={isMobile
            ? { display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 6, minWidth: 0 }
            : { display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 200px', minWidth: 0 }}>
            <input ref={phoneRef} value={focusedInput === 'phone' ? (local.phone || '') : fmtPhone(local.phone || '')} onChange={e => update('phone', e.target.value)}
              onFocus={() => setFocusedInput('phone')} onBlur={e => { setFocusedInput(null); const f = fmtPhone(e.target.value); if (f !== e.target.value) update('phone', f); save('phone', f) }}
              onKeyDown={enterBlur} placeholder="Add phone" style={{ ...iStyle('phone'), ...(isMobile ? { flex: '0 0 auto', width: 132, minWidth: 0, paddingLeft: 0 } : { flex: 1, minWidth: 0 }) }} />
            {local.phone && (<>
              <a href={`tel:${local.phone.replace(/\D/g, '')}`} style={{ ...aBtnStyle('var(--c-fg-2)'), flexShrink: 0 }}>Call</a>
              <a href={`sms:${local.phone.replace(/\D/g, '')}`} style={{ ...aBtnStyle('var(--c-fg-2)'), flexShrink: 0 }}>Text</a>
            </>)}
          </div>
        </div>

      </div>
      </div>

      {/* ═══ Zone 2 (bg var(--c-wash)) — session info ═══════════════ */}
      <div className="c-band">
      <div className="c-band-head">Session</div>
      {/* ─── Session & Quote ─────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 48px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <div style={fieldLabelStyle}>Location · Studio</div>
            <div style={{ maxWidth: isMobile ? '100%' : 180 }}>
              <StudioSelect
                location={localVenue}
                studio={localStudio}
                shortCodes
                onChange={(venue, studio) => {
                  setLocalVenue(venue)
                  setLocalStudio(studio)
                  const combined = combineLocation(venue, studio)
                  save('location', combined)
                  update('location', combined)
                }}
                selectStyle={selStyle}
              />
            </div>
          </div>
          <div>
            {/* Start date + OPTIONAL end date. Clients regularly ask to hold a
                block ("a week in August"); that range used to collapse to a
                single day because the lead had nowhere to put it. Leave the end
                blank for an ordinary one-day lead — the calendar seeds a
                booking's end_date from it when present. */}
            <div style={fieldLabelStyle}>Session Date{local.session_end_date ? 's' : ''}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="date"
                value={local.session_date || ''}
                onChange={e => { update('session_date', e.target.value); save('session_date', e.target.value) }}
                style={{ ...iStyle('session_date'), cursor: 'pointer', paddingLeft: 0 }}
              />
              <span style={{ color: 'var(--c-fg-3)', fontSize: 11, flexShrink: 0 }}>–</span>
              <input
                type="date"
                value={local.session_end_date || ''}
                min={local.session_date || undefined}
                title="Optional — set only when the client wants more than one day"
                onChange={e => { update('session_end_date', e.target.value); save('session_end_date', e.target.value || null) }}
                style={{ ...iStyle('session_end_date'), cursor: 'pointer', paddingLeft: 0, opacity: local.session_end_date ? 1 : 0.6 }}
              />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <div style={fieldLabelStyle}>Quote / Rate</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="c-seg c-seg-tiny">
              <button type="button" onClick={() => setDetailRateType('hourly')} className={detailRateType === 'hourly' ? 'c-on' : ''}>/ hr</button>
              <button type="button" onClick={() => setDetailRateType('daily')} className={detailRateType === 'daily' ? 'c-on' : ''}>/ day</button>
              </span>
              <input
                ref={quoteRef}
                value={detailRateType === 'hourly' ? (local.quote || '') : (local.rate_daily || '')}
                onChange={e => update(detailRateType === 'hourly' ? 'quote' : 'rate_daily', e.target.value)}
                onFocus={() => setFocusedInput('quote')}
                onBlur={e => {
                  setFocusedInput(null)
                  const f = fmtMoney(e.target.value)
                  const key = detailRateType === 'hourly' ? 'quote' : 'rate_daily'
                  if (f !== e.target.value) update(key, f)
                  save(key, f || e.target.value)
                }}
                onKeyDown={enterBlur}
                placeholder="—"
                style={{ ...iStyle('quote'), width: 72, flex: 'none', borderRadius: '0 4px 4px 0' }}
              />
            </div>
          </div>
          <div>
            <div style={fieldLabelStyle}>Start – End</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <TimeInput
                value={local.session_start || ''}
                onChange={v => { update('session_start', v) }}
                onBlur={() => { setFocusedInput(null); save('session_start', local.session_start || '') }}
                placeholder="Start"
                style={{ ...iStyle('session_start'), width: 78, flex: 'none' }}
              />
              <span style={{ color: 'var(--c-fg-3)', fontSize: 11, flexShrink: 0 }}>–</span>
              <TimeInput
                value={local.session_end || ''}
                onChange={v => { update('session_end', v) }}
                onBlur={() => { setFocusedInput(null); save('session_end', local.session_end || '') }}
                placeholder="End"
                style={{ ...iStyle('session_end'), width: 78, flex: 'none' }}
              />
            </div>
          </div>
        </div>
      </div>
      {/* Staffing — Eng / Asst / No Staff plus an optional person. Whatever is
          chosen here seeds every studio-time row in the Work Order, so staff
          don't have to be typed onto each line by hand. Replaced the old
          "Engineer Needed" boolean, which nothing outside the CRM ever read. */}
      <div style={{ marginTop: 8 }}>
        <div style={fieldLabelStyle}>Staffing</div>
        <StaffPicker
          listId={`lead-staff-${lead.id}`}
          role={(local.staff_role as StaffMode | null) ?? null}
          name={local.staff_name ?? null}
          onChange={({ role, name }) => {
            // Role and name are one decision — persist together so a stale name
            // from the other pool can never survive a role switch.
            update('staff_role', role)
            update('staff_name', name)
            save('staff_role', role)
            save('staff_name', name || null)
          }}
        />
      </div>
      </div>

      {/* ─── Session Notes ─────────────────────────────── */}
      <div className="c-band">
      <div className="c-band-head">Notes</div>
      <textarea
        className="c-well c-well-area"
        value={notesVal}
        onChange={e => setNotesVal(e.target.value)}
        onBlur={() => { if (notesDirty) save('notes', notesVal) }}
        onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px' }}
        ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
        placeholder="Add notes…"
        style={{ width: '100%', resize: 'none', overflow: 'hidden', lineHeight: 1.6 }}
      />
      </div>

      {/* ─── Activity Log ──────────────────────────────── */}
      <details className="c-fold">
      <summary>Activity · {activityLog.length + 1}</summary>
      <div className="c-fold-body" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {activityLog.map((entry, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: entry.color, flexShrink: 0, marginTop: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'DM Mono' }}>{fmtActivityTime(entry.ts)} · </span>
              <span style={{ fontSize: 10, color: 'var(--c-fg-2)', fontFamily: 'Inter' }}>{entry.label}</span>
            </div>
          </div>
        ))}
        {/* Dedicated Lead Created row — always the oldest (last) entry */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--c-fg-2)', flexShrink: 0, marginTop: 3 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'DM Mono' }}>{fmtActivityTime(lead.created_at)} · </span>
            <span style={{ fontSize: 10, color: 'var(--c-fg-2)', fontFamily: 'Inter' }}>{creationLabel}</span>
          </div>
        </div>
      </div>
      </details>

      {/* ─── Tags ──────────────────────────────── */}
      <details className="c-fold" open={tagsOpen} onToggle={e => setTagsOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Tags{localTags.length > 0 ? ` · ${localTags.length}` : ''}</summary>
        {(
          <div className="c-fold-body">
            {/* Existing tags */}
            {localTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {localTags.map(tag => (
                  <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--c-wash)', borderRadius: 20, padding: '2px 8px', fontSize: 10, color: 'var(--c-fg-2)', fontFamily: 'Inter' }}>
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      style={{ background: 'none', padding: 0, cursor: 'pointer', color: 'var(--c-fg-3)', lineHeight: 1, fontSize: 11 }}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            {/* Starter tag chips (not yet applied) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {allTags.filter(t => !localTags.includes(t)).map(tag => (
                <button
                  key={tag}
                  onClick={() => addTag(tag)}
                  style={{ background: 'transparent', borderRadius: 20, padding: '2px 8px', fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', cursor: 'pointer' }}
                >
                  + {tag}
                </button>
              ))}
            </div>
            {/* Custom tag input */}
            <div style={{ position: 'relative' }}>
              <input
                value={tagInput}
                onChange={e => { setTagInput(e.target.value); setTagDDOpen(e.target.value.trim().length > 0) }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && tagInput.trim()) { addTag(tagInput); setTagInput(''); setTagDDOpen(false) }
                  if (e.key === 'Escape') { setTagInput(''); setTagDDOpen(false) }
                }}
                onBlur={() => setTimeout(() => setTagDDOpen(false), 150)}
                placeholder="Add custom tag…"
                style={{ width: '100%', background: 'var(--c-wash)', borderRadius: 4, padding: '5px 8px', fontSize: 10, color: 'var(--c-fg)', fontFamily: 'Inter', outline: 'none', boxSizing: 'border-box' }}
              />
              {tagDDOpen && tagInput.trim() && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--c-bg)', borderRadius: 4, zIndex: 100, marginTop: 2 }}>
                  <button
                    onMouseDown={() => { addTag(tagInput); setTagInput(''); setTagDDOpen(false) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', padding: '6px 10px', fontSize: 10, color: 'var(--c-fg-2)', fontFamily: 'Inter', cursor: 'pointer' }}
                  >
                    Add &ldquo;{tagInput.trim()}&rdquo;
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </details>

      {/* Footer — destructive action, right-aligned. Hot is sanctioned here by the
          §5 ruling that --c-st-hot is dual-purpose: temperature AND critical. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="c-danger" onClick={() => setShowDeleteConfirm(true)}>
          Delete lead
        </button>
      </div>

      {showDeleteConfirm && (
        <div onClick={() => setShowDeleteConfirm(false)} className="c-modal-backdrop" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--c-bg)', borderRadius: 12, padding: '20px 24px', maxWidth: 400, width: '100%' }}>
            <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 14, marginBottom: 8 }}>
              Delete {[lead.fname, lead.lname].filter(Boolean).join(' ') || 'this lead'}?
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-fg-2)', fontFamily: 'Inter', lineHeight: 1.7, marginBottom: 20 }}>
              This will permanently delete this lead and all contact log entries. This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ background: 'transparent', color: 'var(--c-fg-3)', borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: 'Inter', cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={async () => {
                  setDeleting(true)
                  await supabase.from('lead_activity').delete().eq('lead_id', lead.id)
                  await supabase.from('registration_tokens').update({ lead_id: null }).eq('lead_id', lead.id)
                  await supabase.from('leads').delete().eq('id', lead.id)
                  setDeleting(false)
                  setShowDeleteConfirm(false)
                  onDelete?.()
                }}
                disabled={deleting}
                style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--c-st-hot)', borderRadius: 4, padding: '6px 16px', fontSize: 10, fontFamily: 'Inter', cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.7 : 1 }}
              >
                {deleting ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirmModal && (
        <ConfirmClientModal
          lead={lead}
          markBooked={confirmIntent === 'status'}
          onClose={() => setShowConfirmModal(false)}
          onCreated={(clientId) => {
            setShowConfirmModal(false)
            onUpdate('client_id', clientId)
            if (confirmIntent === 'book') {
              // Came from Start Booking — carry straight on into the Work Order.
              // The lead stays as it is; the WO marks it booked when the session
              // is saved, so an abandoned booking doesn't close the lead out.
              leadRouter.push(`/calendar?newBooking=1&clientId=${clientId}&leadId=${lead.id}`)
              return
            }
            // Came from the status pill — the user explicitly chose Booked.
            onUpdate('status', 'booked')
            setShowSuccessModal(true)
          }}
        />
      )}
      {/* FLOW 1 (new client, marked Booked from the status pill): confirmation that
          the client account was created. Only reached when confirmIntent==='status' —
          the Start Booking path redirects into the Work Order instead. */}
      {showSuccessModal && (
        <div
          className="c-modal-backdrop" style={{ zIndex: 3000 }}
          onClick={e => { if (e.target === e.currentTarget) setShowSuccessModal(false) }}
        >
          <div style={{ background: 'var(--c-bg)', borderRadius: 12, padding: '22px 24px', maxWidth: 420, width: '100%' }}>
            <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 18, color: 'var(--c-fg)', marginBottom: 8 }}>Client Account Created</div>
            <div style={{ fontSize: 11, color: 'var(--c-fg-2)', fontFamily: 'Inter', lineHeight: 1.7, marginBottom: 20 }}>New client account created successfully. Proceed to standard booking protocols.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSuccessModal(false)}
                style={{ padding: '7px 18px', borderRadius: 5, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, letterSpacing: '0.05em', cursor: 'pointer', background: 'var(--c-fg)', color: 'var(--c-bg)' }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {/* FLOW 2 (returning client, marked Booked from the status pill): confirm the
          status change. Booking an actual session is the Start Booking button. */}
      {showBookedModal && (
        <div
          className="c-modal-backdrop" style={{ zIndex: 3000 }}
          onClick={e => { if (e.target === e.currentTarget) setShowBookedModal(false) }}
        >
          <div style={{ background: 'var(--c-bg)', borderRadius: 12, padding: '22px 24px', maxWidth: 420, width: '100%' }}>
            <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 18, color: 'var(--c-fg)', marginBottom: 8 }}>Mark as Booked</div>
            <div style={{ fontSize: 11, color: 'var(--c-fg-2)', fontFamily: 'Inter', lineHeight: 1.7, marginBottom: 20 }}>This client has been marked as booked. Proceed to standard booking protocols.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={async () => {
                  if (markingBooked) return
                  setMarkingBooked(true)
                  await supabase.from('leads').update({ status: 'booked' }).eq('id', lead.id)
                  onUpdate('status', 'booked')
                  setMarkingBooked(false)
                  setShowBookedModal(false)
                }}
                disabled={markingBooked}
                style={{ padding: '7px 18px', borderRadius: 5, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, letterSpacing: '0.05em', cursor: markingBooked ? 'default' : 'pointer', background: 'var(--c-fg)', color: 'var(--c-bg)', opacity: markingBooked ? 0.7 : 1 }}
              >
                {markingBooked ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
      {regViewOpen && lead.client_id && (
        <RegViewModal clientId={lead.client_id} onClose={() => setRegViewOpen(false)} />
      )}
    </div>
  )
}

// ─── CONFIRM CLIENT MODAL ─────────────────────────────────────────────────────

function ConfirmClientModal({ lead, onClose, onCreated, markBooked = true }: {
  lead: Lead
  onClose: () => void
  onCreated: (clientId: string) => void
  // Whether creating the client should also close the lead out as booked.
  // TRUE from the status pill (the user explicitly chose Booked). FALSE from
  // Start Booking, where the lead is only booked once the session is actually
  // saved in the Work Order — so backing out of the WO leaves it in the pipeline.
  markBooked?: boolean
}) {
  const isBillingLead = lead.billing === 'Billing'
  const [type, setType] = useState<'individual' | 'label'>(isBillingLead ? 'label' : 'individual')
  const [fname, setFname] = useState(lead.fname || '')
  const [lname, setLname] = useState(lead.lname || '')
  const [email, setEmail] = useState(lead.email || '')
  const [phone, setPhone] = useState(lead.phone || '')
  const [company, setCompany] = useState(lead.company || lead.label || '')
  const [artist, setArtist] = useState('')
  const [instagram, setInstagram] = useState('')
  const [notes, setNotes] = useState(lead.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isLabel = type === 'label'
  const hasName = fname.trim() || lname.trim() || (isLabel && company.trim())
  const hasContact = email.trim() || phone.trim()
  const valid = hasName && hasContact

  async function handleSave() {
    if (!valid || saving) return
    setSaving(true)
    setError('')
    const clientId = crypto.randomUUID()
    const name = isLabel
      ? (company.trim() || `${fname} ${lname}`.trim())
      : `${fname} ${lname}`.trim() || fname.trim() || lname.trim()
    const { error: err } = await supabase.from('clients').insert({
      id: clientId, type,
      name: name || 'Unknown',
      fname: fname || null, lname: lname || null,
      email: email || null, phone: phone || null,
      instagram: instagram || null,
      artists: artist ? [artist] : [],
      notes: notes || null,
      source_lead_id: lead.id,
      tags: lead.tags || [],
      created_at: new Date().toISOString(),
    })
    if (err) { setError(err.message); setSaving(false); return }
    const leadPatch: Partial<Lead> = { client_id: clientId }
    if (markBooked) { leadPatch.status = 'booked'; leadPatch.keep_hot_until = null }
    const { error: leadErr } = await supabase.from('leads').update(leadPatch).eq('id', lead.id)
    if (!dbResult('Linking client to lead', leadErr)) { setSaving(false); return }
    onCreated(clientId)
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(0,0,0,.55)' }
  const fL: React.CSSProperties = { fontSize: 10, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 5, display: 'block' as const }
  const inp: React.CSSProperties = { width: '100%', background: 'var(--c-bg)', borderRadius: 99, color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 12, padding: '10px 16px', outline: 'none', boxSizing: 'border-box' as const, boxShadow: 'inset 3px 3px 9px rgba(0,0,0,.34), inset -3px -3px 9px rgba(255,255,255,.03)' }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--c-bg)', borderRadius: 10, width: '100%', maxWidth: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 18, color: 'var(--c-fg)' }}>Confirm Client Account</div>
            <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)', marginTop: 2 }}>Review and complete before starting booking</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--c-fg-3)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={fL}>Account Type</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['individual', 'label'] as const).map(t => (
                <button key={t} type="button" onClick={() => setType(t)} style={{
                  flex: 1, padding: '6px 0', borderRadius: 5, fontSize: 10,
                  fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.06em', textTransform: 'uppercase',
                  cursor: 'pointer',
                  background: type === t ? 'rgba(139,144,168,0.12)' : 'var(--c-wash)',
                  color: type === t ? 'var(--c-fg)' : 'var(--c-fg-3)',
                  }}>
                  {t === 'label' ? 'Label / Billing' : 'COD'}
                </button>
              ))}
            </div>
          </div>

          {isLabel && (
            <div>
              <label style={fL}>Label / Company</label>
              <input style={inp} value={company} onChange={e => setCompany(e.target.value)} placeholder="Label name" />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={fL}>{isLabel ? 'A&R First Name' : 'First Name'}</label>
              <input style={inp} value={fname} onChange={e => setFname(e.target.value)} placeholder="First" />
            </div>
            <div>
              <label style={fL}>{isLabel ? 'A&R Last Name' : 'Last Name'}</label>
              <input style={inp} value={lname} onChange={e => setLname(e.target.value)} placeholder="Last" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={fL}>Email</label>
              <input style={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="email@..." type="email" />
            </div>
            <div>
              <label style={fL}>Phone</label>
              <input style={inp} value={phone} onChange={e => setPhone(e.target.value)} placeholder="000-000-0000" />
            </div>
          </div>

          {isLabel && (
            <div>
              <label style={fL}>Artist</label>
              <input style={inp} value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist name" />
            </div>
          )}

          <div>
            <label style={fL}>Instagram</label>
            <input style={inp} value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@handle" />
          </div>

          <div>
            <label style={fL}>Notes</label>
            <textarea style={{ ...inp, height: 60, resize: 'vertical' as const, lineHeight: 1.5 }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes..." />
          </div>

          {!hasContact && (
            <div style={{ fontSize: 10, color: 'var(--c-st-warm)', fontFamily: 'Inter', padding: '6px 10px', background: 'rgba(249,115,22,0.08)', borderRadius: 4 }}>
              Requires at minimum a name and email or phone number.
            </div>
          )}
          {error && (
            <div style={{ fontSize: 10, color: 'var(--c-st-hot)', fontFamily: 'Inter', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 4 }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', background: 'transparent', color: 'var(--c-fg-2)', borderRadius: 5, fontFamily: 'Inter', fontSize: 11, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!valid || saving}
            style={{
              padding: '7px 18px', borderRadius: 5, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400,
              fontSize: 11, letterSpacing: '0.05em', cursor: (valid && !saving) ? 'pointer' : 'default',
              background: valid ? 'var(--c-fg)' : 'var(--c-wash)',
              color: valid ? 'var(--c-bg)' : 'var(--c-fg-3)',
            }}
          >
            {saving ? 'Creating…' : 'Start Booking →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── New Lead modal ───────────────────────────────────────────────────────────

function NewLeadModal({ leads, onClose, onSave }: {
  leads: Lead[]
  onClose: () => void
  onSave: (data: Partial<Lead>) => Promise<number | null>
}) {
  const router = useRouter()
  const emptyForm = { fname: '', lname: '', email: '', phone: '', company: '', label: '', source: '', booking: '', notes: '', billing: 'COD' as BillingType, quote: '', rate_daily: '', location: '', session_date: '', session_end_date: '', session_start: '', session_end: '', staff_role: 'assistant' as StaffMode, staff_name: '', artist_name: '' }
  const [mode, setMode] = useState<'cod' | 'label'>('cod')
  const [form, setForm] = useState(emptyForm)
  const [temperature, setTemperature] = useState<'hot' | 'warm' | 'booking'>('hot')
  const [bookingError, setBookingError] = useState('')
  const [needsContact, setNeedsContact] = useState(false)
  const [rateType, setRateType] = useState<'hourly' | 'daily'>('hourly')
  const [formVenue, setFormVenue] = useState('')
  const [formStudio, setFormStudio] = useState('')
  const [labelArtists, setLabelArtists] = useState<string[]>([])

  // COD mode state
  const [matchedClientId, setMatchedClientId] = useState<string | null>(null)
  const [nameSuggestions, setNameSuggestions] = useState<Array<{ record: Lead | Client, type: 'lead' | 'client' }>>([])
  const [showNameDD, setShowNameDD] = useState(false)
  const [nameHighlight, setNameHighlight] = useState(-1)
  const [labelSuggestions, setLabelSuggestions] = useState<string[]>([])
  const [companySuggestions, setCompanySuggestions] = useState<string[]>([])
  const [showLabelDD, setShowLabelDD] = useState(false)
  const [showCompanyDD, setShowCompanyDD] = useState(false)

  // Label mode state
  const [labelClientId, setLabelClientId] = useState<string | null>(null)
  const [labelQuery, setLabelQuery] = useState('')
  // Universal client search (label / A&R / artist) — the single search field in label mode
  const [clientSearch, setClientSearch] = useState('')
  const [uniSuggestions, setUniSuggestions] = useState<UniSuggestion[]>([])
  const [showUniDD, setShowUniDD] = useState(false)
  const [uniHighlight, setUniHighlight] = useState(-1)
  const [anrContacts, setAnrContacts] = useState<ClientContact[]>([])
  const [anrContactId, setAnrContactId] = useState<string | null>(null)
  const [selectedAnr, setSelectedAnr] = useState<ClientContact | null>(null)
  const [anrQuery, setAnrQuery] = useState('')
  const [showAnrDD, setShowAnrDD] = useState(false)
  const [anrHighlight, setAnrHighlight] = useState(-1)
  const [artistQuery, setArtistQuery] = useState('')
  const [showArtistDD, setShowArtistDD] = useState(false)
  const [artistHighlight, setArtistHighlight] = useState(-1)

  const [saving, setSaving] = useState(false)
  const [newLeadTags, setNewLeadTags] = useState<string[]>([])
  const [newTagInput, setNewTagInput] = useState('')
  const [newTagDDOpen, setNewTagDDOpen] = useState(false)
  const nameDebounce = useRef<ReturnType<typeof setTimeout>>()
  const uniDebounce = useRef<ReturnType<typeof setTimeout>>()
  const skipNameSearch = useRef(false)

  // COD: name autocomplete
  useEffect(() => {
    if (mode !== 'cod') return
    if (skipNameSearch.current) { skipNameSearch.current = false; return }
    const query = `${form.fname} ${form.lname}`.trim()
    if (query.length < 2) { setNameSuggestions([]); setShowNameDD(false); return }
    clearTimeout(nameDebounce.current)
    nameDebounce.current = setTimeout(async () => {
      const leadMatches = leads
        .filter(l => fuzzyMatch(query, `${l.fname} ${l.lname} ${l.company || ''}`))
        .slice(0, 6).map(l => ({ record: l as Lead | Client, type: 'lead' as const }))
      const words = query.toLowerCase().split(/\s+/).filter(Boolean)
      let clientQuery = supabase.from('clients').select('id, type, name, fname, lname, email, phone, how_heard, created_at')
      if (words[0]) clientQuery = clientQuery.or(`name.ilike.%${words[0]}%,fname.ilike.%${words[0]}%,lname.ilike.%${words[0]}%`)
      const { data: clientData } = await clientQuery.limit(8)
      const clientMatches = (clientData || [])
        .filter((c: Client) => fuzzyMatch(query, `${c.name} ${c.fname || ''} ${c.lname || ''}`))
        .map((c: Client) => ({ record: c as Lead | Client, type: 'client' as const }))
      const seen = new Set<string>()
      const combined: Array<{ record: Lead | Client, type: 'lead' | 'client' }> = []
      for (const item of [...clientMatches, ...leadMatches]) {
        const key = item.record.email?.toLowerCase() || `${item.record.fname}${item.record.lname}`.toLowerCase()
        if (!seen.has(key)) { seen.add(key); combined.push(item) }
      }
      setNameSuggestions(combined.slice(0, 8))
      setShowNameDD(combined.length > 0)
    }, 250)
    return () => clearTimeout(nameDebounce.current)
  }, [form.fname, form.lname, leads, mode])

  useEffect(() => {
    if (form.label.length < 2) { setLabelSuggestions([]); return }
    const q = form.label.toLowerCase()
    setLabelSuggestions(Array.from(new Set(leads.map(l => l.label).filter((v): v is string => !!v && v.toLowerCase().includes(q)))).slice(0, 6))
  }, [form.label, leads])

  useEffect(() => {
    if (form.company.length < 2) { setCompanySuggestions([]); return }
    const q = form.company.toLowerCase()
    setCompanySuggestions(Array.from(new Set(leads.map(l => l.company).filter((v): v is string => !!v && v.toLowerCase().includes(q)))).slice(0, 6))
  }, [form.company, leads])

  // Label mode: universal client search — matches on label name, A&R contact name, AND artist name.
  // Mirrors the booking form's combined client search (BookingForm.tsx).
  useEffect(() => {
    if (mode !== 'label') return
    const q = clientSearch.trim()
    if (q.length < 2) { setUniSuggestions([]); setShowUniDD(false); return }
    clearTimeout(uniDebounce.current)
    uniDebounce.current = setTimeout(async () => {
      const [labelRes, anrRes, artistRes] = await Promise.all([
        // Label clients by name
        supabase.from('clients').select('id, type, name').eq('type', 'label').ilike('name', `%${q}%`).limit(20),
        // A&R contacts by name, joined to parent label client
        supabase.from('client_contacts').select('id, client_id, fname, lname, email, phone, contact_type, clients(id, type, name)').or(`fname.ilike.%${q}%,lname.ilike.%${q}%`).limit(20),
        // A&R contacts with artist arrays + parent label client; matched client-side
        supabase.from('client_contacts').select('id, client_id, fname, lname, email, phone, artists, contact_type, clients(id, type, name)').neq('artists', '{}').limit(100),
      ])

      const seen = new Set<string>()
      const results: UniSuggestion[] = []

      // Artist matches — A&R contacts whose artist array contains the query (artist is the hero line)
      for (const ct of (artistRes.data || []) as any[]) {
        const parent = ct.clients as any
        if (!parent || parent.type !== 'label') continue
        if (ct.contact_type === 'admin') continue
        if (!Array.isArray(ct.artists)) continue
        for (const artistName of ct.artists as string[]) {
          if (typeof artistName !== 'string') continue
          if (!artistName.toLowerCase().includes(q.toLowerCase())) continue
          const key = `artist-${ct.id}-${artistName}`
          if (seen.has(key)) continue
          seen.add(key)
          results.push({
            clientId: parent.id,
            labelName: parent.name,
            artist: artistName,
            anrName: `${ct.fname || ''} ${ct.lname || ''}`.trim(),
            anrContactId: ct.id,
            anrEmail: ct.email ?? null,
            anrPhone: ct.phone ?? null,
          })
        }
      }

      // A&R name matches
      for (const ct of (anrRes.data || []) as any[]) {
        const parent = ct.clients as any
        if (!parent || parent.type !== 'label') continue
        if (ct.contact_type === 'admin') continue
        const anrName = `${ct.fname || ''} ${ct.lname || ''}`.trim()
        if (!anrName) continue
        const key = `anr-${ct.id}`
        if (seen.has(key)) continue
        seen.add(key)
        results.push({
          clientId: parent.id,
          labelName: parent.name,
          artist: '',
          anrName,
          anrContactId: ct.id,
          anrEmail: ct.email ?? null,
          anrPhone: ct.phone ?? null,
        })
      }

      // Label name matches
      for (const c of (labelRes.data || []) as any[]) {
        const key = `label-${c.id}`
        if (seen.has(key)) continue
        seen.add(key)
        results.push({
          clientId: c.id,
          labelName: c.name,
          artist: '',
          anrName: '',
          anrContactId: null,
          anrEmail: null,
          anrPhone: null,
        })
      }

      setUniSuggestions(results)
      setShowUniDD(results.length > 0)
    }, 200)
    return () => clearTimeout(uniDebounce.current)
  }, [clientSearch, mode])

  // Label mode: load A&R contacts + label artist roster when label client is selected
  useEffect(() => {
    if (!labelClientId) { setAnrContacts([]); setLabelArtists([]); return }
    Promise.all([
      supabase.from('client_contacts').select('*').eq('client_id', labelClientId),
      supabase.from('clients').select('artists').eq('id', labelClientId).single(),
    ]).then(([{ data: contacts }, { data: client }]) => {
      setAnrContacts((contacts as ClientContact[]) || [])
      setLabelArtists((client?.artists as string[]) || [])
    })
  }, [labelClientId])

  // Autofill LABEL + A&R/REP + ARTIST from a universal-search pick. All three fields
  // remain editable afterward (this only seeds their values).
  function selectUniClient(s: UniSuggestion) {
    clearTimeout(uniDebounce.current)
    // LABEL
    setLabelClientId(s.clientId)
    setLabelQuery(s.labelName)
    set('label', s.labelName)
    // A&R / REP
    if (s.anrContactId) {
      setAnrContactId(s.anrContactId)
      setAnrQuery(s.anrName)
      setSelectedAnr({ id: s.anrContactId, client_id: s.clientId, fname: s.anrName.split(' ')[0] || null, lname: s.anrName.split(' ').slice(1).join(' ') || null, email: s.anrEmail, phone: s.anrPhone, instagram: null, role: null, notes: null, contact_type: 'anr', artists: null })
      if (s.anrEmail) set('email', s.anrEmail)
      if (s.anrPhone) set('phone', s.anrPhone)
      setAnrHighlight(-1)
    } else {
      setAnrContactId(null); setSelectedAnr(null); setAnrQuery(''); setAnrHighlight(-1)
    }
    // ARTIST
    if (s.artist) {
      setArtistQuery(s.artist)
      set('artist_name', s.artist)
    }
    setClientSearch('')
    setShowUniDD(false)
    setUniHighlight(-1)
  }

  function selectAnr(contact: ClientContact) {
    setAnrContactId(contact.id)
    setSelectedAnr(contact)
    setAnrQuery(`${contact.fname || ''} ${contact.lname || ''}`.trim())
    setShowAnrDD(false)
    setAnrHighlight(-1)
    if (contact.email) set('email', contact.email)
    if (contact.phone) set('phone', contact.phone)
  }

  async function addNewAnrContact(name: string) {
    if (!labelClientId) return
    const parts = name.trim().split(/\s+/)
    const fname = parts[0] || ''
    const lname = parts.slice(1).join(' ')
    const { data } = await supabase.from('client_contacts').insert({
      client_id: labelClientId, fname, lname: lname || null, contact_type: 'anr', artists: [],
    }).select().single()
    if (data) {
      const contact = data as ClientContact
      setAnrContacts(prev => [...prev, contact])
      selectAnr(contact)
    }
  }

  async function addArtistImmediately(name: string) {
    if (!labelClientId) return
    const trimmed = name.trim()
    const updated = await addArtistToLabel(labelClientId, trimmed, labelArtists)
    setLabelArtists(updated)
    if (anrContactId && selectedAnr) {
      const current = selectedAnr.artists || []
      if (!current.some(a => a.toLowerCase() === trimmed.toLowerCase())) {
        const next = [...current, trimmed]
        await supabase.from('client_contacts').update({ artists: next }).eq('id', anrContactId)
        setSelectedAnr(prev => prev ? { ...prev, artists: next } : prev)
      }
    }
    setArtistQuery(trimmed)
    set('artist_name', trimmed)
    setShowArtistDD(false)
    setArtistHighlight(-1)
  }

  const anrFiltered = anrContacts.filter(c =>
    `${c.fname || ''} ${c.lname || ''}`.toLowerCase().includes(anrQuery.toLowerCase())
  )
  const artistSuggestions = labelArtists.filter(a =>
    a.toLowerCase().includes(artistQuery.toLowerCase()) &&
    a.toLowerCase() !== artistQuery.trim().toLowerCase()
  )

  function applyAutofill(item: { record: Lead | Client, type: 'lead' | 'client' }) {
    skipNameSearch.current = true
    clearTimeout(nameDebounce.current)
    const r = item.record
    const isClient = item.type === 'client'
    const prevNote = isClient
      ? `Repeat client — last booking: ${fmtDate(r.created_at)}`
      : `Previous inquiry: ${fmtDate(r.created_at)} — ${((r as Lead).notes || '').slice(0, 120)}`
    if (isClient) {
      const c = r as Client
      setMatchedClientId(c.id)
      setForm(prev => ({ ...prev, fname: c.fname || prev.fname, lname: c.lname || prev.lname, email: c.email || prev.email, phone: c.phone || prev.phone, company: c.type === 'label' ? c.name : prev.company, label: c.type === 'label' ? c.name : prev.label, source: c.how_heard || prev.source, notes: prevNote }))
    } else {
      const l = r as Lead
      setMatchedClientId(null)
      setForm(prev => ({ ...prev, fname: l.fname || prev.fname, lname: l.lname || prev.lname, email: l.email || prev.email, phone: l.phone || prev.phone, company: l.company || prev.company, label: l.label || prev.label, source: l.source || prev.source, booking: l.booking || prev.booking, billing: l.billing || prev.billing, notes: prevNote }))
    }
    setShowNameDD(false); setNameHighlight(-1)
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (!showNameDD || nameSuggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setNameHighlight(h => Math.min(h + 1, nameSuggestions.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setNameHighlight(h => Math.max(h - 1, 0)) }
    if (e.key === 'Enter' && nameHighlight >= 0) { e.preventDefault(); applyAutofill(nameSuggestions[nameHighlight]) }
    if (e.key === 'Escape') { setShowNameDD(false) }
  }

  function handleUniKeyDown(e: React.KeyboardEvent) {
    if (!showUniDD || uniSuggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setUniHighlight(h => Math.min(h + 1, uniSuggestions.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setUniHighlight(h => Math.max(h - 1, 0)) }
    if (e.key === 'Enter' && uniHighlight >= 0) { e.preventDefault(); selectUniClient(uniSuggestions[uniHighlight]) }
    if (e.key === 'Escape') { setShowUniDD(false); setUniHighlight(-1) }
  }

  function handleAnrKeyDown(e: React.KeyboardEvent) {
    if (!showAnrDD) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setAnrHighlight(h => Math.min(h + 1, anrFiltered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAnrHighlight(h => Math.max(h - 1, 0)) }
    if (e.key === 'Enter' && anrHighlight >= 0 && anrFiltered[anrHighlight]) { e.preventDefault(); selectAnr(anrFiltered[anrHighlight]) }
    if (e.key === 'Escape') { setShowAnrDD(false); setAnrHighlight(-1) }
  }

  function handleArtistKeyDown(e: React.KeyboardEvent) {
    if (!showArtistDD || artistSuggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setArtistHighlight(h => Math.min(h + 1, artistSuggestions.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setArtistHighlight(h => Math.max(h - 1, 0)) }
    if (e.key === 'Enter' && artistHighlight >= 0) { e.preventDefault(); const a = artistSuggestions[artistHighlight]; setArtistQuery(a); set('artist_name', a); setShowArtistDD(false); setArtistHighlight(-1) }
    if (e.key === 'Escape') { setShowArtistDD(false); setArtistHighlight(-1) }
  }

  function set(key: string, val: string) { setForm(prev => ({ ...prev, [key]: val })) }

  async function handleSave() {
    setSaving(true)
    setBookingError('')
    const status: LeadStatus = temperature === 'hot' ? 'hot' : temperature === 'warm' ? 'warm' : 'booked'

    if (mode === 'label') {
      if (!labelQuery.trim()) { setSaving(false); return }
      if (temperature === 'booking' && !labelClientId) {
        setBookingError('No client profile linked — use auto-match before booking.')
        setSaving(false)
        return
      }
      const parts = anrQuery.trim().split(/\s+/)
      const fname = parts[0] || ''
      const lname = parts.slice(1).join(' ')
      const data: Partial<Lead> = {
        ...form,
        fname,
        lname,
        label: labelQuery.trim(),
        artist_name: artistQuery.trim() || null,
        client_id: labelClientId,
        anr_contact_id: anrContactId,
        billing: 'Billing',
        status,
        needs_contact: needsContact,
        tags: newLeadTags,
      }
      const leadId = await onSave(data)
      setSaving(false)
      if (temperature === 'booking' && labelClientId) {
        router.push(`/calendar?newBooking=1&clientId=${labelClientId}&leadId=${leadId}`)
      }
      return
    }

    // COD mode
    if (!form.fname && !form.lname && !form.email && !form.phone) { setSaving(false); return }
    if (temperature === 'booking' && !matchedClientId) {
      setBookingError('No client profile linked — use auto-match before booking.')
      setSaving(false)
      return
    }
    const data: Partial<Lead> = { ...form, status, needs_contact: needsContact, tags: newLeadTags }
    if (matchedClientId) data.client_id = matchedClientId
    const leadId = await onSave(data)
    setSaving(false)
    if (temperature === 'booking' && matchedClientId) {
      router.push(`/calendar?newBooking=1&clientId=${matchedClientId}&leadId=${leadId}`)
    }
  }

  // Carved input: capsule, carved IN, focus is a depth change. Callers that spread
  // this (`{...inputStyle}`) still work; the depth comes from the class below, so
  // anything spreading it must ALSO carry className="c-input c-inset2".
  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--c-bg)', color: 'var(--c-fg)', padding: '10px 16px', borderRadius: 99, fontFamily: 'Inter', fontSize: 12, outline: 'none', boxShadow: 'inset 3px 3px 9px rgba(0,0,0,.34), inset -3px -3px 9px rgba(255,255,255,.03)' }
  const labelS: React.CSSProperties = { fontSize: 10, fontWeight: 800, color: 'var(--c-fg-3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5, display: 'block' }

  const modeToggle = (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ display: 'flex', gap: 2, background: 'var(--c-bg)', borderRadius: 8, padding: 3 }}>
        {(['cod', 'label'] as const).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)} style={{ padding: '7px 28px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, fontWeight: 500, background: mode === m ? 'var(--c-wash)' : 'transparent', color: mode === m ? 'var(--c-fg)' : 'var(--c-fg-2)', transition: 'all 0.15s', letterSpacing: '0.04em' }}>
            {m === 'cod' ? 'COD' : 'Label/Billing'}
          </button>
        ))}
      </div>
    </div>
  )

  const temperatureRow = (
    <div>
      <label style={labelS}>Lead Temperature</label>
      <div style={{ display: 'flex', gap: 8 }}>
        {([
          { key: 'hot', label: 'Hot', color: 'var(--c-st-hot)' },
          { key: 'warm', label: 'Warm', color: 'var(--c-st-warm)' },
          { key: 'booking', label: 'Move to Booking', color: 'var(--c-st-booked)' },
        ] as const).map(opt => (
          <button key={opt.key} type="button" onClick={() => setTemperature(opt.key)} className={`c-pill c-control ${statusFillClass(opt.key === 'booking' ? 'booked' : opt.key)} ${temperature === opt.key ? 'c-pressed' : 'c-raised-chip'}`}
            style={{ flex: opt.key === 'booking' ? 2 : 1, justifyContent: 'center', padding: '8px 0', opacity: temperature === opt.key ? 1 : 0.55 }}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )

  const needsContactToggle = (
    <button
      type="button"
      onClick={() => setNeedsContact(nc => !nc)}
      style={{ alignSelf: 'flex-start', padding: '5px 14px', borderRadius: 20, background: needsContact ? 'rgba(123,167,188,0.12)' : 'transparent', color: needsContact ? 'var(--c-st-uncon)' : 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.15s' }}
    >
      {needsContact ? '● Needs Contact' : '○ Needs Contact'}
    </button>
  )

  const sessionDetails = (
    <div>
      <div style={{ fontSize: 9, color: 'var(--c-fg-3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8, fontFamily: "'Archivo Black', sans-serif", fontWeight: 700 }}>Session Details</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelS}>Studio / Location</label>
          <StudioSelect
            location={formVenue}
            studio={formStudio}
            onChange={(venue, studio) => {
              setFormVenue(venue)
              setFormStudio(studio)
              set('location', combineLocation(venue, studio))
            }}
            selectStyle={{ ...inputStyle, cursor: 'pointer', flex: 1 }}
          />
        </div>
        <div>
          <label style={labelS}>Quote / Rate</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="c-seg c-seg-tiny">
            <button type="button" onClick={() => setRateType('hourly')} className={rateType === 'hourly' ? 'c-on' : ''}>/ hr</button>
            <button type="button" onClick={() => setRateType('daily')} className={rateType === 'daily' ? 'c-on' : ''}>/ day</button>
            </span>
            <input
              value={rateType === 'hourly' ? form.quote : form.rate_daily}
              onChange={e => set(rateType === 'hourly' ? 'quote' : 'rate_daily', e.target.value)}
              onBlur={e => { const f = fmtMoney(e.target.value); const key = rateType === 'hourly' ? 'quote' : 'rate_daily'; if (f !== e.target.value) set(key, f) }}
              placeholder="$0"
              style={{ ...inputStyle, borderRadius: '0 4px 4px 0', marginLeft: 6 }}
            />
          </div>
        </div>
      </div>
      {/* Dates first, then times. End Date is optional and exists so a client
          asking to hold a block ("we want a week") can be captured as a range
          instead of a single day — it seeds the booking's end_date on convert. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <div><label style={labelS}>Session Date</label><input type="date" value={form.session_date} onChange={e => set('session_date', e.target.value)} style={inputStyle} /></div>
        <div>
          <label style={labelS}>End Date <span style={{ color: 'var(--c-fg-3)', fontWeight: 400 }}>(optional)</span></label>
          <input
            type="date"
            value={form.session_end_date}
            min={form.session_date || undefined}
            title="Only for a multi-day hold — leave blank for a single day"
            onChange={e => set('session_end_date', e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <div><label style={labelS}>Start Time</label><TimeInput value={form.session_start} onChange={v => set('session_start', v)} style={inputStyle} /></div>
        <div><label style={labelS}>End Time</label><TimeInput value={form.session_end} onChange={v => set('session_end', v)} style={inputStyle} /></div>
      </div>
      {/* Staffing — same control as the lead detail (shared component so the two
          can't drift). Defaults to Assistant; seeds the Work Order on booking. */}
      <div style={{ marginTop: 10 }}>
        <label style={labelS}>Staffing</label>
        <StaffPicker
          listId="new-lead-staff"
          role={form.staff_role as StaffMode}
          name={form.staff_name}
          onChange={({ role, name }) => setForm(prev => ({ ...prev, staff_role: role, staff_name: name }))}
        />
      </div>
    </div>
  )

  return (
    <div onClick={onClose} className="c-modal-backdrop" style={{ zIndex: 1000, paddingTop: 64 }}>
      <div onClick={e => e.stopPropagation()} className="c-sheet" style={{ width: 540, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: 'var(--c-bg)' }}>
          <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 15 }}>New Lead</span>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--c-fg-3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {modeToggle}
          {mode === 'cod' ? (
            <>
              {/* COD: name fields + autocomplete */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, position: 'relative' }}>
                <div>
                  <label style={labelS}>First Name</label>
                  <input autoFocus value={form.fname} onChange={e => { set('fname', e.target.value); setShowNameDD(true) }} onFocus={() => setShowNameDD(nameSuggestions.length > 0)} onBlur={() => setTimeout(() => setShowNameDD(false), 200)} onKeyDown={handleNameKeyDown} style={inputStyle} />
                </div>
                <div>
                  <label style={labelS}>Last Name</label>
                  <input value={form.lname} onChange={e => { set('lname', e.target.value); setShowNameDD(true) }} onFocus={() => setShowNameDD(nameSuggestions.length > 0)} onBlur={() => setTimeout(() => setShowNameDD(false), 200)} onKeyDown={handleNameKeyDown} style={inputStyle} />
                </div>
                {showNameDD && nameSuggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--c-wash)', borderRadius: 8, zIndex: 20, marginTop: 2, overflow: 'hidden' }}>
                    {nameSuggestions.map((item, i) => {
                      const r = item.record; const isClient = item.type === 'client'
                      return (
                        <div key={`${item.type}-${r.id}`} onMouseDown={() => applyAutofill(item)} style={{ padding: '10px 14px', cursor: 'pointer', background: i === nameHighlight ? 'var(--c-bg)' : isClient ? 'rgba(20,184,166,0.04)' : 'transparent' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: isClient ? 'var(--c-st-booked)' : 'var(--c-fg)' }}>
                              {isClient ? (r as Client).name || `${r.fname || ''} ${r.lname || ''}`.trim() : `${r.fname} ${r.lname}`}
                            </span>
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: isClient ? 'rgba(20,184,166,0.15)' : 'rgba(139,144,168,0.12)', color: isClient ? 'var(--c-st-booked)' : 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                              {isClient ? '★ Client' : 'Prev. Inquiry'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>
                            {r.email && <span>{r.email}</span>}
                            {r.phone && <span>{r.phone}</span>}
                            {!isClient && (r as Lead).booking && <span>{(r as Lead).booking}</span>}
                            <span>{fmtDate(r.created_at)}</span>
                          </div>
                        </div>
                      )
                    })}
                    <div onMouseDown={() => { setMatchedClientId(null); setShowNameDD(false); setNameHighlight(-1) }} style={{ padding: '9px 14px', cursor: 'pointer', color: 'var(--c-fg)', fontSize: 11, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> None of these — New Client
                    </div>
                  </div>
                )}
                {matchedClientId && (
                  <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(20,184,166,0.08)', borderRadius: 6 }}>
                    <span style={{ color: 'var(--c-st-booked)', fontSize: 12 }}>★</span>
                    <span style={{ fontSize: 11, color: 'var(--c-st-booked)', fontFamily: 'Inter', flex: 1 }}>Matched to existing client profile</span>
                    <button onMouseDown={() => setMatchedClientId(null)} style={{ background: 'none', color: 'var(--c-fg-3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                )}
              </div>
              <div>
                <label style={labelS}>Artist Name</label>
                <input value={form.artist_name} onChange={e => set('artist_name', e.target.value)} placeholder="Stage name / artist name" style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label style={labelS}>Email</label><input value={form.email} onChange={e => set('email', e.target.value)} type="email" style={inputStyle} /></div>
                <div><label style={labelS}>Phone</label><PhoneInput value={form.phone} onChange={v => set('phone', v)} variant="bordered" /></div>
              </div>
              {temperatureRow}
              {needsContactToggle}
              {sessionDetails}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label style={labelS}>Source</label><select value={form.source} onChange={e => set('source', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}><option value="">—</option><option>Call</option><option>Text</option><option>Email</option><option>Squarespace</option></select></div>
                <div>
                  <label style={labelS}>Booking Type</label>
                  <select value={form.booking} onChange={e => set('booking', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="">—</option><option>Recording Session</option><option>Filming</option><option>Event/Playback</option><option>Long Term/Leasing</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelS}>Billing</label>
                <select value={form.billing} onChange={e => set('billing', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="COD">COD</option><option value="Billing">Billing</option>
                </select>
              </div>
            </>
          ) : (
            <>
              {/* Label mode: universal search → autofills Label / A&R / Artist */}
              <div style={{ position: 'relative' }}>
                <label style={labelS}>Search Client</label>
                <input
                  autoFocus
                  value={clientSearch}
                  onChange={e => { setClientSearch(e.target.value); setUniHighlight(-1); setShowUniDD(true) }}
                  onFocus={() => setShowUniDD(uniSuggestions.length > 0)}
                  onBlur={() => setTimeout(() => setShowUniDD(false), 200)}
                  onKeyDown={handleUniKeyDown}
                  placeholder="Search client name…"
                  style={inputStyle}
                />
                {showUniDD && uniSuggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--c-wash)', borderRadius: 8, zIndex: 20, marginTop: 2, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
                    {uniSuggestions.map((s, i) => (
                      <div key={`${s.clientId}-${s.artist}-${s.anrContactId || ''}-${i}`} onMouseDown={() => selectUniClient(s)} style={{ padding: '10px 14px', cursor: 'pointer', background: i === uniHighlight ? 'var(--c-bg)' : 'transparent' }}>
                        <div style={{ fontSize: 12, color: 'var(--c-fg)', marginBottom: 2 }}>
                          {s.artist && <span style={{ fontWeight: 700 }}>{s.artist}</span>}
                          {s.artist && (s.labelName || s.anrName) && <span style={{ color: 'var(--c-fg-3)' }}> · </span>}
                          {s.labelName && <span style={{ color: 'var(--c-fg-2)' }}>{s.labelName}</span>}
                          {s.anrName && <span style={{ color: 'var(--c-fg-3)' }}> · {s.anrName}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ position: 'relative' }}>
                <label style={labelS}>Label</label>
                <input
                  value={labelQuery}
                  onChange={e => { setLabelQuery(e.target.value); set('label', e.target.value); setLabelClientId(null) }}
                  placeholder="Label name…"
                  style={inputStyle}
                />
                {labelClientId && (
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--c-st-booked)', fontFamily: 'Inter' }}>
                    <span>★ Linked to label client</span>
                    <button onMouseDown={() => { setLabelClientId(null); setAnrContactId(null); setSelectedAnr(null); setAnrQuery(''); setAnrHighlight(-1) }} style={{ background: 'none', color: 'var(--c-fg-3)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                )}
              </div>

              <div style={{ position: 'relative' }}>
                <label style={labelS}>A&R / Rep</label>
                <input
                  value={anrQuery}
                  onChange={e => { setAnrQuery(e.target.value); setAnrContactId(null); setSelectedAnr(null); setAnrHighlight(-1); setShowAnrDD(true) }}
                  onFocus={() => setShowAnrDD(true)}
                  onBlur={() => setTimeout(() => setShowAnrDD(false), 200)}
                  onKeyDown={handleAnrKeyDown}
                  placeholder="A&R / rep name…"
                  style={inputStyle}
                />
                {showAnrDD && labelClientId && (anrFiltered.length > 0 || anrQuery.trim().length >= 2) && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--c-wash)', borderRadius: 8, zIndex: 20, marginTop: 2, overflow: 'hidden' }}>
                    {anrFiltered.map((c, i) => (
                      <div key={c.id} onMouseDown={() => selectAnr(c)} style={{ padding: '10px 14px', cursor: 'pointer', background: i === anrHighlight ? 'var(--c-bg)' : 'transparent' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{c.fname} {c.lname}</div>
                        <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>
                          {c.email && <span>{c.email}</span>}
                          {c.phone && <span>{c.phone}</span>}
                        </div>
                      </div>
                    ))}
                    {anrQuery.trim().length >= 2 && !anrFiltered.some(c => `${c.fname || ''} ${c.lname || ''}`.trim().toLowerCase() === anrQuery.trim().toLowerCase()) && (
                      <div onMouseDown={() => addNewAnrContact(anrQuery.trim())} style={{ padding: '9px 14px', cursor: 'pointer', color: 'var(--c-fg)', fontSize: 11, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Don&apos;t see this A&R? Add &ldquo;{anrQuery.trim()}&rdquo;
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ position: 'relative' }}>
                <label style={labelS}>Artist</label>
                <input
                  value={artistQuery}
                  onChange={e => { setArtistQuery(e.target.value); set('artist_name', e.target.value); setArtistHighlight(-1); setShowArtistDD(true) }}
                  onFocus={() => setShowArtistDD(true)}
                  onBlur={() => setTimeout(() => setShowArtistDD(false), 200)}
                  onKeyDown={handleArtistKeyDown}
                  placeholder="Artist name…"
                  style={inputStyle}
                />
                {showArtistDD && (artistSuggestions.length > 0 || (artistQuery.trim().length >= 2 && !labelArtists.some(a => a.toLowerCase() === artistQuery.trim().toLowerCase()))) && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--c-wash)', borderRadius: 8, zIndex: 20, marginTop: 2, overflow: 'hidden' }}>
                    {artistSuggestions.map((a, i) => (
                      <div key={a} onMouseDown={() => { setArtistQuery(a); set('artist_name', a); setShowArtistDD(false); setArtistHighlight(-1) }} style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 12, fontFamily: 'Inter', background: i === artistHighlight ? 'var(--c-bg)' : 'transparent' }}>{a}</div>
                    ))}
                    {artistQuery.trim().length >= 2 && !labelArtists.some(a => a.toLowerCase() === artistQuery.trim().toLowerCase()) && (
                      <div onMouseDown={() => addArtistImmediately(artistQuery.trim())} style={{ padding: '9px 14px', cursor: 'pointer', color: 'var(--c-fg)', fontSize: 11, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Don&apos;t see this artist? Add &ldquo;{artistQuery.trim()}&rdquo;{anrContactId && selectedAnr ? ` under ${selectedAnr.fname || ''}` : ' to roster'}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label style={labelS}>Email</label><input value={form.email} onChange={e => set('email', e.target.value)} type="email" style={inputStyle} /></div>
                <div><label style={labelS}>Phone</label><PhoneInput value={form.phone} onChange={v => set('phone', v)} variant="bordered" /></div>
              </div>
              {temperatureRow}
              {needsContactToggle}
              {sessionDetails}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label style={labelS}>Source</label><select value={form.source} onChange={e => set('source', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}><option value="">—</option><option>Call</option><option>Text</option><option>Email</option><option>Squarespace</option></select></div>
                <div>
                  <label style={labelS}>Booking Type</label>
                  <select value={form.booking} onChange={e => set('booking', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="">—</option><option>Recording Session</option><option>Filming</option><option>Event/Playback</option><option>Long Term/Leasing</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div>
            <label style={labelS}>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="e.g. recording session, mixing, overdubs, artist name, any special requirements…" style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          {/* ─── Tags ─────────────────────────────── */}
          <div style={{ paddingTop: 12 }}>
            <label style={labelS}>Tags</label>
            {/* Applied tags */}
            {newLeadTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {newLeadTags.map(tag => (
                  <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--c-wash)', borderRadius: 20, padding: '2px 8px', fontSize: 10, color: 'var(--c-fg-2)', fontFamily: 'Inter' }}>
                    {tag}
                    <button onClick={() => setNewLeadTags(ts => ts.filter(t => t !== tag))} style={{ background: 'none', padding: 0, cursor: 'pointer', color: 'var(--c-fg-3)', lineHeight: 1, fontSize: 11 }}>×</button>
                  </span>
                ))}
              </div>
            )}
            {/* Starter chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {STARTER_TAGS.filter(t => !newLeadTags.includes(t)).map(tag => (
                <button key={tag} type="button" onClick={() => setNewLeadTags(ts => [...ts, tag])} style={{ background: 'transparent', borderRadius: 20, padding: '2px 8px', fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', cursor: 'pointer' }}>
                  + {tag}
                </button>
              ))}
            </div>
            {/* Custom input */}
            <div style={{ position: 'relative' }}>
              <input
                value={newTagInput}
                onChange={e => { setNewTagInput(e.target.value); setNewTagDDOpen(e.target.value.trim().length > 0) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); if (newTagInput.trim() && !newLeadTags.includes(newTagInput.trim())) setNewLeadTags(ts => [...ts, newTagInput.trim()]); setNewTagInput(''); setNewTagDDOpen(false) }
                  if (e.key === 'Escape') { setNewTagInput(''); setNewTagDDOpen(false) }
                }}
                onBlur={() => setTimeout(() => setNewTagDDOpen(false), 150)}
                placeholder="Add custom tag…"
                style={{ ...inputStyle, padding: '5px 8px', fontSize: 10 }}
              />
              {newTagDDOpen && newTagInput.trim() && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--c-bg)', borderRadius: 4, zIndex: 100, marginTop: 2 }}>
                  <button
                    onMouseDown={() => { if (!newLeadTags.includes(newTagInput.trim())) setNewLeadTags(ts => [...ts, newTagInput.trim()]); setNewTagInput(''); setNewTagDDOpen(false) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', padding: '6px 10px', fontSize: 10, color: 'var(--c-fg-2)', fontFamily: 'Inter', cursor: 'pointer' }}
                  >
                    Add &ldquo;{newTagInput.trim()}&rdquo;
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 20px 20px', flexShrink: 0, background: 'var(--c-bg)' }}>
          {bookingError && (
            <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--c-st-hot)', fontFamily: 'Inter' }}>{bookingError}</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '9px 0', background: 'var(--c-fg)', color: 'var(--c-bg)', borderRadius: 6, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, cursor: saving ? 'not-allowed' : 'pointer', letterSpacing: '0.05em', textTransform: 'uppercase', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : temperature === 'booking' ? 'Save & Go to Booking →' : 'Create Lead'}
            </button>
            <button onClick={onClose} style={{ padding: '9px 20px', background: 'transparent', color: 'var(--c-fg-2)', borderRadius: 6, fontFamily: 'Inter', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Email modal ──────────────────────────────────────────────────────────────

function EmailModal({ lead, onClose }: { lead: Lead, onClose: () => void }) {
  const subject = `Following up — PRS Studio availability`
  const defaultBody = `Hi ${lead.fname},\n\nFollowing up on your inquiry about ${lead.booking || 'a session'} at Paramount Recording Studios.\n\nWe have great availability coming up and would love to get something on the books for you.\n\nFeel free to reply or give us a call — happy to answer any questions.\n\n— Paramount Recording Studios`
  const [body, setBody] = useState(defaultBody)
  const [copied, setCopied] = useState(false)

  async function handleCopyAndOpen() {
    try { await navigator.clipboard.writeText(body) } catch (_) {}
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  return (
    <div onClick={onClose} className="c-modal-backdrop" style={{ zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} className="c-sheet" style={{ width: 520 }}>
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 15 }}>Email {lead.fname} {lead.lname}</div>
            <div style={{ fontSize: 10, color: 'var(--c-fg-3)', marginTop: 2, fontFamily: 'Inter' }}>{lead.email || 'No email on file'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--c-fg-3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 9, color: 'var(--c-fg-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Subject: {subject}</div>
          <textarea value={body} onChange={e => setBody(e.target.value)} style={{ width: '100%', height: 220, background: 'var(--c-wash)', color: 'var(--c-fg)', padding: '10px 12px', borderRadius: 7, fontFamily: 'Inter', fontSize: 11, resize: 'none', outline: 'none', lineHeight: 1.6 }} />
        </div>
        <div style={{ padding: '0 20px 20px', display: 'flex', gap: 8 }}>
          <button onClick={handleCopyAndOpen} disabled={!lead.email} style={{ flex: 1, padding: '9px 0', background: lead.email ? 'var(--c-fg)' : 'var(--c-wash)', color: lead.email ? 'var(--c-bg)' : 'var(--c-fg-3)', borderRadius: 6, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, cursor: lead.email ? 'pointer' : 'not-allowed', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {copied ? '✓ Copied!' : '✉ Copy & Open Mail'}
          </button>
          <button onClick={onClose} style={{ padding: '9px 20px', background: 'transparent', color: 'var(--c-fg-2)', borderRadius: 6, fontFamily: 'Inter', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Donut chart ──────────────────────────────────────────────────────────────

function DonutChart({ segments, size = 100 }: {
  segments: Array<{ label: string, value: number, color: string }>
  size?: number
}) {
  const sw = Math.round(size * 0.18)
  const r = (size - sw) / 2
  const cx = size / 2
  const cy = size / 2
  const C = 2 * Math.PI * r
  const total = segments.reduce((s, seg) => s + seg.value, 0)

  if (total === 0) return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="transparent" style={{ stroke: 'var(--c-wash2)' }} strokeWidth={sw} />
    </svg>
  )

  let cumLen = 0
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="transparent" style={{ stroke: 'var(--c-wash2)' }} strokeWidth={sw} />
      {segments.map((seg, i) => {
        const L = (seg.value / total) * C
        const dashOffset = C - cumLen
        cumLen += L
        if (L < 0.5) return null
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="transparent"
            style={{ stroke: seg.color }} strokeWidth={sw}
            strokeDasharray={`${L} ${C - L}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )
      })}
    </svg>
  )
}

// ─── Chart card ───────────────────────────────────────────────────────────────

function ChartCard({ title, subtitle, segments }: {
  title: string
  subtitle: string
  segments: Array<{ label: string, value: number, color: string }>
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  return (
    <div style={{ background: 'var(--c-bg)', borderRadius: 10, padding: 20 }}>
      <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 13, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 10, color: 'var(--c-fg-3)', marginBottom: 12, fontFamily: 'Inter' }}>{subtitle}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <DonutChart segments={segments} size={90} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {segments.slice(0, 6).map(seg => (
            <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--c-fg-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seg.label}</span>
              <span style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', flexShrink: 0 }}>
                {seg.value} <span style={{ opacity: 0.6 }}>({total ? Math.round(seg.value / total * 100) : 0}%)</span>
              </span>
            </div>
          ))}
          {segments.length > 6 && (
            <div style={{ fontSize: 9, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>+{segments.length - 6} more</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Analytics ────────────────────────────────────────────────────────────────

function AnalyticsView({ leads }: { leads: Lead[] }) {
  const [rangePreset, setRangePreset] = useState<AnalyticsRangePreset>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const range = getAnalyticsRange(rangePreset, customStart, customEnd)
  const leadsInRange = range
    ? leads.filter(l => { const t = new Date(l.created_at).getTime(); return t >= range.start.getTime() && t <= range.end.getTime() })
    : leads

  const rangeLabel = ANALYTICS_RANGE_LABELS[rangePreset]
  const rangeLabelLower = rangeLabel.toLowerCase()

  const total = leadsInRange.length
  const booked = leadsInRange.filter(l => l.status === 'booked').length
  const convRate = total > 0 ? Math.round(booked / total * 100) : 0
  const bookedLeads = leadsInRange.filter(l => l.status === 'booked')
  const labelLeads = bookedLeads.filter(l => l.label)

  const charts = [
    { title: 'COD vs Billing', subtitle: `All inquiries, ${rangeLabelLower}`, segs: toSegments(groupBy(leadsInRange, 'billing')) },
    { title: 'COD vs Billing (Booked)', subtitle: `Confirmed sessions, ${rangeLabelLower}`, segs: toSegments(groupBy(bookedLeads, 'billing')) },
    { title: 'Booking Type', subtitle: `All inquiries, ${rangeLabelLower}`, segs: toSegments(groupBy(leadsInRange, 'booking')) },
    { title: 'Booking Type (Booked)', subtitle: `Confirmed sessions, ${rangeLabelLower}`, segs: toSegments(groupBy(bookedLeads, 'booking')) },
    { title: 'Inquiry Source', subtitle: `All inquiries, ${rangeLabelLower}`, segs: toSegments(groupBy(leadsInRange, 'source')) },
    { title: 'Bookings by Label', subtitle: `${labelLeads.length} sessions with label data, ${rangeLabelLower}`, segs: toSegments(groupBy(labelLeads, 'label')) },
  ]

  const dateInputStyle = { background: 'var(--c-bg)', color: 'var(--c-fg-2)', padding: '6px 10px', borderRadius: 6, fontFamily: 'Inter', fontSize: 11, outline: 'none', cursor: 'pointer' } as const

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 32, letterSpacing: -1 }}>
          Analytics <em style={{ fontStyle: 'italic', color: 'var(--c-fg)' }}>&amp; Insights</em>
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select
            value={rangePreset}
            onChange={e => setRangePreset(e.target.value as AnalyticsRangePreset)}
            style={{ background: 'var(--c-bg)', color: 'var(--c-fg-2)', padding: '6px 12px', borderRadius: 6, fontFamily: 'Inter', fontSize: 11, outline: 'none', cursor: 'pointer' }}
          >
            {(Object.keys(ANALYTICS_RANGE_LABELS) as AnalyticsRangePreset[]).map(p => (
              <option key={p} value={p}>{ANALYTICS_RANGE_LABELS[p]}</option>
            ))}
          </select>
          {rangePreset === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={dateInputStyle} />
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={dateInputStyle} />
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Total Leads', value: total.toLocaleString(), color: 'var(--c-fg)', sub: rangeLabel },
          { label: 'Booked', value: booked.toLocaleString(), color: 'var(--c-fg)', sub: 'Confirmed sessions' },
          { label: 'Conversion Rate', value: `${convRate}%`, color: 'var(--c-fg)', sub: 'Leads to booked' },
        ].map(stat => (
          <div key={stat.label} style={{ background: 'var(--c-bg)', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-fg-2)', marginBottom: 8 }}>{stat.label}</div>
            <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 36, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 10, color: 'var(--c-fg-3)', marginTop: 4 }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {charts.map(c => <ChartCard key={c.title} title={c.title} subtitle={c.subtitle} segments={c.segs} />)}
      </div>
    </div>
  )
}
