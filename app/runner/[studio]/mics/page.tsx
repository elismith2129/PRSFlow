'use client'
// SOFT SKIN PORT, 2026-08-14 (one-pass runner redesign). All logic — loads,
// dirtyRef realtime guard, status/room/qty state, both save paths, the four
// submit upserts — is UNTOUCHED. Old skin retired (legacy tokens, 1px borders,
// Syne). Status colour only (§5): Here = booked green, Room = cold blue,
// Missing = hot red; active state is a FILLED pill, not a tinted border.
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { getLocalToday } from '@/lib/time'
import { useReloadOnReturn } from '@/hooks/useReloadOnReturn'
import { draftKey, readDraft, writeDraft, clearDraft } from '@/lib/draft'


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
    const restoredCheckins: Record<string, CheckinState> = {}
    for (const c of savedCheckins ?? []) {
      restoredCheckins[c.mic_id] = { status: c.status, room: c.room ?? '' }
    }
    const restoredQtys: Record<string, number> = {}
    for (const q of savedQtys ?? []) {
      restoredQtys[q.mic_id] = q.quantity
    }
    dirtyRef.current = false

    // Unsaved draft from a previous visit (lib/draft): the runner's un-saved
    // taps win over what the server has, and the page counts as dirty so
    // realtime doesn't clobber them. Cleared on successful save/submit.
    const draft = readDraft<{ checkins: Record<string, CheckinState>; quantities: Record<string, number>; initials: string }>(
      draftKey('mics', studio, today))
    if (draft && (Object.keys(draft.checkins).length > 0 || Object.keys(draft.quantities).length > 0 || draft.initials)) {
      Object.assign(restoredCheckins, draft.checkins)
      Object.assign(restoredQtys, draft.quantities)
      if (draft.initials) setInitials(draft.initials)
      dirtyRef.current = true
    }

    setCheckins(restoredCheckins)
    setQuantities(restoredQtys)
    setLoading(false)
  }, [studio, today])

  // Mirror un-saved taps to the draft as they happen.
  useEffect(() => {
    if (loading || !dirtyRef.current) return
    writeDraft(draftKey('mics', studio, today), { checkins, quantities, initials })
  }, [checkins, quantities, initials, loading, studio, today])

  useEffect(() => { load() }, [load])
  // Same dirty-guard as the realtime channel: never clobber an in-progress check-in.
  useReloadOnReturn(useCallback(() => { if (!dirtyRef.current) load() }, [load]))

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
    clearDraft(draftKey('mics', studio, today))
    dirtyRef.current = false
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

    clearDraft(draftKey('mics', studio, today))
    dirtyRef.current = false
    setSubmitting(false)
    router.push(`/runner/${studio}`)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--c-bg)', color: 'var(--c-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  const homeMics  = mics.filter(m => m.home_studio === studio && m.category === 'mic')
  const otherMics = mics.filter(m => m.home_studio !== studio && m.home_studio !== 'floating' && m.category === 'mic')
  const floatGear = mics.filter(m => m.category === 'floating_gear')
  const oddsEnds  = mics.filter(m => m.category === 'odds_ends')

  // A section: soft card, header always visible, rows revealed when open.
  const sectionCard: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))',
    boxShadow: 'var(--c-softsh)',
    borderRadius: 16,
    overflow: 'hidden',
  }

  function SectionHeader({ sectionKey, label, count }: { sectionKey: string; label: string; count: number }) {
    const open = openSections[sectionKey]
    return (
      <button
        onClick={() => toggleSection(sectionKey)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'transparent', border: 'none', font: 'inherit', color: 'var(--c-fg)',
          padding: '13px 14px', cursor: 'pointer', minHeight: 48,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 800 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, opacity: 0.45 }}>{count}</span>
          <span style={{ fontSize: 11, opacity: 0.45, display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
        </div>
      </button>
    )
  }

  // Status pill: filled with its status colour when active, quiet wash when not.
  function statusPill(on: boolean, color: string, ink: string): React.CSSProperties {
    return {
      padding: '6px 10px', minHeight: 32, borderRadius: 99, border: 'none', font: 'inherit',
      background: on ? color : 'var(--c-wash)',
      color: on ? ink : 'var(--c-fg)',
      opacity: on ? 1 : 0.6,
      fontSize: 10, fontWeight: 800, letterSpacing: '0.03em',
      cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
    }
  }

  function MicRow({ mic, first }: { mic: Mic; first: boolean }) {
    const state     = checkins[mic.id] ?? { status: 'not_checked', room: '' }
    const isHere    = state.status === 'here'
    const isRoom    = state.status === 'room'
    const isMissing = state.status === 'missing'
    const pickerOpen = isRoom && !!roomPickerOpen[mic.id]

    return (
      <div style={{ boxShadow: first ? undefined : '0 -1px 0 var(--c-wash)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', gap: 8 }}>
          <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mic.name}
          </span>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <button onClick={() => setStatus(mic.id, 'here')} style={statusPill(isHere, 'var(--c-st-booked)', 'var(--c-chip-ink)')}>
              HERE
            </button>
            <button onClick={() => {
              if (!isRoom) {
                setStatus(mic.id, 'room')
                setRoomPickerOpen(prev => ({ ...prev, [mic.id]: true }))
              } else {
                setRoomPickerOpen(prev => ({ ...prev, [mic.id]: !prev[mic.id] }))
              }
            }} style={statusPill(isRoom, 'var(--c-st-cold)', 'var(--c-chip-ink)')}>
              {isRoom && state.room ? state.room.replace('Studio ', '') + ' ▾' : 'ROOM ▾'}
            </button>
            <button onClick={() => setStatus(mic.id, 'missing')} style={statusPill(isMissing, 'var(--c-st-hot)', 'var(--c-hot-text)')}>
              MISS
            </button>
          </div>
        </div>
        {pickerOpen && (
          <div style={{ padding: '0 14px 10px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, opacity: 0.45 }}>Room:</span>
            {rooms.map(r => (
              <button key={r} onClick={() => setRoom(mic.id, r)}
                style={{
                  padding: '5px 10px', minHeight: 30, borderRadius: 99, border: 'none', font: 'inherit',
                  background: state.room === r ? 'var(--c-st-cold)' : 'var(--c-wash)',
                  color: state.room === r ? 'var(--c-chip-ink)' : 'var(--c-fg)',
                  opacity: state.room === r ? 1 : 0.65,
                  fontSize: 10.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                  WebkitTapHighlightColor: 'transparent',
                }}>
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  function OddsRow({ mic, first }: { mic: Mic; first: boolean }) {
    const qty = quantities[mic.id] ?? 0
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px', gap: 8,
        boxShadow: first ? undefined : '0 -1px 0 var(--c-wash)',
      }}>
        <span style={{ fontSize: 12.5, flex: 1 }}>{mic.name}</span>
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--c-wash)', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
          <button onClick={() => adjustQty(mic.id, -1)}
            style={{ width: 36, height: 34, background: 'transparent', border: 'none', font: 'inherit', color: 'var(--c-fg)', opacity: qty === 0 ? 0.25 : 0.8, fontSize: 17, cursor: qty === 0 ? 'default' : 'pointer', lineHeight: 1 }}>
            −
          </button>
          <span className="c-mono" style={{ minWidth: 26, textAlign: 'center', fontSize: 13, fontWeight: 700, opacity: qty > 0 ? 1 : 0.45 }}>
            {qty}
          </span>
          <button onClick={() => adjustQty(mic.id, 1)}
            style={{ width: 36, height: 34, background: 'transparent', border: 'none', font: 'inherit', color: 'var(--c-fg)', opacity: 0.8, fontSize: 17, cursor: 'pointer', lineHeight: 1 }}>
            +
          </button>
        </div>
      </div>
    )
  }

  const SECTIONS: { key: string; label: string; mics: Mic[]; odds?: boolean; empty?: string }[] = [
    { key: 'home', label: `${meta.label} mics`, mics: homeMics },
    { key: 'other', label: 'Other studio mics', mics: otherMics, empty: 'No stray mics to report.' },
    { key: 'floating', label: 'Floating gear', mics: floatGear },
    { key: 'odds', label: 'Odds & ends', mics: oddsEnds, odds: true },
  ]

  return (
    <div style={{
      minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden',
      background: 'var(--c-bg)', color: 'var(--c-fg)', paddingBottom: 130,
    }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '14px 16px 10px', position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--c-bg)',
      }}>
        <button
          onClick={() => router.push(`/runner/${studio}`)}
          aria-label="Back"
          className="c-control c-raised"
          style={{
            width: 38, height: 38, borderRadius: 99, flexShrink: 0,
            background: 'var(--c-wash)', color: 'var(--c-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, cursor: 'pointer',
          }}
        >←</button>
        <div>
          <div className="c-arch" style={{ fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Mic inventory</div>
          <div style={{ fontSize: 11.5, opacity: 0.5 }}>{meta.label} · {today}</div>
        </div>
      </div>

      {/* Sections */}
      <div style={{ padding: '4px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SECTIONS.map(sec => (
          <div key={sec.key} style={sectionCard}>
            <SectionHeader sectionKey={sec.key} label={sec.label} count={sec.mics.length} />
            {openSections[sec.key] && (
              sec.mics.length === 0
                ? <div style={{ padding: '4px 14px 16px', fontSize: 12.5, opacity: 0.5 }}>{sec.empty ?? 'Nothing here.'}</div>
                : sec.mics.map((m, i) => sec.odds
                    ? <OddsRow key={m.id} mic={m} first={i === 0} />
                    : <MicRow key={m.id} mic={m} first={i === 0} />)
            )}
          </div>
        ))}
      </div>

      {/* Fixed footer */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '12px 14px calc(16px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(to top, var(--c-bg) 68%, transparent)',
        display: 'flex', gap: 9, alignItems: 'center',
      }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <input
            value={initials}
            onChange={e => { dirtyRef.current = true; setInitials(e.target.value.toUpperCase()); if (e.target.value.trim()) setShowInitialsHint(false) }}
            placeholder="Initials"
            maxLength={4}
            className="c-mono"
            style={{
              width: 70, minHeight: 48, padding: '10px 8px',
              background: 'var(--c-wash)', border: 'none', borderRadius: 12,
              color: 'var(--c-fg)', fontSize: 13, textAlign: 'center', outline: 'none',
              boxShadow: 'var(--c-softsh)',
            }}
          />
          {showInitialsHint && (
            <div style={{ position: 'absolute', top: '100%', left: 0, fontSize: 9.5, color: 'var(--c-st-hot)', fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap' }}>
              Required to submit
            </div>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={submitting}
          style={{
            flex: '0 0 26%', minHeight: 48, borderRadius: 14,
            background: 'var(--c-wash)', color: 'var(--c-fg)', opacity: 0.8,
            border: 'none', font: 'inherit', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', boxShadow: 'var(--c-ctlsh, var(--c-softsh))',
          }}
        >
          Save
        </button>
        <button
          onClick={() => { if (!initials.trim()) { setShowInitialsHint(true); return } handleSubmit() }}
          disabled={submitting}
          className="c-control c-raised"
          style={{
            flex: 1, minHeight: 48, borderRadius: 14,
            background: 'var(--c-wash2)', color: 'var(--c-fg)',
            border: 'none', font: 'inherit', fontSize: 13, fontWeight: 800,
            cursor: initials.trim() ? 'pointer' : 'default',
            opacity: initials.trim() ? 1 : 0.55,
            boxShadow: 'var(--c-softsh)',
          }}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>

    </div>
  )
}
