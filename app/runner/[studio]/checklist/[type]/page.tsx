'use client'
// SOFT SKIN PORT, 2026-08-14 (one-pass runner redesign). Everything above the
// render — loads, the clIdRef/creatingRef instant-save pattern, the dirtyRef
// realtime guard, attention sync, flag raising — is UNTOUCHED byte-for-byte.
// Old skin retired (legacy tokens, 1px borders, Syne, lime literals). Colour is
// status only (§5): checked = booked green, attention = warm.
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { CHECKLISTS, flattenSections, type ChecklistSection } from '@/lib/checklist-items'
import { SignedImage } from '@/components/shared/SignedImage'
import { useUserProfile } from '@/hooks/useUserProfile'
import { profileInitials } from '@/lib/format'
import { opsToday } from '@/lib/time'

const STUDIO_META: Record<string, { label: string }> = {
  paramount: { label: 'Paramount' },
  ameraycan: { label: 'Ameraycan' },
  encore:    { label: 'Encore' },
  track:     { label: 'Track' },
}

export default function ChecklistPage() {
  const router     = useRouter()
  const { studio, type } = useParams<{ studio: string; type: string }>()
  const meta       = STUDIO_META[studio] ?? { label: studio }
  const isOpening  = type === 'opening'
  // Operational day (8:50 AM roll, 2026-08-28) — a closing checklist finished
  // at 1 AM files under the night it closes, and doesn't block the NEXT
  // night's checklist as "already submitted".
  const today      = opsToday()

  const sections: ChecklistSection[] = CHECKLISTS[studio]?.[type as 'opening' | 'closing'] ?? CHECKLISTS.paramount[type as 'opening' | 'closing']
  const allItems = flattenSections(sections)

  // Refs to avoid stale closures in async saves
  const clIdRef           = useRef<string | null>(null)
  const creatingRef       = useRef(false)
  const checkedRef        = useRef<Record<string, boolean>>({})
  const attentionChangedRef = useRef(false)

  const [checked, setChecked]   = useState<Record<string, boolean>>({})
  const [staffName, setStaffName] = useState('')
  const [notes, setNotes]       = useState('')
  const [photos, setPhotos]     = useState<string[]>([])
  const [uploading, setUploading]           = useState(false)
  const [submitting, setSubmitting]         = useState(false)
  const [isSubmitted, setIsSubmitted]       = useState(false)
  const [pageLoading, setPageLoading]       = useState(true)
  const [showInitialsHint, setShowInitialsHint] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { profile } = useUserProfile()

  // Runners have their own logins now (Eli, 2026-08-25) — initials come from
  // the profile, nobody types them. The input stays as a fallback for the
  // shared runner account (no person behind it) and never blocks a loaded
  // value: an existing row's staff_name always wins.
  useEffect(() => {
    if (!staffName && profile && profile.email !== 'runner@paramountrecording.com') {
      const derived = profile.initials || profileInitials(profile.display_name)
      if (derived) setStaffName(derived)
    }
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps
  // True once the runner interacts; blocks the realtime refetch so a live update never
  // clobbers an in-progress note/photo/toggle. Reset to false whenever we load fresh data.
  const dirtyRef = useRef(false)

  const completedCount = Object.values(checked).filter(Boolean).length

  // ── Load existing data on mount ──────────────────────────────────────────────
  const loadExisting = useCallback(async () => {
    const [{ data: clData }, { data: subData }] = await Promise.all([
      supabase.from('checklists').select('*')
        .eq('studio', studio).eq('type', type).eq('date', today)
        .maybeSingle(),
      supabase.from('daily_ops_submissions').select('*')
        .eq('studio', studio).eq('date', today).eq('category', `${type}_checklist`)
        .maybeSingle(),
    ])
    if (clData) {
      clIdRef.current = clData.id
      const checkedMap: Record<string, boolean> = {}
      for (const row of clData.items ?? []) checkedMap[row.item] = row.checked
      checkedRef.current = checkedMap
      setChecked(checkedMap)
      setNotes(clData.needs_attention_notes ?? clData.notes ?? '')
      setPhotos(clData.needs_attention_photos ?? clData.photo_urls ?? [])
      if (clData.staff_name) setStaffName(clData.staff_name)
    }
    if (subData?.submitted_at) setIsSubmitted(true)
    if (!clData && subData?.staff_name) setStaffName(subData.staff_name)
    setPageLoading(false)
    dirtyRef.current = false
  }, [studio, type, today])

  useEffect(() => { loadExisting() }, [loadExisting])

  // Real-time: another device's checklist changes refetch live when clean; skipped
  // while this runner is mid-edit so their local toggles/notes are never clobbered.
  useEffect(() => {
    const channel = supabase
      .channel(`runner-checklist-${studio}-${type}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklists' }, () => { if (!dirtyRef.current) loadExisting() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_ops_submissions' }, () => { if (!dirtyRef.current) loadExisting() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studio, type, loadExisting])

  // ── Attention content sync — fires after runner edits notes or photos ────────
  // Auto-derives needs_attention from content; no manual toggle needed.
  // pendingAttentionRef holds the not-yet-fired write so leaving the page
  // inside the 600ms debounce window flushes it instead of dropping it
  // (Eli 2026-08-24: "I don't want their input to get wiped").
  const pendingAttentionRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!attentionChangedRef.current) return
    const hasAttention = notes.trim().length > 0 || photos.length > 0
    const write = async () => {
      pendingAttentionRef.current = null
      if (clIdRef.current) {
        await supabase.from('checklists').update({
          notes: notes.trim() || null,
          needs_attention_notes: notes.trim() || null,
          needs_attention_photos: photos.length > 0 ? photos : null,
          needs_attention: hasAttention,
        }).eq('id', clIdRef.current)
      }
      await supabase.from('daily_ops_submissions').upsert({
        studio, date: today, category: `${type}_checklist`,
        needs_attention: hasAttention,
        attention_notes: notes.trim() || null,
        photo_urls: photos.length > 0 ? photos : null,
      }, { onConflict: 'studio,date,category' })
    }
    pendingAttentionRef.current = write
    const timer = setTimeout(write, 600)
    return () => clearTimeout(timer)
  }, [notes, photos]) // eslint-disable-line react-hooks/exhaustive-deps

  // Unmount flush: fire whatever the debounce hadn't written yet. Fire-and-
  // forget — the component is gone, but the supabase call still completes.
  useEffect(() => () => { pendingAttentionRef.current?.() }, [])

  // ── Toggle item — saves immediately ─────────────────────────────────────────
  async function toggle(item: string) {
    dirtyRef.current = true
    const newChecked = { ...checkedRef.current, [item]: !checkedRef.current[item] }
    checkedRef.current = newChecked
    setChecked({ ...newChecked })

    const itemsPayload = allItems.map(i => ({ item: i, checked: newChecked[i] ?? false }))

    if (!clIdRef.current) {
      if (creatingRef.current) return
      creatingRef.current = true
      const { data } = await supabase.from('checklists').insert({
        studio, type, date: today,
        items: itemsPayload,
        needs_attention: false,
      }).select('id').single()
      if (data) clIdRef.current = data.id
      creatingRef.current = false
    } else {
      await supabase.from('checklists')
        .update({ items: itemsPayload })
        .eq('id', clIdRef.current)
    }
  }

  // ── Photo upload ──────────────────────────────────────────────────────────────
  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    const urls: string[] = []
    for (const file of Array.from(files)) {
      const path = `${studio}/${today}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
      const { data, error } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
      if (data && !error) {
        // Store the storage PATH — checklist-photos is private; reads sign on demand.
        urls.push(data.path)
      }
    }
    attentionChangedRef.current = true
    setPhotos(prev => [...prev, ...urls])
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSave() {
    const clId = clIdRef.current
    if (!clId) return
    await supabase.from('checklists').update({
      items: allItems.map(i => ({ item: i, checked: checked[i] ?? false })),
      notes,
      photo_urls: photos,
    }).eq('id', clId)
    router.push(`/runner/${studio}`)
  }

  // ── Submit — marks shift complete, form stays editable ──────────────────────
  async function handleSubmit() {
    if (!staffName.trim()) { setShowInitialsHint(true); return }
    setSubmitting(true)
    const now = new Date().toISOString()
    const itemsPayload = allItems.map(i => ({ item: i, checked: checkedRef.current[i] ?? false }))
    const hasAttention = notes.trim().length > 0 || photos.length > 0

    if (clIdRef.current) {
      await supabase.from('checklists').update({
        items: itemsPayload, staff_name: staffName.trim(), completed_at: now,
        notes: notes.trim() || null,
        photo_urls: photos.length > 0 ? photos : null,
        needs_attention: hasAttention,
        needs_attention_notes: notes.trim() || null,
        needs_attention_photos: photos.length > 0 ? photos : null,
      }).eq('id', clIdRef.current)
    } else {
      const { data } = await supabase.from('checklists').insert({
        studio, type, date: today, staff_name: staffName.trim(),
        items: itemsPayload, completed_at: now,
        notes: notes.trim() || null,
        photo_urls: photos.length > 0 ? photos : null,
        needs_attention: hasAttention,
        needs_attention_notes: notes.trim() || null,
        needs_attention_photos: photos.length > 0 ? photos : null,
      }).select('id').single()
      if (data) clIdRef.current = data.id
    }
    await supabase.from('daily_ops_submissions').upsert({
      studio, date: today, category: `${type}_checklist`,
      staff_name: staffName.trim(), submitted_at: now,
      notes: notes.trim() || null,
    }, { onConflict: 'studio,date,category' })

    if (hasAttention && clIdRef.current) {
      const { data: existingFlag } = await supabase
        .from('flags')
        .select('id')
        .eq('source_id', clIdRef.current)
        .maybeSingle()
      if (existingFlag) {
        await supabase.from('flags').update({
          runner_note: notes.trim() || null,
          photo_url: photos.length > 0 ? photos[0] : null,
          status: 'pending',
          // Re-stamp on resubmit — the initials on the flag should be whoever
          // last stood behind it (2026-09-01, flag names).
          created_by_name: staffName.trim() || null,
        }).eq('id', existingFlag.id)
      } else {
        await supabase.from('flags').insert({
          studio,
          source: 'runner_flag',
          source_id: clIdRef.current,
          source_label: `${meta.label} · ${type === 'opening' ? 'Opening' : 'Closing'} Checklist`,
          runner_note: notes.trim() || null,
          photo_url: photos.length > 0 ? photos[0] : null,
          status: 'pending',
          // The checklist's typed initials — the shared runner login means the
          // profile isn't the person; the initials are (2026-09-01).
          created_by_name: staffName.trim() || null,
        })
      }
    }

    setSubmitting(false)
    router.push(`/runner/${studio}`)
  }

  // ── Presentation (soft skin) ──────────────────────────────────────────────────
  const surface: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))',
    boxShadow: 'var(--c-softsh)',
    borderRadius: 16,
    padding: '13px 14px',
  }
  const hasAttentionNow = notes.trim().length > 0 || photos.length > 0

  if (pageLoading) return (
    <div style={{ minHeight: '100dvh', background: 'var(--c-bg)', color: 'var(--c-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 13 }}>
      Loading…
    </div>
  )

  return (
    <div style={{
      minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden',
      background: 'var(--c-bg)', color: 'var(--c-fg)', paddingBottom: 130,
    }} onChangeCapture={() => { dirtyRef.current = true }}>

      {/* Sticky header */}
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="c-arch" style={{ fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {isOpening ? 'Opening' : 'Closing'}
            </span>
            {isSubmitted && <span style={{ fontSize: 10.5, color: 'var(--c-st-booked)', fontWeight: 700 }}>Submitted</span>}
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.5 }}>{meta.label} · {completedCount}/{allItems.length} checked</div>
        </div>
        <div style={{ width: 56, height: 5, background: 'var(--c-wash)', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
          <div style={{
            height: '100%', borderRadius: 99,
            width: `${allItems.length > 0 ? (completedCount / allItems.length) * 100 : 0}%`,
            background: 'var(--c-st-booked)', transition: 'width 0.2s',
          }} />
        </div>
      </div>

      <div style={{ padding: '4px 14px' }}>

        <div style={{ fontSize: 11, opacity: 0.45, lineHeight: 1.5, margin: '0 2px 14px' }}>
          Tap items as you complete them — saves instantly. Only check what&apos;s done.
        </div>

        {sections.map(sec => (
          <div key={sec.section} style={{ marginBottom: 16 }}>
            <div className="c-label" style={{ marginBottom: 7, paddingLeft: 2 }}>
              {sec.section}
            </div>
            <div style={{ ...surface, padding: '4px 12px' }}>
              {sec.items.map((item, i) => {
                const on = checked[item] ?? false
                return (
                  <button key={item} onClick={() => toggle(item)} style={{
                    width: '100%', background: 'transparent', border: 'none', font: 'inherit',
                    color: 'var(--c-fg)', padding: '10px 0', cursor: 'pointer',
                    display: 'flex', alignItems: 'flex-start', gap: 11, textAlign: 'left',
                    boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
                    WebkitTapHighlightColor: 'transparent', minHeight: 44,
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: 99, flexShrink: 0, marginTop: 1,
                      background: on ? 'var(--c-st-booked)' : 'var(--c-wash2)',
                      color: on ? 'var(--c-chip-ink)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, transition: 'background 0.12s',
                    }}>
                      ✓
                    </div>
                    <span style={{
                      fontSize: 13, lineHeight: 1.45, flex: 1,
                      opacity: on ? 0.45 : 1,
                      textDecoration: on ? 'line-through' : 'none',
                    }}>
                      {item}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* Needs Attention */}
        <div style={{ ...surface, marginTop: 4 }}>
          <div className="c-label" style={{
            marginBottom: 12,
            color: hasAttentionNow ? 'var(--c-st-warm)' : undefined,
            opacity: hasAttentionNow ? 1 : undefined,
          }}>
            Needs attention / runner notes
          </div>

          {hasAttentionNow && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--c-wash)', borderRadius: 12, padding: '10px 13px', marginBottom: 12,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--c-st-warm)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-st-warm)' }}>Flagged for management attention</div>
                <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 1 }}>Management will be notified when you submit</div>
              </div>
            </div>
          )}

          <textarea
            placeholder="Notes / issues / incomplete items — anything you couldn't complete, found damaged, or needs attention…"
            value={notes}
            onChange={e => { attentionChangedRef.current = true; setNotes(e.target.value) }}
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--c-wash)', border: 'none', borderRadius: 12,
              padding: '11px 13px', color: 'var(--c-fg)', fontSize: 13,
              font: 'inherit', outline: 'none', resize: 'vertical',
              lineHeight: 1.5, marginBottom: 11,
            }}
          />

          <input ref={fileRef} type="file" accept="image/*" multiple onChange={handlePhotoSelect} style={{ display: 'none' }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              background: 'var(--c-wash)', border: 'none', borderRadius: 99,
              padding: '9px 16px', minHeight: 40, color: 'var(--c-fg)',
              fontSize: 12, fontWeight: 700, font: 'inherit',
              cursor: uploading ? 'not-allowed' : 'pointer',
              opacity: uploading ? 0.6 : 1,
            }}
          >
            {uploading ? 'Uploading…' : '+ Add photos'}
          </button>

          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {photos.map((url, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <SignedImage path={url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10 }} />
                  <button
                    onClick={() => { dirtyRef.current = true; attentionChangedRef.current = true; setPhotos(prev => prev.filter((_, j) => j !== i)) }}
                    style={{
                      position: 'absolute', top: -5, right: -5, width: 19, height: 19, borderRadius: 99,
                      background: 'var(--c-st-hot)', border: 'none', color: 'var(--c-hot-text)',
                      fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontWeight: 700,
                    }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fixed footer — submitted state shows back button, not Submit */}
      {isSubmitted ? (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          padding: '12px 14px calc(16px + env(safe-area-inset-bottom))',
          background: 'linear-gradient(to top, var(--c-bg) 68%, transparent)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--c-st-booked)' }}>
            ✓ Shift complete · {completedCount}/{allItems.length} checked
          </div>
          <button
            onClick={() => router.push(`/runner/${studio}`)}
            className="c-control c-raised"
            style={{
              width: '100%', minHeight: 52, borderRadius: 14,
              background: 'var(--c-wash2)', color: 'var(--c-fg)',
              border: 'none', font: 'inherit', fontSize: 14, fontWeight: 800,
              cursor: 'pointer', boxShadow: 'var(--c-softsh)',
            }}
          >
            Back to {meta.label}
          </button>
        </div>
      ) : (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          padding: '12px 14px calc(16px + env(safe-area-inset-bottom))',
          background: 'linear-gradient(to top, var(--c-bg) 68%, transparent)',
          display: 'flex', gap: 9, alignItems: 'center',
        }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <input
              value={staffName}
              onChange={e => { setStaffName(e.target.value.toUpperCase()); if (e.target.value.trim()) setShowInitialsHint(false) }}
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
            onClick={() => { if (!staffName.trim()) { setShowInitialsHint(true); return } handleSubmit() }}
            disabled={submitting}
            className="c-control c-raised"
            style={{
              flex: 1, minHeight: 48, borderRadius: 14,
              background: 'var(--c-wash2)', color: 'var(--c-fg)',
              border: 'none', font: 'inherit', fontSize: 13, fontWeight: 800,
              cursor: staffName.trim() ? 'pointer' : 'default',
              opacity: staffName.trim() ? 1 : 0.55,
              boxShadow: 'var(--c-softsh)',
            }}
          >
            {submitting ? 'Submitting…' : `Submit ${isOpening ? 'opening' : 'closing'}`}
          </button>
        </div>
      )}
    </div>
  )
}
