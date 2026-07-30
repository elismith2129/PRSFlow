'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { getLocalToday } from '@/lib/time'


const STUDIO_META: Record<string, { label: string }> = {
  paramount: { label: 'Paramount' },
  ameraycan: { label: 'Ameraycan' },
  encore:    { label: 'Encore' },
  track:     { label: 'Track' },
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
  const meta  = STUDIO_META[studio] ?? { label: studio }
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
  // True once the runner edits anything; blocks the realtime refetch so a live update
  // never clobbers unsaved status/room/qty. Reset to false whenever we load fresh data.
  const dirtyRef = useRef(false)

  const load = useCallback(async () => {
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
    dirtyRef.current = false
  }, [studio, today])

  useEffect(() => { load() }, [load])

  // Real-time: another device's mic check-ins/quantities refetch live when clean;
  // skipped while this runner is mid-edit so their local entries are never clobbered.
  useEffect(() => {
    const channel = supabase
      .channel(`runner-mics-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mic_checkins' }, () => { if (!dirtyRef.current) load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mic_inventory_quantities' }, () => { if (!dirtyRef.current) load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studio, load])

  function toggleSection(key: string) {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function setStatus(micId: string, status: CheckinState['status']) {
    dirtyRef.current = true
    setCheckins(prev => {
      const cur = prev[micId]
      if (cur?.status === status) return { ...prev, [micId]: { status: 'not_checked', room: '' } }
      return { ...prev, [micId]: { status, room: cur?.room ?? '' } }
    })
  }

  function setRoom(micId: string, room: string) {
    dirtyRef.current = true
    setCheckins(prev => ({ ...prev, [micId]: { status: 'room', room } }))
    setRoomPickerOpen(prev => ({ ...prev, [micId]: false }))
  }

  function adjustQty(micId: string, delta: number) {
    dirtyRef.current = true
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
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontFamily: 'Syne, sans-serif' }}>
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
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: open ? '12px 12px 0 0' : 12,
          padding: '13px 16px', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'Syne, sans-serif' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'Inter' }}>{count}</span>
          <span style={{ fontSize: 11, color: 'var(--text2)', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
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
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'Inter', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mic.name}
          </span>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <button onClick={() => setStatus(mic.id, 'here')}
              style={{ padding: '5px 9px', borderRadius: 7, border: `1px solid ${isHere ? 'var(--booked)' : 'var(--border)'}`, background: isHere ? 'rgba(20,184,166,0.13)' : 'transparent', color: isHere ? 'var(--booked)' : 'var(--text2)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter' }}>
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
              style={{ padding: '5px 9px', borderRadius: 7, border: `1px solid ${isRoom ? 'var(--uncontacted)' : 'var(--border)'}`, background: isRoom ? 'rgba(123,167,188,0.13)' : 'transparent', color: isRoom ? 'var(--uncontacted)' : 'var(--text2)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter' }}>
              {isRoom && state.room ? state.room.replace('Studio ', '') + ' ▾' : 'ROOM ▾'}
            </button>
            <button onClick={() => setStatus(mic.id, 'missing')}
              style={{ padding: '5px 9px', borderRadius: 7, border: `1px solid ${isMissing ? 'var(--hot)' : 'var(--border)'}`, background: isMissing ? 'rgba(239,68,68,0.13)' : 'transparent', color: isMissing ? 'var(--hot)' : 'var(--text2)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter' }}>
              MISS
            </button>
          </div>
        </div>
        {pickerOpen && (
          <div style={{ padding: '0 14px 10px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'Inter' }}>Room:</span>
            {rooms.map(r => (
              <button key={r} onClick={() => setRoom(mic.id, r)}
                style={{ padding: '3px 9px', borderRadius: 6, border: `1px solid ${state.room === r ? 'var(--uncontacted)' : 'var(--border)'}`, background: state.room === r ? 'rgba(123,167,188,0.13)' : 'transparent', color: state.room === r ? 'var(--uncontacted)' : 'var(--text2)', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter', whiteSpace: 'nowrap' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'Inter', flex: 1 }}>{mic.name}</span>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
          <button onClick={() => adjustQty(mic.id, -1)}
            style={{ width: 32, height: 32, background: 'transparent', border: 'none', color: qty === 0 ? '#3a3e4d' : 'var(--text)', fontSize: 18, cursor: qty === 0 ? 'default' : 'pointer', lineHeight: 1 }}>
            −
          </button>
          <span style={{ minWidth: 28, textAlign: 'center', fontSize: 13, fontWeight: 700, color: qty > 0 ? 'var(--text)' : 'var(--text2)', fontFamily: 'Inter' }}>
            {qty}
          </span>
          <button onClick={() => adjustQty(mic.id, 1)}
            style={{ width: 32, height: 32, background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>
            +
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden', background: 'var(--bg)', fontFamily: 'Syne, sans-serif', paddingBottom: 120 }}>

      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.push(`/runner/${studio}`)} style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>←</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Mic Inventory</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'Inter' }}>{meta.label} · {today}</div>
        </div>
      </div>

      {/* Sections */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        <div>
          <SectionHeader sectionKey="home" label={`${meta.label} Mics`} count={homeMics.length} />
          {openSections.home && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
              {homeMics.map(m => <MicRow key={m.id} mic={m} />)}
            </div>
          )}
        </div>

        <div>
          <SectionHeader sectionKey="other" label="Other Studio Mics" count={otherMics.length} />
          {openSections.other && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
              {otherMics.length === 0
                ? <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--text2)', fontFamily: 'Inter' }}>No stray mics to report.</div>
                : otherMics.map(m => <MicRow key={m.id} mic={m} />)
              }
            </div>
          )}
        </div>

        <div>
          <SectionHeader sectionKey="floating" label="Floating Gear" count={floatGear.length} />
          {openSections.floating && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
              {floatGear.map(m => <MicRow key={m.id} mic={m} />)}
            </div>
          )}
        </div>

        <div>
          <SectionHeader sectionKey="odds" label="Odds & Ends" count={oddsEnds.length} />
          {openSections.odds && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
              {oddsEnds.map(m => <OddsRow key={m.id} mic={m} />)}
            </div>
          )}
        </div>

      </div>

      {/* Fixed footer */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--bg)', borderTop: '1px solid var(--surface2)', padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <input
            value={initials}
            onChange={e => { setInitials(e.target.value.toUpperCase()); if (e.target.value.trim()) setShowInitialsHint(false) }}
            placeholder="Initials"
            maxLength={4}
            style={{ width: 70, padding: '10px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, fontFamily: 'Inter', textAlign: 'center', outline: 'none' }}
          />
          {showInitialsHint && (
            <div style={{ position: 'absolute', top: '100%', left: 0, fontSize: 9, color: 'var(--hot)', fontFamily: 'Inter', marginTop: 3, whiteSpace: 'nowrap' }}>
              Required to submit
            </div>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={submitting}
          style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text2)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
        >
          Save
        </button>
        <button
          onClick={() => { if (!initials.trim()) { setShowInitialsHint(true); return } handleSubmit() }}
          disabled={submitting}
          style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 12, color: initials.trim() ? 'var(--text)' : 'var(--text3)', fontSize: 13, fontWeight: 800, cursor: initials.trim() ? 'pointer' : 'default', opacity: initials.trim() ? 1 : 0.6, fontFamily: 'Syne, sans-serif' }}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>

    </div>
  )
}
