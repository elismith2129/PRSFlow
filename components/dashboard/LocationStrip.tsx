'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { DailyOpsModal, type DailyOpsSubmission } from '@/components/dashboard/DailyOpsModal'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import { CHECKLISTS, flattenSections } from '@/lib/checklist-items'

const LOCATIONS = [
  { label: 'Paramount', key: 'paramount', abbr: 'PRS', color: '#c8f04e' },
  { label: 'Encore',    key: 'encore',    abbr: 'ERS', color: '#4e8ff0' },
  { label: 'Ameraycan', key: 'ameraycan', abbr: 'ARS', color: '#f04e7a' },
  { label: 'Track',     key: 'track',     abbr: 'TRS', color: '#f0a24e' },
]

const OPS_CATS = [
  { key: 'opening_checklist', label: 'Opening Checklist', liveDoc: false, global: false },
  { key: 'closing_checklist', label: 'Closing Checklist', liveDoc: false, global: false },
  { key: 'petty_cash',        label: 'Petty Cash',        liveDoc: false, global: false },
  { key: 'stock_list',        label: 'Stock List',        liveDoc: true,  global: false },
  { key: 'mic_inventory',     label: 'Mic Inventory',     liveDoc: true,  global: true  },
]

const DAILY_CATS = OPS_CATS.filter(c => !c.liveDoc)

type WO = {
  id: string; booking_id: string | null; invoice_number: string | null
  client: string | null; artist: string | null; engineer: string | null
  from_time: string | null; to_time: string | null; studios: string[] | null
  status: string; session_notes: string | null
  needs_attention_notes: string | null
}

type DailyOpsRow = {
  id: string; category: string; staff_name: string | null
  submitted_at: string | null; admin_approved_at: string | null; admin_approved_by: string | null
  needs_attention?: boolean | null
}

type ChecklistProgress = { checked: number; total: number }

type SessionRow = { booking: Booking; wo: WO | null }
type StudioSummary = { sessionCount: number; pendingCount: number }
type ModalTarget = { category: string; date: string }

function getLocalDateStr(offsetDays = 0): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function matchesLoc(loc: string | null, key: string, abbr: string) {
  const l = (loc ?? '').toLowerCase()
  return l.includes(key) || l.includes(abbr.toLowerCase())
}

function TwoCheckbox({ label, checked, clickable = false, loading = false, onClick, color = '#c8f04e' }: {
  label: string; checked: boolean; clickable?: boolean; loading?: boolean; onClick?: () => void; color?: string
}) {
  return (
    <button
      onClick={clickable && !loading ? onClick : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        background: checked ? color + '18' : 'var(--surface2, #1e2130)',
        border: `1px solid ${checked ? color + '66' : 'var(--border)'}`,
        borderRadius: 6, padding: '4px 9px',
        cursor: clickable && !loading ? 'pointer' : 'default',
        opacity: loading ? 0.5 : 1, transition: 'all 0.12s',
      }}
    >
      <div style={{
        width: 11, height: 11, borderRadius: 3, flexShrink: 0,
        border: `1.5px solid ${checked ? color : 'var(--text3, #666)'}`,
        background: checked ? color : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && <span style={{ fontSize: 7, color: '#0d0f14', fontWeight: 900, lineHeight: 1 }}>✓</span>}
      </div>
      <span style={{ fontSize: 9, fontFamily: 'DM Mono, monospace', fontWeight: 700, letterSpacing: '0.05em', color: checked ? color : 'var(--text3, #666)' }}>
        {loading ? '…' : label}
      </span>
    </button>
  )
}

