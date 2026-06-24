'use client'
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

const STUDIO_META: Record<string, { label: string; color: string }> = {
  paramount: { label: 'Paramount', color: '#c8f04e' },
  ameraycan: { label: 'Ameraycan', color: '#f04e7a' },
  encore:    { label: 'Encore',    color: '#4e8ff0' },
  track:     { label: 'Track',     color: '#f0a24e' },
}

// Spec-ordered studios + a catch-all group for floating gear / odds & ends.
const STUDIO_ORDER = ['paramount', 'ameraycan', 'encore', 'track'] as const
const FLOATING_KEY = 'floating'

const STATUS_META: Record<string, { label: string; color: string }> = {
  here:    { label: 'Here',    color: '#14B8A6' },
  room:    { label: 'Room',    color: '#F97316' },
  missing: { label: 'Missing', color: '#ef4444' },
}
const NONE_COLOR = '#4a4f64'

// Missing first, then Room, then Here, then no-data.
function statusRank(status: string | undefined): number {
  if (status === 'missing') return 0
  if (status === 'room') return 1
  if (status === 'here') return 2
  return 3
}

type Mic = {
  id: string
  name: string
  home_studio: string
  category: string
  sort_order: number
  is_active: boolean
}

type Checkin = {
  mic_id: string
  studio: string
  date: string
  status: 'here' | 'room' | 'missing'
  room: string | null
  created_at: string | null
}

type QtyRow = {
  mic_id: string
  studio: string
  date: string
  quantity: number
  created_at: string | null
}

type SubmissionRow = {
  studio: string
  date: string
  submitted_at: string | null
  submitted_by: string | null
}

