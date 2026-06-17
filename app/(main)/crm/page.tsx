'use client'
import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Lead, LeadStatus, Client, ClientContact, BillingType } from '@/lib/supabase'
import { TOUCH_INTERVAL_DAYS } from '@/lib/settings'
import { ContactPicker } from '@/components/shared/ContactPicker'
import { ArtistPicker } from '@/components/shared/ArtistPicker'
import PhoneInput from '@/components/shared/PhoneInput'
import TimeInput from '@/components/shared/TimeInput'
import StudioSelect from '@/components/shared/StudioSelect'
import { RegViewModal, RegField } from '@/components/shared/RegViewModal'
import { combineLocation, parseLocation } from '@/lib/studios'
import { addArtistToLabel } from '@/lib/roster'
import { ClientsPageInner } from '@/app/(main)/clients/page'

const STATUS_COLORS: Record<string, string> = {
  hot: 'var(--hot)', warm: 'var(--warm)', cold: 'var(--cold)',
  uncontacted: 'var(--uncontacted)', booked: 'var(--booked)', dead: 'var(--text3)'
}

function leadNameColor(_l: { billing?: string | null }): string {
  return 'var(--text)'
}

const BOOKING_ICONS: Record<string, string> = {
  'Recording Session': '🎙', 'Filming': '🎬', 'Event/Playback': '🎛'
}

const TOUCH_METHODS = ['Call', 'Text', 'Email'] as const
type TouchMethod = typeof TOUCH_METHODS[number]

const aBtnStyle = (color: string): React.CSSProperties => ({
  padding: '2px 7px', borderRadius: 3, border: '1px solid var(--border)',
  background: 'var(--surface)', color, fontFamily: 'DM Mono', fontSize: 9,
  textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap' as const,
})

const CHART_COLORS = [
  'var(--accent)', 'var(--accent2)', 'var(--hot)', 'var(--warm)',
  'var(--booked)', 'var(--cold)', 'var(--uncontacted)', 'var(--text2)',
]

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 9, color: 'var(--text3)', letterSpacing: '0.08em',
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
  if (n.includes('call')) return '#EF4444'
  if (n.includes('text')) return '#F97316'
  if (n.includes('email')) return '#7BA7BC'
  if (n.includes('kept hot') || n.includes('keep hot')) return '#EF4444'
  if (n.includes('kept warm') || n.includes('keep warm')) return '#F97316'
  if (n.includes('registration returned') || n.includes('reg returned')) return '#14B8A6'
  if (n.includes('registration') || n.includes('reg link') || n.includes('reg sent')) return '#c8f04e'
  return '#8b90a8'
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
    const d = new Date(l.session_date + 'T12:00:00')
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const start = fmtTime12(l.session_start)
    const end = fmtTime12(l.session_end)
    const timeStr = start && end ? `${start}–${end}` : start || end
    parts.push(timeStr ? `${dateStr} ${timeStr}` : dateStr)
  }
  return parts.length > 0 ? parts.join(' · ') : null
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