export function LocationStrip() {
  const today     = getLocalDateStr()
  const yesterday = getLocalDateStr(-1)

  const [summaries, setSummaries]           = useState<Record<string, StudioSummary>>({})
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [selectedLoc, setSelectedLoc]       = useState<typeof LOCATIONS[0] | null>(null)
  const [drawerLoading, setDrawerLoading]   = useState(false)
  const [sessions, setSessions]             = useState<SessionRow[]>([])
  const [opsRows, setOpsRows]               = useState<DailyOpsRow[]>([])
  const [yestSessions, setYestSessions]     = useState<SessionRow[]>([])
  const [yestOpsRows, setYestOpsRows]       = useState<DailyOpsRow[]>([])
  const [openModal, setOpenModal]           = useState<ModalTarget | null>(null)
  const [checklistProgress, setChecklistProgress] = useState<Record<string, ChecklistProgress>>({})
  // Ref for stable closure in realtime callbacks — always reflects current selectedLoc
  const selectedLocRef = useRef<typeof LOCATIONS[0] | null>(null)
  const [woBooking, setWoBooking]           = useState<Booking | null>(null)

  useEffect(() => { selectedLocRef.current = selectedLoc }, [selectedLoc])

  useEffect(() => { loadSummaries() }, [])

  // Subscribe to bookings and work_orders — re-fetch summaries (badges) and
  // silently refresh the open drawer whenever any change lands in the DB.
  useEffect(() => {
    async function handleChange() {
      await loadSummaries()
      const loc = selectedLocRef.current
      if (loc) await fetchDrawerData(loc)
    }

    const bookingsChannel = supabase
      .channel('daily-ops-bookings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, handleChange)
      .subscribe()

    const woChannel = supabase
      .channel('daily-ops-wos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, handleChange)
      .subscribe()

    return () => {
      supabase.removeChannel(bookingsChannel)
      supabase.removeChannel(woChannel)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSummaries() {
    const [{ data: bkgs }, { data: ops }, { data: yOps }, { data: submittedWOs }] = await Promise.all([
      supabase.from('bookings').select('id, location, status').lte('start_date', today).gte('end_date', today).eq('status', 'confirmed'),
      supabase.from('daily_ops_submissions').select('studio, category, submitted_at, admin_approved_at').eq('date', today),
      supabase.from('daily_ops_submissions').select('studio, category, submitted_at, admin_approved_at').eq('date', yesterday),
      supabase.from('work_orders').select('booking_id').eq('status', 'open'),
    ])

    const submittedBkgIds = new Set((submittedWOs ?? []).map((w: any) => w.booking_id).filter(Boolean))

    const result: Record<string, StudioSummary> = {}
    for (const loc of LOCATIONS) {
      const locBkgs = (bkgs ?? []).filter(b => matchesLoc(b.location, loc.key, loc.abbr))
      const locOps  = (ops ?? []).filter(o => (o as any).studio === loc.key)
      const yLocOps = (yOps ?? []).filter(o => (o as any).studio === loc.key)

      result[loc.key] = {
        sessionCount: locBkgs.length,
        pendingCount:
          locBkgs.filter(b => submittedBkgIds.has(b.id)).length +
          locOps.filter(o => o.submitted_at && !o.admin_approved_at).length +
          yLocOps.filter((o: any) => o.submitted_at && !o.admin_approved_at).length,
      }
    }
    setSummaries(result)
    setLoadingSummary(false)
  }

  // Fetches and updates drawer state without touching the loading flag — used
  // both by openDrawer (with loading) and by realtime callbacks (silent refresh).
  async function fetchDrawerData(loc: typeof LOCATIONS[0]) {
    const [{ data: todayBkgsData }, { data: yestBkgsData }] = await Promise.all([
      supabase.from('bookings').select('*').lte('start_date', today).gte('end_date', today).eq('status', 'confirmed').order('from_time'),
      supabase.from('bookings').select('*').lte('start_date', yesterday).gte('end_date', yesterday).eq('status', 'confirmed').order('from_time'),
    ])

    const locTodayBkgs = (todayBkgsData ?? []).filter(b => matchesLoc(b.location, loc.key, loc.abbr))
    const locYestBkgs  = (yestBkgsData ?? []).filter(b => matchesLoc(b.location, loc.key, loc.abbr))
    const todayBkgIds  = locTodayBkgs.map(b => b.id)
    const yestBkgIds   = locYestBkgs.map(b => b.id)

    const [tWOs, tOps, yWOs, yOps, tChecklists] = await Promise.all([
      todayBkgIds.length > 0 ? supabase.from('work_orders').select('*').in('booking_id', todayBkgIds) : Promise.resolve({ data: [] as any[] }),
      supabase.from('daily_ops_submissions').select('*').eq('studio', loc.key).eq('date', today),
      yestBkgIds.length > 0  ? supabase.from('work_orders').select('*').in('booking_id', yestBkgIds)  : Promise.resolve({ data: [] as any[] }),
      supabase.from('daily_ops_submissions').select('*').eq('studio', loc.key).eq('date', yesterday),
      supabase.from('checklists').select('type, items').eq('studio', loc.key).eq('date', today),
    ])

    const woMapToday: Record<string, WO> = {}
    for (const w of tWOs.data ?? []) if (w.booking_id) woMapToday[w.booking_id] = w
    const woMapYest: Record<string, WO> = {}
    for (const w of yWOs.data ?? []) if (w.booking_id) woMapYest[w.booking_id] = w

    const activeTodayBkgs = locTodayBkgs.filter(b => {
      const wo = woMapToday[b.id]
      if (!wo) return true
      return wo.status !== 'completed'
    })

    const clProgress: Record<string, ChecklistProgress> = {}
    for (const row of tChecklists.data ?? []) {
      const catKey = `${row.type}_checklist`
      const studioChecklists = CHECKLISTS[loc.key] ?? CHECKLISTS.paramount
      const secs = studioChecklists[row.type as 'opening' | 'closing'] ?? []
      const total = flattenSections(secs).length
      const done  = (row.items ?? []).filter((it: any) => it.checked).length
      clProgress[catKey] = { checked: done, total }
    }

    setSessions(activeTodayBkgs.map(b => ({ booking: b as Booking, wo: woMapToday[b.id] ?? null })))
    setOpsRows(tOps.data ?? [])
    setYestSessions(locYestBkgs.map(b => ({ booking: b as Booking, wo: woMapYest[b.id] ?? null })))
    setYestOpsRows(yOps.data ?? [])
    setChecklistProgress(clProgress)
  }

  async function openDrawer(loc: typeof LOCATIONS[0]) {
    setSelectedLoc(loc)
    setDrawerLoading(true)
    await fetchDrawerData(loc)
    setDrawerLoading(false)
  }

  function closeDrawer() {
    setSelectedLoc(null)
    setSessions([]); setOpsRows([]); setYestSessions([]); setYestOpsRows([])
  }

  async function approveOps(category: string, date: string) {
    if (!selectedLoc) return
    const studioKey = category === 'mic_inventory' ? 'global' : selectedLoc.key
    await supabase.from('daily_ops_submissions').upsert({
      studio: studioKey, date, category,
      admin_approved_at: new Date().toISOString(), admin_approved_by: 'admin',
    }, { onConflict: 'studio,date,category' })
    if (selectedLoc) await openDrawer(selectedLoc)
    await loadSummaries()
  }

  const yestHasUnapproved = !!(selectedLoc && (
    yestSessions.some(({ wo }) => wo && wo.status !== 'completed') ||
    DAILY_CATS.some(cat => { const r = yestOpsRows.find(o => o.category === cat.key); return r?.submitted_at && !r?.admin_approved_at })
  ))

  function SessionCard({ b, wo, isYesterday }: { b: Booking; wo: WO | null; isYesterday?: boolean }) {
    const runnerDone     = wo?.status === 'completed'
    const adminDone      = wo?.status === 'completed'
    const needsAttention = !!(wo?.needs_attention_notes)
    const col            = selectedLoc!.color
    const borderColor    = needsAttention ? '#f9731655' : 'var(--border)'
    return (
      <div style={{
        background: 'var(--surface)',
        border: `1px solid ${borderColor}`,
        borderRadius: 10, padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{b.artist || b.client_name || '—'}</div>
            {b.artist && b.client_name && <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 1 }}>{b.client_name}</div>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {needsAttention && (
              <span style={{ fontSize: 9, fontWeight: 700, color: '#f97316', background: '#f9731622', padding: '2px 7px', borderRadius: 4, fontFamily: 'DM Mono, monospace' }}>⚠ Needs Attention</span>
            )}
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: b.status === 'confirmed' ? col : 'var(--text3)', background: (b.status === 'confirmed' ? col : 'var(--text3)') + '22', padding: '2px 7px', borderRadius: 4, fontFamily: 'DM Mono, monospace' }}>{b.status}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
          {b.from_time && <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono, monospace' }}>{b.from_time}–{b.to_time ?? '?'}</span>}
          {(b as any).studio && <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono, monospace' }}>Studio {(b as any).studio}</span>}
          {(b as any).engineer_name && <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono, monospace' }}>Eng: {(b as any).engineer_name}</span>}
          {(b as any).payment_type && <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>{(b as any).payment_type}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 9, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', minWidth: 22 }}>WO</span>
            <TwoCheckbox label="Runner" checked={runnerDone} color={col} />
            <TwoCheckbox label="Admin" checked={!!adminDone} color={col} />
          </div>
          {wo && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={e => { e.stopPropagation(); setWoBooking(b) }}
                style={{ fontSize: 10, color: col, fontFamily: 'Syne, sans-serif', padding: '4px 9px', border: `1px solid ${col}55`, borderRadius: 6, background: `${col}12`, cursor: 'pointer', fontWeight: 700 }}
              >
                View / Edit
              </button>
              <a href={`/wo/${wo.id}/print`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'Syne, sans-serif', textDecoration: 'none', padding: '4px 9px', border: '1px solid var(--border)', borderRadius: 6 }}>PDF</a>
            </div>
          )}
        </div>
      </div>
    )
  }

  function SectionLabel({ label, date, orange }: { label: string; date: string; orange?: boolean }) {
    const c = orange ? '#f0a24e' : 'var(--text3)'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: c, fontFamily: 'Syne', whiteSpace: 'nowrap' }}>{label}</div>
        <div style={{ flex: 1, height: 1, background: orange ? '#f0a24e33' : 'var(--border)' }} />
        <div style={{ fontSize: 9, color: orange ? '#f0a24e88' : 'var(--text3)', fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap' }}>
          {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* ── Strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
        {LOCATIONS.map(loc => {
          const s        = summaries[loc.key]
          const sessCount = s?.sessionCount ?? 0
          const pending  = s?.pendingCount ?? 0
          const active   = sessCount > 0
          return (
            <div key={loc.key} onClick={() => openDrawer(loc)}
              onMouseEnter={e => (e.currentTarget.style.borderColor = loc.color + '99')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = active ? loc.color + '55' : 'var(--border)')}
              style={{ background: 'var(--surface)', border: `1px solid ${active ? loc.color + '55' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s' }}
            >
              <div style={{ height: 2, background: active ? loc.color : 'var(--border)', opacity: active ? 1 : 0.25 }} />
              <div style={{ padding: '10px 14px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 13, color: active ? loc.color : 'var(--text2)' }}>{loc.label}</div>
                  {!loadingSummary && pending > 0 && (
                    <div style={{ background: '#f0a24e', color: '#0d0f14', borderRadius: 100, fontSize: 9, fontWeight: 800, padding: '1px 6px', fontFamily: 'DM Mono, monospace' }}>{pending}</div>
                  )}
                </div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: active ? loc.color : 'var(--text3)', marginTop: 2 }}>
                  {loadingSummary ? '…' : active ? `${sessCount} SESSION${sessCount !== 1 ? 'S' : ''}` : 'OPEN'}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Centered Dialog — zIndex above nav (9999) ── */}
      {selectedLoc && (
        <div
          style={{ position: 'fixed', inset: 0, background: '#000000cc', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}
          onClick={e => e.target === e.currentTarget && closeDrawer()}
        >
          <div style={{
            background: 'var(--bg)', width: '100%', maxWidth: 920,
            maxHeight: '88dvh', borderRadius: 16, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 32px 96px #0009',
            border: `1px solid ${selectedLoc.color}33`,
          }}>
            {/* Color accent bar */}
            <div style={{ height: 3, background: selectedLoc.color, flexShrink: 0 }} />

            {/* Header */}
            <div style={{ padding: '18px 26px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <div style={{ fontFamily: 'Syne', fontWeight: 900, fontSize: 20, color: selectedLoc.color }}>{selectedLoc.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
                  {new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · Daily Ops
                </div>
              </div>
              <button onClick={closeDrawer} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '4px 8px' }}>✕</button>
            </div>

            {/* Scrollable body */}
            {drawerLoading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontFamily: 'Syne' }}>Loading…</div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>

                  {/* ── LEFT — Yesterday ── */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text3)', fontFamily: 'Syne' }}>Yesterday</span>
                      <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>
                        {new Date(yesterday + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                    </div>

                    {(() => {
                      const unapprovedSessions = yestSessions.filter(({ wo }) =>
                        wo?.status !== 'completed'
                      )
                      const unapprovedOpsCats = DAILY_CATS.filter(cat => {
                        const row = yestOpsRows.find(o => o.category === cat.key)
                        return !!(row?.submitted_at && !row?.admin_approved_at)
                      })
                      const allClear = unapprovedSessions.length === 0 && unapprovedOpsCats.length === 0

                      if (allClear) {
                        return (
                          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '28px 16px', textAlign: 'center' }}>
                            <div style={{ fontSize: 20, marginBottom: 6 }}>✓</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', fontFamily: 'Syne' }}>All clear</div>
                            <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', marginTop: 4 }}>Nothing pending from yesterday</div>
                          </div>
                        )
                      }

                      return (
                        <>
                          {unapprovedSessions.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {unapprovedSessions.map(({ booking: b, wo }) => (
                                <SessionCard key={b.id} b={b} wo={wo} isYesterday />
                              ))}
                            </div>
                          )}

                          {unapprovedOpsCats.length > 0 && (
                            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                              {unapprovedOpsCats.map((cat, i) => {
                                const row        = yestOpsRows.find(o => o.category === cat.key)
                                const runnerDone = !!row?.submitted_at
                                const adminDone  = !!row?.admin_approved_at
                                const needsReview = runnerDone && !adminDone
                                return (
                                  <div key={cat.key}
                                    onClick={() => setOpenModal({ category: cat.key, date: yesterday })}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2, #1e2130)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = needsReview ? '#f0a24e08' : 'transparent')}
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', background: needsReview ? '#f0a24e08' : 'transparent', borderBottom: i < unapprovedOpsCats.length - 1 ? '1px solid var(--border)' : 'none', transition: 'background 0.1s' }}
                                  >
                                    <div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                        <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'Syne', fontWeight: 600 }}>{cat.label}</span>
                                        {needsReview && <span style={{ fontSize: 9, fontWeight: 700, color: '#f0a24e', background: '#f0a24e22', padding: '2px 7px', borderRadius: 4, fontFamily: 'DM Mono, monospace' }}>Review</span>}
                                      </div>
                                      {row?.staff_name && (
                                        <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
                                          {row.staff_name}{row.submitted_at && ` · ${new Date(row.submitted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
                                        </div>
                                      )}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                      <TwoCheckbox label="Runner" checked={runnerDone} color={selectedLoc.color} />
                                      <TwoCheckbox label="Admin"  checked={adminDone}  color={selectedLoc.color} />
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>

                  {/* ── RIGHT — Today ── */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 10, borderBottom: `1px solid ${selectedLoc.color}44` }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: selectedLoc.color, fontFamily: 'Syne' }}>Today</span>
                      <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>
                        {new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                    </div>

                    {(() => {
                      if (sessions.length === 0) {
                        return <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'Syne', padding: '10px 0' }}>No sessions booked today.</div>
                      }
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {sessions.map(({ booking: b, wo }) => (
                            <SessionCard key={b.id} b={b} wo={wo} />
                          ))}
                        </div>
                      )
                    })()}

                    {(() => {
                      const activeCats = OPS_CATS.filter(cat => {
                        const row = opsRows.find(o => o.category === cat.key)
                        return !row?.admin_approved_at
                      })
                      if (activeCats.length === 0) return null
                      return (
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                      {activeCats.map((cat, i) => {
                        const row         = opsRows.find(o => o.category === cat.key)
                        const runnerDone  = !!row?.submitted_at
                        const adminDone   = !!row?.admin_approved_at
                        const isChecklist = cat.key === 'opening_checklist' || cat.key === 'closing_checklist'
                        const prog        = checklistProgress[cat.key]
                        return (
                          <div key={cat.key}
                            onClick={() => setOpenModal({ category: cat.key, date: today })}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2, #1e2130)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', borderBottom: i < activeCats.length - 1 ? '1px solid var(--border)' : 'none', transition: 'background 0.1s' }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'Syne', fontWeight: 600 }}>{cat.label}</span>
                                {row?.needs_attention && !adminDone && (
                                  <span style={{ fontSize: 9, fontWeight: 700, color: '#f0a24e', background: '#f0a24e22', padding: '2px 6px', borderRadius: 4, fontFamily: 'DM Mono, monospace' }}>⚠</span>
                                )}
                              </div>
                              {isChecklist && prog && (
                                <div style={{ fontSize: 9, color: runnerDone ? '#4ade80' : '#8b90a8', fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
                                  {prog.checked}/{prog.total} checked
                                </div>
                              )}
                              {row?.staff_name && (
                                <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', marginTop: 2 }}>
                                  {row.staff_name}{row.submitted_at && ` · ${new Date(row.submitted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <TwoCheckbox label="Runner" checked={runnerDone} color={selectedLoc.color} />
                              <TwoCheckbox label="Admin"  checked={adminDone}  color={selectedLoc.color} />
                            </div>
                          </div>
                        )
                      })}
                      </div>
                      )
                    })()}
                  </div>

                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Daily Ops Detail Modal (zIndex above dialog) ── */}
      {openModal && selectedLoc && (() => {
        const { category, date } = openModal
        const cat        = OPS_CATS.find(c => c.key === category)
        const studioKey  = category === 'mic_inventory' ? 'global' : selectedLoc.key
        const rowsForDate = date === today ? opsRows : yestOpsRows
        const row        = rowsForDate.find(o => o.category === category)
        const submission: DailyOpsSubmission | null = row ? {
          id: row.id, studio: studioKey, category, date,
          staff_name: row.staff_name, submitted_at: row.submitted_at,
          admin_approved_at: row.admin_approved_at, admin_approved_by: row.admin_approved_by,
        } : null
        return (
          <DailyOpsModal
            category={category}
            studio={studioKey}
            today={date}
            color={selectedLoc.color}
            studioLabel={cat?.label ?? selectedLoc.label}
            submission={submission}
            onClose={() => setOpenModal(null)}
            onApprove={async () => { await approveOps(category, date); setOpenModal(null) }}
          />
        )
      })()}

      {/* ── WO popup opened from daily ops card (zIndex above dialog) ── */}
      {woBooking && (
        <WorkOrderPopup
          booking={woBooking}
          onClose={() => setWoBooking(null)}
          onSaved={async () => {
            setWoBooking(null)
            if (selectedLoc) {
              await openDrawer(selectedLoc)
              await loadSummaries()
            }
          }}
        />
      )}
    </>
  )
}
