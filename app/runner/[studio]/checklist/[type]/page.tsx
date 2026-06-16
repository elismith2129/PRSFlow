'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { CHECKLISTS, flattenSections, type ChecklistSection } from '@/lib/checklist-items'

const STUDIO_META: Record<string, { label: string; color: string }> = {
  paramount: { label: 'Paramount', color: '#c8f04e' },
  ameraycan: { label: 'Ameraycan', color: '#EF4444' },
  encore:    { label: 'Encore',    color: '#4e8ff0' },
  track:     { label: 'Track',     color: '#F97316' },
}

export default function ChecklistPage() {
  const router     = useRouter()
  const { studio, type } = useParams<{ studio: string; type: string }>()
  const meta       = STUDIO_META[studio] ?? { label: studio, color: '#c8f04e' }
  const isOpening  = type === 'opening'
  const today      = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) })()

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

  const completedCount = Object.values(checked).filter(Boolean).length

  // ── Load existing data on mount ──────────────────────────────────────────────
  useEffect(() => {
    async function loadExisting() {
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
    }
    loadExisting()
  }, [studio, type, today])

  // ── Attention content sync — fires after runner edits notes or photos ────────
  // Auto-derives needs_attention from content; no manual toggle needed.
  useEffect(() => {
    if (!attentionChangedRef.current) return
    const hasAttention = notes.trim().length > 0 || photos.length > 0
    const timer = setTimeout(async () => {
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
    }, 600)
    return () => clearTimeout(timer)
  }, [notes, photos]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle item — saves immediately ─────────────────────────────────────────
  async function toggle(item: string) {
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
        const { data: { publicUrl } } = supabase.storage.from('checklist-photos').getPublicUrl(data.path)
        urls.push(publicUrl)
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
          status: 'pending',
        }).eq('id', existingFlag.id)
      } else {
        await supabase.from('flags').insert({
          studio,
          source: 'runner_flag',
          source_id: clIdRef.current,
          source_label: `${meta.label} · ${type === 'opening' ? 'Opening' : 'Closing'} Checklist`,
          runner_note: notes.trim() || null,
          status: 'pending',
        })
      }
    }

    setSubmitting(false)
    router.push(`/runner/${studio}`)
  }

  if (pageLoading) return (
    <div style={{ minHeight: '100dvh', background: '#0d0f14', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Syne, sans-serif', color: '#8b90a8' }}>
      Loading…
    </div>
  )

  return (
    <div style={{ minHeight: '100dvh', background: '#0d0f14', fontFamily: 'Syne, sans-serif', paddingBottom: 120 }}>

      {/* Sticky header */}
      <div style={{ background: '#161920', borderBottom: `3px solid ${meta.color}`, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.push(`/runner/${studio}`)} style={{ background: 'none', border: 'none', color: '#8b90a8', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#e8eaf2' }}>{isOpening ? 'Opening' : 'Closing'} Checklist</span>
            {isSubmitted && <span style={{ fontSize: 10, color: '#14B8A6', fontFamily: 'DM Mono, monospace' }}>● submitted</span>}
          </div>
          <div style={{ fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>{meta.label} · {completedCount}/{allItems.length} checked</div>
        </div>
        <div style={{ width: 60, height: 4, background: '#2a2e3d', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${allItems.length > 0 ? (completedCount / allItems.length) * 100 : 0}%`, background: meta.color, transition: 'width 0.2s' }} />
        </div>
      </div>

      <div style={{ padding: '16px' }}>

        <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace', lineHeight: 1.5 }}>
          Tap items as you complete them — saves instantly. Only check what&apos;s done.
        </div>

        {sections.map(sec => (
          <div key={sec.section} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8b90a8', fontFamily: 'DM Mono, monospace', marginBottom: 8, paddingLeft: 4 }}>
              {sec.section}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {sec.items.map(item => {
                const on = checked[item] ?? false
                return (
                  <button key={item} onClick={() => toggle(item)} style={{
                    background: on ? meta.color + '15' : '#161920',
                    border: `1px solid ${on ? meta.color + '55' : '#2a2e3d'}`,
                    borderRadius: 10, padding: '11px 14px', cursor: 'pointer',
                    display: 'flex', alignItems: 'flex-start', gap: 12, textAlign: 'left',
                    transition: 'all 0.12s',
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1,
                      background: on ? meta.color : '#2a2e3d',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, color: '#0d0f14', fontWeight: 700,
                      transition: 'background 0.12s',
                    }}>
                      {on ? '✓' : ''}
                    </div>
                    <span style={{ fontSize: 13, color: on ? '#e8eaf2' : '#8b90a8', lineHeight: 1.45, textDecoration: on ? 'line-through' : 'none', flex: 1 }}>
                      {item}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* Needs Attention */}
        <div style={{ background: '#161920', border: `1px solid ${(notes.trim() || photos.length > 0) ? '#f9731640' : '#2a2e3d'}`, borderRadius: 12, padding: '16px', marginTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: (notes.trim() || photos.length > 0) ? '#f97316' : '#8b90a8', marginBottom: 14 }}>
            Needs Attention / Runner Notes
          </div>

          {(notes.trim() || photos.length > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f9731615', border: '1px solid #f9731640', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
              <span style={{ fontSize: 14, color: '#f97316', flexShrink: 0 }}>⚠</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f97316', fontFamily: 'Syne, sans-serif' }}>Flagged for management attention</div>
                <div style={{ fontSize: 10, color: '#8b90a8', fontFamily: 'DM Mono, monospace', marginTop: 2 }}>Management will be notified when you submit</div>
              </div>
            </div>
          )}

          <textarea
            placeholder="Notes / Issues / Incomplete items — anything you couldn't complete, found damaged, or needs attention..."
            value={notes}
            onChange={e => { attentionChangedRef.current = true; setNotes(e.target.value) }}
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#0d0f14', border: '1px solid #2a2e3d', borderRadius: 10,
              padding: '12px 14px', color: '#e8eaf2', fontSize: 13,
              fontFamily: 'DM Mono, monospace', outline: 'none', resize: 'vertical',
              lineHeight: 1.5, marginBottom: 12,
            }}
          />

          <input ref={fileRef} type="file" accept="image/*" multiple onChange={handlePhotoSelect} style={{ display: 'none' }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              background: '#2a2e3d', border: '1px solid #3a3e4d', borderRadius: 8,
              padding: '10px 16px', color: '#e8eaf2', fontSize: 12, fontWeight: 600,
              cursor: uploading ? 'not-allowed' : 'pointer', fontFamily: 'Syne, sans-serif',
              opacity: uploading ? 0.7 : 1,
            }}
          >
            {uploading ? 'Uploading…' : '+ Add photos'}
          </button>

          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {photos.map((url, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #2a2e3d' }} />
                  <button
                    onClick={() => { attentionChangedRef.current = true; setPhotos(prev => prev.filter((_, j) => j !== i)) }}
                    style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, background: '#EF4444', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fixed footer — submitted state shows back button, not Submit */}
      {isSubmitted ? (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: '#0d0f14', borderTop: '1px solid #2a2e3d', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ textAlign: 'center', fontSize: 12, color: '#14B8A6', fontFamily: 'DM Mono, monospace' }}>
            ✓ Shift complete · {completedCount}/{allItems.length} checked
          </div>
          <button
            onClick={() => router.push(`/runner/${studio}`)}
            style={{ width: '100%', padding: '14px 0', background: '#161920', color: '#e8eaf2', border: '1px solid #2a2e3d', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
          >
            Back to {meta.label}
          </button>
        </div>
      ) : (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0d0f14', borderTop: '1px solid #2a2e3d', padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <input
              value={staffName}
              onChange={e => { setStaffName(e.target.value.toUpperCase()); if (e.target.value.trim()) setShowInitialsHint(false) }}
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
            onClick={() => { if (!staffName.trim()) { setShowInitialsHint(true); return } handleSubmit() }}
            disabled={submitting}
            style={{ flex: 1, padding: '12px', background: staffName.trim() ? meta.color : '#1e2130', border: 'none', borderRadius: 12, color: staffName.trim() ? '#0d0f14' : '#4b5563', fontSize: 13, fontWeight: 800, cursor: staffName.trim() ? 'pointer' : 'default', fontFamily: 'Syne, sans-serif' }}
          >
            {submitting ? 'Submitting…' : `Submit ${isOpening ? 'Opening' : 'Closing'} Checklist`}
          </button>
        </div>
      )}
    </div>
  )
}
