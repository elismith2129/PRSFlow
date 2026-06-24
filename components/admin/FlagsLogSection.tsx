'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Flag, FlagComment } from '@/lib/supabase'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SectionHeader } from '@/components/ui/SectionHeader'

const STUDIO_COLORS: Record<string, string> = {
  paramount: '#c8f04e',
  ameraycan: '#f04e7a',
  encore: '#4e8ff0',
  track: '#F97316',
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  facility_general: { label: 'Facility / General', color: 'var(--text3)', bg: 'var(--surface2)' },
  gear_equipment:   { label: 'Gear / Equipment',   color: '#F59E0B',       bg: 'rgba(245,158,11,0.12)' },
  client_billing:   { label: 'Client / Billing',   color: '#60A5FA',       bg: 'rgba(96,165,250,0.12)' },
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  )
}

async function uploadPhoto(file: File): Promise<string | null> {
  const path = `dashboard-tasks/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
  const { data, error } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
  if (!data || error) return null
  const { data: { publicUrl } } = supabase.storage.from('checklist-photos').getPublicUrl(data.path)
  return publicUrl
}

export function FlagsLogSection() {
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'acknowledged' | 'resolved'>('all')
  const [studioFilter, setStudioFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [flags, setFlags] = useState<Flag[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFlag, setSelectedFlag] = useState<Flag | null>(null)
  const [flagComments, setFlagComments] = useState<FlagComment[]>([])
  const [flagCommentText, setFlagCommentText] = useState('')
  const [flagCommentPhoto, setFlagCommentPhoto] = useState<File | null>(null)
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [pendingCategory, setPendingCategory] = useState<'facility_general' | 'gear_equipment' | 'client_billing' | null>(null)
  const [showResolveModal, setShowResolveModal] = useState(false)
  const [confirmDeleteFlag, setConfirmDeleteFlag] = useState(false)
  const [resolveNote, setResolveNote] = useState('')
  const [resolveVendor, setResolveVendor] = useState('')
  const [resolveCost, setResolveCost] = useState('')
  const [search, setSearch] = useState('')
  const flagCommentPhotoRef = useRef<HTMLInputElement>(null)

  const loadFlags = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('flags')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100)
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (studioFilter !== 'all') query = query.eq('studio', studioFilter)
    if (categoryFilter !== 'all') query = query.eq('category', categoryFilter)
    const { data } = await query
    setFlags(data || [])
    setLoading(false)
  }, [statusFilter, studioFilter, categoryFilter])

  useEffect(() => { loadFlags() }, [loadFlags])

  async function loadFlagComments(flagId: string) {
    const { data } = await supabase
      .from('flag_comments')
      .select('*')
      .eq('flag_id', flagId)
      .order('created_at', { ascending: true })
    setFlagComments(data || [])
  }

  async function handleOpenFlag(flag: Flag) {
    setSelectedFlag(flag)
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    setPendingCategory(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    await loadFlagComments(flag.id)
  }

  async function handleFlagComment() {
    if (!selectedFlag || flagSubmitting) return
    if (!flagCommentText.trim() && !flagCommentPhoto) return
    setFlagSubmitting(true)
    const photo_url = flagCommentPhoto ? await uploadPhoto(flagCommentPhoto) : null
    await supabase.from('flag_comments').insert({
      flag_id: selectedFlag.id,
      text: flagCommentText.trim() || null,
      photo_url,
      created_by_name: 'Staff',
    })
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    await loadFlagComments(selectedFlag.id)
    setFlagSubmitting(false)
  }

  async function handleAcknowledgeFlag() {
    if (!selectedFlag || flagSubmitting) return
    setFlagSubmitting(true)
    const { data: updatedData } = await supabase.from('flags').update({
      status: 'acknowledged',
      acknowledged_by: 'Staff',
      acknowledged_at: new Date().toISOString(),
      acknowledged_note: flagCommentText.trim() || null,
      ...(pendingCategory ? { category: pendingCategory } : {}),
    }).eq('id', selectedFlag.id).select().single()
    if (updatedData) setSelectedFlag(updatedData)
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    setPendingCategory(null)
    await loadFlags()
    setFlagSubmitting(false)
  }

  async function handleResolveFlag() {
    if (!selectedFlag || flagSubmitting) return
    setFlagSubmitting(true)
    const photo_url = flagCommentPhoto ? await uploadPhoto(flagCommentPhoto) : null
    if (flagCommentText.trim() || photo_url) {
      await supabase.from('flag_comments').insert({
        flag_id: selectedFlag.id,
        text: flagCommentText.trim() || null,
        photo_url,
        created_by_name: 'Staff',
      })
    }
    const { data: updatedData } = await supabase.from('flags').update({
      status: 'resolved',
      resolved_by: 'Staff',
      resolved_at: new Date().toISOString(),
      resolved_note: resolveNote.trim() || null,
      resolved_vendor: resolveVendor.trim() || null,
      resolved_cost: resolveCost ? parseFloat(resolveCost) : null,
    }).eq('id', selectedFlag.id).select().single()
    if (updatedData) setSelectedFlag(updatedData)
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    setShowResolveModal(false)
    setResolveNote('')
    setResolveVendor('')
    setResolveCost('')
    await loadFlags()
    setFlagSubmitting(false)
  }

  async function handleSaveFlag() {
    if (!selectedFlag || flagSubmitting) return
    setFlagSubmitting(true)
    const photo_url = flagCommentPhoto ? await uploadPhoto(flagCommentPhoto) : null
    if (flagCommentText.trim() || photo_url) {
      await supabase.from('flag_comments').insert({
        flag_id: selectedFlag.id,
        text: flagCommentText.trim() || null,
        photo_url,
        created_by_name: 'Staff',
      })
      await loadFlagComments(selectedFlag.id)
    }
    if (pendingCategory && pendingCategory !== selectedFlag.category) {
      const { data: updatedData } = await supabase.from('flags')
        .update({ category: pendingCategory })
        .eq('id', selectedFlag.id).select().single()
      if (updatedData) {
        setSelectedFlag(updatedData)
        await loadFlags()
      }
    }
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    setFlagSubmitting(false)
  }

  async function handleDeleteFlag() {
    if (!selectedFlag) return
    await supabase.from('flags').update({ deleted_at: new Date().toISOString() }).eq('id', selectedFlag.id)
    await loadFlags()
    setSelectedFlag(null)
    setConfirmDeleteFlag(false)
  }

  return (
    <div>

      {/* Header */}
      <SectionHeader title="Flags Log" />

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search flags…"
        style={{
          width: '100%', padding: '8px', fontSize: 11, fontFamily: 'DM Mono',
          background: '#1a1d27', border: '1px solid #2a2e3d',
          borderRadius: 6, color: '#e8eaf2', outline: 'none',
          boxSizing: 'border-box', marginBottom: 12,
        }}
      />

      {/* Filter row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: '#1a1d27', borderRadius: 8, padding: 3 }}>
          {(['all', 'pending', 'acknowledged', 'resolved'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '4px 10px', fontSize: 10, fontFamily: 'DM Mono', border: 'none', borderRadius: 6, cursor: 'pointer',
                background: statusFilter === s ? '#c8f04e' : 'transparent',
                color: statusFilter === s ? '#0d0f14' : '#8b90a8',
                fontWeight: statusFilter === s ? 700 : 400,
                textTransform: 'capitalize',
              }}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <select
          value={studioFilter}
          onChange={e => setStudioFilter(e.target.value)}
          style={{ padding: '5px 8px', fontSize: 11, background: '#1a1d27', border: '1px solid #2a2e3d', borderRadius: 6, color: '#e8eaf2', fontFamily: 'DM Mono', outline: 'none' }}
        >
          <option value="all">All Studios</option>
          <option value="paramount">Paramount</option>
          <option value="encore">Encore</option>
          <option value="ameraycan">Ameraycan</option>
          <option value="track">Track</option>
        </select>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          style={{ padding: '5px 8px', fontSize: 11, background: '#1a1d27', border: '1px solid #2a2e3d', borderRadius: 6, color: '#e8eaf2', fontFamily: 'DM Mono', outline: 'none' }}
        >
          <option value="all">All Categories</option>
          <option value="facility_general">Facility / General</option>
          <option value="gear_equipment">Gear / Equipment</option>
          <option value="client_billing">Client / Billing</option>
        </select>
      </div>

      {/* Flag list */}
      {loading ? (
        <div style={{ fontSize: 11, color: '#4a4f64', fontFamily: 'DM Mono', padding: '24px 0' }}>Loading…</div>
      ) : (() => {
        const filtered = flags.filter(f => {
          if (!search.trim()) return true
          const q = search.toLowerCase()
          return (
            (f.runner_note ?? '').toLowerCase().includes(q) ||
            (f.source_label ?? '').toLowerCase().includes(q) ||
            (f.acknowledged_note ?? '').toLowerCase().includes(q) ||
            (f.resolved_note ?? '').toLowerCase().includes(q) ||
            (f.resolved_vendor ?? '').toLowerCase().includes(q)
          )
        })
        return filtered.length === 0 ? (
          <div style={{ fontSize: 11, color: '#4a4f64', fontFamily: 'DM Mono', padding: '24px 0' }}>No flags found.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filtered.map(flag => {
            const statusDotColor = flag.status === 'pending' ? '#EF4444' : flag.status === 'acknowledged' ? '#F97316' : '#14B8A6'
            const studioColor = STUDIO_COLORS[flag.studio] ?? '#8b90a8'
            const catConf = flag.category ? CATEGORY_CONFIG[flag.category] : null
            return (
              <div
                key={flag.id}
                onClick={() => handleOpenFlag(flag)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0',
                  borderBottom: '1px solid #2a2e3d', cursor: 'pointer',
                }}
              >
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: statusDotColor, flexShrink: 0 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: studioColor, background: `${studioColor}18`, borderRadius: 4, padding: '2px 6px',
                  }}>
                    {flag.studio}
                  </span>
                  {catConf && (
                    <span style={{
                      fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                      color: catConf.color, background: catConf.bg, borderRadius: 4, padding: '2px 6px',
                    }}>
                      {catConf.label}
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#e8eaf2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {flag.runner_note || '—'}
                  </div>
                  {flag.source_label && (
                    <div style={{ fontSize: 10, color: '#4a4f64', fontFamily: 'DM Mono', marginTop: 2 }}>
                      {flag.source_label}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: '#4a4f64', fontFamily: 'DM Mono', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {new Date(flag.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>
            )
            })}
          </div>
        )
      })()}

      {/* Detail modal */}
      {selectedFlag && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setSelectedFlag(null); setConfirmDeleteFlag(false) } }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 480, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Modal header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              {(() => {
                const STUDIO_COLORS: Record<string, string> = {
                  paramount: '#c8f04e',
                  ameraycan: '#f04e7a',
                  encore: '#4e8ff0',
                  track: '#F97316',
                }
                return (
                  <>
                    {/* Row 1: status badge + resolve + × */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <StatusBadge status={selectedFlag.status} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {selectedFlag.status === 'acknowledged' && (
                          <button
                            onClick={() => setShowResolveModal(true)}
                            disabled={flagSubmitting}
                            style={{ fontSize: 10, fontFamily: 'DM Mono', background: 'transparent', color: '#14B8A6', border: '1px solid #14B8A6', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}
                          >
                            {flagSubmitting ? 'Saving…' : 'Resolve'}
                          </button>
                        )}
                        <button
                          onClick={() => { setSelectedFlag(null); setConfirmDeleteFlag(false) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1, padding: 0 }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {/* Row 2: studio name · category */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'Syne', textTransform: 'uppercase', color: STUDIO_COLORS[selectedFlag.studio] ?? 'var(--text)' }}>
                        {selectedFlag.studio.charAt(0).toUpperCase() + selectedFlag.studio.slice(1)}
                      </span>
                      {selectedFlag.category && (() => {
                        const catConf = CATEGORY_CONFIG[selectedFlag.category]
                        return catConf ? (
                          <>
                            <span style={{ color: 'var(--text3)', fontSize: 11 }}>·</span>
                            <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
                              {catConf.label}
                            </span>
                          </>
                        ) : null
                      })()}
                    </div>
                    {/* Row 3: source label */}
                    {selectedFlag.source_label && (
                      <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', marginTop: 2, opacity: 0.6 }}>
                        {selectedFlag.source_label}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Runner note — read only */}
              {selectedFlag.runner_note && (
                <div>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                    Runner Note
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                    {selectedFlag.runner_note}
                  </div>
                </div>
              )}

              {/* Category picker — pill buttons for pending/no category; dropdown for acknowledged */}
              {selectedFlag.category === null && selectedFlag.status === 'pending' && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                    Category
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['facility_general', 'gear_equipment', 'client_billing'] as const).map(catKey => {
                      const catConf = CATEGORY_CONFIG[catKey]
                      const isSelected = pendingCategory === catKey
                      return (
                        <button
                          key={catKey}
                          onClick={() => setPendingCategory(catKey)}
                          style={{
                            flex: 1, padding: '5px 4px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700,
                            letterSpacing: '0.04em', textTransform: 'uppercase',
                            color: isSelected ? '#0d0f14' : 'var(--text3)',
                            background: isSelected ? '#c8f04e' : 'transparent',
                            border: isSelected ? '1px solid #c8f04e' : '1px solid var(--border)',
                            borderRadius: 6, cursor: 'pointer',
                          }}
                        >
                          {catConf.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {selectedFlag.status === 'acknowledged' && (
                <select
                  value={pendingCategory ?? selectedFlag.category ?? ''}
                  onChange={e => setPendingCategory(e.target.value as 'facility_general' | 'gear_equipment' | 'client_billing')}
                  style={{ width: '100%', padding: '7px 8px', fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono', outline: 'none', marginBottom: 8 }}
                >
                  <option value="facility_general">Facility / General</option>
                  <option value="gear_equipment">Gear / Equipment</option>
                  <option value="client_billing">Client / Billing</option>
                </select>
              )}

              {/* Acknowledged box — shown whenever acknowledged_at is set, including after resolve */}
              {selectedFlag.acknowledged_at && (
                <div style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#F97316', marginBottom: 4 }}>
                    Acknowledged
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono' }}>
                    {selectedFlag.acknowledged_by}
                    {selectedFlag.acknowledged_at && ` · ${new Date(selectedFlag.acknowledged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                  {selectedFlag.acknowledged_note && (
                    <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 6, lineHeight: 1.5 }}>
                      {selectedFlag.acknowledged_note}
                    </div>
                  )}
                </div>
              )}

              {/* Resolved box */}
              {selectedFlag.resolved_at && (
                <div style={{ background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#14B8A6', marginBottom: 4 }}>
                    Resolved
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono' }}>
                    {selectedFlag.resolved_by}
                    {selectedFlag.resolved_at && ` · ${new Date(selectedFlag.resolved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                  {selectedFlag.resolved_note && (
                    <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 6, lineHeight: 1.5 }}>
                      {selectedFlag.resolved_note}
                    </div>
                  )}
                  {selectedFlag.resolved_vendor && (
                    <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', marginTop: 4 }}>
                      Vendor: {selectedFlag.resolved_vendor}
                    </div>
                  )}
                  {selectedFlag.resolved_cost != null && (
                    <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', marginTop: 2 }}>
                      Cost: ${selectedFlag.resolved_cost}
                    </div>
                  )}
                </div>
              )}

              {/* Comment thread */}
              {flagComments.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>No updates yet</div>
              ) : (
                flagComments.map(c => (
                  <div key={c.id} style={{ marginBottom: 2 }}>
                    {c.text && (
                      <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{c.text}</div>
                    )}
                    {c.photo_url && (
                      <img
                        src={c.photo_url}
                        alt=""
                        style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: c.text ? 6 : 0 }}
                      />
                    )}
                    <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4, fontFamily: 'DM Mono' }}>
                      {c.created_by_name && `${c.created_by_name} · `}{fmtTime(c.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--border)' }} />

            {/* Input area */}
            <div style={{ padding: '12px 20px' }}>
              <textarea
                value={flagCommentText}
                onChange={e => setFlagCommentText(e.target.value)}
                placeholder="Add a note…"
                rows={2}
                style={{
                  width: '100%', padding: '8px', fontSize: 11,
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                  outline: 'none', resize: 'none', boxSizing: 'border-box',
                }}
              />
              <label style={{ display: 'inline-block', fontSize: 10, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Mono', marginTop: 6, marginBottom: 8 }}>
                {flagCommentPhoto ? flagCommentPhoto.name : '+ Attach photo'}
                <input
                  ref={flagCommentPhotoRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => setFlagCommentPhoto(e.target.files?.[0] ?? null)}
                />
              </label>

              {/* Action buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                {/* Delete flow — left side */}
                {confirmDeleteFlag ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono' }}>Confirm delete?</span>
                    <button
                      onClick={handleDeleteFlag}
                      style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'DM Mono', background: '#EF4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteFlag(false)}
                      style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'DM Mono', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteFlag(true)}
                    style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'DM Mono', background: 'transparent', color: '#EF4444', border: '1px solid #EF4444', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                )}
                {/* Right side: Acknowledge or Save */}
                <div style={{ display: 'flex', gap: 8 }}>
                  {selectedFlag.status === 'pending' && (() => {
                    const canAck = selectedFlag.category !== null || pendingCategory !== null
                    return (
                      <button
                        onClick={handleAcknowledgeFlag}
                        disabled={flagSubmitting || !canAck}
                        style={{
                          padding: '8px 16px', fontSize: 11, fontFamily: 'DM Mono',
                          background: canAck ? '#c8f04e' : 'var(--surface2)',
                          color: canAck ? '#0d0f14' : 'var(--text3)',
                          border: 'none', borderRadius: 6,
                          cursor: canAck ? 'pointer' : 'default',
                          fontWeight: 600,
                        }}
                      >
                        {flagSubmitting ? 'Saving…' : 'Acknowledge'}
                      </button>
                    )
                  })()}
                  {selectedFlag.status === 'acknowledged' && (
                    <button
                      onClick={handleSaveFlag}
                      disabled={flagSubmitting}
                      style={{
                        padding: '8px 16px', fontSize: 11, fontFamily: 'DM Mono',
                        background: '#c8f04e',
                        color: '#0d0f14',
                        border: 'none', borderRadius: 6,
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {flagSubmitting ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* RESOLVE MODAL */}
      {showResolveModal && selectedFlag && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowResolveModal(false) }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 420, margin: '0 20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>Resolve Flag</span>
              <button
                onClick={() => setShowResolveModal(false)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Resolution Notes <span style={{ color: '#EF4444' }}>*</span>
                </div>
                <textarea
                  value={resolveNote}
                  onChange={e => setResolveNote(e.target.value)}
                  placeholder="Describe what was done…"
                  rows={3}
                  style={{
                    width: '100%', padding: '8px', fontSize: 11,
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                    outline: 'none', resize: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Vendor / Person
                </div>
                <input
                  type="text"
                  value={resolveVendor}
                  onChange={e => setResolveVendor(e.target.value)}
                  placeholder="Vendor or person who fixed it…"
                  style={{
                    width: '100%', padding: '8px', fontSize: 11,
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                  Cost
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'DM Mono' }}>$</span>
                  <input
                    type="number"
                    value={resolveCost}
                    onChange={e => setResolveCost(e.target.value)}
                    placeholder="0.00"
                    style={{
                      flex: 1, padding: '8px', fontSize: 11,
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => setShowResolveModal(false)}
                  style={{
                    flex: 1, padding: '9px', fontSize: 11, fontFamily: 'DM Mono',
                    background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 6, cursor: 'pointer', color: 'var(--text2)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleResolveFlag}
                  disabled={flagSubmitting || !resolveNote.trim()}
                  style={{
                    flex: 1, padding: '9px', fontSize: 11, fontFamily: 'DM Mono',
                    background: resolveNote.trim() ? '#c8f04e' : 'var(--surface2)',
                    color: resolveNote.trim() ? '#0d0f14' : 'var(--text3)',
                    border: 'none', borderRadius: 6,
                    cursor: resolveNote.trim() ? 'pointer' : 'default',
                    fontWeight: 600,
                  }}
                >
                  {flagSubmitting ? 'Saving…' : 'Confirm Resolve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
