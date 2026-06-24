'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
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

// Studio keys offered in the Manage Mics selects (catalog home_studio values).
const STUDIO_OPTIONS = ['paramount', 'ameraycan', 'encore', 'track', 'floating'] as const

// Per-studio room options (matches the runner mics page).
const STUDIO_ROOMS: Record<string, string[]> = {
  paramount: ['Studio A', 'Studio B', 'Studio C', 'Studio E', 'Studio X'],
  ameraycan: ['Studio A', 'Studio B'],
  encore:    ['Studio A', 'Studio B'],
  track:     ['Studio North', 'Studio South'],
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  here:    { label: 'Here',    color: '#14B8A6' },
  room:    { label: 'Room',    color: '#F97316' },
  missing: { label: 'Missing', color: '#ef4444' },
}
const NONE_COLOR = '#4a4f64'
const ADMIN_TEAL = '#14B8A6'

// Missing first, then Room, then Here, then no-data.
function statusRank(status: string | undefined): number {
  if (status === 'missing') return 0
  if (status === 'room') return 1
  if (status === 'here') return 2
  return 3
}

function getLocalToday(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

function studioLabel(key: string): string {
  return STUDIO_META[key]?.label ?? (key === FLOATING_KEY ? 'Floating' : key)
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
  source: string | null
  amended_by: string | null
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

const inputS: React.CSSProperties = {
  background: '#0d0f14', border: '1px solid #2a2e3d', borderRadius: 6,
  color: '#e8eaf2', fontSize: 11, fontFamily: 'DM Mono', padding: '6px 8px',
  outline: 'none', width: '100%', boxSizing: 'border-box',
}

// 7-column table grid: Mic | Status | Room | Qty | Submitted By | Date | Edit.
// One template for header + every row (editing or not) so cells always align
// under their headers; the action column is wide enough to hold Save/Cancel.
const GRID_COLS = '1fr 88px 84px 52px 116px 116px 124px'

// Small teal "ADMIN" badge for admin-amended checkins.
function AdminBadge() {
  return (
    <span style={{
      fontSize: 8, fontFamily: 'DM Mono', fontWeight: 700, color: ADMIN_TEAL,
      background: ADMIN_TEAL + '18', border: `1px solid ${ADMIN_TEAL}33`,
      borderRadius: 3, padding: '1px 5px', letterSpacing: '0.05em',
    }}>
      ADMIN
    </span>
  )
}

export function MicInventorySection() {
  const [mics, setMics] = useState<Mic[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [quantities, setQuantities] = useState<QtyRow[]>([])
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [activeTab, setActiveTab] = useState<string>(STUDIO_ORDER[0])
  const [showHistory, setShowHistory] = useState(false)

  // Current user for amended_by (auth not live yet — falls back to 'Admin').
  const [amendedBy, setAmendedBy] = useState('Admin')

  // Inline status editing.
  const [editingMicId, setEditingMicId] = useState<string | null>(null)
  const [draftStatus, setDraftStatus] = useState<'here' | 'room' | 'missing'>('here')
  const [draftRoom, setDraftRoom] = useState('')
  const [draftQty, setDraftQty] = useState('')
  const [draftBy, setDraftBy] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Manage Mics modal.
  const [manageOpen, setManageOpen] = useState(false)
  const [manageTab, setManageTab] = useState<'list' | 'add'>('list')
  const [mngSearch, setMngSearch] = useState('')
  const [mngEditId, setMngEditId] = useState<string | null>(null)
  const [mngDraft, setMngDraft] = useState<{ name: string; home_studio: string; category: string; qty: string }>(
    { name: '', home_studio: 'paramount', category: 'mic', qty: '' }
  )
  const [addDraft, setAddDraft] = useState<{ name: string; home_studio: string; category: string; qty: string }>(
    { name: '', home_studio: 'paramount', category: 'mic', qty: '1' }
  )
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    const [micsRes, checkinsRes, qtyRes, subsRes] = await Promise.all([
      supabase
        .from('mics')
        .select('id,name,home_studio,category,sort_order,is_active')
        .order('sort_order'),
      supabase
        .from('mic_checkins')
        .select('mic_id,studio,date,status,room,source,amended_by,created_at')
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
  }, [])

  useEffect(() => {
    async function init() {
      setLoading(true)
      await loadData()
      setLoading(false)
    }
    init()
  }, [loadData])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data?.user
      const name = (u?.user_metadata?.full_name as string) || u?.email || ''
      if (name) setAmendedBy(name)
    })
  }, [])

  // Active-only mics drive the display; the Manage modal uses the full list.
  const activeMics = useMemo(() => mics.filter(m => m.is_active), [mics])

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
      mics: activeMics.filter(m => m.category === 'mic' && m.home_studio === key),
    }))
    const floating = {
      key: FLOATING_KEY,
      label: 'Floating Gear',
      color: '#8b90a8',
      isStudio: false,
      mics: activeMics.filter(
        m => !(m.category === 'mic' && (STUDIO_ORDER as readonly string[]).includes(m.home_studio))
      ),
    }
    return [...studioGroups, floating]
  }, [activeMics])

  // Missing across all studios (latest-any per mic).
  const missingList = useMemo(() => {
    const out: { mic: Mic; checkin: Checkin }[] = []
    for (const mic of activeMics) {
      const c = latestAnyByMic[mic.id]
      if (c && c.status === 'missing') out.push({ mic, checkin: c })
    }
    // Newest missing first.
    out.sort((a, b) => (a.checkin.date < b.checkin.date ? 1 : -1))
    return out
  }, [activeMics, latestAnyByMic])

  function resolveStatus(group: { key: string; isStudio: boolean }, mic: Mic): Checkin | undefined {
    return group.isStudio
      ? latestByStudioMic[`${group.key}|${mic.id}`]
      : latestAnyByMic[mic.id]
  }

  function resolveQty(group: { key: string; isStudio: boolean }, mic: Mic): number | null {
    const q = group.isStudio ? qtyByStudioMic[`${group.key}|${mic.id}`] : qtyAnyByMic[mic.id]
    return q ? q.quantity : null
  }

  // ── Inline status editing ────────────────────────────────────────
  function startEdit(group: { key: string; isStudio: boolean }, mic: Mic) {
    const c = resolveStatus(group, mic)
    setDraftStatus((c?.status as 'here' | 'room' | 'missing') || 'here')
    setDraftRoom(c?.room ?? '')
    const q = resolveQty(group, mic)
    setDraftQty(q != null ? String(q) : '')
    setDraftBy(c?.source === 'admin' ? (c?.amended_by || amendedBy) : amendedBy)
    setEditingMicId(mic.id)
  }

  async function saveInlineEdit(group: { key: string; isStudio: boolean }, mic: Mic) {
    if (savingEdit) return
    setSavingEdit(true)
    // Studio tabs write under the tab's key; floating writes under the resolved
    // checkin's studio, falling back to the mic's home_studio.
    const studioKey = group.isStudio
      ? group.key
      : (resolveStatus(group, mic)?.studio || mic.home_studio)
    const today = getLocalToday()
    const row = {
      mic_id: mic.id,
      studio: studioKey,
      date: today,
      status: draftStatus,
      room: draftStatus === 'room' ? (draftRoom.trim() || null) : null,
      source: 'admin',
      amended_by: draftBy.trim() || amendedBy || null,
    }
    await supabase.from('mic_checkins').upsert(row, { onConflict: 'mic_id,studio,date' })
    // Qty cell is editable now → persist a changed value to mic_inventory_quantities.
    const prevQty = resolveQty(group, mic)
    const trimmed = draftQty.trim()
    if (trimmed !== '' && Number(trimmed) !== prevQty) {
      await supabase.from('mic_inventory_quantities').upsert(
        { mic_id: mic.id, studio: studioKey, date: today, quantity: Number(trimmed) },
        { onConflict: 'mic_id,studio,date' }
      )
    }
    setEditingMicId(null)
    setSavingEdit(false)
    await loadData()
  }

  // ── Manage Mics actions ──────────────────────────────────────────
  function startMicEdit(mic: Mic) {
    const q = qtyAnyByMic[mic.id]
    setMngDraft({
      name: mic.name,
      home_studio: mic.home_studio,
      category: mic.category,
      qty: q ? String(q.quantity) : '',
    })
    setMngEditId(mic.id)
  }

  async function saveMicEdit(mic: Mic) {
    if (saving) return
    setSaving(true)
    await supabase.from('mics').update({
      name: mngDraft.name.trim(),
      home_studio: mngDraft.home_studio,
      category: mngDraft.category.trim() || 'mic',
    }).eq('id', mic.id)
    // Quantity lives in mic_inventory_quantities, never on mics.
    if (mngDraft.qty.trim() !== '') {
      await supabase.from('mic_inventory_quantities').upsert(
        { mic_id: mic.id, studio: mngDraft.home_studio, date: getLocalToday(), quantity: Number(mngDraft.qty) },
        { onConflict: 'mic_id,studio,date' }
      )
    }
    setMngEditId(null)
    setSaving(false)
    await loadData()
  }

  async function setMicActive(mic: Mic, active: boolean) {
    if (saving) return
    setSaving(true)
    await supabase.from('mics').update({ is_active: active }).eq('id', mic.id)
    setSaving(false)
    await loadData()
  }

  async function handleAddMic() {
    if (!addDraft.name.trim() || saving) return
    setSaving(true)
    const maxSort = mics.reduce((mx, m) => Math.max(mx, m.sort_order ?? 0), 0)
    const { data, error } = await supabase
      .from('mics')
      .insert({
        name: addDraft.name.trim(),
        home_studio: addDraft.home_studio,
        category: addDraft.category.trim() || 'mic',
        sort_order: maxSort + 1,
        is_active: true,
      })
      .select()
      .single()
    if (!error && data && addDraft.qty.trim() !== '' && Number(addDraft.qty) > 0) {
      await supabase.from('mic_inventory_quantities').upsert(
        { mic_id: (data as Mic).id, studio: addDraft.home_studio, date: getLocalToday(), quantity: Number(addDraft.qty) },
        { onConflict: 'mic_id,studio,date' }
      )
    }
    setSaving(false)
    setAddDraft({ name: '', home_studio: 'paramount', category: 'mic', qty: '1' })
    setManageTab('list')
    await loadData()
  }

  if (loading) {
    return <div style={{ fontSize: 11, color: '#4a4f64', fontFamily: 'DM Mono' }}>Loading…</div>
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#e8eaf2' }}>Mic Inventory</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#4a4f64' }}>
            {activeMics.length} active{missingList.length > 0 ? ` · ${missingList.length} missing` : ''}
          </div>
          <button
            onClick={() => { setManageOpen(true); setManageTab('list'); setMngEditId(null) }}
            style={{ padding: '5px 12px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', background: 'transparent', border: '1px solid #2a2e3d', color: '#8b90a8' }}
          >
            Manage Mics
          </button>
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
              const byName = checkin.source === 'admin' ? (checkin.amended_by || '—') : (sub?.by || '—')
              return (
                <div key={mic.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr 120px 130px 110px', gap: 12, alignItems: 'center',
                }}>
                  <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#e8eaf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mic.name}</div>
                  <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#f0a3a3' }}>{STUDIO_META[checkin.studio]?.label ?? checkin.studio}</div>
                  <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#f0a3a3' }}>{fmtDate(checkin.date)}</div>
                  <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#f0a3a3', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {byName}
                    {checkin.source === 'admin' && <AdminBadge />}
                  </div>
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
              onClick={() => { setActiveTab(group.key); setEditingMicId(null) }}
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
                  {['Mic Name', 'Status', 'Room', 'Qty', 'Last Submitted By', 'Date', ''].map((h, hi) => (
                    <div key={hi} style={labelS}>{h}</div>
                  ))}
                </div>

                {/* Rows */}
                {sorted.map((mic, idx) => {
                  const c = resolveStatus(group, mic)
                  const status = c?.status
                  const statusMeta = status ? STATUS_META[status] : null
                  const qty = resolveQty(group, mic)
                  const sub = c ? submitterBy[`${c.studio}|${c.date}`] : undefined
                  const isAdmin = c?.source === 'admin'
                  const byName = isAdmin ? (c?.amended_by || '—') : (sub?.by || '—')
                  const isMissing = status === 'missing'
                  const histKey = group.isStudio ? `${group.key}|${mic.id}` : null
                  const hist = histKey ? (historyByStudioMic[histKey] ?? []).slice(0, 7) : []
                  const isEditing = editingMicId === mic.id

                  return (
                    <div key={mic.id} style={{ borderBottom: idx < sorted.length - 1 ? '1px solid #2a2e3d' : 'none' }}>
                      <div style={{
                        display: 'grid', gridTemplateColumns: GRID_COLS, gap: 12,
                        padding: isEditing ? '7px 16px' : '9px 16px', alignItems: 'center',
                        borderLeft: isMissing ? '3px solid #ef4444' : isEditing ? '3px solid #c8f04e' : '3px solid transparent',
                        background: isEditing ? 'rgba(200,240,78,0.05)' : isMissing ? 'rgba(239,68,68,0.06)' : 'transparent',
                      }}>
                        {/* Mic name */}
                        <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#e8eaf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mic.name}</div>
                        {/* Status */}
                        <div>
                          {isEditing ? (
                            <select
                              value={draftStatus}
                              onChange={e => setDraftStatus(e.target.value as 'here' | 'room' | 'missing')}
                              style={{ ...inputS, padding: '4px 4px' }}
                            >
                              <option value="here">Here</option>
                              <option value="room">Room</option>
                              <option value="missing">Missing</option>
                            </select>
                          ) : statusMeta ? (
                            <span style={{ fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, color: statusMeta.color, background: statusMeta.color + '18', border: `1px solid ${statusMeta.color}33`, borderRadius: 3, padding: '2px 7px', textTransform: 'uppercase' }}>
                              {statusMeta.label}
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, fontFamily: 'DM Mono', color: NONE_COLOR }}>—</span>
                          )}
                        </div>
                        {/* Room */}
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: c?.room ? '#8b90a8' : NONE_COLOR }}>
                          {isEditing ? (
                            draftStatus === 'room' ? (() => {
                              const rStudio = group.isStudio ? group.key : (resolveStatus(group, mic)?.studio || mic.home_studio)
                              const roomOpts = STUDIO_ROOMS[rStudio] ?? []
                              return roomOpts.length > 0 ? (
                                <select
                                  value={draftRoom}
                                  onChange={e => setDraftRoom(e.target.value)}
                                  style={{ ...inputS, padding: '4px 4px' }}
                                >
                                  <option value="">Room…</option>
                                  {roomOpts.map(r => <option key={r} value={r}>{r.replace('Studio ', '')}</option>)}
                                </select>
                              ) : (
                                <input
                                  value={draftRoom}
                                  onChange={e => setDraftRoom(e.target.value)}
                                  placeholder="Room"
                                  style={{ ...inputS, padding: '4px 6px' }}
                                />
                              )
                            })() : (
                              <span style={{ color: NONE_COLOR }}>—</span>
                            )
                          ) : (
                            c?.status === 'room' && c.room ? c.room.replace('Studio ', '') : '—'
                          )}
                        </div>
                        {/* Qty */}
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: qty != null ? '#e8eaf2' : NONE_COLOR }}>
                          {isEditing ? (
                            <input
                              value={draftQty}
                              onChange={e => setDraftQty(e.target.value.replace(/[^0-9]/g, ''))}
                              inputMode="numeric"
                              placeholder="—"
                              style={{ ...inputS, padding: '4px 6px' }}
                            />
                          ) : (
                            qty != null ? qty : '—'
                          )}
                        </div>
                        {/* Submitted by */}
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: byName !== '—' ? '#8b90a8' : NONE_COLOR, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                          {isEditing ? (
                            <input
                              value={draftBy}
                              onChange={e => setDraftBy(e.target.value)}
                              placeholder="Initials"
                              style={{ ...inputS, padding: '4px 6px' }}
                            />
                          ) : (
                            <>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{byName}</span>
                              {isAdmin && <AdminBadge />}
                            </>
                          )}
                        </div>
                        {/* Date */}
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: c?.date ? '#8b90a8' : NONE_COLOR }}>
                          {c?.date ? fmtDate(c.date) : '—'}
                        </div>
                        {/* Edit / actions */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => saveInlineEdit(group, mic)}
                                disabled={savingEdit}
                                style={{ padding: '5px 9px', borderRadius: 6, fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer', background: '#c8f04e', border: 'none', color: '#0d0f14' }}
                              >
                                {savingEdit ? '…' : 'Save'}
                              </button>
                              <button
                                onClick={() => setEditingMicId(null)}
                                disabled={savingEdit}
                                style={{ padding: '5px 9px', borderRadius: 6, fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer', background: 'transparent', border: '1px solid #2a2e3d', color: '#8b90a8' }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEdit(group, mic)}
                              title="Edit status"
                              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12, padding: '2px 4px', lineHeight: 1 }}
                            >
                              ✎
                            </button>
                          )}
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
                              const hAdmin = h.source === 'admin'
                              const hBy = hAdmin ? (h.amended_by || '—') : (hsub?.by || '—')
                              return (
                                <div key={hi} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#6b7280', width: 56 }}>{fmtShort(h.date)}</span>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: hm?.color ?? NONE_COLOR, flexShrink: 0 }} />
                                  <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: hm?.color ?? NONE_COLOR, width: 52 }}>{hm?.label ?? '—'}</span>
                                  {h.status === 'room' && h.room && (
                                    <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#6b7280' }}>{h.room.replace('Studio ', '')}</span>
                                  )}
                                  <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#4a4f64', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    {hBy}
                                    {hAdmin && <AdminBadge />}
                                  </span>
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

      {/* ── Manage Mics modal ────────────────────────────────────── */}
      {manageOpen && (
        <div
          onClick={() => { setManageOpen(false); setMngEditId(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 780, maxHeight: '84vh', overflow: 'auto', background: '#12151c', border: '1px solid #2a2e3d', borderRadius: 10, padding: 20 }}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: '#e8eaf2' }}>Manage Mics</div>
              <button
                onClick={() => { setManageOpen(false); setMngEditId(null) }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#8b90a8', fontSize: 18, lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            {/* Modal tabs */}
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #2a2e3d', marginBottom: 16 }}>
              {([['list', 'Master Mic List'], ['add', 'Add Mic']] as const).map(([key, label]) => {
                const active = manageTab === key
                return (
                  <button
                    key={key}
                    onClick={() => { setManageTab(key); setMngEditId(null) }}
                    style={{ padding: '8px 14px', border: 'none', cursor: 'pointer', background: 'transparent', fontFamily: 'Syne', fontWeight: 700, fontSize: 12, color: active ? '#e8eaf2' : '#8b90a8', borderBottom: `2px solid ${active ? '#c8f04e' : 'transparent'}`, marginBottom: -1 }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Master Mic List tab */}
            {manageTab === 'list' && (() => {
              const q = mngSearch.trim().toLowerCase()
              const matches = (m: Mic) =>
                !q || m.name.toLowerCase().includes(q) || studioLabel(m.home_studio).toLowerCase().includes(q) || m.home_studio.toLowerCase().includes(q)
              const activeRows = mics.filter(m => m.is_active && matches(m))
              const inactiveRows = mics.filter(m => !m.is_active && matches(m))

              const MIC_GRID = '1fr 110px 96px 56px 150px'

              const renderRow = (mic: Mic, isInactive: boolean) => {
                const editing = mngEditId === mic.id
                const qv = qtyAnyByMic[mic.id]
                if (editing) {
                  return (
                    <div key={mic.id} style={{ padding: '10px 12px', borderBottom: '1px solid #20242f', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: MIC_GRID, gap: 8, alignItems: 'center' }}>
                        <input value={mngDraft.name} onChange={e => setMngDraft(d => ({ ...d, name: e.target.value }))} placeholder="Name" style={inputS} />
                        <select value={mngDraft.home_studio} onChange={e => setMngDraft(d => ({ ...d, home_studio: e.target.value }))} style={inputS}>
                          {STUDIO_OPTIONS.map(s => <option key={s} value={s}>{studioLabel(s)}</option>)}
                        </select>
                        <input value={mngDraft.category} onChange={e => setMngDraft(d => ({ ...d, category: e.target.value }))} placeholder="Category" style={inputS} />
                        <input value={mngDraft.qty} onChange={e => setMngDraft(d => ({ ...d, qty: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="Qty" inputMode="numeric" style={inputS} />
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button onClick={() => saveMicEdit(mic)} disabled={saving} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 10, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer', background: '#c8f04e', border: 'none', color: '#0d0f14' }}>{saving ? '…' : 'Save'}</button>
                          <button onClick={() => setMngEditId(null)} disabled={saving} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', background: 'transparent', border: '1px solid #2a2e3d', color: '#8b90a8' }}>Cancel</button>
                        </div>
                      </div>
                      <div style={{ fontSize: 8, fontFamily: 'DM Mono', color: '#4a4f64' }}>Qty writes to today’s mic_inventory_quantities under {studioLabel(mngDraft.home_studio)}.</div>
                    </div>
                  )
                }
                return (
                  <div key={mic.id} style={{ display: 'grid', gridTemplateColumns: MIC_GRID, gap: 8, padding: '9px 12px', borderBottom: '1px solid #20242f', alignItems: 'center', opacity: isInactive ? 0.5 : 1 }}>
                    <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#e8eaf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mic.name}</div>
                    <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8b90a8' }}>{studioLabel(mic.home_studio)}</div>
                    <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8b90a8' }}>{mic.category}</div>
                    <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: qv ? '#e8eaf2' : NONE_COLOR }}>{qv ? qv.quantity : '—'}</div>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {isInactive ? (
                        <button onClick={() => setMicActive(mic, true)} disabled={saving} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(20,184,166,0.4)', color: ADMIN_TEAL }}>Reactivate</button>
                      ) : (
                        <>
                          <button onClick={() => startMicEdit(mic)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer', background: 'transparent', border: '1px solid #2a2e3d', color: '#8b90a8' }}>Edit</button>
                          <button onClick={() => setMicActive(mic, false)} disabled={saving} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontFamily: 'DM Mono', cursor: 'pointer', background: 'transparent', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444' }}>Deactivate</button>
                        </>
                      )}
                    </div>
                  </div>
                )
              }

              return (
                <div>
                  <input
                    value={mngSearch}
                    onChange={e => setMngSearch(e.target.value)}
                    placeholder="Search by name or studio…"
                    style={{ ...inputS, width: '100%', marginBottom: 12, padding: '8px 10px' }}
                  />
                  <div style={{ border: '1px solid #2a2e3d', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: MIC_GRID, gap: 8, padding: '6px 12px', background: '#1a1d27', borderBottom: '1px solid #2a2e3d' }}>
                      {['Name', 'Studio', 'Category', 'Qty', ''].map((h, hi) => <div key={hi} style={labelS}>{h}</div>)}
                    </div>
                    {activeRows.length === 0 && (
                      <div style={{ padding: '16px 12px', fontSize: 11, fontFamily: 'DM Mono', color: '#4a4f64' }}>No active mics match.</div>
                    )}
                    {activeRows.map(m => renderRow(m, false))}
                  </div>

                  {inactiveRows.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 8 }}>
                        Deactivated ({inactiveRows.length})
                      </div>
                      <div style={{ border: '1px solid #20242f', borderRadius: 6, overflow: 'hidden' }}>
                        {inactiveRows.map(m => renderRow(m, true))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Add Mic tab */}
            {manageTab === 'add' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
                <div>
                  <div style={{ ...labelS, marginBottom: 5 }}>Mic Name *</div>
                  <input value={addDraft.name} onChange={e => setAddDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Neumann U87 #3" style={inputS} />
                </div>
                <div>
                  <div style={{ ...labelS, marginBottom: 5 }}>Studio</div>
                  <select value={addDraft.home_studio} onChange={e => setAddDraft(d => ({ ...d, home_studio: e.target.value }))} style={inputS}>
                    {STUDIO_OPTIONS.map(s => <option key={s} value={s}>{studioLabel(s)}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ ...labelS, marginBottom: 5 }}>Category</div>
                  <input value={addDraft.category} onChange={e => setAddDraft(d => ({ ...d, category: e.target.value }))} placeholder="mic / floating_gear / odds_ends" style={inputS} />
                </div>
                <div>
                  <div style={{ ...labelS, marginBottom: 5 }}>Quantity</div>
                  <input value={addDraft.qty} onChange={e => setAddDraft(d => ({ ...d, qty: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="1" inputMode="numeric" style={inputS} />
                  <div style={{ fontSize: 8, fontFamily: 'DM Mono', color: '#4a4f64', marginTop: 4 }}>Saved to today’s mic_inventory_quantities under {studioLabel(addDraft.home_studio)} when &gt; 0.</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleAddMic}
                    disabled={saving || !addDraft.name.trim()}
                    style={{ padding: '9px 18px', borderRadius: 8, fontSize: 12, fontFamily: 'Syne', fontWeight: 700, cursor: addDraft.name.trim() ? 'pointer' : 'default', background: addDraft.name.trim() ? '#c8f04e' : '#1e2130', border: 'none', color: addDraft.name.trim() ? '#0d0f14' : '#4b5563' }}
                  >
                    {saving ? 'Saving…' : 'Add Mic'}
                  </button>
                  <button
                    onClick={() => setManageTab('list')}
                    style={{ padding: '9px 18px', borderRadius: 8, fontSize: 12, fontFamily: 'Syne', fontWeight: 700, cursor: 'pointer', background: 'transparent', border: '1px solid #2a2e3d', color: '#8b90a8' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