export default function CRMPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [latestTouches, setLatestTouches] = useState<TouchMap>({})
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [view, setView] = useState<CrmView>('needs-action')
  const [loading, setLoading] = useState(true)
  const [emailModal, setEmailModal] = useState(false)
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [focusField, setFocusField] = useState<string | null>(null)
  const [toast, setToast] = useState<{ clientId: string } | null>(null)
  const router = useRouter()
  const [tab, setTab] = useState<'leads' | 'clients'>('leads')
  const [initialClientId, setInitialClientId] = useState<string | null>(null)

  // Switch to clients tab if ?clientId= or ?id= is present on load
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const cid = params.get('clientId') || params.get('id')
      if (cid) { setTab('clients'); setInitialClientId(cid) }
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

  useEffect(() => { load() }, [load])

  const hasAutoSelected = useRef(false)
  useEffect(() => {
    if (loading || hasAutoSelected.current || leads.length === 0) return
    const uncontacted = leads.filter(l => l.status === 'uncontacted' || (!l.last_contact && !['booked', 'dead'].includes(l.status)))
    const hotDue = leads.filter(l => l.status === 'hot' && isKhuDue(l) && !isParked(l))
    const warmDue = leads.filter(l => l.status === 'warm' && isKhuDue(l) && !isParked(l))
    const incompleteLeads = leads.filter(l => ['hot', 'warm', 'uncontacted'].includes(l.status) && getMissing(l).length > 0)
    const first = uncontacted[0] || hotDue[0] || warmDue[0] || incompleteLeads[0]
    if (first) { setSelectedId(first.id); hasAutoSelected.current = true }
  }, [loading, leads])

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
    await supabase.from('leads').update(updateData).eq('id', id)
    await supabase.from('lead_activity').insert({ lead_id: id, type: 'touch', note: activityNote })
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
    await supabase.from('leads').update({ last_contact: now, keep_hot_until: keepHotUntil.toISOString() }).eq('id', id)
    await supabase.from('lead_activity').insert({ lead_id: id, type: 'touch', note: activityNote })
    await load()
  }

  async function markDead(id: number, initials: string) {
    await supabase.from('leads').update({ status: 'dead' }).eq('id', id)
    await supabase.from('lead_activity').insert({ lead_id: id, type: 'touch', note: `${initials} - Marked Dead` })
    await load()
  }

  async function markDidNotAnswer(id: number, initials: string) {
    await supabase.from('leads').update({ needs_contact: false }).eq('id', id)
    await load()
  }

  async function createLead(data: Partial<Lead>) {
    const insertData: Partial<Lead> = { ...data }
    if (!insertData.status) insertData.status = 'uncontacted'
    if (insertData.status === 'hot') {
      const khu = new Date(); khu.setDate(khu.getDate() + 5)
      insertData.keep_hot_until = khu.toISOString()
    } else if (insertData.status === 'warm') {
      const khu = new Date(); khu.setDate(khu.getDate() + 3)
      insertData.keep_hot_until = khu.toISOString()
    }
    const { data: rows } = await supabase.from('leads').insert(insertData).select('id').single()
    await load()
    return (rows as { id: number } | null)?.id ?? null
  }

  const selected = leads.find(l => l.id === selectedId) || null

  async function updateStatus(id: number, status: string) {
    await supabase.from('leads').update({ status }).eq('id', id)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status: status as LeadStatus } : l))
  }

  function selectAndFocus(id: number, field?: string) {
    setSelectedId(id)
    if (field) setFocusField(field)
  }

  const distinctLabels = Array.from(new Set(leads.map(l => l.label).filter((v): v is string => !!v))).sort()
  const distinctCompanies = Array.from(new Set(leads.map(l => l.company).filter((v): v is string => !!v))).sort()

  // Badge count for Needs Action tab
  const naUncontacted = leads.filter(l => (l.status === 'uncontacted' || (!l.last_contact && !['booked', 'dead'].includes(l.status))) && l.needs_contact !== false)
  const naHot = leads.filter(l => l.status === 'hot' && isKhuDue(l) && !isParked(l) && l.needs_contact !== false)
  const naWarm = leads.filter(l => l.status === 'warm' && isKhuDue(l) && !isParked(l) && l.needs_contact !== false)
  const naIncomplete = leads.filter(l => ['hot', 'warm', 'uncontacted'].includes(l.status) && getMissing(l).length > 0 && l.needs_contact !== false)
  const needsActionCount = naUncontacted.length + naHot.length + naWarm.length + naIncomplete.length

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

      {/* LEADS / CLIENTS toggle */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 10, flexShrink: 0 }}>
        {(['leads', 'clients'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            padding: '0 0 4px', cursor: 'pointer',
            fontFamily: 'Syne', fontWeight: 700, fontSize: 13, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: tab === t ? 'var(--accent)' : 'var(--text3)',
            transition: 'color 0.15s',
          }}>
            {t === 'leads' ? 'Leads' : 'Clients'}
          </button>
        ))}
      </div>

      {tab === 'leads' && (
        <>
          {/* Sub-nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
              {(['needs-action', 'all-leads', 'analytics'] as CrmView[]).map(v => {
                const labels: Record<CrmView, string> = { 'needs-action': 'Needs Action', 'all-leads': 'All Leads', 'analytics': 'Analytics' }
                const active = view === v
                return (
                  <button key={v} onClick={() => setView(v)} style={{
                    position: 'relative', padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontFamily: 'DM Mono', fontSize: 11, fontWeight: 500,
                    background: active ? 'var(--surface2)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text2)',
                    transition: 'all 0.15s',
                  }}>
                    {labels[v]}
                    {v === 'needs-action' && needsActionCount > 0 && (
                      <span style={{
                        position: 'absolute', top: 2, right: 2,
                        background: 'var(--hot)', color: '#fff',
                        borderRadius: '50%', minWidth: 16, height: 16,
                        fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 3px', lineHeight: 1,
                      }}>
                        {needsActionCount > 99 ? '99+' : needsActionCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {view !== 'analytics' && (
              <button onClick={() => setNewLeadOpen(true)} style={{
                padding: '8px 20px', background: 'var(--accent)', color: '#0d0f14',
                border: 'none', borderRadius: 6, fontFamily: 'Syne',
                fontWeight: 700, fontSize: 11, cursor: 'pointer',
                letterSpacing: '0.05em', textTransform: 'uppercase',
              }}>+ New Lead</button>
            )}
          </div>

          {(view === 'needs-action' || view === 'all-leads') && (
            <div style={{ display: 'grid', gridTemplateColumns: '60fr 40fr', gap: 14, flex: 1, minHeight: 0 }}>
              {view === 'needs-action' ? (
                <NeedsActionSection
                  leads={leads}
                  latestTouches={latestTouches}
                  selectedId={selectedId}
                  onSelect={selectAndFocus}
                  onMarkTouched={markTouched}
                  onKeepHot={keepHot}
                  onUpdateStatus={updateStatus}
                  loading={loading}
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
              )}

              {/* Detail panel */}
              <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', minHeight: 0 }}>
                {!selected ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text3)', fontSize: 11 }}>
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
  const [initials, setInitials] = useState('')
  const [method, setMethod] = useState<TouchMethod | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = initials.trim().length >= 2 && method !== null

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    await onSubmit(leadId, initials.trim().toUpperCase(), method!, notes)
    setSubmitting(false)
  }

  const methodDefs: { m: TouchMethod; color: string; actionHref?: string; actionLabel?: string }[] = [
    { m: 'Call',  color: '#EF4444', actionHref: phone ? `tel:${phone.replace(/\D/g, '')}` : undefined,  actionLabel: '→ Dial' },
    { m: 'Text',  color: '#F97316', actionHref: phone ? `sms:${phone.replace(/\D/g, '')}` : undefined,  actionLabel: '→ Text' },
    { m: 'Email', color: '#8b90a8', actionHref: email ? `mailto:${email}` : undefined, actionLabel: '→ Mail' },
  ]

  return (
    <div onClick={e => e.stopPropagation()} style={{ padding: '10px 16px 12px 38px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Row 1: initials + method buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          autoFocus value={initials}
          onChange={e => setInitials(e.target.value.toUpperCase().slice(0, 3))}
          onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
          placeholder="Initials" maxLength={3}
          style={{ width: 70, background: 'var(--surface)', border: '1px solid var(--accent)', color: 'var(--text)', padding: '4px 8px', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 12, outline: 'none', textAlign: 'center', letterSpacing: '0.12em' }}
        />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {methodDefs.map(({ m, color, actionHref, actionLabel }) => {
            const active = method === m
            return (
              <React.Fragment key={m}>
                <button onClick={() => setMethod(active ? null : m)} style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'Syne', fontWeight: 700, fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase', border: `1px solid ${active ? color : 'var(--border)'}`, background: active ? `color-mix(in srgb, ${color} 15%, transparent)` : 'transparent', color: active ? color : 'var(--text3)', transition: 'all 0.1s' }}>
                  {m}
                </button>
                {active && actionHref && (
                  <a href={actionHref} style={{ padding: '3px 8px', borderRadius: 4, background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`, color, fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
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
        style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 11, outline: 'none', resize: 'none', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={{ padding: '4px 14px', background: canSubmit ? 'var(--accent)' : 'var(--surface)', color: canSubmit ? '#0d0f14' : 'var(--text3)', border: `1px solid ${canSubmit ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed', letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'all 0.15s' }}>
          {submitting ? '…' : 'Log Touch'}
        </button>
        <button onClick={onCancel} style={{ padding: '4px 10px', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer' }}>
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
  const [initials, setInitials] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = initials.trim().length >= 2
  const color = status === 'warm' ? 'var(--warm)' : 'var(--hot)'
  const bgTint = status === 'warm' ? 'rgba(249,115,22,0.07)' : 'rgba(239,68,68,0.07)'

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    await onSubmit(leadId, initials.trim().toUpperCase(), notes)
    setSubmitting(false)
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{ padding: '10px 16px 12px 38px', background: bgTint, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          autoFocus value={initials}
          onChange={e => setInitials(e.target.value.toUpperCase().slice(0, 3))}
          onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
          placeholder="Initials" maxLength={3}
          style={{ width: 70, background: 'var(--surface)', border: `1px solid ${color}`, color: 'var(--text)', padding: '4px 8px', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 12, outline: 'none', textAlign: 'center', letterSpacing: '0.12em' }}
        />
        <span style={{ fontSize: 10, color, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <textarea
        value={notes} onChange={e => setNotes(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
        placeholder="Optional: add context (e.g. waiting on budget approval)"
        rows={2}
        style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 11, outline: 'none', resize: 'none', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={{ padding: '4px 14px', background: canSubmit ? color : 'var(--surface)', color: canSubmit ? '#fff' : 'var(--text3)', border: `1px solid ${canSubmit ? color : 'var(--border)'}`, borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed', letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'all 0.15s' }}>
          {submitting ? '…' : label}
        </button>
        <button onClick={onCancel} style={{ padding: '4px 10px', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer' }}>
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
  const [initials, setInitials] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = initials.trim().length >= 2

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    await onSubmit(leadId, initials.trim().toUpperCase())
    setSubmitting(false)
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{ padding: '10px 16px 12px 38px', background: 'rgba(58,63,82,0.5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', marginRight: 4 }}>Mark dead?</span>
      <input
        autoFocus value={initials}
        onChange={e => setInitials(e.target.value.toUpperCase().slice(0, 3))}
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel() }}
        placeholder="Initials" maxLength={3}
        style={{ width: 70, background: 'var(--surface)', border: '1px solid var(--dead)', color: 'var(--text)', padding: '4px 8px', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 12, outline: 'none', textAlign: 'center', letterSpacing: '0.12em' }}
      />
      <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={{ padding: '4px 14px', background: canSubmit ? 'var(--dead)' : 'var(--surface)', color: canSubmit ? 'var(--text2)' : 'var(--text3)', border: `1px solid ${canSubmit ? 'var(--border)' : 'var(--border)'}`, borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed', letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'all 0.15s' }}>
        {submitting ? '…' : 'Confirm'}
      </button>
      <button onClick={onCancel} style={{ padding: '4px 10px', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer' }}>
        Cancel
      </button>
    </div>
  )
}

// ─── Needs Action section ─────────────────────────────────────────────────────

type NeedsActionTab = 'uncontacted' | 'hot' | 'warm' | 'incomplete'

function NeedsActionSection({ leads, latestTouches, selectedId, onSelect, onMarkTouched, onKeepHot, onUpdateStatus, loading }: {
  leads: Lead[]
  latestTouches: TouchMap
  selectedId: number | null
  onSelect: (id: number, field?: string) => void
  onMarkTouched: (id: number, initials: string, method: TouchMethod, notes: string, statusOverride?: string) => Promise<void>
  onKeepHot: (id: number, initials: string, notes: string, status?: string) => Promise<void>
  onUpdateStatus: (id: number, status: string) => Promise<void>
  loading: boolean
}) {
  const [activeTab, setActiveTab] = useState<NeedsActionTab>('uncontacted')
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('crm_na_tab') as NeedsActionTab
      if (stored) setActiveTab(stored)
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
  const incompleteLeads = leads.filter(l => ['hot', 'warm', 'uncontacted'].includes(l.status) && getMissing(l).length > 0 && l.needs_contact !== false)
  const totalCount = uncontacted.length + hotDue.length + warmDue.length + incompleteLeads.length

  const tabs: { key: NeedsActionTab; label: string; color: string; items: Lead[]; type: 'touch' | 'incomplete'; emptyMsg: string }[] = [
    { key: 'uncontacted', label: 'Uncontacted', color: '#7BA7BC', items: uncontacted, type: 'touch', emptyMsg: 'No fresh uncontacted leads.' },
    { key: 'hot', label: 'Hot', color: 'var(--hot)', items: hotDue, type: 'touch', emptyMsg: 'All hot leads are up to date.' },
    { key: 'warm', label: 'Warm', color: 'var(--warm)', items: warmDue, type: 'touch', emptyMsg: 'All warm leads are up to date.' },
    { key: 'incomplete', label: 'Incomplete', color: 'var(--text2)', items: incompleteLeads, type: 'incomplete', emptyMsg: 'All leads have complete info.' },
  ]
  const activeBucket = tabs.find(t => t.key === activeTab)!

  // Auto-select first lead when switching tabs
  const didMountRef = useRef(false)
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return }
    setTouchPromptId(null)
    setKeepHotPromptId(null)
    const items = tabs.find(t => t.key === activeTab)?.items || []
    if (items[0]) onSelect(items[0].id)
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '12px 16px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15, letterSpacing: -0.3 }}>
            Needs Action{totalCount > 0 ? <span style={{ color: 'var(--text3)', fontWeight: 600, fontSize: 13 }}> ({totalCount})</span> : null}
          </span>
        </div>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0 }}>
          {tabs.map(tab => {
            const active = activeTab === tab.key
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                padding: '6px 12px', border: 'none', background: 'transparent', cursor: 'pointer',
                fontFamily: 'Syne', fontWeight: 700, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: tab.color,
                borderBottom: active ? `3px solid ${tab.color}` : '3px solid transparent',
                marginBottom: -1, transition: 'border-color 0.15s', whiteSpace: 'nowrap',
                opacity: active ? 1 : 0.6,
              }}>
                {tab.label}
                <span style={{ marginLeft: 4, fontSize: 9, fontWeight: 500, color: tab.color }}>
                  ({tab.items.length})
                </span>
              </button>
            )
          })}
        </div>
      </div>
      {/* Content */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
        ) : activeBucket.items.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 11 }}>{activeBucket.emptyMsg}</div>
        ) : activeBucket.items.map(l => {
          const missing = getMissing(l)
          const touch = latestTouches[l.id]
          const isTouchPrompting = touchPromptId === l.id
          const isKeepHotPrompting = keepHotPromptId === l.id
          const isPrompting = isTouchPrompting || isKeepHotPrompting
          const keepColor = l.status === 'warm' ? 'var(--warm)' : 'var(--hot)'
          return (
            <React.Fragment key={l.id}>
              <div onClick={() => onSelect(l.id)} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)', marginBottom: isPrompting ? 0 : 4, background: selectedId === l.id ? 'rgba(200,240,78,0.04)' : 'transparent', transition: 'background 0.15s' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: STATUS_COLORS[l.status] || 'var(--text3)' }} />
                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, background: STATUS_COLORS[l.status] || 'var(--text3)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: leadNameColor(l) }}>
                    {l.label && l.artist_name
                      ? <>{l.label} <span style={{ color: 'var(--text3)' }}>/</span> {l.fname} {l.lname} <span style={{ color: 'var(--text3)' }}>/</span> {l.artist_name}</>
                      : <>{l.fname} {l.lname}</>}
                  </div>
                  {fmtSessionLine(l) && (
                    <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fmtSessionLine(l)}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                    {activeBucket.type === 'incomplete'
                      ? <span style={{ color: 'var(--accent2)' }}>missing: {missing.join(', ')}</span>
                      : activeBucket.key === 'uncontacted'
                        ? <span style={{ color: 'var(--text3)' }}>never contacted · added {fmtDate(l.created_at)}</span>
                        : <>{daysSince(l.last_contact || l.created_at)}d ago{touch?.initials && <span style={{ color: 'var(--text2)' }}> · {touch.initials}{touch.method ? ` via ${touch.method}` : ''}</span>}</>}
                  </div>
                </div>
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)', color: 'var(--text3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {BOOKING_ICONS[l.booking] || ''} {l.booking || '—'}
                </span>
                {(l.status === 'hot' || l.status === 'warm') && daysUntilKhu(l) !== null && (daysUntilKhu(l) as number) <= 1 && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setTouchPromptId(null)
                      setKeepHotPromptId(isKeepHotPrompting ? null : l.id)
                    }}
                    style={{ flexShrink: 0, padding: '4px 9px', background: 'transparent', border: `1px solid ${isKeepHotPrompting ? 'var(--border)' : keepColor}`, color: isKeepHotPrompting ? 'var(--text3)' : keepColor, borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {isKeepHotPrompting ? 'Cancel' : activeBucket.key === 'warm' ? 'Keep Warm?' : 'Keep Hot?'}
                  </button>
                )}
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setKeepHotPromptId(null)
                    setTouchPromptId(isTouchPrompting ? null : l.id)
                    if (!isTouchPrompting) onSelect(l.id)
                  }}
                  style={{ flexShrink: 0, padding: '4px 10px', background: 'transparent', border: `1px solid ${isTouchPrompting ? 'var(--border)' : 'var(--accent)'}`, color: isTouchPrompting ? 'var(--text3)' : 'var(--accent)', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
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

type AllLeadsFilter = 'all' | 'uncontacted' | 'hot' | 'warm' | 'cold-dead' | 'booked'

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
  const [activeFilter, setActiveFilter] = useState<AllLeadsFilter>('all')
  const [search, setSearch] = useState('')
  const skipFilterReset = useRef(false)

  // Restore persisted filter + search after mount — lazy initializers read sessionStorage
  // during SSR where it doesn't exist, causing a hydration mismatch on the style-conditional
  // filter buttons. Start with stable defaults and restore client-side only.
  useEffect(() => {
    try {
      const f = sessionStorage.getItem('crm_al_filter') as AllLeadsFilter
      const s = sessionStorage.getItem('crm_al_search')
      if (f || s) {
        skipFilterReset.current = true
        if (f) setActiveFilter(f)
        if (s) setSearch(s)
      }
    } catch {}
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem('crm_al_filter', activeFilter) } catch {}
  }, [activeFilter])
  useEffect(() => {
    try { sessionStorage.setItem('crm_al_search', search) } catch {}
  }, [search])
  const [page, setPage] = useState(1)
  const [touchPromptId, setTouchPromptId] = useState<number | null>(null)
  const [keepHotPromptId, setKeepHotPromptId] = useState<number | null>(null)

  useEffect(() => { setPage(1) }, [search])
  useEffect(() => {
    if (skipFilterReset.current) { skipFilterReset.current = false; return }
    setPage(1); setSearch(''); setTouchPromptId(null); setKeepHotPromptId(null)
  }, [activeFilter])

  const uncontactedLeads = leads.filter(l => l.status === 'uncontacted' || (!l.last_contact && !['booked', 'dead'].includes(l.status)))
  const hotLeads = leads.filter(l => l.status === 'hot')
  const warmLeads = leads.filter(l => l.status === 'warm')
  const coldDeadLeads = leads.filter(l => l.status === 'cold' || l.status === 'dead')
  const bookedLeads = leads.filter(l => l.status === 'booked')

  const filterMap: Record<AllLeadsFilter, Lead[]> = {
    all: leads,
    uncontacted: uncontactedLeads, hot: hotLeads, warm: warmLeads, 'cold-dead': coldDeadLeads, booked: bookedLeads,
  }

  const filterDefs: { key: AllLeadsFilter; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: '#e8eaf2' },
    { key: 'uncontacted', label: 'Uncontacted', color: '#7BA7BC' },
    { key: 'hot', label: 'Hot', color: '#EF4444' },
    { key: 'warm', label: 'Warm', color: '#F97316' },
    { key: 'cold-dead', label: 'Cold/Dead', color: '#8b90a8' },
    { key: 'booked', label: 'Booked', color: '#14B8A6' },
  ]

  const activeLeads = filterMap[activeFilter]
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
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', flex: 1, minHeight: 0 }}>
      {/* Header: filter pills + search */}
      <div style={{ padding: '10px 16px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
          {filterDefs.map(f => {
            const active = activeFilter === f.key
            return (
              <button key={f.key} onClick={() => setActiveFilter(f.key)} style={{
                padding: '4px 10px', cursor: 'pointer', borderRadius: 20,
                fontFamily: 'Syne', fontWeight: active ? 700 : 600, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
                background: active ? `${f.color}33` : 'transparent',
                border: `1px solid ${active ? f.color : `${f.color}80`}`,
                color: active ? f.color : `${f.color}b3`,
                transition: 'all 0.15s',
              }}>
                {f.label} ({filterMap[f.key].length})
              </button>
            )
          })}
        </div>
        <div style={{ padding: '0 0 8px' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${activeLeads.length} ${activeFilter === 'all' ? '' : filterDefs.find(f => f.key === activeFilter)?.label.toLowerCase() + ' '}leads…`}
            style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: 5, fontFamily: 'DM Mono', fontSize: 11, outline: 'none' }}
          />
        </div>
      </div>

      {/* Lead list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 11 }}>
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
          const keepColor = l.status === 'warm' ? 'var(--warm)' : 'var(--hot)'
          const prevLead = idx > 0 ? paginated[idx - 1] : null
          const showDateSep = !!l.created_at && (!prevLead || new Date(l.created_at).toDateString() !== new Date(prevLead.created_at).toDateString())
          return (
            <React.Fragment key={l.id}>
              {showDateSep && (
                <div style={{ display: 'flex', alignItems: 'center', margin: '16px 16px 0', color: '#4a4f64', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <span style={{ flex: 1, borderBottom: '1px solid #2a2e3d' }} />
                  <span style={{ margin: '0 12px' }}>{dateSepLabel(l.created_at)}</span>
                  <span style={{ flex: 1, borderBottom: '1px solid #2a2e3d' }} />
                </div>
              )}
              <div onClick={() => onSelect(l.id)} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)', marginBottom: isPrompting ? 0 : 4, background: selectedId === l.id ? 'rgba(200,240,78,0.04)' : 'transparent', transition: 'background 0.15s' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: STATUS_COLORS[l.status] || 'var(--text3)' }} />
                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, background: STATUS_COLORS[l.status] || 'var(--text3)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: leadNameColor(l) }}>
                    {l.label && l.artist_name
                      ? <>{l.label} <span style={{ color: 'var(--text3)' }}>/</span> {l.fname} {l.lname} <span style={{ color: 'var(--text3)' }}>/</span> {l.artist_name}</>
                      : <>{l.fname} {l.lname}{l.company && <span style={{ color: 'var(--text3)', fontWeight: 400 }}> · {l.company}</span>}</>}
                  </div>
                  {fmtSessionLine(l) && (
                    <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fmtSessionLine(l)}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.booking && <span>{BOOKING_ICONS[l.booking] || ''} {l.booking} · </span>}
                    {l.last_contact ? `${daysSince(l.last_contact)}d ago` : `added ${fmtDate(l.created_at)}`}
                    {touch?.initials && <span style={{ color: 'var(--text3)' }}> · {touch.initials}{touch.method ? ` via ${touch.method}` : ''}</span>}
                    {missing.length > 0 && <span style={{ color: 'var(--accent2)' }}> · missing: {missing.join(', ')}</span>}
                  </div>
                </div>
                {showKeepHot && (
                  <button onClick={e => { e.stopPropagation(); setTouchPromptId(null); setKeepHotPromptId(isKeepHotPrompting ? null : l.id) }}
                    style={{ flexShrink: 0, padding: '3px 8px', background: 'transparent', border: `1px solid ${isKeepHotPrompting ? 'var(--border)' : keepColor}`, color: isKeepHotPrompting ? 'var(--text3)' : keepColor, borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {isKeepHotPrompting ? 'Cancel' : keepLabel}
                  </button>
                )}
                <button onClick={e => { e.stopPropagation(); setKeepHotPromptId(null); setTouchPromptId(isTouchPrompting ? null : l.id); if (!isTouchPrompting) onSelect(l.id) }}
                  style={{ flexShrink: 0, padding: '3px 8px', background: 'transparent', border: `1px solid ${isTouchPrompting ? 'var(--border)' : 'var(--accent)'}`, color: isTouchPrompting ? 'var(--text3)' : 'var(--accent)', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
            style={{ background: 'none', border: 'none', cursor: safePage <= 1 ? 'default' : 'pointer', fontFamily: 'DM Mono', fontSize: 10, color: safePage <= 1 ? 'var(--text3)' : 'var(--text2)', padding: '2px 4px' }}>
            ← Prev
          </button>
          <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
            {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
            style={{ background: 'none', border: 'none', cursor: safePage >= totalPages ? 'default' : 'pointer', fontFamily: 'DM Mono', fontSize: 10, color: safePage >= totalPages ? 'var(--text3)' : 'var(--text2)', padding: '2px 4px' }}>
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Section helpers ──────────────────────────────────────────────────────────

function SectionHeader({ label, mt }: { label: string; mt?: number }) {
  return (
    <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 4, marginTop: mt ?? 8 }}>
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

function LeadDetail({ lead, missing, latestTouch, focusField, onFocusConsumed, distinctLabels, distinctCompanies, onUpdate, onSendEmail, onDelete }: {
  lead: Lead
  missing: string[]
  latestTouch?: { initials: string, method: string, created_at: string }
  focusField?: string | null
  onFocusConsumed?: () => void
  distinctLabels: string[]
  distinctCompanies: string[]
  onUpdate: (f: string, v: any) => void
  onSendEmail?: () => void
  onDelete?: () => void
}) {
  const [local, setLocal] = useState<Partial<Lead>>({ ...lead })
  const [notesVal, setNotesVal] = useState(lead.notes || '')
  const [savedField, setSavedField] = useState<string | null>(null)
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const [showLabelDD, setShowLabelDD] = useState(false)
  const [showCompanyDD, setShowCompanyDD] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [showBookingToast, setShowBookingToast] = useState(false)
  const leadRouter = useRouter()
  const [regLinkUrl, setRegLinkUrl] = useState<string | null>(null)
  const [regLinkCopied, setRegLinkCopied] = useState(false)
  const [regLinkGenerating, setRegLinkGenerating] = useState(false)
  const [existingTokenStr, setExistingTokenStr] = useState<string | null>(null)
  const [regPanelOpen, setRegPanelOpen] = useState(false)
  const [regViewOpen, setRegViewOpen] = useState(false)
  const [fnameVal, setFnameVal] = useState(lead.fname || '')
  const [lnameVal, setLnameVal] = useState(lead.lname || '')
const parsedLoc0 = parseLocation(lead.location || '')
  const [localVenue, setLocalVenue] = useState(parsedLoc0.venue)
  const [localStudio, setLocalStudio] = useState(parsedLoc0.studio)
  const [detailRateType, setDetailRateType] = useState<'hourly' | 'daily'>(() => lead.rate_daily ? 'daily' : 'hourly')
  const [activityLog, setActivityLog] = useState<Array<{ ts: string; label: string; color: string }>>([])
  const [regTokenDates, setRegTokenDates] = useState<{ created_at: string; used_at: string | null } | null>(null)

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
  }, [lead.id])
  useEffect(() => { setNotesVal(lead.notes || '') }, [lead.notes])
  useEffect(() => {
    setRegLinkUrl(null); setRegLinkCopied(false); setRegLinkGenerating(false); setExistingTokenStr(null)
    setRegTokenDates(null); setRegPanelOpen(false)
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
        const synth: Array<{ ts: string; label: string; color: string }> = [
          { ts: lead.created_at, label: 'Lead Created', color: '#8b90a8' },
        ]
        if (regTokenDates?.created_at) synth.push({ ts: regTokenDates.created_at, label: 'Reg Link Sent', color: '#c8f04e' })
        if (regTokenDates?.used_at) synth.push({ ts: regTokenDates.used_at, label: 'Registration Returned', color: '#14B8A6' })
        const all = [...items, ...synth].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
        setActivityLog(all)
      })
  }, [lead.id, lead.last_contact, regTokenDates])

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

  const notesDirty = notesVal !== (lead.notes || '')

  function update(key: keyof Lead, val: any) {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  async function save(key: string, val: any) {
    if (val === (lead as any)[key]) return
    await supabase.from('leads').update({ [key]: val }).eq('id', lead.id)
    onUpdate(key, val)
    setSavedField(key)
    setTimeout(() => setSavedField(null), 600)
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
    await supabase.from('leads').update(updates).eq('id', lead.id)
    onUpdate('status', newStatus)
    onUpdate('keep_hot_until', updates.keep_hot_until ?? null)
    setSavedField('status')
    setTimeout(() => setSavedField(null), 600)
  }

const khuDays = daysUntilKhu(lead)
  const khuColor = khuDays === null ? 'var(--text3)' : khuDays < 1 ? 'var(--hot)' : khuDays <= 2 ? 'var(--warm)' : 'var(--booked)'

  const selStyle: React.CSSProperties = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', padding: '4px 6px', fontFamily: 'DM Mono',
    fontSize: 12, outline: 'none', borderRadius: 4, cursor: 'pointer', flex: 1, minWidth: 0,
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
    setTimeout(() => setRegLinkCopied(false), 2000)
  }

  function emailRegLink() {
    if (!regLinkUrl) return
    const subject = encodeURIComponent('Your Paramount Recording Studios registration link')
    const body = encodeURIComponent(
      `Hi ${lead.fname || 'there'},\n\nPlease complete your registration for Paramount Recording Studios using the link below:\n\n${regLinkUrl}\n\nThis link expires in 7 days.\n\n— Paramount Recording Studios`
    )
    window.location.href = `mailto:${lead.email || ''}?subject=${subject}&body=${body}`
  }

  const pillBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center',
    padding: '3px 10px', borderRadius: 20,
    fontSize: 10, fontFamily: 'Syne', fontWeight: 700,
    letterSpacing: '0.08em', textTransform: 'uppercase',
    cursor: 'pointer', border: 'none', outline: 'none',
  }

  function iStyle(key: string): React.CSSProperties {
    return {
      background: focusedInput === key ? 'var(--surface2)' : 'transparent',
      border: 'none', color: 'var(--text)', padding: '4px 6px',
      fontFamily: 'DM Mono', fontSize: 12, outline: 'none',
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
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 6, zIndex: 50, overflow: 'hidden', marginTop: 2,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  }
  const ddItemStyle: React.CSSProperties = {
    padding: '7px 8px', cursor: 'pointer', fontSize: 11,
    borderBottom: '1px solid var(--border)', fontFamily: 'DM Mono',
  }

  return (
    <div>
      {/* ─── Header bar ──────────────────────────────────────────────── */}
      <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 10px', marginBottom: 8 }}>
        {/* Row 1: left group (label + pills) | right group (reg button) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
            <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0 }}>Lead Details</span>
            <select
              value={local.status || lead.status}
              onChange={e => { update('status', e.target.value); saveStatus(e.target.value) }}
              style={{ ...pillBase, flexShrink: 0, background: `${STATUS_COLORS[local.status || lead.status]}22`, color: STATUS_COLORS[local.status || lead.status] || 'var(--text2)', border: `1px solid ${STATUS_COLORS[local.status || lead.status]}66` }}>
              {['hot', 'warm', 'cold', 'uncontacted', 'booked', 'dead'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {lead.needs_contact !== false && (
              <button
                onClick={() => { save('needs_contact', false); onUpdate('needs_contact', false) }}
                style={{ ...pillBase, flexShrink: 0, background: 'rgba(123,167,188,0.12)', color: '#7BA7BC', border: '1px solid rgba(123,167,188,0.4)' }}
              >
                ● Needs Contact
              </button>
            )}
          </div>
          <div style={{ flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
            {lead.billing !== 'Billing' && (regTokenDates?.used_at ? (
              <button onClick={() => setRegViewOpen(true)} style={{ padding: '4px 8px', background: 'rgba(20,184,166,0.12)', color: 'var(--booked)', border: '1px solid rgba(20,184,166,0.35)', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 8, cursor: 'pointer' }}>
                ✓ Registered
              </button>
            ) : existingTokenStr ? (
              <button onClick={async () => { const done = await refreshRegStatus(); if (!done) setRegPanelOpen(v => !v) }} style={{ padding: '4px 8px', background: regPanelOpen ? 'rgba(249,115,22,0.18)' : 'rgba(249,115,22,0.08)', color: 'var(--warm)', border: '1px solid rgba(249,115,22,0.35)', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 8, cursor: 'pointer' }}>
                Reg Sent
              </button>
            ) : (
              <button onClick={generateRegLink} disabled={regLinkGenerating} style={{ padding: '4px 8px', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 8, cursor: regLinkGenerating ? 'default' : 'pointer' }}>
                {regLinkGenerating ? '…' : 'Send Reg'}
              </button>
            ))}
          </div>
        </div>
        {/* Row 2: Keep Hot Until — hot/warm only */}
        {(lead.status === 'hot' || lead.status === 'warm') && lead.keep_hot_until && (
          <div style={{ marginTop: 6, fontSize: 10, fontFamily: 'DM Mono', color: khuColor }}>
            Keep Hot Until: {fmtDateTime(lead.keep_hot_until)}
          </div>
        )}
      </div>

      {/* Reg link panel — shown when pending token is expanded */}
      {regPanelOpen && regLinkUrl && !regTokenDates?.used_at && (
        <div style={{ marginBottom: 8, background: 'var(--surface2)', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 5, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
              {regLinkUrl}
            </span>
            <button onClick={() => setRegPanelOpen(false)} style={{ padding: '2px 6px', background: 'transparent', color: 'var(--text3)', border: 'none', borderRadius: 3, fontFamily: 'DM Mono', fontSize: 11, cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>
              ✕
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={copyRegLink} style={{ padding: '3px 10px', background: 'var(--accent)', color: '#0d0f14', border: 'none', borderRadius: 3, fontFamily: 'Syne', fontWeight: 700, fontSize: 8, letterSpacing: '0.08em', cursor: 'pointer' }}>
              {regLinkCopied ? 'Copied!' : 'Copy Link'}
            </button>
            <button onClick={emailRegLink} style={{ padding: '3px 10px', background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 3, fontFamily: 'DM Mono', fontSize: 8, cursor: 'pointer' }}>
              Email
            </button>
            <button onClick={generateRegLink} disabled={regLinkGenerating} style={{ padding: '3px 10px', background: 'transparent', color: 'var(--warm)', border: '1px solid rgba(249,115,22,0.4)', borderRadius: 3, fontFamily: 'DM Mono', fontSize: 8, cursor: regLinkGenerating ? 'default' : 'pointer' }}>
              {regLinkGenerating ? '…' : 'Resend'}
            </button>
          </div>
        </div>
      )}

      {savedField && <span style={{ fontSize: 9, color: 'var(--booked)', fontFamily: 'DM Mono', display: 'block', marginBottom: 4 }}>saved</span>}

      {/* ─── Missing warning ─────────────────────────────── */}
      {missing.length > 0 && (
        <div style={{ fontSize: 10, color: '#F97316', background: 'rgba(249,115,22,0.08)', padding: '6px 10px', borderRadius: 6, marginBottom: 6 }}>
          ⚠ Missing: {missing.join(', ')}
        </div>
      )}

      {/* ─── Name + Pills ─────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
            <div style={{ display: 'inline-grid', minWidth: '3ch' }}>
              <span aria-hidden style={{ visibility: 'hidden', gridArea: '1/1', fontFamily: 'DM Serif Display', fontSize: 22, letterSpacing: -0.5, padding: '4px 0', whiteSpace: 'pre' }}>
                {fnameVal || 'First'}
              </span>
              <input
                value={fnameVal}
                onChange={e => setFnameVal(e.target.value)}
                onFocus={() => setFocusedInput('fname')}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur() }}
                onBlur={() => { setFocusedInput(null); save('fname', fnameVal.trim()) }}
                placeholder="First"
                style={{ gridArea: '1/1', width: 0, minWidth: '100%', background: focusedInput === 'fname' ? 'var(--surface2)' : 'transparent', border: 'none', outline: 'none', color: leadNameColor(lead), fontFamily: 'DM Serif Display', fontSize: 22, letterSpacing: -0.5, padding: '4px 0', borderRadius: 4 }}
              />
            </div>
            <div style={{ display: 'inline-grid', minWidth: '3ch' }}>
              <span aria-hidden style={{ visibility: 'hidden', gridArea: '1/1', fontFamily: 'DM Serif Display', fontSize: 22, letterSpacing: -0.5, padding: '4px 0', whiteSpace: 'pre' }}>
                {lnameVal || 'Last'}
              </span>
              <input
                value={lnameVal}
                onChange={e => setLnameVal(e.target.value)}
                onFocus={() => setFocusedInput('lname')}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur() }}
                onBlur={() => { setFocusedInput(null); save('lname', lnameVal.trim()) }}
                placeholder="Last"
                style={{ gridArea: '1/1', width: 0, minWidth: '100%', background: focusedInput === 'lname' ? 'var(--surface2)' : 'transparent', border: 'none', outline: 'none', color: leadNameColor(lead), fontFamily: 'DM Serif Display', fontSize: 22, letterSpacing: -0.5, padding: '4px 0', borderRadius: 4 }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
            <button
              onClick={() => { const nb = (local.billing || lead.billing) === 'COD' ? 'Billing' : 'COD'; update('billing', nb); save('billing', nb) }}
              style={{ ...pillBase, background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)' }}>
              {local.billing || lead.billing || 'COD'}
            </button>
            {lead.booking && (
              <span style={{ ...pillBase, background: 'rgba(139,144,168,0.12)', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'default', fontSize: 9 }}>
                {BOOKING_ICONS[lead.booking] || ''} {lead.booking}
              </span>
            )}
            {lead.first_time && (
              <span style={{ ...pillBase, background: 'rgba(139,144,168,0.12)', color: 'var(--text3)', border: '1px solid var(--border)', cursor: 'default' }}>
                ★ First Time
              </span>
            )}
            {lead.source && (
              <span style={{ ...pillBase, background: 'rgba(139,144,168,0.12)', color: 'var(--text3)', border: '1px solid var(--border)', cursor: 'default', fontSize: 9 }}>
                {lead.source}
              </span>
            )}
          </div>
          </div>
          <button
            onClick={() => {
              if (lead.client_id) {
                leadRouter.push(`/calendar?newBooking=1&clientId=${lead.client_id}&leadId=${lead.id}`)
              } else {
                setShowConfirmModal(true)
              }
            }}
            style={{ padding: '5px 12px', background: 'var(--accent)', color: '#0d0f14', border: 'none', borderRadius: 4, fontFamily: 'Syne', fontWeight: 700, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const, cursor: 'pointer', flexShrink: 0, marginTop: 4 }}
          >
            Start Booking
          </button>
        </div>
        {lead.billing !== 'COD' && (
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <div style={fieldLabelStyle}>Label / Company</div>
              <input
                value={local.label || ''}
                onChange={e => { update('label', e.target.value); setShowLabelDD(true) }}
                onFocus={() => { setFocusedInput('label'); setShowLabelDD(true) }}
                onBlur={e => { setFocusedInput(null); setShowLabelDD(false); save('label', e.target.value) }}
                onKeyDown={enterBlur}
                placeholder="—"
                style={iStyle('label')}
              />
              {showLabelDD && labelSuggestions.length > 0 && (
                <div style={ddStyle}>
                  {labelSuggestions.map(s => (
                    <div key={s} onMouseDown={e => { e.preventDefault(); update('label', s); save('label', s); setShowLabelDD(false) }} style={ddItemStyle}>{s}</div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <div style={fieldLabelStyle}>Artist</div>
              <input
                value={local.artist_name || ''}
                onChange={e => update('artist_name', e.target.value)}
                onFocus={() => setFocusedInput('artist_name')}
                onBlur={e => { setFocusedInput(null); save('artist_name', e.target.value) }}
                onKeyDown={enterBlur}
                placeholder="—"
                style={iStyle('artist_name')}
              />
            </div>
          </div>
        )}
      </div>

      {/* ─── Contact — 3-col grid ─────────────────────────────── */}
      <SectionHeader label="Contact" />
      <div style={{ marginTop: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 48px' }}>
        <div>
          <div style={fieldLabelStyle}>Email</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input ref={emailRef} value={local.email || ''} onChange={e => update('email', e.target.value)}
              onFocus={() => setFocusedInput('email')} onBlur={e => { setFocusedInput(null); save('email', e.target.value) }}
              onKeyDown={enterBlur} placeholder="Add email" style={{ ...iStyle('email'), flex: 1, minWidth: 0 }} />
            {local.email && (
              <a href={`mailto:${local.email}`} style={{ ...aBtnStyle('#8b90a8'), flexShrink: 0 }}>Email</a>
            )}
          </div>
        </div>
        <div>
          <div style={fieldLabelStyle}>Created</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono', padding: '4px 6px', whiteSpace: 'nowrap' }}>{fmtDate(lead.created_at)}</div>
        </div>
        <div>
          <div style={fieldLabelStyle}>Phone</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input ref={phoneRef} value={local.phone || ''} onChange={e => update('phone', e.target.value)}
              onFocus={() => setFocusedInput('phone')} onBlur={e => { setFocusedInput(null); save('phone', e.target.value) }}
              onKeyDown={enterBlur} placeholder="Add phone" style={{ ...iStyle('phone'), flex: 1, minWidth: 0 }} />
            {local.phone && (<>
              <a href={`tel:${local.phone.replace(/\D/g, '')}`} style={{ ...aBtnStyle('#8b90a8'), flexShrink: 0 }}>Call</a>
              <a href={`sms:${local.phone.replace(/\D/g, '')}`} style={{ ...aBtnStyle('#8b90a8'), flexShrink: 0 }}>Text</a>
            </>)}
          </div>
        </div>
      </div>

      {/* ─── Session & Quote ─────────────────────────────── */}
      <SectionHeader label="Session & Quote" mt={8} />
      <div style={{ marginTop: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 48px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <div style={fieldLabelStyle}>Location · Studio</div>
            <StudioSelect
              location={localVenue}
              studio={localStudio}
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
          <div>
            <div style={fieldLabelStyle}>Session Date</div>
            <input
              type="date"
              value={local.session_date || ''}
              onChange={e => { update('session_date', e.target.value); save('session_date', e.target.value) }}
              style={{ ...iStyle('session_date'), cursor: 'pointer' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <div style={fieldLabelStyle}>Quote / Rate</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <button type="button" onClick={() => setDetailRateType('hourly')} style={{ padding: '3px 7px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const, cursor: 'pointer', borderRadius: '4px 0 0 4px', border: '1px solid var(--border)', background: detailRateType === 'hourly' ? 'rgba(200,240,78,0.12)' : 'transparent', color: detailRateType === 'hourly' ? 'var(--accent)' : 'var(--text3)' }}>/ hr</button>
              <button type="button" onClick={() => setDetailRateType('daily')} style={{ padding: '3px 7px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const, cursor: 'pointer', borderRadius: '0 4px 4px 0', border: '1px solid var(--border)', borderLeft: 'none', background: detailRateType === 'daily' ? 'rgba(200,240,78,0.12)' : 'transparent', color: detailRateType === 'daily' ? 'var(--accent)' : 'var(--text3)' }}>/ day</button>
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
                style={{ ...iStyle('quote'), borderRadius: '0 4px 4px 0', borderLeft: 'none', flex: 1 }}
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
                style={{ ...iStyle('session_start'), flex: 1, minWidth: 0 }}
              />
              <span style={{ color: 'var(--text3)', fontSize: 11, flexShrink: 0 }}>–</span>
              <TimeInput
                value={local.session_end || ''}
                onChange={v => { update('session_end', v) }}
                onBlur={() => { setFocusedInput(null); save('session_end', local.session_end || '') }}
                placeholder="End"
                style={{ ...iStyle('session_end'), flex: 1, minWidth: 0 }}
              />
            </div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => { const v = !local.engineer_needed; update('engineer_needed', v); save('engineer_needed', v) }}
          style={{ padding: '5px 14px', background: local.engineer_needed ? 'rgba(200,240,78,0.12)' : 'var(--surface2)', color: local.engineer_needed ? 'var(--accent)' : 'var(--text3)', border: `1px solid ${local.engineer_needed ? 'rgba(200,240,78,0.35)' : 'var(--border)'}`, borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer' }}
        >
          {local.engineer_needed ? '● Engineer Needed' : '○ Engineer Needed'}
        </button>
      </div>

      {/* ─── Activity Log ──────────────────────────────── */}
      <SectionHeader label="Activity Log" mt={8} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
        {activityLog.length === 0 ? (
          <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', padding: '4px 0' }}>No activity yet</div>
        ) : activityLog.map((entry, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: entry.color, flexShrink: 0, marginTop: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>{fmtActivityTime(entry.ts)} · </span>
              <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono' }}>{entry.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Session Notes ─────────────────────────────── */}
      <SectionHeader label="Session Notes" mt={8} />
      <textarea
        value={notesVal}
        onChange={e => setNotesVal(e.target.value)}
        onBlur={() => { if (notesDirty) save('notes', notesVal) }}
        placeholder="Add notes…"
        style={{ width: '100%', minHeight: 70, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11, resize: 'vertical', outline: 'none', lineHeight: 1.6 }}
      />
      {notesDirty && (
        <button
          onClick={() => save('notes', notesVal)}
          style={{ marginTop: 6, padding: '5px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Save Notes
        </button>
      )}

      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--hot)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 4, padding: '4px 10px', fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer' }}
        >
          Delete Lead
        </button>
      </div>

      {showDeleteConfirm && (
        <div onClick={() => setShowDeleteConfirm(false)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px', maxWidth: 400, width: '100%' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 14, marginBottom: 8 }}>
              Delete {[lead.fname, lead.lname].filter(Boolean).join(' ') || 'this lead'}?
            </div>
            <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'DM Mono', lineHeight: 1.7, marginBottom: 20 }}>
              This will permanently delete this lead and all contact log entries. This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 14px', fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer' }}>Cancel</button>
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
                style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--hot)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, padding: '6px 16px', fontSize: 10, fontFamily: 'DM Mono', cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.7 : 1 }}
              >
                {deleting ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBookingToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 3000, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.5)', maxWidth: 320, fontFamily: 'DM Mono', fontSize: 11 }}>
          <span style={{ color: 'var(--accent)', fontSize: 14 }}>🗓</span>
          <span style={{ color: 'var(--text)', flex: 1 }}>Navigate to Calendar to book this client.</span>
          <button onClick={() => setShowBookingToast(false)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}
      {showConfirmModal && (
        <ConfirmClientModal
          lead={lead}
          onClose={() => setShowConfirmModal(false)}
          onCreated={(clientId) => {
            setShowConfirmModal(false)
            onUpdate('client_id', clientId)
            onUpdate('status', 'booked')
            leadRouter.push(`/calendar?newBooking=1&clientId=${clientId}&leadId=${lead.id}`)
          }}
        />
      )}
      {regViewOpen && lead.client_id && (
        <RegViewModal clientId={lead.client_id} onClose={() => setRegViewOpen(false)} />
      )}
    </div>
  )
}

// ─── CONFIRM CLIENT MODAL ─────────────────────────────────────────────────────

function ConfirmClientModal({ lead, onClose, onCreated }: {
  lead: Lead
  onClose: () => void
  onCreated: (clientId: string) => void
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
      created_at: new Date().toISOString(),
    })
    if (err) { setError(err.message); setSaving(false); return }
    await supabase.from('leads').update({ client_id: clientId, status: 'booked' }).eq('id', lead.id)
    onCreated(clientId)
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }
  const fL: React.CSSProperties = { fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 3, display: 'block' as const }
  const inp: React.CSSProperties = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontFamily: 'DM Mono', fontSize: 11, padding: '6px 9px', outline: 'none', boxSizing: 'border-box' as const }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, width: '100%', maxWidth: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: 'DM Serif Display', fontSize: 18, color: 'var(--text)' }}>Confirm Client Account</div>
            <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text3)', marginTop: 2 }}>Review and complete before starting booking</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={fL}>Account Type</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['individual', 'label'] as const).map(t => (
                <button key={t} type="button" onClick={() => setType(t)} style={{
                  flex: 1, padding: '6px 0', borderRadius: 5, fontSize: 10,
                  fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  cursor: 'pointer',
                  background: type === t ? 'rgba(139,144,168,0.12)' : 'var(--surface2)',
                  color: type === t ? 'var(--text)' : 'var(--text3)',
                  border: '1px solid var(--border)',
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
            <div style={{ fontSize: 10, color: 'var(--warm)', fontFamily: 'DM Mono', padding: '6px 10px', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 4 }}>
              Requires at minimum a name and email or phone number.
            </div>
          )}
          {error && (
            <div style={{ fontSize: 10, color: 'var(--hot)', fontFamily: 'DM Mono', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4 }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 5, fontFamily: 'DM Mono', fontSize: 11, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!valid || saving}
            style={{
              padding: '7px 18px', borderRadius: 5, fontFamily: 'Syne', fontWeight: 700,
              fontSize: 11, letterSpacing: '0.05em', border: 'none',
              cursor: (valid && !saving) ? 'pointer' : 'default',
              background: valid ? 'var(--accent)' : 'var(--surface2)',
              color: valid ? '#0d0f14' : 'var(--text3)',
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
  const emptyForm = { fname: '', lname: '', email: '', phone: '', company: '', label: '', source: '', booking: '', notes: '', billing: 'COD' as BillingType, quote: '', rate_daily: '', location: '', session_date: '', session_start: '', session_end: '', engineer_needed: false, artist_name: '' }
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
  const [labelClientSuggestions, setLabelClientSuggestions] = useState<LabelSuggestion[]>([])
  const [showLabelClientDD, setShowLabelClientDD] = useState(false)
  const [labelHighlight, setLabelHighlight] = useState(-1)
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
  const nameDebounce = useRef<ReturnType<typeof setTimeout>>()
  const labelDebounce = useRef<ReturnType<typeof setTimeout>>()
  const skipNameSearch = useRef(false)
  const skipLabelSearch = useRef(false)

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

  // Label mode: label client search — matches on label name AND A&R contact names
  useEffect(() => {
    if (mode !== 'label') return
    if (skipLabelSearch.current) { skipLabelSearch.current = false; return }
    if (labelQuery.length < 2) { setLabelClientSuggestions([]); setShowLabelClientDD(false); return }
    clearTimeout(labelDebounce.current)
    labelDebounce.current = setTimeout(async () => {
      const q = labelQuery.trim()
      const [nameRes, anrRes] = await Promise.all([
        supabase.from('clients').select('id, type, name, email, phone, created_at').eq('type', 'label').ilike('name', `%${q}%`).limit(8),
        supabase.from('client_contacts').select('id, client_id, fname, lname, email, phone, clients(id, type, name, email, phone, created_at)').eq('contact_type', 'anr').or(`fname.ilike.%${q}%,lname.ilike.%${q}%`).limit(12),
      ])
      const seen = new Set<string>()
      const suggestions: LabelSuggestion[] = []
      for (const c of (nameRes.data || []) as Client[]) {
        if (!seen.has(c.id)) { seen.add(c.id); suggestions.push(c) }
      }
      for (const ct of (anrRes.data || []) as any[]) {
        const client = ct.clients as Client
        if (!client || client.type !== 'label') continue
        if (seen.has(client.id)) continue
        seen.add(client.id)
        suggestions.push({
          ...client,
          _anrName: `${ct.fname || ''} ${ct.lname || ''}`.trim(),
          _anrContactId: ct.id,
          _anrEmail: ct.email ?? null,
          _anrPhone: ct.phone ?? null,
        })
      }
      setLabelClientSuggestions(suggestions)
      setShowLabelClientDD(suggestions.length > 0)
    }, 200)
    return () => clearTimeout(labelDebounce.current)
  }, [labelQuery, mode])

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

  function selectLabelClient(c: LabelSuggestion) {
    skipLabelSearch.current = true
    clearTimeout(labelDebounce.current)
    setLabelClientId(c.id)
    setLabelQuery(c.name)
    setShowLabelClientDD(false)
    setLabelHighlight(-1)
    set('label', c.name)
    if (c._anrName && c._anrContactId) {
      setAnrContactId(c._anrContactId)
      setAnrQuery(c._anrName)
      setSelectedAnr({ id: c._anrContactId, client_id: c.id, fname: c._anrName.split(' ')[0] || null, lname: c._anrName.split(' ').slice(1).join(' ') || null, email: c._anrEmail || null, phone: c._anrPhone || null, instagram: null, role: null, notes: null, contact_type: 'anr', artists: null })
      if (c._anrEmail) set('email', c._anrEmail)
      if (c._anrPhone) set('phone', c._anrPhone)
      setAnrHighlight(-1)
    } else {
      setAnrContactId(null); setSelectedAnr(null); setAnrQuery(''); setAnrHighlight(-1)
    }
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

  function handleLabelKeyDown(e: React.KeyboardEvent) {
    if (!showLabelClientDD || labelClientSuggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setLabelHighlight(h => Math.min(h + 1, labelClientSuggestions.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setLabelHighlight(h => Math.max(h - 1, 0)) }
    if (e.key === 'Enter' && labelHighlight >= 0) { e.preventDefault(); selectLabelClient(labelClientSuggestions[labelHighlight]) }
    if (e.key === 'Escape') { setShowLabelClientDD(false); setLabelHighlight(-1) }
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
    const data: Partial<Lead> = { ...form, status, needs_contact: needsContact }
    if (temperature === 'booking' && matchedClientId) data.client_id = matchedClientId
    const leadId = await onSave(data)
    setSaving(false)
    if (temperature === 'booking' && matchedClientId) {
      router.push(`/calendar?newBooking=1&clientId=${matchedClientId}&leadId=${leadId}`)
    }
  }

  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 12, outline: 'none' }
  const labelS: React.CSSProperties = { fontSize: 9, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4, display: 'block' }

  const modeToggle = (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ display: 'flex', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
        {(['cod', 'label'] as const).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)} style={{ padding: '7px 28px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'DM Mono', fontSize: 11, fontWeight: 500, background: mode === m ? 'var(--surface2)' : 'transparent', color: mode === m ? 'var(--text)' : 'var(--text2)', transition: 'all 0.15s', letterSpacing: '0.04em' }}>
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
          { key: 'hot', label: 'Hot', color: 'var(--hot)' },
          { key: 'warm', label: 'Warm', color: 'var(--warm)' },
          { key: 'booking', label: 'Move to Booking', color: 'var(--booked)' },
        ] as const).map(opt => (
          <button key={opt.key} type="button" onClick={() => setTemperature(opt.key)} style={{ flex: opt.key === 'booking' ? 2 : 1, padding: '7px 0', borderRadius: 6, border: `1px solid ${temperature === opt.key ? opt.color : 'var(--border)'}`, background: temperature === opt.key ? `${opt.color}22` : 'transparent', color: temperature === opt.key ? opt.color : 'var(--text3)', fontFamily: 'Syne', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.15s' }}>
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
      style={{ alignSelf: 'flex-start', padding: '5px 14px', borderRadius: 20, border: `1px solid ${needsContact ? '#7BA7BC' : 'var(--border)'}`, background: needsContact ? 'rgba(123,167,188,0.12)' : 'transparent', color: needsContact ? '#7BA7BC' : 'var(--text3)', fontFamily: 'Syne', fontWeight: 700, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.15s' }}
    >
      {needsContact ? '● Needs Contact' : '○ Needs Contact'}
    </button>
  )

  const sessionDetails = (
    <div>
      <div style={{ fontSize: 9, color: 'var(--text3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'Syne', fontWeight: 700 }}>Session Details</div>
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
          <div style={{ display: 'flex', gap: 0 }}>
            <button type="button" onClick={() => setRateType('hourly')} style={{ padding: '4px 8px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const, cursor: 'pointer', borderRadius: '4px 0 0 4px', border: '1px solid var(--border)', background: rateType === 'hourly' ? 'rgba(200,240,78,0.12)' : 'transparent', color: rateType === 'hourly' ? 'var(--accent)' : 'var(--text3)' }}>/ hr</button>
            <button type="button" onClick={() => setRateType('daily')} style={{ padding: '4px 8px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const, cursor: 'pointer', borderRadius: '0 4px 4px 0', border: '1px solid var(--border)', borderLeft: 'none', background: rateType === 'daily' ? 'rgba(200,240,78,0.12)' : 'transparent', color: rateType === 'daily' ? 'var(--accent)' : 'var(--text3)' }}>/ day</button>
            <input
              value={rateType === 'hourly' ? form.quote : form.rate_daily}
              onChange={e => set(rateType === 'hourly' ? 'quote' : 'rate_daily', e.target.value)}
              onBlur={e => { const f = fmtMoney(e.target.value); const key = rateType === 'hourly' ? 'quote' : 'rate_daily'; if (f !== e.target.value) set(key, f) }}
              placeholder="$0"
              style={{ ...inputStyle, borderRadius: '0 4px 4px 0', borderLeft: 'none', marginLeft: 6 }}
            />
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10 }}>
        <div><label style={labelS}>Session Date</label><input type="date" value={form.session_date} onChange={e => set('session_date', e.target.value)} style={inputStyle} /></div>
        <div><label style={labelS}>Start Time</label><TimeInput value={form.session_start} onChange={v => set('session_start', v)} style={inputStyle} /></div>
        <div><label style={labelS}>End Time</label><TimeInput value={form.session_end} onChange={v => set('session_end', v)} style={inputStyle} /></div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id="new_engineer_needed" checked={form.engineer_needed as boolean} onChange={e => setForm(prev => ({ ...prev, engineer_needed: e.target.checked }))} style={{ cursor: 'pointer', accentColor: 'var(--accent)', width: 13, height: 13 }} />
        <label htmlFor="new_engineer_needed" style={{ ...labelS, marginBottom: 0, cursor: 'pointer' }}>Engineer Needed</label>
      </div>
    </div>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 540, maxHeight: '88vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15 }}>New Lead</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 20, marginTop: 2, overflow: 'hidden' }}>
                    {nameSuggestions.map((item, i) => {
                      const r = item.record; const isClient = item.type === 'client'
                      return (
                        <div key={`${item.type}-${r.id}`} onMouseDown={() => applyAutofill(item)} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: i === nameHighlight ? 'var(--surface)' : isClient ? 'rgba(20,184,166,0.04)' : 'transparent' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: isClient ? 'var(--booked)' : 'var(--text)' }}>
                              {isClient ? (r as Client).name || `${r.fname || ''} ${r.lname || ''}`.trim() : `${r.fname} ${r.lname}`}
                            </span>
                            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: isClient ? 'rgba(20,184,166,0.15)' : 'rgba(139,144,168,0.12)', color: isClient ? 'var(--booked)' : 'var(--text3)', fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                              {isClient ? '★ Client' : 'Prev. Inquiry'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
                            {r.email && <span>{r.email}</span>}
                            {r.phone && <span>{r.phone}</span>}
                            {!isClient && (r as Lead).booking && <span>{(r as Lead).booking}</span>}
                            <span>{fmtDate(r.created_at)}</span>
                          </div>
                        </div>
                      )
                    })}
                    <div onMouseDown={() => { setMatchedClientId(null); setShowNameDD(false); setNameHighlight(-1) }} style={{ padding: '9px 14px', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> None of these — New Client
                    </div>
                  </div>
                )}
                {matchedClientId && (
                  <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: 6 }}>
                    <span style={{ color: 'var(--booked)', fontSize: 12 }}>★</span>
                    <span style={{ fontSize: 11, color: 'var(--booked)', fontFamily: 'DM Mono', flex: 1 }}>Matched to existing client profile</span>
                    <button onMouseDown={() => setMatchedClientId(null)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
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
              <div>
                <label style={labelS}>Billing</label>
                <select value={form.billing} onChange={e => set('billing', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="COD">COD</option><option value="Billing">Billing</option>
                </select>
              </div>
            </>
          ) : (
            <>
              {/* Label mode: Label → A&R → Artist */}
              <div style={{ position: 'relative' }}>
                <label style={labelS}>Label</label>
                <input
                  autoFocus
                  value={labelQuery}
                  onChange={e => { setLabelQuery(e.target.value); setLabelClientId(null); setLabelHighlight(-1); setShowLabelClientDD(true) }}
                  onFocus={() => setShowLabelClientDD(labelClientSuggestions.length > 0)}
                  onBlur={() => setTimeout(() => setShowLabelClientDD(false), 200)}
                  onKeyDown={handleLabelKeyDown}
                  placeholder="Search label clients…"
                  style={inputStyle}
                />
                {showLabelClientDD && labelClientSuggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 20, marginTop: 2, overflow: 'hidden' }}>
                    {labelClientSuggestions.map((c, i) => (
                      <div key={c.id} onMouseDown={() => selectLabelClient(c)} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: i === labelHighlight ? 'var(--surface)' : 'transparent' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                          {c._anrName ? `${c._anrName} — ${c.name}` : c.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
                          {c._anrName ? `A&R · ${c.name}` : c.email || ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {labelClientId && (
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--booked)', fontFamily: 'DM Mono' }}>
                    <span>★ Linked to label client</span>
                    <button onMouseDown={() => { setLabelClientId(null); setAnrContactId(null); setSelectedAnr(null); setAnrQuery(''); setAnrHighlight(-1) }} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
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
                  placeholder={labelClientId ? 'Search or add A&R contact…' : 'Select a label first'}
                  disabled={!labelClientId}
                  style={{ ...inputStyle, opacity: labelClientId ? 1 : 0.4 }}
                />
                {showAnrDD && labelClientId && (anrFiltered.length > 0 || anrQuery.trim().length >= 2) && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 20, marginTop: 2, overflow: 'hidden' }}>
                    {anrFiltered.map((c, i) => (
                      <div key={c.id} onMouseDown={() => selectAnr(c)} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: i === anrHighlight ? 'var(--surface)' : 'transparent' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{c.fname} {c.lname}</div>
                        <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
                          {c.email && <span>{c.email}</span>}
                          {c.phone && <span>{c.phone}</span>}
                        </div>
                      </div>
                    ))}
                    {anrQuery.trim().length >= 2 && !anrFiltered.some(c => `${c.fname || ''} ${c.lname || ''}`.trim().toLowerCase() === anrQuery.trim().toLowerCase()) && (
                      <div onMouseDown={() => addNewAnrContact(anrQuery.trim())} style={{ padding: '9px 14px', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', borderTop: anrFiltered.length > 0 ? '1px solid var(--border)' : undefined, display: 'flex', alignItems: 'center', gap: 6 }}>
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
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 20, marginTop: 2, overflow: 'hidden' }}>
                    {artistSuggestions.map((a, i) => (
                      <div key={a} onMouseDown={() => { setArtistQuery(a); set('artist_name', a); setShowArtistDD(false); setArtistHighlight(-1) }} style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'DM Mono', background: i === artistHighlight ? 'var(--surface)' : 'transparent' }}>{a}</div>
                    ))}
                    {artistQuery.trim().length >= 2 && !labelArtists.some(a => a.toLowerCase() === artistQuery.trim().toLowerCase()) && (
                      <div onMouseDown={() => addArtistImmediately(artistQuery.trim())} style={{ padding: '9px 14px', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', borderTop: artistSuggestions.length > 0 ? '1px solid var(--border)' : undefined, display: 'flex', alignItems: 'center', gap: 6 }}>
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
        </div>

        <div style={{ padding: '12px 20px 20px', position: 'sticky', bottom: 0, background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          {bookingError && (
            <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--hot)', fontFamily: 'DM Mono' }}>{bookingError}</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '9px 0', background: 'var(--accent)', color: '#0d0f14', border: 'none', borderRadius: 6, fontFamily: 'Syne', fontWeight: 700, fontSize: 11, cursor: saving ? 'not-allowed' : 'pointer', letterSpacing: '0.05em', textTransform: 'uppercase', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : temperature === 'booking' ? 'Save & Go to Booking →' : 'Create Lead'}
            </button>
            <button onClick={onClose} style={{ padding: '9px 20px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 520, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15 }}>Email {lead.fname} {lead.lname}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, fontFamily: 'DM Mono' }}>{lead.email || 'No email on file'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 9, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Subject: {subject}</div>
          <textarea value={body} onChange={e => setBody(e.target.value)} style={{ width: '100%', height: 220, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 12px', borderRadius: 7, fontFamily: 'DM Mono', fontSize: 11, resize: 'none', outline: 'none', lineHeight: 1.6 }} />
        </div>
        <div style={{ padding: '0 20px 20px', display: 'flex', gap: 8 }}>
          <button onClick={handleCopyAndOpen} disabled={!lead.email} style={{ flex: 1, padding: '9px 0', background: lead.email ? 'var(--accent)' : 'var(--surface2)', color: lead.email ? '#0d0f14' : 'var(--text3)', border: 'none', borderRadius: 6, fontFamily: 'Syne', fontWeight: 700, fontSize: 11, cursor: lead.email ? 'pointer' : 'not-allowed', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {copied ? '✓ Copied!' : '✉ Copy & Open Mail'}
          </button>
          <button onClick={onClose} style={{ padding: '9px 20px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
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
      <circle cx={cx} cy={cy} r={r} fill="transparent" stroke="var(--border)" strokeWidth={sw} />
    </svg>
  )

  let cumLen = 0
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="transparent" stroke="var(--border)" strokeWidth={sw} />
      {segments.map((seg, i) => {
        const L = (seg.value / total) * C
        const dashOffset = C - cumLen
        cumLen += L
        if (L < 0.5) return null
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="transparent"
            stroke={seg.color} strokeWidth={sw}
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
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
      <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 16, fontFamily: 'DM Mono' }}>{subtitle}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <DonutChart segments={segments} size={90} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {segments.slice(0, 6).map(seg => (
            <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seg.label}</span>
              <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', flexShrink: 0 }}>
                {seg.value} <span style={{ opacity: 0.6 }}>({total ? Math.round(seg.value / total * 100) : 0}%)</span>
              </span>
            </div>
          ))}
          {segments.length > 6 && (
            <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono' }}>+{segments.length - 6} more</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Analytics ────────────────────────────────────────────────────────────────

function AnalyticsView({ leads }: { leads: Lead[] }) {
  const total = leads.length
  const booked = leads.filter(l => l.status === 'booked').length
  const convRate = total > 0 ? Math.round(booked / total * 100) : 0
  const bookedLeads = leads.filter(l => l.status === 'booked')
  const labelLeads = bookedLeads.filter(l => l.label)

  const charts = [
    { title: 'COD vs Billing', subtitle: 'All inquiries, all time', segs: toSegments(groupBy(leads, 'billing')) },
    { title: 'COD vs Billing (Booked)', subtitle: 'Confirmed sessions, all time', segs: toSegments(groupBy(bookedLeads, 'billing')) },
    { title: 'Booking Type', subtitle: 'All inquiries, all time', segs: toSegments(groupBy(leads, 'booking')) },
    { title: 'Booking Type (Booked)', subtitle: 'Confirmed sessions, all time', segs: toSegments(groupBy(bookedLeads, 'booking')) },
    { title: 'Inquiry Source', subtitle: 'All inquiries, all time', segs: toSegments(groupBy(leads, 'source')) },
    { title: 'Bookings by Label', subtitle: `${labelLeads.length} sessions with label data, all time`, segs: toSegments(groupBy(labelLeads, 'label')) },
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'DM Serif Display', fontSize: 32, letterSpacing: -1 }}>
          Analytics <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>&amp; Insights</em>
        </h1>
        <select style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '6px 12px', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11, outline: 'none', cursor: 'pointer' }}>
          <option>All Time</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Total Leads', value: total.toLocaleString(), color: 'var(--accent)', sub: 'All time' },
          { label: 'Booked', value: booked.toLocaleString(), color: 'var(--accent)', sub: 'Confirmed sessions' },
          { label: 'Conversion Rate', value: `${convRate}%`, color: 'var(--accent)', sub: 'Leads to booked' },
        ].map(stat => (
          <div key={stat.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 8 }}>{stat.label}</div>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 36, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {charts.map(c => <ChartCard key={c.title} title={c.title} subtitle={c.subtitle} segments={c.segs} />)}
      </div>
    </div>
  )
}
