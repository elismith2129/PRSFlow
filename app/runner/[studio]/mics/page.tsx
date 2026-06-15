'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'

function getLocalToday(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

const STUDIO_META: Record<string, { label: string; color: string }> = {
  paramount: { label: 'Paramount', color: '#c8f04e' },
  ameraycan: { label: 'Ameraycan', color: '#EF4444' },
  encore:    { label: 'Encore',    color: '#4e8ff0' },
  track:     { label: 'Track',     color: '#F97316' },
}

const STUDIO_ROOMS: Record<string, string[]> = {
  paramount: ['Studio A', 'Studio B', 'Studio C', 'Studio E', 'Studio X'],
  ameraycan: ['Studio A', 'Studio B'],
  encore:    ['Studio A', 'Studio B'],
  track:     ['Studio North', 'Studio South'],
}

type Mic = {
  id: string
  name: string
  home_studio: string
  category: string
  sort_order: number
}

type CheckinState = {
  status: 'not_checked' | 'here' | 'room' | 'missing'
  room: string
}

export default function MicsPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta  = STUDIO_META[studio] ?? { label: studio, color: '#c8f04e' }
  const today = getLocalToday()
  const rooms = STUDIO_ROOMS[studio] ?? []

  const [mics, setMics]             = useState<Mic[]>([])
  const [loading, setLoading]       = useState(true)
  const [checkins, setCheckins]     = useState<Record<string, CheckinState>>({})
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [initials, setInitials]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showInitialsHint, setShowInitialsHint] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    home: true, other: false, floating: false, odds: false,
  })
  const [roomPickerOpen, setRoomPickerOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('mics')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      setMics(data ?? [])

      const [{ data: savedCheckins }, { data: savedQtys }] = await Promise.all([
        supabase.from('mic_checkins').select('*').eq('studio', studio).eq('date', today),
        supabase.from('mic_inventory_quantities').select('*').eq('studio', studio).eq('date', today),
      ])
      if (savedCheckins?.length) {
        const restored: Record<string, CheckinState> = {}
        for (const c of savedCheckins) {
          restored[c.mic_id] = { status: c.status, room: c.room ?? '' }
        }
        setCheckins(restored)
      }
      if (savedQtys?.length) {
        const restored: Record<string, number> = {}
        for (const q of savedQtys) {
          restored[q.mic_id] = q.quantity
        }
        setQuantities(restored)
      }

      setLoading(false)
    }
    load()
  }, [])

  function toggleSection(key: string) {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function setStatus(micId: string, status: CheckinState['status']) {
    setCheckins(prev => {
      const cur = prev[micId]
      if (cur?.status === status) return { ...prev, [micId]: { status: 'not_checked', room: '' } }
      return { ...prev, [micId]: { status, room: cur?.room ?? '' } }
    })
  }

  function setRoom(micId: string, room: string) {
    setCheckins(prev => ({ ...prev, [micId]: { status: 'room', room } }))
    setRoomPickerOpen(prev => ({ ...prev, [micId]: false }))
  }

  function adjustQty(micId: string, delta: number) {
    setQuantities(prev => ({ ...prev, [micId]: Math.max(0, (prev[micId] ?? 0) + delta) }))
  }

  async function handleSave() {
    const checkinRows = Object.entries(checkins)
      .filter(([, s]) => s.status !== 'not_checked')
      .map(([mic_id, s]) => ({ studio, date: today, mic_id, status: s.status, room: s.room || null }))
    const qtyRows = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([mic_id, qty]) => ({ studio, date: today, mic_id, quantity: qty }))
    await Promise.all([
      checkinRows.length ? supabase.from('mic_checkins').upsert(checkinRows, { onConflict: 'mic_id,studio,date' }) : Promise.resolve(),
      qtyRows.length ? supabase.from('mic_inventory_quantities').upsert(qtyRows, { onConflict: 'mic_id,studio,date' }) : Promise.resolve(),
    ])
    router.push(`/runner/${studio}`)
  }

  async function handleSubmit() {
    if (!initials.trim() || submitting) return
    setSubmitting(true)
    const now = new Date().toISOString()

    // 1. mic_checkins — only touched rows
    const checkinRows = Object.entries(checkins)
      .filter(([, v]) => v.status !== 'not_checked')
      .map(([mic_id, v]) => ({ mic_id, studio, date: today, status: v.status, room: v.room || null }))
    if (checkinRows.length > 0) {
      await supabase.from('mic_checkins').upsert(checkinRows, { onConflict: 'mic_id,studio,date' })
    }

    // 2. mic_inventory_quantities — only qty > 0
    const qtyRows = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([mic_id, quantity]) => ({ mic_id, studio, date: today, quantity }))
    if (qtyRows.length > 0) {
      await supabase.from('mic_inventory_quantities').upsert(qtyRows, { onConflict: 'mic_id,studio,date' })
    }

    // 3. mic_inventory_submissions
    await supabase.from('mic_inventory_submissions').upsert(
      { studio, date: today, submitted_at: now, submitted_by: initials.trim() },
      { onConflict: 'studio,date' }
    )

    // 4. daily_ops_submissions
    await supabase.from('daily_ops_submissions').upsert(
      { studio, date: today, category: 'mic_inventory', submitted_at: now, staff_name: initials.trim() },
      { onConflict: 'studio,date,category' }
    )

    setSubmitting(false)
    router.push(`/runner/${studio}`)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0d0f14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b90a8', fontFamily: 'Syne, sans-serif' }}>
        Loading…
      </div>
    )
  }

  const homeMics  = mics.filter(m => m.home_studio === studio && m.category === 'mic')
  const otherMics = mics.filter(m => m.home_studio !== studio && m.home_studio !== 'floating' && m.category === 'mic')
  const floatGear = mics.filter(m => m.category === 'floating_gear')
  const oddsEnds  = mics.filter(m => m.category === 'odds_ends')
  const canSubmit = initials.trim().length > 0 && !submitting

  function SectionHeader({ sectionKey, label, count }: { sectionKey: string; label: string; count: number }) {
    const open = openSections[sectionKey]
    return (
      <button
        onClick={() => toggleSection(sectionKey)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#161920', border: '1px solid #2a2e3d',
          borderRadius: open ? '12px 12px 0 0' : 12,
          padding: '13px 16px', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e8eaf2', fontFamily: 'Syne, sans-serif' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>{count}</span>
          <span style={{ fontSize: 11, color: '#8b90a8', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
        </div>
      </button>
    )
  }

  function MicRow({ mic }: { mic: Mic }) {
    const state     = checkins[mic.id] ?? { status: 'not_checked', room: '' }
    const isHere    = state.status === 'here'
    const isRoom    = state.status === 'room'
    const isMissing = state.status === 'missing'
    const pickerOpen = isRoom && !!roomPickerOpen[mic.id]

    return (
      <div style={{ borderBottom: '1px solid #2a2e3d' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#e8eaf2', fontFamily: 'DM Mono, monospace', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mic.name}
          </span>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <button onClick={() => setStatus(mic.id, 'here')}
              style={{ padding: '5px 9px', borderRadius: 7, border: `1px solid ${isHere ? '#14B8A6' : '#2a2e3d'}`, background: isHere ? 'rgba(20,184,166,0.13)' : 'transparent', color: isHere ? '#14B8A6' : '#8b90a8', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Mono, monospace' }}>
              HERE
            </button>
            <button onClick={() => {
              if (!isRoom) {
                setStatus(mic.id, 'room')
                setRoomPickerOpen(prev => ({ ...prev, [mic.id]: true }))
              } else {
                setRoomPickerOpen(prev => ({ ...prev, [mic.id]: !prev[mic.id] }))
              }
            }}
              style={{ padding: '5px 9px', borderRadius: 7, border: `1px solid ${isRoom ? '#7BA7BC' : '#2a2e3d'}`, background: isRoom ? 'rgba(123,167,188,0.13)' : 'transparent', color: isRoom ? '#7BA7BC' : '#8b90a8', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Mono, monospace' }}>
              {isRoom && state.room ? state.room.replace('Studio ', '') + ' ▾' : 'ROOM ▾'}
            </button>
            <button onClick={() => setStatus(mic.id, 'missing')}
              style={{ padding: '5px 9px', borderRadius: 7, border: `1px solid ${isMissing ? '#EF4444' : '#2a2e3d'}`, background: isMissing ? 'rgba(239,68,68,0.13)' : 'transparent', color: isMissing ? '#EF4444' : '#8b90a8', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Mono, monospace' }}>
              MISS
            </button>
          </div>
        </div>
        {pickerOpen && (
          <div style={{ padding: '0 14px 10px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>Room:</span>
            {rooms.map(r => (
              <button key={r} onClick={() => setRoom(mic.id, r)}
                style={{ padding: '3px 9px', borderRadius: 6, border: `1px solid ${state.room === r ? '#7BA7BC' : '#2a2e3d'}`, background: state.room === r ? 'rgba(123,167,188,0.13)' : 'transparent', color: state.room === r ? '#7BA7BC' : '#8b90a8', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Mono, monospace', whiteSpace: 'nowrap' }}>
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  function OddsRow({ mic }: { mic: Mic }) {
    const qty = quantities[mic.id] ?? 0
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #2a2e3d', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#e8eaf2', fontFamily: 'DM Mono, monospace', flex: 1 }}>{mic.name}</span>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #2a2e3d', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
          <button onClick={() => adjustQty(mic.id, -1)}
            style={{ width: 32, height: 32, background: 'transparent', border: 'none', color: qty === 0 ? '#3a3e4d' : '#e8eaf2', fontSize: 18, cursor: qty === 0 ? 'default' : 'pointer', lineHeight: 1 }}>
            −
          </button>
          <span style={{ minWidth: 28, textAlign: 'center', fontSize: 13, fontWeight: 700, color: qty > 0 ? '#e8eaf2' : '#8b90a8', fontFamily: 'DM Mono, monospace' }}>
            {qty}
          </span>
          <button onClick={() => adjustQty(mic.id, 1)}
            style={{ width: 32, height: 32, background: 'transparent', border: 'none', color: '#e8eaf2', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>
            +
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden', background: '#0d0f14', fontFamily: 'Syne, sans-serif', paddingBottom: 120 }}>

      {/* Header */}
      <div style={{ background: '#161920', borderBottom: `3px solid ${meta.color}`, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.push(`/runner/${studio}`)} style={{ background: 'none', border: 'none', color: '#8b90a8', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>←</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#e8eaf2' }}>Mic Inventory</div>
          <div style={{ fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>{meta.label} · {today}</div>
        </div>
      </div>

      {/* Sections */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        <div>
          <SectionHeader sectionKey="home" label={`${meta.label} Mics`} count={homeMics.length} />
          {openSections.home && (
            <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
              {homeMics.map(m => <MicRow key={m.id} mic={m} />)}
            </div>
          )}
        </div>

        <div>
          <SectionHeader sectionKey="other" label="Other Studio Mics" count={otherMics.length} />
          {openSections.other && (
            <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
              {otherMics.length === 0
                ? <div style={{ padding: '16px 14px', fontSize: 12, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>No stray mics to report.</div>
                : otherMics.map(m => <MicRow key={m.id} mic={m} />)
              }
            </div>
          )}
        </div>

        <div>
          <SectionHeader sectionKey="floating" label="Floating Gear" count={floatGear.length} />
          {openSections.floating && (
            <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
              {floatGear.map(m => <MicRow key={m.id} mic={m} />)}
            </div>
          )}
        </div>

        <div>
          <SectionHeader sectionKey="odds" label="Odds & Ends" count={oddsEnds.length} />
          {openSections.odds && (
            <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
              {oddsEnds.map(m => <OddsRow key={m.id} mic={m} />)}
            </div>
          )}
        </div>

      </div>

      {/* Fixed footer */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0d0f14', borderTop: '1px solid #1e2130', padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <input
            value={initials}
            onChange={e => { setInitials(e.target.value.toUpperCase()); if (e.target.value.trim()) setShowInitialsHint(false) }}
            placeholder="Initials"
            maxLength={4}
            style={{ width: 70, padding: '10px 8px', background: '#161920', border: '1px solid #2a2e3d', borderRadius: 8, color: '#e8eaf2', fontSize: 13, fontFamily: 'DM Mono, monospace', textAlign: 'center', outline: 'none' }}
          />
          {showInitialsHint && (
            <div style={{ position: 'absolute', top: '100%', left: 0, fontSize: 9, color: '#ef4444', fontFamily: 'DM Mono, monospace', marginTop: 3, whiteSpace: 'nowrap' }}>
              Required to submit
            </div>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={submitting}
          style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid #2a2e3d', borderRadius: 12, color: '#8b90a8', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
        >
          Save
        </button>
        <button
          onClick={() => { if (!initials.trim()) { setShowInitialsHint(true); return } handleSubmit() }}
          disabled={submitting}
          style={{ flex: 1, padding: '12px', background: initials.trim() ? meta.color : '#1e2130', border: 'none', borderRadius: 12, color: initials.trim() ? '#0d0f14' : '#4b5563', fontSize: 13, fontWeight: 800, cursor: initials.trim() ? 'pointer' : 'default', fontFamily: 'Syne, sans-serif' }}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>

    </div>
  )
}
