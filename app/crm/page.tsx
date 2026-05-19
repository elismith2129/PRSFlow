'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, Lead, LeadStatus, Client } from '@/lib/supabase'
import { TOUCH_INTERVAL_DAYS } from '@/lib/settings'

const STATUS_COLORS: Record<string, string> = {
  hot: 'var(--hot)', warm: 'var(--warm)', cold: 'var(--cold)',
  uncontacted: 'var(--uncontacted)', booked: 'var(--booked)', dead: 'var(--text3)'
}

const BOOKING_ICONS: Record<string, string> = {
  'Recording Session': '🎙', 'Filming': '🎬', 'Event/Playback': '🎛'
}

const TOUCH_METHODS = ['Call', 'Text', 'Email'] as const
type TouchMethod = typeof TOUCH_METHODS[number]

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

function getMissing(l: Lead) {
  const m: string[] = []
  if (!l.fname) m.push('first name')
  if (!l.lname) m.push('last name')
  if (!l.email) m.push('email')
  if (!l.phone) m.push('phone')
  if (!l.quote) m.push('quote')
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

export default function CRMPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [latestTouches, setLatestTouches] = useState<TouchMap>({})
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [view, setView] = useState<CrmView>('needs-action')
  const [loading, setLoading] = useState(true)
  const [emailModal, setEmailModal] = useState(false)
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [focusField, setFocusField] = useState<string | null>(null)

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
    const dateStr = new Date().toLocaleString('en-US', {
      month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).replace(',', '').toLowerCase()
    const touchNote = notes.trim()
      ? `[${dateStr}] ${initials} - ${method} - ${notes.trim()}`
      : `[${dateStr}] ${initials} - ${method}`
    const lead = leads.find(l => l.id === id)
    const currentNotes = lead?.notes?.trim() || ''
    const newNotes = currentNotes ? `${currentNotes}\n${touchNote}` : touchNote
    const updateData: Partial<Lead> = { last_contact: now, notes: newNotes }
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
    await supabase.from('leads').update(updateData).eq('id', id)
    await supabase.from('lead_activity').insert({ lead_id: id, type: 'touch', note: `${initials} - ${method}` })
    await load()
  }

  async function keepHot(id: number, initials: string, notes = '', status?: string) {
    const lead = leads.find(l => l.id === id)
    const isWarm = (status || lead?.status) === 'warm'
    const label = isWarm ? 'Kept Warm' : 'Kept Hot'
    const days = isWarm ? 3 : 5
    const now = new Date().toISOString()
    const dateStr = new Date().toLocaleString('en-US', {
      month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).replace(',', '').toLowerCase()
    const touchNote = notes.trim()
      ? `[${dateStr}] ${initials} - ${label} - ${notes.trim()}`
      : `[${dateStr}] ${initials} - ${label}`
    const currentNotes = lead?.notes?.trim() || ''
    const newNotes = currentNotes ? `${currentNotes}\n${touchNote}` : touchNote
    const keepHotUntil = new Date(); keepHotUntil.setDate(keepHotUntil.getDate() + days)
    await supabase.from('leads').update({ last_contact: now, keep_hot_until: keepHotUntil.toISOString(), notes: newNotes }).eq('id', id)
    await supabase.from('lead_activity').insert({ lead_id: id, type: 'touch', note: `${initials} - ${label}` })
    await load()
  }

  async function markDead(id: number, initials: string) {
    const now = new Date().toISOString()
    const dateStr = new Date().toLocaleString('en-US', {
      month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).replace(',', '').toLowerCase()
    const touchNote = `[${dateStr}] ${initials} - Marked Dead`
    const lead = leads.find(l => l.id === id)
    const currentNotes = lead?.notes?.trim() || ''
    const newNotes = currentNotes ? `${currentNotes}\n${touchNote}` : touchNote
    await supabase.from('leads').update({ status: 'dead', notes: newNotes }).eq('id', id)
    await supabase.from('lead_activity').insert({ lead_id: id, type: 'touch', note: `${initials} - Marked Dead` })
    await load()
  }

  async function createLead(data: Partial<Lead>) {
    const insertData: Partial<Lead> = { ...data, status: 'uncontacted' }
    if (insertData.status === 'hot') {
      const khu = new Date(); khu.setDate(khu.getDate() + 5)
      insertData.keep_hot_until = khu.toISOString()
    } else if (insertData.status === 'warm') {
      const khu = new Date(); khu.setDate(khu.getDate() + 3)
      insertData.keep_hot_until = khu.toISOString()
    }
    await supabase.from('leads').insert(insertData)
    await load()
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
  const naUncontacted = leads.filter(l => l.status === 'uncontacted' || (!l.last_contact && !['booked', 'dead'].includes(l.status)))
  const naHot = leads.filter(l => l.status === 'hot' && isKhuDue(l) && !isParked(l))
  const naWarm = leads.filter(l => l.status === 'warm' && isKhuDue(l) && !isParked(l))
  const naIncomplete = leads.filter(l => ['hot', 'warm', 'uncontacted'].includes(l.status) && getMissing(l).length > 0)
  const needsActionCount = naUncontacted.length + naHot.length + naWarm.length + naIncomplete.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px - 24px)' }}>
      {emailModal && selected && <EmailModal lead={selected} onClose={() => setEmailModal(false)} />}
      {newLeadOpen && (
        <NewLeadModal
          leads={leads}
          onClose={() => setNewLeadOpen(false)}
          onSave={async (data) => { await createLead(data); setNewLeadOpen(false) }}
        />
      )}

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
              onMarkDead={markDead}
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
              onMarkDead={markDead}
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
              <>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)' }}>Lead Details</div>
                  <button onClick={() => setEmailModal(true)} style={{
                    padding: '5px 14px', background: 'var(--accent)', color: '#0d0f14',
                    border: 'none', borderRadius: 5, fontFamily: 'Syne', fontWeight: 700,
                    fontSize: 10, cursor: 'pointer', letterSpacing: '0.05em', textTransform: 'uppercase',
                  }}>✉ Send Email</button>
                </div>
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
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {view === 'analytics' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <AnalyticsView leads={leads} />
        </div>
      )}
    </div>
  )
}

