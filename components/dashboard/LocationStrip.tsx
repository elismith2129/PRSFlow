'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/supabase'
import { DailyOpsModal, type DailyOpsSubmission } from '@/components/dashboard/DailyOpsModal'
import { WorkOrderPopup } from '@/components/calendar/WorkOrderPopup'
import { CHECKLISTS, flattenSections } from '@/lib/checklist-items'
import { useIsMobile } from '@/hooks/useIsMobile'
import { StatusDot, StatusPill, statusFillClass } from '@/components/carved'

const LOCATIONS = [
  { label: 'Paramount', key: 'paramount', abbr: 'PRS' },
  { label: 'Encore',    key: 'encore',    abbr: 'ERS' },
  { label: 'Ameraycan', key: 'ameraycan', abbr: 'ARS' },
  { label: 'Track',     key: 'track',     abbr: 'TRS' },
]

const OPS_CATS = [
  { key: 'opening_checklist', label: 'Opening Checklist', liveDoc: false, global: false },
  { key: 'closing_checklist', label: 'Closing Checklist', liveDoc: false, global: false },
  { key: 'petty_cash',        label: 'Petty Cash',        liveDoc: false, global: false },
  { key: 'stock',             label: 'Stock List',        liveDoc: false, global: false },
  { key: 'mic_inventory',     label: 'Mic Inventory',     liveDoc: false, global: true  },
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

type ChecklistProgress = { checked: number; total: number; needsAttention: boolean }

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

// Runner / Admin sign-off. Signing something off IS an act of pressing, so the
// affordance law does the work here: unchecked is RAISED and empty (something to
// press), checked is PRESSED IN and filled (something already pressed). No colour
// — a completion state isn't one of the three things allowed to carry it (§5).
function TwoCheckbox({ label, checked, clickable = false, loading = false, onClick }: {
  label: string; checked: boolean; clickable?: boolean; loading?: boolean; onClick?: () => void
}) {
  return (
    <button
      onClick={clickable && !loading ? onClick : undefined}
      className={`c-signoff ${checked ? 'c-on c-pressed' : 'c-raised'}${clickable && !loading ? ' c-control' : ''}`}
      style={{
        cursor: clickable && !loading ? 'pointer' : 'default',
        opacity: loading ? 0.5 : 1,
      }}
    >
      <span style={{ lineHeight: 1, fontSize: 10 }}>{checked ? '✓' : '○'}</span>
      <span>{loading ? '…' : label}</span>
    </button>
  )
}

export function LocationStrip() {
  const isMobile  = useIsMobile()
  const today     = getLocalDateStr()
  const yesterday = getLocalDateStr(-1)
  const retentionCutoff = new Date(today + 'T09:00:00')
  retentionCutoff.setDate(retentionCutoff.getDate() + 1)
  const pastRetentionWindow = new Date() >= retentionCutoff

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

    // Ops badges/drawer also depend on runner ops submissions + checklists — subscribe
    // directly so a runner submitting ops (with no booking change) updates the badge live.
    const opsChannel = supabase
      .channel('daily-ops-submissions-checklists')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_ops_submissions' }, handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklists' }, handleChange)
      .subscribe()

    return () => {
      supabase.removeChannel(bookingsChannel)
      supabase.removeChannel(woChannel)
      supabase.removeChannel(opsChannel)
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
      // .is('imported_at', null): imported WordPress history (migration
      // 20260826150000) never enters daily ops — a Yesterday drawer full of
      // WO-less history rows would read as unapproved work that isn't.
      supabase.from('bookings').select('*').lte('start_date', yesterday).gte('end_date', yesterday).eq('status', 'confirmed').is('imported_at', null).order('from_time'),
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
      supabase.from('checklists').select('type, items, needs_attention').eq('studio', loc.key).eq('date', today),
    ])

    const woMapToday: Record<string, WO> = {}
    for (const w of tWOs.data ?? []) if (w.booking_id) woMapToday[w.booking_id] = w
    const woMapYest: Record<string, WO> = {}
    for (const w of yWOs.data ?? []) if (w.booking_id) woMapYest[w.booking_id] = w

    // Keep completed WOs in Today until 9am the following morning
    const activeTodayBkgs = locTodayBkgs.filter(b => {
      const wo = woMapToday[b.id]
      if (!wo) return true
      if (wo.status !== 'completed') return true
      if (!pastRetentionWindow) return true  // before 9am next day — keep completed WOs
      return false
    })

    const clProgress: Record<string, ChecklistProgress> = {}
    for (const row of tChecklists.data ?? []) {
      const catKey = `${row.type}_checklist`
      const studioChecklists = CHECKLISTS[loc.key] ?? CHECKLISTS.paramount
      const secs = studioChecklists[row.type as 'opening' | 'closing'] ?? []
      const total = flattenSections(secs).length
      const done  = (row.items ?? []).filter((it: any) => it.checked).length
      clProgress[catKey] = { checked: done, total, needsAttention: !!(row.needs_attention) }
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

  async function approveOps(category: string, date: string, submissionId?: string) {
    if (!selectedLoc) return
    const nowIso = new Date().toISOString()
    const patchRow = (r: DailyOpsRow) =>
      r.category === category ? { ...r, admin_approved_at: nowIso, admin_approved_by: 'admin' } : r
    if (date === yesterday) setYestOpsRows(prev => prev.map(patchRow))
    else setOpsRows(prev => prev.map(patchRow))
    const studioKey = category === 'mic_inventory' ? 'global' : selectedLoc.key
    if (submissionId) {
      await supabase.from('daily_ops_submissions').update({
        admin_approved_at: nowIso, admin_approved_by: 'admin',
      }).eq('id', submissionId)
    } else {
      await supabase.from('daily_ops_submissions').upsert({
        studio: studioKey, date, category,
        admin_approved_at: nowIso, admin_approved_by: 'admin',
      }, { onConflict: 'studio,date,category' })
    }
    await loadSummaries()
  }

  const yestHasUnapproved = !!(selectedLoc && (
    yestSessions.some(({ wo }) => wo && wo.status !== 'completed') ||
    DAILY_CATS.some(cat => { const r = yestOpsRows.find(o => o.category === cat.key); return r?.submitted_at && !r?.admin_approved_at })
  ))

  // A session block IS a session, so it gets the identical treatment to the
  // dashboard room cards: a colored pool carved INTO the surface, status fill,
  // room label in small caps, artist in Archivo, times and engineer in mono.
  // Same recipe, same tokens — the two surfaces should be indistinguishable.
  function SessionCard({ b, wo, isYesterday }: { b: Booking; wo: WO | null; isYesterday?: boolean }) {
    const completed      = wo?.status === 'completed'
    const needsAttention = !!(wo?.needs_attention_notes)
    const studio         = (b as any).studio as string | undefined
    return (
      <div
        onClick={() => setWoBooking(b)}
        className={`c-room c-pool ${statusFillClass((b as any).status || 'confirmed')}`}
        style={{ borderRadius: 26, padding: '13px 15px', cursor: 'pointer', minHeight: 0 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            {/* Room first — "which room" is the first thing anyone reads off a
                daily-ops card. No "Studio " prefix: bookings.studio already holds
                the full label ("Studio X", "North"). */}
            {studio && <span className="c-room-name">{studio}</span>}
            <div className="c-room-artist c-arch" style={{ fontSize: 17 }}>
              {b.artist || b.client_name || '—'}
            </div>
            {b.artist && b.client_name && <div className="c-room-meta">{b.client_name}</div>}
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
            {needsAttention && <StatusPill status="warm" label="⚠ Attention" />}
            {completed && <StatusPill status="booked" label="Completed" />}
          </div>
        </div>
        <div className="c-mono" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 10, opacity: 0.7 }}>
          {b.from_time && <span>{b.from_time}–{b.to_time ?? '?'}</span>}
          {(b as any).engineer_name && <span>ENG {(b as any).engineer_name}</span>}
          {(b as any).payment_type && <span>{String((b as any).payment_type).toUpperCase()}</span>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          {/* A link you click is a control: small raised pill, not floating text. */}
          <a
            href={wo ? `/wo/${wo.id}/print` : '#'}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            className="c-soft c-soft-sm c-control c-raised"
            style={{ textDecoration: 'none' }}
          >
            PDF
          </a>
        </div>
      </div>
    )
  }

  // Yesterday / Today section heading. The 1px-tall spacer div that used to run
  // between the label and the date was a divider wearing a disguise — Law 1 rules
  // out hairlines however they're built, so the label is a capsule lozenge now and
  // the date sits at the far end. The `orange` variant is gone with it: "needs
  // review" is conveyed by the badge on the row, not by tinting the heading.
  function SectionLabel({ label, date }: { label: string; date: string; orange?: boolean }) {
    return (
      <div className="c-lozenge c-anchor" style={{ marginBottom: 12 }}>
        <b style={{ whiteSpace: 'nowrap' }}>{label}</b>
        <span className="c-mono" style={{ fontSize: 10, opacity: 0.6, whiteSpace: 'nowrap' }}>
          {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>
    )
  }

  return (
    <>
      {/* ── Strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
        {LOCATIONS.map((loc, i) => {
          const s        = summaries[loc.key]
          const sessCount = s?.sessionCount ?? 0
          const pending  = s?.pendingCount ?? 0
          const active   = sessCount > 0
          return (
            // Carved: these open the daily-ops drawer, so by Law 2 they are
            // controls — raised, and they press in when held. The old bordered
            // surface card and its hover borderColor swap are gone (Law 1).
            <div key={loc.key} onClick={() => openDrawer(loc)}
              className="c-control c-raised"
              style={{ borderRadius: 26, padding: '13px 17px', cursor: 'pointer' }}
            >
              <div className="c-arch" style={{ fontSize: 15, lineHeight: 1.2 }}>{loc.label}</div>
              {/* A live session is session status, so it earns colour — but as a
                  dot, not coloured text (§5: status is always a fill, never tinted
                  type). This deviates from the mock, which tinted the count text
                  in dark mode only. */}
              <div className="c-label" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, opacity: active ? 0.85 : 0.45 }}>
                {active && !loadingSummary && <StatusDot status="booked" />}
                {loadingSummary ? '…' : active ? `${sessCount} session${sessCount !== 1 ? 's' : ''}` : 'Open'}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Centered Dialog — zIndex above nav (9999) ── */}
      {selectedLoc && (
        <div
          className="c-modal-backdrop" style={{ zIndex: 10001, background: isMobile ? 'var(--c-bg)' : undefined, padding: isMobile ? 0 : 24 }}
          onClick={e => e.target === e.currentTarget && closeDrawer()}
        >
          <div className="c-sheet" style={{
            width: '100%', maxWidth: isMobile ? '100vw' : 920,
            maxHeight: isMobile ? '100dvh' : '88dvh', height: isMobile ? '100dvh' : undefined,
            display: 'flex', flexDirection: 'column',
            }}>
            {/* Header */}
            <div style={{ padding: '22px 26px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ minWidth: 0 }}>
                <div className="c-arch" style={{ fontSize: 22, letterSpacing: '-0.02em' }}>{selectedLoc.label}</div>
                <div className="c-label" style={{ marginTop: 4 }}>
                  {new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · Daily Ops
                </div>
              </div>
              {/* Close is a control: raised circle that presses in when held. */}
              <button
                onClick={closeDrawer}
                aria-label="Close"
                className="c-control c-raised"
                style={{
                  width: 36, height: 36, borderRadius: 99, flexShrink: 0,
                  background: 'var(--c-bg)', color: 'var(--c-fg)',
                  fontSize: 15, lineHeight: 1, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Scrollable body */}
            {drawerLoading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-fg-3)', fontFamily: 'Archivo Black' }}>Loading…</div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: (isMobile || pastRetentionWindow) ? '1fr' : '1fr 1fr', gap: 24, alignItems: 'start' }}>

                  {/* ── LEFT — Yesterday ── */}
                  {!pastRetentionWindow && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <SectionLabel label="Yesterday" date={yesterday} />

                    {(() => {
                      return (
                        <>
                          {yestSessions.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {yestSessions.map(({ booking: b, wo }) => (
                                <SessionCard key={b.id} b={b} wo={wo} isYesterday />
                              ))}
                            </div>
                          )}

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {DAILY_CATS.map((cat, i) => {
                              const row        = yestOpsRows.find(o => o.category === cat.key)
                              const runnerDone = !!row?.submitted_at
                              const adminDone  = !!row?.admin_approved_at
                              const needsReview = runnerDone && !adminDone
                              return (
                                <div key={cat.key}
                                  onClick={() => setOpenModal({ category: cat.key, date: yesterday })}
                                  className="c-oprow c-inset2"
                                >
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                      <span className="c-arch" style={{ fontSize: 13 }}>{cat.label}</span>
                                      {needsReview && <StatusPill status="warm" label="Review" />}
                                    </div>
                                    {row?.staff_name && (
                                      <div style={{ fontSize: 9, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 2 }}>
                                        {row.staff_name}{row.submitted_at && ` · ${new Date(row.submitted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <TwoCheckbox label="Runner" checked={runnerDone} />
                                    <TwoCheckbox label="Admin"  checked={adminDone} />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                  )}

                  {/* ── RIGHT — Today ── */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <SectionLabel label="Today" date={today} />

                    {(() => {
                      if (sessions.length === 0) {
                        return <div style={{ color: 'var(--c-fg-3)', fontSize: 12, fontFamily: 'Archivo Black', padding: '10px 0' }}>No sessions booked today.</div>
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
                      return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {OPS_CATS.map((cat, i) => {
                        const row         = opsRows.find(o => o.category === cat.key)
                        const runnerDone  = !!row?.submitted_at
                        const adminDone   = !!row?.admin_approved_at
                        const isChecklist = cat.key === 'opening_checklist' || cat.key === 'closing_checklist'
                        const prog        = checklistProgress[cat.key]
                        return (
                          <div key={cat.key}
                            onClick={() => setOpenModal({ category: cat.key, date: today })}
                            className="c-oprow c-inset2"
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span className="c-arch" style={{ fontSize: 13 }}>{cat.label}</span>
                                {isChecklist && checklistProgress[cat.key]?.needsAttention && !adminDone && (
                                  <StatusPill status="warm" label="⚠" />
                                )}
                              </div>
                              {isChecklist && prog && (
                                <div style={{ fontSize: 9, color: 'var(--c-fg-2)', fontFamily: 'Inter', marginTop: 2 }}>
                                  {prog.checked}/{prog.total} checked
                                </div>
                              )}
                              {row?.staff_name && (
                                <div style={{ fontSize: 9, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 2 }}>
                                  {row.staff_name}{row.submitted_at && ` · ${new Date(row.submitted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <TwoCheckbox label="Runner" checked={runnerDone} />
                              <TwoCheckbox label="Admin"  checked={adminDone} />
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
            studioLabel={cat?.label ?? selectedLoc.label}
            submission={submission}
            onClose={() => setOpenModal(null)}
            onApprove={async () => { await approveOps(category, date, submission?.id ?? undefined); setOpenModal(null) }}
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