function fmtDate(date: string): string {
  if (!date) return '—'
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtShort(date: string): string {
  if (!date) return '—'
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
}

const labelS: React.CSSProperties = {
  fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: '#4a4f64',
}

// 6-column table grid: Mic | Status | Room | Qty | Submitted By | Date
const GRID_COLS = '1fr 90px 90px 60px 120px 130px'

export function MicInventorySection() {
  const [mics, setMics] = useState<Mic[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [quantities, setQuantities] = useState<QtyRow[]>([])
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [activeTab, setActiveTab] = useState<string>(STUDIO_ORDER[0])
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [micsRes, checkinsRes, qtyRes, subsRes] = await Promise.all([
        supabase
          .from('mics')
          .select('id,name,home_studio,category,sort_order,is_active')
          .eq('is_active', true)
          .order('sort_order'),
        supabase
          .from('mic_checkins')
          .select('mic_id,studio,date,status,room,created_at')
          .order('date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('mic_inventory_quantities')
          .select('mic_id,studio,date,quantity,created_at')
          .order('date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('mic_inventory_submissions')
          .select('studio,date,submitted_at,submitted_by'),
      ])
      setMics((micsRes.data ?? []) as Mic[])
      setCheckins((checkinsRes.data ?? []) as Checkin[])
      setQuantities((qtyRes.data ?? []) as QtyRow[])
      setSubmissions((subsRes.data ?? []) as SubmissionRow[])
      setLoading(false)
    }
    load()
  }, [])

  // ── Derived lookups ──────────────────────────────────────────────
  // Submitter / date resolved by (studio, date).
  const submitterBy = useMemo(() => {
    const m: Record<string, { by: string; at: string | null }> = {}
    for (const s of submissions) {
      m[`${s.studio}|${s.date}`] = { by: s.submitted_by ?? '', at: s.submitted_at }
    }
    return m
  }, [submissions])

  // checkins is already newest-first → first seen per key wins.
  const latestByStudioMic = useMemo(() => {
    const m: Record<string, Checkin> = {}
    for (const c of checkins) {
      const key = `${c.studio}|${c.mic_id}`
      if (!m[key]) m[key] = c
    }
    return m
  }, [checkins])

  const latestAnyByMic = useMemo(() => {
    const m: Record<string, Checkin> = {}
    for (const c of checkins) {
      if (!m[c.mic_id]) m[c.mic_id] = c
    }
    return m
  }, [checkins])

  const qtyByStudioMic = useMemo(() => {
    const m: Record<string, QtyRow> = {}
    for (const q of quantities) {
      const key = `${q.studio}|${q.mic_id}`
      if (!m[key]) m[key] = q
    }
    return m
  }, [quantities])

  const qtyAnyByMic = useMemo(() => {
    const m: Record<string, QtyRow> = {}
    for (const q of quantities) {
      if (!m[q.mic_id]) m[q.mic_id] = q
    }
    return m
  }, [quantities])

  // History: all checkins (newest first) per (studio, mic).
  const historyByStudioMic = useMemo(() => {
    const m: Record<string, Checkin[]> = {}
    for (const c of checkins) {
      const key = `${c.studio}|${c.mic_id}`
      ;(m[key] ??= []).push(c)
    }
    return m
  }, [checkins])

  // Mic groups: 4 studios + floating/other catch-all.
  const groups = useMemo(() => {
    const studioGroups = STUDIO_ORDER.map(key => ({
      key,
      label: STUDIO_META[key].label,
      color: STUDIO_META[key].color,
      isStudio: true,
      mics: mics.filter(m => m.category === 'mic' && m.home_studio === key),
    }))
    const floating = {
      key: FLOATING_KEY,
      label: 'Floating Gear',
      color: '#8b90a8',
      isStudio: false,
      mics: mics.filter(
        m => !(m.category === 'mic' && (STUDIO_ORDER as readonly string[]).includes(m.home_studio))
      ),
    }
    return [...studioGroups, floating]
  }, [mics])

  // Missing across all studios (latest-any per mic).
  const missingList = useMemo(() => {
    const out: { mic: Mic; checkin: Checkin }[] = []
    for (const mic of mics) {
      const c = latestAnyByMic[mic.id]
      if (c && c.status === 'missing') out.push({ mic, checkin: c })
    }
    // Newest missing first.
    out.sort((a, b) => (a.checkin.date < b.checkin.date ? 1 : -1))
    return out
  }, [mics, latestAnyByMic])

  function resolveStatus(group: { key: string; isStudio: boolean }, mic: Mic): Checkin | undefined {
    return group.isStudio
      ? latestByStudioMic[`${group.key}|${mic.id}`]
      : latestAnyByMic[mic.id]
  }

  function resolveQty(group: { key: string; isStudio: boolean }, mic: Mic): number | null {
    const q = group.isStudio ? qtyByStudioMic[`${group.key}|${mic.id}`] : qtyAnyByMic[mic.id]
    return q ? q.quantity : null
  }

  if (loading) {
    return <div style={{ fontSize: 11, color: '#4a4f64', fontFamily: 'DM Mono' }}>Loading…</div>
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#e8eaf2' }}>Mic Inventory</div>
        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#4a4f64' }}>
          {mics.length} active{missingList.length > 0 ? ` · ${missingList.length} missing` : ''}
        </div>
      </div>

      {/* ── Missing mic banner ───────────────────────────────────── */}
      {missingList.length > 0 && !bannerDismissed && (
        <div style={{
          border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.18)',
          borderRadius: 6, padding: '14px 18px', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#ef4444' }}>
              ⚠ {missingList.length} mic{missingList.length !== 1 ? 's' : ''} missing
            </div>
            <button
              onClick={() => setBannerDismissed(true)}
              style={{ padding: '3px 10px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', cursor: 'pointer' }}
            >
              Dismiss
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {missingList.map(({ mic, checkin }) => {
              const sub = submitterBy[`${checkin.studio}|${checkin.date}`]
              return (
                <div key={mic.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr 120px 130px 110px', gap: 12, alignItems: 'center',
                }}>
                  <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#e8eaf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mic.name}</div>
                  <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#f0a3a3' }}>{STUDIO_META[checkin.studio]?.label ?? checkin.studio}</div>
                  <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#f0a3a3' }}>{fmtDate(checkin.date)}</div>
                  <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#f0a3a3' }}>{sub?.by || '—'}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Studio tabs ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #2a2e3d', marginBottom: 16, flexWrap: 'wrap' }}>
        {groups.map(group => {
          const active = activeTab === group.key
          const tabMissing = group.mics.filter(m => resolveStatus(group, m)?.status === 'missing').length
          return (
            <button
              key={group.key}
              onClick={() => setActiveTab(group.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 14px', border: 'none', cursor: 'pointer', background: 'transparent',
                fontFamily: 'Syne', fontWeight: 700, fontSize: 12, letterSpacing: '0.03em',
                color: active ? '#e8eaf2' : '#8b90a8',
                borderBottom: `2px solid ${active ? group.color : 'transparent'}`,
                marginBottom: -1,
              }}
            >
              <span>{group.label}</span>
              <span style={{ fontSize: 10, fontFamily: 'DM Mono', fontWeight: 400, color: '#4a4f64' }}>{group.mics.length}</span>
              {tabMissing > 0 && (
                <span style={{ fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3, padding: '1px 6px' }}>
                  {tabMissing}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Active studio table ──────────────────────────────────── */}
      {(() => {
        const group = groups.find(g => g.key === activeTab) ?? groups[0]

        // Sort within group: missing → room → here → none, then sort_order.
        const sorted = [...group.mics].sort((a, b) => {
          const ra = statusRank(resolveStatus(group, a)?.status)
          const rb = statusRank(resolveStatus(group, b)?.status)
          if (ra !== rb) return ra - rb
          return (a.sort_order ?? 0) - (b.sort_order ?? 0)
        })

        return (
          <div>
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>
              {group.isStudio && (
                <button
                  onClick={() => setShowHistory(v => !v)}
                  style={{ padding: '4px 12px', borderRadius: 4, fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer', background: showHistory ? '#c8f04e' : 'transparent', border: `1px solid ${showHistory ? '#c8f04e' : '#2a2e3d'}`, color: showHistory ? '#0d0f14' : '#8b90a8', fontWeight: showHistory ? 700 : 400 }}
                >
                  {showHistory ? 'Hide History' : 'Show History'}
                </button>
              )}
            </div>

            {group.mics.length === 0 ? (
              <div style={{ border: '1px solid #2a2e3d', borderRadius: 6, padding: '24px 16px', fontSize: 11, color: '#4a4f64', fontFamily: 'DM Mono' }}>No mics in this group.</div>
            ) : (
              <div style={{ border: '1px solid #2a2e3d', borderRadius: 6, overflow: 'hidden' }}>
                {/* Column header */}
                <div style={{ display: 'grid', gridTemplateColumns: GRID_COLS, gap: 12, padding: '6px 16px', background: '#1a1d27', borderBottom: '1px solid #2a2e3d' }}>
                  {['Mic Name', 'Status', 'Room', 'Qty', 'Last Submitted By', 'Date'].map(h => (
                    <div key={h} style={labelS}>{h}</div>
                  ))}
                </div>

                {/* Rows */}
                {sorted.map((mic, idx) => {
                  const c = resolveStatus(group, mic)
                  const status = c?.status
                  const statusMeta = status ? STATUS_META[status] : null
                  const qty = resolveQty(group, mic)
                  const sub = c ? submitterBy[`${c.studio}|${c.date}`] : undefined
                  const isMissing = status === 'missing'
                  const histKey = group.isStudio ? `${group.key}|${mic.id}` : null
                  const hist = histKey ? (historyByStudioMic[histKey] ?? []).slice(0, 7) : []

                  return (
                    <div key={mic.id} style={{ borderBottom: idx < sorted.length - 1 ? '1px solid #2a2e3d' : 'none' }}>
                      <div style={{
                        display: 'grid', gridTemplateColumns: GRID_COLS, gap: 12,
                        padding: '9px 16px', alignItems: 'center',
                        borderLeft: isMissing ? '3px solid #ef4444' : '3px solid transparent',
                        background: isMissing ? 'rgba(239,68,68,0.06)' : 'transparent',
                      }}>
                        {/* Mic name */}
                        <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#e8eaf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mic.name}</div>
                        {/* Status */}
                        <div>
                          {statusMeta ? (
                            <span style={{ fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, color: statusMeta.color, background: statusMeta.color + '18', border: `1px solid ${statusMeta.color}33`, borderRadius: 3, padding: '2px 7px', textTransform: 'uppercase' }}>
                              {statusMeta.label}
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, fontFamily: 'DM Mono', color: NONE_COLOR }}>—</span>
                          )}
                        </div>
                        {/* Room */}
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: c?.room ? '#8b90a8' : NONE_COLOR }}>
                          {c?.status === 'room' && c.room ? c.room.replace('Studio ', '') : '—'}
                        </div>
                        {/* Qty */}
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: qty != null ? '#e8eaf2' : NONE_COLOR }}>
                          {qty != null ? qty : '—'}
                        </div>
                        {/* Submitted by */}
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: sub?.by ? '#8b90a8' : NONE_COLOR, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sub?.by || '—'}
                        </div>
                        {/* Date */}
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: c?.date ? '#8b90a8' : NONE_COLOR }}>
                          {c?.date ? fmtDate(c.date) : '—'}
                        </div>
                      </div>

                      {/* History sub-rows (studio groups only) */}
                      {showHistory && group.isStudio && (
                        <div style={{ padding: '2px 16px 10px 32px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {hist.length === 0 ? (
                            <div style={{ fontSize: 9, fontFamily: 'DM Mono', color: NONE_COLOR }}>No history</div>
                          ) : (
                            hist.map((h, hi) => {
                              const hm = STATUS_META[h.status]
                              const hsub = submitterBy[`${h.studio}|${h.date}`]
                              return (
                                <div key={hi} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#6b7280', width: 56 }}>{fmtShort(h.date)}</span>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: hm?.color ?? NONE_COLOR, flexShrink: 0 }} />
                                  <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: hm?.color ?? NONE_COLOR, width: 52 }}>{hm?.label ?? '—'}</span>
                                  {h.status === 'room' && h.room && (
                                    <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#6b7280' }}>{h.room.replace('Studio ', '')}</span>
                                  )}
                                  <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#4a4f64', marginLeft: 'auto' }}>{hsub?.by || '—'}</span>
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