// ─── Touch prompt ─────────────────────────────────────────────────────────────

function TouchPrompt({ leadId, onSubmit, onCancel, showStatusSelect }: {
  leadId: number
  onSubmit: (id: number, initials: string, method: TouchMethod, notes: string, statusOverride?: string) => Promise<void>
  onCancel: () => void
  showStatusSelect?: boolean
}) {
  const [initials, setInitials] = useState('')
  const [method, setMethod] = useState<TouchMethod | null>(null)
  const [notes, setNotes] = useState('')
  const [newStatus, setNewStatus] = useState('hot')
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = initials.trim().length >= 2 && method !== null && (!showStatusSelect || !!newStatus)

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    await onSubmit(leadId, initials.trim().toUpperCase(), method!, notes, showStatusSelect ? newStatus : undefined)
    setSubmitting(false)
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{ padding: '10px 16px 12px 38px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          autoFocus value={initials}
          onChange={e => setInitials(e.target.value.toUpperCase().slice(0, 3))}
          onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
          placeholder="Initials" maxLength={3}
          style={{ width: 70, background: 'var(--surface)', border: '1px solid var(--accent)', color: 'var(--text)', padding: '4px 8px', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 12, outline: 'none', textAlign: 'center', letterSpacing: '0.12em' }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {TOUCH_METHODS.map(m => (
            <button key={m} onClick={() => setMethod(m)} style={{ padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'Syne', fontWeight: 700, fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase', border: `1px solid ${method === m ? 'var(--accent)' : 'var(--border)'}`, background: method === m ? 'rgba(200,240,78,0.12)' : 'transparent', color: method === m ? 'var(--accent)' : 'var(--text3)', transition: 'all 0.1s' }}>
              {m}
            </button>
          ))}
        </div>
        {showStatusSelect && (
          <select
            value={newStatus} onChange={e => setNewStatus(e.target.value)}
            style={{ background: 'var(--surface)', border: '1px solid var(--accent)', color: 'var(--text)', padding: '4px 8px', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 11, outline: 'none', cursor: 'pointer' }}>
            <option value="hot">→ Hot</option>
            <option value="warm">→ Warm</option>
            <option value="cold">→ Cold</option>
            <option value="booked">→ Booked</option>
            <option value="dead">→ Dead</option>
          </select>
        )}
      </div>
      <textarea
        value={notes} onChange={e => setNotes(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
        placeholder="Optional: add context about this touch"
        rows={2}
        style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 11, outline: 'none', resize: 'none', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
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

function KeepHotPrompt({ leadId, onSubmit, onCancel, label = 'Keep Hot' }: {
  leadId: number
  onSubmit: (id: number, initials: string, notes: string) => Promise<void>
  onCancel: () => void
  label?: string
}) {
  const [initials, setInitials] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = initials.trim().length >= 2

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    await onSubmit(leadId, initials.trim().toUpperCase(), notes)
    setSubmitting(false)
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{ padding: '10px 16px 12px 38px', background: 'rgba(240,78,122,0.07)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          autoFocus value={initials}
          onChange={e => setInitials(e.target.value.toUpperCase().slice(0, 3))}
          onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
          placeholder="Initials" maxLength={3}
          style={{ width: 70, background: 'var(--surface)', border: '1px solid var(--hot)', color: 'var(--text)', padding: '4px 8px', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 12, outline: 'none', textAlign: 'center', letterSpacing: '0.12em' }}
        />
        <span style={{ fontSize: 10, color: 'var(--hot)', fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <textarea
        value={notes} onChange={e => setNotes(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
        placeholder="Optional: add context (e.g. waiting on budget approval)"
        rows={2}
        style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 11, outline: 'none', resize: 'none', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={{ padding: '4px 14px', background: canSubmit ? 'var(--hot)' : 'var(--surface)', color: canSubmit ? '#fff' : 'var(--text3)', border: `1px solid ${canSubmit ? 'var(--hot)' : 'var(--border)'}`, borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed', letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'all 0.15s' }}>
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

function NeedsActionSection({ leads, latestTouches, selectedId, onSelect, onMarkTouched, onKeepHot, onMarkDead, onUpdateStatus, loading }: {
  leads: Lead[]
  latestTouches: TouchMap
  selectedId: number | null
  onSelect: (id: number, field?: string) => void
  onMarkTouched: (id: number, initials: string, method: TouchMethod, notes: string, statusOverride?: string) => Promise<void>
  onKeepHot: (id: number, initials: string, notes: string, status?: string) => Promise<void>
  onMarkDead: (id: number, initials: string) => Promise<void>
  onUpdateStatus: (id: number, status: string) => Promise<void>
  loading: boolean
}) {
  const [activeTab, setActiveTab] = useState<NeedsActionTab>('uncontacted')
  const [touchPromptId, setTouchPromptId] = useState<number | null>(null)
  const [keepHotPromptId, setKeepHotPromptId] = useState<number | null>(null)
  const [deadLeadPromptId, setDeadLeadPromptId] = useState<number | null>(null)

  const uncontacted = leads.filter(l => l.status === 'uncontacted' || (!l.last_contact && !['booked', 'dead'].includes(l.status)))
  const hotDue = leads.filter(l => l.status === 'hot' && isKhuDue(l) && !isParked(l))
  const warmDue = leads.filter(l => l.status === 'warm' && isKhuDue(l) && !isParked(l))
  const incompleteLeads = leads.filter(l => ['hot', 'warm', 'uncontacted'].includes(l.status) && getMissing(l).length > 0)
  const totalCount = uncontacted.length + hotDue.length + warmDue.length + incompleteLeads.length

  const tabs: { key: NeedsActionTab; label: string; color: string; items: Lead[]; type: 'touch' | 'incomplete'; emptyMsg: string }[] = [
    { key: 'uncontacted', label: 'Uncontacted', color: '#4ef0db', items: uncontacted, type: 'touch', emptyMsg: 'No fresh uncontacted leads.' },
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
          const isDeadPrompting = deadLeadPromptId === l.id
          const isPrompting = isTouchPrompting || isKeepHotPrompting || isDeadPrompting
          return (
            <React.Fragment key={l.id}>
              <div onClick={() => onSelect(l.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer', borderBottom: isPrompting ? 'none' : '1px solid var(--border)', background: selectedId === l.id ? 'rgba(78,143,240,0.06)' : 'transparent', transition: 'background 0.15s' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[l.status] || 'var(--text3)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.fname} {l.lname}</div>
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
                {/* Keep Hot / Keep Warm — Hot and Warm tabs */}
                {(activeBucket.key === 'hot' || activeBucket.key === 'warm') && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setTouchPromptId(null); setDeadLeadPromptId(null)
                      setKeepHotPromptId(isKeepHotPrompting ? null : l.id)
                    }}
                    style={{ flexShrink: 0, padding: '4px 9px', background: 'transparent', border: `1px solid ${isKeepHotPrompting ? 'var(--border)' : 'var(--hot)'}`, color: isKeepHotPrompting ? 'var(--text3)' : 'var(--hot)', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {isKeepHotPrompting ? 'Cancel' : activeBucket.key === 'warm' ? 'Keep Warm' : 'Keep Hot'}
                  </button>
                )}
                {/* Dead Lead — Incomplete tab only */}
                {activeBucket.key === 'incomplete' && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setTouchPromptId(null); setKeepHotPromptId(null)
                      setDeadLeadPromptId(isDeadPrompting ? null : l.id)
                    }}
                    style={{ flexShrink: 0, padding: '4px 9px', background: 'transparent', border: `1px solid ${isDeadPrompting ? 'var(--border)' : 'var(--text3)'}`, color: isDeadPrompting ? 'var(--text3)' : 'var(--text2)', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {isDeadPrompting ? 'Cancel' : 'Dead Lead'}
                  </button>
                )}
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setKeepHotPromptId(null); setDeadLeadPromptId(null)
                    setTouchPromptId(isTouchPrompting ? null : l.id)
                  }}
                  style={{ flexShrink: 0, padding: '4px 10px', background: 'transparent', border: `1px solid ${isTouchPrompting ? 'var(--border)' : 'var(--accent)'}`, color: isTouchPrompting ? 'var(--text3)' : 'var(--accent)', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {isTouchPrompting ? 'Cancel' : 'Mark Touched'}
                </button>
              </div>
              {isTouchPrompting && (
                <TouchPrompt
                  leadId={l.id}
                  showStatusSelect={activeBucket.key === 'uncontacted'}
                  onSubmit={async (id, init, meth, notes, status) => { setTouchPromptId(null); await onMarkTouched(id, init, meth, notes, status) }}
                  onCancel={() => setTouchPromptId(null)}
                />
              )}
              {isKeepHotPrompting && (
                <KeepHotPrompt
                  leadId={l.id}
                  label={l.status === 'warm' ? 'Keep Warm' : 'Keep Hot'}
                  onSubmit={async (id, init, notes) => { setKeepHotPromptId(null); await onKeepHot(id, init, notes, l.status) }}
                  onCancel={() => setKeepHotPromptId(null)}
                />
              )}
              {isDeadPrompting && (
                <DeadLeadPrompt
                  leadId={l.id}
                  onSubmit={async (id, init) => { setDeadLeadPromptId(null); await onMarkDead(id, init) }}
                  onCancel={() => setDeadLeadPromptId(null)}
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

type AllLeadsTab = 'uncontacted' | 'hot' | 'warm' | 'cold-dead' | 'booked'

function AllLeadsView({ leads, latestTouches, selectedId, onSelect, onMarkTouched, onKeepHot, onMarkDead, onUpdateStatus, loading }: {
  leads: Lead[]
  latestTouches: TouchMap
  selectedId: number | null
  onSelect: (id: number) => void
  onMarkTouched: (id: number, initials: string, method: TouchMethod, notes: string, statusOverride?: string) => Promise<void>
  onKeepHot: (id: number, initials: string, notes: string, status?: string) => Promise<void>
  onMarkDead: (id: number, initials: string) => Promise<void>
  onUpdateStatus: (id: number, status: string) => Promise<void>
  loading: boolean
}) {
  const [activeTab, setActiveTab] = useState<AllLeadsTab>('hot')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [touchPromptId, setTouchPromptId] = useState<number | null>(null)
  const [keepHotPromptId, setKeepHotPromptId] = useState<number | null>(null)
  const [deadLeadPromptId, setDeadLeadPromptId] = useState<number | null>(null)

  useEffect(() => { setPage(1) }, [search])

  const uncontactedLeads = leads.filter(l => l.status === 'uncontacted' || (!l.last_contact && !['booked', 'dead'].includes(l.status)))
  const hotLeads = leads.filter(l => l.status === 'hot')
  const warmLeads = leads.filter(l => l.status === 'warm')
  const coldDeadLeads = leads.filter(l => l.status === 'cold' || l.status === 'dead')
  const bookedLeads = leads.filter(l => l.status === 'booked')

  const tabMap: Record<AllLeadsTab, Lead[]> = {
    uncontacted: uncontactedLeads, hot: hotLeads, warm: warmLeads, 'cold-dead': coldDeadLeads, booked: bookedLeads,
  }

  const didMountRef = useRef(false)
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return }
    setPage(1); setSearch(''); setTouchPromptId(null); setKeepHotPromptId(null); setDeadLeadPromptId(null)
    const first = tabMap[activeTab][0]
    if (first) onSelect(first.id)
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const tabDefs: { key: AllLeadsTab; label: string; color: string }[] = [
    { key: 'uncontacted', label: 'Uncontacted', color: '#4ef0db' },
    { key: 'hot', label: 'Hot', color: 'var(--hot)' },
    { key: 'warm', label: 'Warm', color: 'var(--warm)' },
    { key: 'cold-dead', label: 'Cold/Dead', color: 'var(--text3)' },
    { key: 'booked', label: 'Booked', color: 'var(--booked)' },
  ]

  const activeLeads = tabMap[activeTab]
  const filtered = activeLeads.filter(l => {
    if (!search) return true
    const q = search.toLowerCase()
    return `${l.fname || ''} ${l.lname || ''} ${l.email || ''} ${l.phone || ''} ${l.company || ''} ${l.label || ''}`.toLowerCase().includes(q)
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const startIdx = (safePage - 1) * PAGE_SIZE
  const paginated = filtered.slice(startIdx, startIdx + PAGE_SIZE)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', flex: 1, minHeight: 0 }}>
      {/* Header: tab bar + search */}
      <div style={{ padding: '10px 16px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: 0 }}>
          {tabDefs.map(tab => {
            const active = activeTab === tab.key
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                padding: '5px 11px', border: 'none', background: 'transparent', cursor: 'pointer',
                fontFamily: 'Syne', fontWeight: 700, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: tab.color, opacity: active ? 1 : 0.55,
                borderBottom: active ? `3px solid ${tab.color}` : '3px solid transparent',
                marginBottom: -1, transition: 'opacity 0.15s', whiteSpace: 'nowrap',
              }}>
                {tab.label} <span style={{ fontWeight: 500 }}>({tabMap[tab.key].length})</span>
              </button>
            )
          })}
        </div>
        <div style={{ padding: '8px 0 6px' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${activeLeads.length} ${tabDefs.find(t => t.key === activeTab)?.label.toLowerCase()} leads…`}
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
            {search ? 'No leads match.' : `No ${tabDefs.find(t => t.key === activeTab)?.label.toLowerCase()} leads.`}
          </div>
        ) : paginated.map(l => {
          const touch = latestTouches[l.id]
          const missing = getMissing(l)
          const isTouchPrompting = touchPromptId === l.id
          const isKeepHotPrompting = keepHotPromptId === l.id
          const isDeadPrompting = deadLeadPromptId === l.id
          const isPrompting = isTouchPrompting || isKeepHotPrompting || isDeadPrompting
          const showKeepHot = activeTab === 'hot' || activeTab === 'warm'
          const keepLabel = activeTab === 'warm' ? 'Keep Warm' : 'Keep Hot'
          const showDeadLead = missing.length > 0
          return (
            <React.Fragment key={l.id}>
              <div onClick={() => onSelect(l.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', cursor: 'pointer', borderBottom: isPrompting ? 'none' : '1px solid var(--border)', background: selectedId === l.id ? 'rgba(78,143,240,0.06)' : 'transparent', transition: 'background 0.15s' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[l.status] || 'var(--text3)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.fname} {l.lname}
                    {l.company && <span style={{ color: 'var(--text3)', fontWeight: 400 }}> · {l.company}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.booking && <span>{BOOKING_ICONS[l.booking] || ''} {l.booking} · </span>}
                    {l.last_contact ? `${daysSince(l.last_contact)}d ago` : `added ${fmtDate(l.created_at)}`}
                    {touch?.initials && <span style={{ color: 'var(--text3)' }}> · {touch.initials}{touch.method ? ` via ${touch.method}` : ''}</span>}
                    {missing.length > 0 && <span style={{ color: 'var(--accent2)' }}> · missing: {missing.join(', ')}</span>}
                  </div>
                </div>
                {showKeepHot && (
                  <button onClick={e => { e.stopPropagation(); setTouchPromptId(null); setDeadLeadPromptId(null); setKeepHotPromptId(isKeepHotPrompting ? null : l.id) }}
                    style={{ flexShrink: 0, padding: '3px 8px', background: 'transparent', border: `1px solid ${isKeepHotPrompting ? 'var(--border)' : 'var(--hot)'}`, color: isKeepHotPrompting ? 'var(--text3)' : 'var(--hot)', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {isKeepHotPrompting ? 'Cancel' : keepLabel}
                  </button>
                )}
                {showDeadLead && (
                  <button onClick={e => { e.stopPropagation(); setTouchPromptId(null); setKeepHotPromptId(null); setDeadLeadPromptId(isDeadPrompting ? null : l.id) }}
                    style={{ flexShrink: 0, padding: '3px 8px', background: 'transparent', border: `1px solid ${isDeadPrompting ? 'var(--border)' : 'var(--text3)'}`, color: isDeadPrompting ? 'var(--text3)' : 'var(--text2)', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {isDeadPrompting ? 'Cancel' : 'Dead Lead'}
                  </button>
                )}
                <button onClick={e => { e.stopPropagation(); setKeepHotPromptId(null); setDeadLeadPromptId(null); setTouchPromptId(isTouchPrompting ? null : l.id) }}
                  style={{ flexShrink: 0, padding: '3px 8px', background: 'transparent', border: `1px solid ${isTouchPrompting ? 'var(--border)' : 'var(--accent)'}`, color: isTouchPrompting ? 'var(--text3)' : 'var(--accent)', borderRadius: 4, fontSize: 9, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {isTouchPrompting ? 'Cancel' : 'Mark Touched'}
                </button>
              </div>
              {isTouchPrompting && (
                <TouchPrompt leadId={l.id} showStatusSelect={activeTab === 'uncontacted'}
                  onSubmit={async (id, init, meth, notes, status) => { setTouchPromptId(null); await onMarkTouched(id, init, meth, notes, status) }}
                  onCancel={() => setTouchPromptId(null)} />
              )}
              {isKeepHotPrompting && (
                <KeepHotPrompt leadId={l.id}
                  label={keepLabel}
                  onSubmit={async (id, init, notes) => { setKeepHotPromptId(null); await onKeepHot(id, init, notes, l.status) }}
                  onCancel={() => setKeepHotPromptId(null)} />
              )}
              {isDeadPrompting && (
                <DeadLeadPrompt leadId={l.id}
                  onSubmit={async (id, init) => { setDeadLeadPromptId(null); await onMarkDead(id, init) }}
                  onCancel={() => setDeadLeadPromptId(null)} />
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

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6, marginTop: 14 }}>
      {label}
    </div>
  )
}

function FieldPair({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>{children}</div>
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

function LeadDetail({ lead, missing, latestTouch, focusField, onFocusConsumed, distinctLabels, distinctCompanies, onUpdate }: {
  lead: Lead
  missing: string[]
  latestTouch?: { initials: string, method: string, created_at: string }
  focusField?: string | null
  onFocusConsumed?: () => void
  distinctLabels: string[]
  distinctCompanies: string[]
  onUpdate: (f: string, v: any) => void
}) {
  const [local, setLocal] = useState<Partial<Lead>>({ ...lead })
  const [notesVal, setNotesVal] = useState(lead.notes || '')
  const [savedField, setSavedField] = useState<string | null>(null)
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const [showLabelDD, setShowLabelDD] = useState(false)
  const [showCompanyDD, setShowCompanyDD] = useState(false)

  const fnameRef = useRef<HTMLInputElement>(null)
  const lnameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const quoteRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setLocal({ ...lead }) }, [lead.id])
  useEffect(() => { setNotesVal(lead.notes || '') }, [lead.notes])

  useEffect(() => {
    if (!focusField) return
    const refMap: Record<string, React.RefObject<HTMLInputElement>> = {
      'first name': fnameRef, 'last name': lnameRef,
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

  const lastContactDisplay = lead.last_contact
    ? `${fmtDateTime(lead.last_contact)}${latestTouch?.initials ? ' · ' + latestTouch.initials + (latestTouch.method ? ' via ' + latestTouch.method : '') : ''}`
    : '—'

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
      {/* Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <input
          ref={fnameRef}
          value={local.fname || ''} onChange={e => update('fname', e.target.value)}
          onFocus={() => setFocusedInput('fname')}
          onBlur={e => { setFocusedInput(null); save('fname', e.target.value) }}
          placeholder="First name"
          style={{ ...iStyle('fname'), fontFamily: 'DM Serif Display', fontSize: 22, letterSpacing: -0.5, flex: 1 }}
        />
        <input
          ref={lnameRef}
          value={local.lname || ''} onChange={e => update('lname', e.target.value)}
          onFocus={() => setFocusedInput('lname')}
          onBlur={e => { setFocusedInput(null); save('lname', e.target.value) }}
          placeholder="Last name"
          style={{ ...iStyle('lname'), fontFamily: 'DM Serif Display', fontSize: 22, letterSpacing: -0.5, flex: 1 }}
        />
        {savedField && <span style={{ fontSize: 9, color: 'var(--booked)', fontFamily: 'DM Mono', flexShrink: 0 }}>saved</span>}
      </div>

      {/* Pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        <select
          value={local.status || lead.status}
          onChange={e => { update('status', e.target.value); saveStatus(e.target.value) }}
          style={{ ...pillBase, background: `${STATUS_COLORS[local.status || lead.status]}22`, color: STATUS_COLORS[local.status || lead.status] || 'var(--text2)', border: `1px solid ${STATUS_COLORS[local.status || lead.status]}66`, appearance: 'none' as any }}>
          {['hot', 'warm', 'cold', 'uncontacted', 'booked', 'dead'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          onClick={() => { const nb = (local.billing || lead.billing) === 'COD' ? 'Billing' : 'COD'; update('billing', nb); save('billing', nb) }}
          style={{ ...pillBase, background: (local.billing || lead.billing) === 'COD' ? 'rgba(78,240,162,0.15)' : 'rgba(78,143,240,0.15)', color: (local.billing || lead.billing) === 'COD' ? 'var(--booked)' : 'var(--accent2)', border: `1px solid ${(local.billing || lead.billing) === 'COD' ? 'rgba(78,240,162,0.4)' : 'rgba(78,143,240,0.4)'}` }}>
          {local.billing || lead.billing || 'COD'}
        </button>
        {lead.booking && (
          <span style={{ ...pillBase, background: 'rgba(139,144,168,0.12)', color: 'var(--text2)', border: '1px solid var(--border)', cursor: 'default', fontSize: 9 }}>
            {BOOKING_ICONS[lead.booking] || ''} {lead.booking}
          </span>
        )}
        {lead.first_time && (
          <span style={{ ...pillBase, background: 'rgba(78,143,240,0.15)', color: 'var(--accent2)', border: '1px solid rgba(78,143,240,0.4)', cursor: 'default' }}>
            ★ First Time
          </span>
        )}
      </div>

      {missing.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--accent2)', background: 'rgba(78,143,240,0.08)', padding: '6px 10px', borderRadius: 6, marginBottom: 4 }}>
          ⚠ Missing: {missing.join(', ')}
        </div>
      )}

      <SectionHeader label="Contact" />
      <FieldPair>
        <Field label="Email">
          <input ref={emailRef} value={local.email || ''} onChange={e => update('email', e.target.value)}
            onFocus={() => setFocusedInput('email')} onBlur={e => { setFocusedInput(null); save('email', e.target.value) }}
            placeholder="Add email" style={iStyle('email')} />
        </Field>
        <Field label="Phone">
          <input ref={phoneRef} value={local.phone || ''} onChange={e => update('phone', e.target.value)}
            onFocus={() => setFocusedInput('phone')} onBlur={e => { setFocusedInput(null); save('phone', e.target.value) }}
            placeholder="Add phone" style={iStyle('phone')} />
        </Field>

        {/* Label with autocomplete */}
        <div style={{ position: 'relative' }}>
          <div style={fieldLabelStyle}>Label</div>
          <input
            value={local.label || ''}
            onChange={e => { update('label', e.target.value); setShowLabelDD(true) }}
            onFocus={() => { setFocusedInput('label'); setShowLabelDD(true) }}
            onBlur={e => { setFocusedInput(null); setShowLabelDD(false); save('label', e.target.value) }}
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

        <Field label="Source">
          <input value={local.source || ''} onChange={e => update('source', e.target.value)}
            onFocus={() => setFocusedInput('source')} onBlur={e => { setFocusedInput(null); save('source', e.target.value) }}
            placeholder="—" style={iStyle('source')} />
        </Field>
      </FieldPair>

      {/* Company with autocomplete */}
      <div style={{ marginTop: 6, position: 'relative' }}>
        <div style={fieldLabelStyle}>Company / Artist</div>
        <input
          value={local.company || ''}
          onChange={e => { update('company', e.target.value); setShowCompanyDD(true) }}
          onFocus={() => { setFocusedInput('company'); setShowCompanyDD(true) }}
          onBlur={e => { setFocusedInput(null); setShowCompanyDD(false); save('company', e.target.value) }}
          placeholder="—"
          style={iStyle('company')}
        />
        {showCompanyDD && companySuggestions.length > 0 && (
          <div style={ddStyle}>
            {companySuggestions.map(s => (
              <div key={s} onMouseDown={e => { e.preventDefault(); update('company', s); save('company', s); setShowCompanyDD(false) }} style={ddItemStyle}>{s}</div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
        <div>
          <div style={fieldLabelStyle}>Initial Contact</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', padding: '4px 6px' }}>{fmtDate(lead.created_at)}</div>
        </div>
        <div>
          <div style={fieldLabelStyle}>Last Contact</div>
          <div style={{ fontSize: 11, color: lead.last_contact ? 'var(--text)' : 'var(--text3)', padding: '4px 6px', lineHeight: 1.5 }}>{lastContactDisplay}</div>
        </div>
        {(lead.status === 'hot' || lead.status === 'warm') && (
          <div>
            <div style={fieldLabelStyle}>Keep Hot Until</div>
            <div style={{ fontSize: 11, padding: '4px 6px', color: (() => {
              if (!lead.keep_hot_until) return 'var(--text3)'
              const d = daysUntilKhu(lead)
              if (d === null) return 'var(--text3)'
              if (d < 1) return 'var(--hot)'
              if (d <= 2) return 'var(--warm)'
              return 'var(--booked)'
            })() }}>
              {lead.keep_hot_until ? fmtDateTime(lead.keep_hot_until) : '—'}
            </div>
          </div>
        )}
      </div>

      <SectionHeader label="Location & Quote" />
      <FieldPair>
        <Field label="Studio / Location">
          <input value={local.location || ''} onChange={e => update('location', e.target.value)}
            onFocus={() => setFocusedInput('location')} onBlur={e => { setFocusedInput(null); save('location', e.target.value) }}
            placeholder="—" style={iStyle('location')} />
        </Field>
        <Field label="Quote / Rate">
          <input ref={quoteRef} value={local.quote || ''} onChange={e => update('quote', e.target.value)}
            onFocus={() => setFocusedInput('quote')} onBlur={e => { setFocusedInput(null); save('quote', e.target.value) }}
            placeholder="—" style={iStyle('quote')} />
        </Field>
      </FieldPair>

      <SectionHeader label="Session Notes & Details" />
      <textarea
        value={notesVal}
        onChange={e => setNotesVal(e.target.value)}
        onBlur={() => { if (notesDirty) save('notes', notesVal) }}
        placeholder="Add notes…"
        style={{ width: '100%', minHeight: 90, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11, resize: 'vertical', outline: 'none', lineHeight: 1.6 }}
      />
      {notesDirty && (
        <button
          onClick={() => save('notes', notesVal)}
          style={{ marginTop: 6, padding: '5px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 5, fontSize: 10, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Save Notes
        </button>
      )}
    </div>
  )
}

// ─── New Lead modal ───────────────────────────────────────────────────────────

function NewLeadModal({ leads, onClose, onSave }: {
  leads: Lead[]
  onClose: () => void
  onSave: (data: Partial<Lead>) => Promise<void>
}) {
  const emptyForm = { fname: '', lname: '', email: '', phone: '', company: '', label: '', source: '', booking: '', notes: '', billing: 'COD' as const }
  const [form, setForm] = useState(emptyForm)
  const [nameSuggestions, setNameSuggestions] = useState<Array<{ record: Lead | Client, type: 'lead' | 'client' }>>([])
  const [showNameDD, setShowNameDD] = useState(false)
  const [nameHighlight, setNameHighlight] = useState(-1)
  const [labelSuggestions, setLabelSuggestions] = useState<string[]>([])
  const [companySuggestions, setCompanySuggestions] = useState<string[]>([])
  const [showLabelDD, setShowLabelDD] = useState(false)
  const [showCompanyDD, setShowCompanyDD] = useState(false)
  const [saving, setSaving] = useState(false)
  const nameDebounce = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const query = `${form.fname} ${form.lname}`.trim()
    if (query.length < 2) { setNameSuggestions([]); setShowNameDD(false); return }
    clearTimeout(nameDebounce.current)
    nameDebounce.current = setTimeout(async () => {
      const leadMatches = leads
        .filter(l => fuzzyMatch(query, `${l.fname} ${l.lname} ${l.company || ''}`))
        .slice(0, 6).map(l => ({ record: l as Lead | Client, type: 'lead' as const }))
      const words = query.toLowerCase().split(/\s+/).filter(Boolean)
      let clientQuery = supabase.from('clients').select('*')
      if (words[0]) clientQuery = clientQuery.or(`fname.ilike.%${words[0]}%,lname.ilike.%${words[0]}%,company.ilike.%${words[0]}%`)
      const { data: clientData } = await clientQuery.limit(8)
      const clientMatches = (clientData || [])
        .filter((c: Client) => fuzzyMatch(query, `${c.fname} ${c.lname} ${c.company || ''}`))
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
  }, [form.fname, form.lname, leads])

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

  function applyAutofill(item: { record: Lead | Client, type: 'lead' | 'client' }) {
    const r = item.record
    const prevNote = item.type === 'client'
      ? `Repeat client — last booking: ${fmtDate(r.created_at)} ${(r as any).booking || ''}`
      : `Previous inquiry: ${fmtDate(r.created_at)} — ${((r as Lead).notes || '').slice(0, 120)}`
    setForm(prev => ({ ...prev, fname: r.fname || prev.fname, lname: r.lname || prev.lname, email: r.email || prev.email, phone: r.phone || prev.phone, company: r.company || prev.company, label: r.label || prev.label, source: r.source || prev.source, booking: (r as any).booking || prev.booking, billing: (r as any).billing || prev.billing, notes: prevNote }))
    setShowNameDD(false); setNameHighlight(-1)
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (!showNameDD || nameSuggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setNameHighlight(h => Math.min(h + 1, nameSuggestions.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setNameHighlight(h => Math.max(h - 1, 0)) }
    if (e.key === 'Enter' && nameHighlight >= 0) { e.preventDefault(); applyAutofill(nameSuggestions[nameHighlight]) }
    if (e.key === 'Escape') { setShowNameDD(false) }
  }

  function set(key: string, val: string) { setForm(prev => ({ ...prev, [key]: val })) }

  async function handleSave() {
    if (!form.fname && !form.lname && !form.email && !form.phone) return
    setSaving(true)
    await onSave({ ...form, status: 'uncontacted' as LeadStatus })
    setSaving(false)
  }

  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 12, outline: 'none' }
  const labelS: React.CSSProperties = { fontSize: 9, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4, display: 'block' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 540, maxHeight: '88vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15 }}>New Lead</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                    <div key={`${item.type}-${r.id}`} onMouseDown={() => applyAutofill(item)} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: i === nameHighlight ? 'var(--surface)' : 'transparent', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{r.fname} {r.lname}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                          {r.company && <span>{r.company} · </span>}{(r as any).booking && <span>{(r as any).booking} · </span>}{fmtDate(r.created_at)}
                        </div>
                      </div>
                      <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 10, background: isClient ? 'rgba(78,240,162,0.15)' : 'rgba(139,144,168,0.15)', color: isClient ? 'var(--booked)' : 'var(--text3)', fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>
                        {isClient ? '★ Client' : 'Prev. Inquiry'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><label style={labelS}>Email</label><input value={form.email} onChange={e => set('email', e.target.value)} type="email" style={inputStyle} /></div>
            <div><label style={labelS}>Phone</label><input value={form.phone} onChange={e => set('phone', e.target.value)} style={inputStyle} /></div>
          </div>
          <div style={{ position: 'relative' }}>
            <label style={labelS}>Company / Artist Name</label>
            <input value={form.company} onChange={e => set('company', e.target.value)} onFocus={() => setShowCompanyDD(true)} onBlur={() => setTimeout(() => setShowCompanyDD(false), 150)} style={inputStyle} />
            {showCompanyDD && companySuggestions.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 10, marginTop: 2 }}>
                {companySuggestions.map(s => <div key={s} onMouseDown={() => { set('company', s); setShowCompanyDD(false) }} style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--border)' }}>{s}</div>)}
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <label style={labelS}>Label</label>
            <input value={form.label} onChange={e => set('label', e.target.value)} onFocus={() => setShowLabelDD(true)} onBlur={() => setTimeout(() => setShowLabelDD(false), 150)} style={inputStyle} />
            {showLabelDD && labelSuggestions.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 10, marginTop: 2 }}>
                {labelSuggestions.map(s => <div key={s} onMouseDown={() => { set('label', s); setShowLabelDD(false) }} style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--border)' }}>{s}</div>)}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><label style={labelS}>Source</label><input value={form.source} onChange={e => set('source', e.target.value)} placeholder="Instagram, referral…" style={inputStyle} /></div>
            <div>
              <label style={labelS}>Booking Type</label>
              <select value={form.booking} onChange={e => set('booking', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">—</option><option>Recording Session</option><option>Filming</option><option>Event/Playback</option>
              </select>
            </div>
          </div>
          <div>
            <label style={labelS}>Billing</label>
            <select value={form.billing} onChange={e => set('billing', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="COD">COD</option><option value="Billing">Billing</option>
            </select>
          </div>
          <div>
            <label style={labelS}>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </div>
        <div style={{ padding: '12px 20px 20px', display: 'flex', gap: 8, position: 'sticky', bottom: 0, background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '9px 0', background: 'var(--accent)', color: '#0d0f14', border: 'none', borderRadius: 6, fontFamily: 'Syne', fontWeight: 700, fontSize: 11, cursor: saving ? 'not-allowed' : 'pointer', letterSpacing: '0.05em', textTransform: 'uppercase', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Create Lead'}
          </button>
          <button onClick={onClose} style={{ padding: '9px 20px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
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
          { label: 'Conversion Rate', value: `${convRate}%`, color: 'var(--accent2)', sub: 'Leads to booked' },
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
