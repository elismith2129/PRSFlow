'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams, useSearchParams } from 'next/navigation'

const STUDIO_META: Record<string, { label: string; abbr: string; color: string }> = {
  paramount: { label: 'Paramount', abbr: 'PRS', color: '#c8f04e' },
  ameraycan: { label: 'Ameraycan', abbr: 'ARS', color: '#f04e7a' },
  encore: { label: 'Encore', abbr: 'ERS', color: '#4e8ff0' },
  track: { label: 'Track', abbr: 'TRS', color: '#f0a24e' },
}

const EQUIPMENT = ['Speakers', 'Microphone', 'Console']

type EquipCond = Record<string, 'ok' | 'not_ok' | null>
type Expense = { id?: string; vendor: string; item: string; amount: string; receipt_url: string | null; uploading?: boolean }

export default function RunnerWOPage() {
  const router = useRouter()
  const { studio, id: woIdParam } = useParams<{ studio: string; id: string }>()
  const searchParams = useSearchParams()
  const bookingId = searchParams.get('booking_id')
  const meta = STUDIO_META[studio] ?? { label: studio, abbr: '?', color: '#c8f04e' }

  const woRef = useRef<string | null>(null)
  const [wo, setWo] = useState<any>(null)
  const [stRows, setStRows] = useState<any[]>([])
  const [equipConds, setEquipConds] = useState<EquipCond>({})
  const [equipRows, setEquipRows] = useState<any[]>([])
  const [sessionNotes, setSessionNotes] = useState('')
  const [needsAttentionNotes, setNeedsAttentionNotes] = useState('')
  const [needsAttentionPhotos, setNeedsAttentionPhotos] = useState<string[]>([])
  const [naUploading, setNaUploading] = useState(false)
  const naFileRef = useRef<HTMLInputElement>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [runnerFinished, setRunnerFinished] = useState(false)
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)

  useEffect(() => {
    async function init() {
      let resolvedId = woIdParam !== 'new' ? woIdParam : null

      if (!resolvedId && bookingId) {
        // Check for existing WO
        const { data: existing } = await supabase
          .from('work_orders')
          .select('*')
          .eq('booking_id', bookingId)
          .maybeSingle()

        if (existing) {
          resolvedId = existing.id
        } else {
          // Create new WO from booking
          const { data: booking } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', bookingId)
            .single()

          if (!booking) { setLoading(false); return }

          const { data: newWo } = await supabase
            .from('work_orders')
            .insert({
              booking_id: bookingId,
              session_date: booking.start_date,
              studios: booking.studio ? [booking.studio] : [],
              from_time: booking.from_time,
              to_time: booking.to_time,
              engineer: booking.engineer_name,
              client: booking.client_name,
              artist: booking.artist,
              payment_status: booking.payment_type,
              status: 'draft',
            })
            .select()
            .single()

          resolvedId = newWo?.id ?? null

          // Auto-generate equipment condition rows
          if (resolvedId && booking.start_date) {
            const eqInserts = EQUIPMENT.map(eq => ({
              work_order_id: resolvedId,
              equipment: eq,
              date: booking.start_date,
              condition: null,
            }))
            await supabase.from('equipment_condition_rows').insert(eqInserts)
          }
        }
      }

      if (!resolvedId) { setLoading(false); return }
      woRef.current = resolvedId

      const [{ data: woData }, { data: st }, { data: eq }, { data: exp }] = await Promise.all([
        supabase.from('work_orders').select('*').eq('id', resolvedId).single(),
        supabase.from('studio_time_rows').select('*').eq('work_order_id', resolvedId).order('sort_order'),
        supabase.from('equipment_condition_rows').select('*').eq('work_order_id', resolvedId),
        supabase.from('expense_rows').select('*').eq('work_order_id', resolvedId).order('created_at'),
      ])

      setWo(woData)
      setStRows(st ?? [])
      setEquipRows(eq ?? [])
      setSessionNotes(woData?.session_notes ?? '')
      setNeedsAttentionNotes(woData?.needs_attention_notes ?? '')
      setNeedsAttentionPhotos(woData?.needs_attention_photos ?? [])
      setRunnerFinished(
        woData?.runner_finished === true ||
        woData?.status === 'submitted' ||
        woData?.status === 'approved'
      )

      const conds: EquipCond = {}
      for (const r of eq ?? []) {
        conds[`${r.equipment}||${r.date}`] = r.condition
      }
      setEquipConds(conds)

      setExpenses((exp ?? []).map((e: any) => ({
        id: e.id,
        vendor: e.vendor ?? '',
        item: e.item ?? '',
        amount: e.amount != null ? String(e.amount) : '',
        receipt_url: e.receipt_url,
      })))

      setLoading(false)
    }
    init()
  }, [woIdParam, bookingId])

  async function toggleEquip(eq: string, date: string, val: 'ok' | 'not_ok') {
    const key = `${eq}||${date}`
    const newVal = equipConds[key] === val ? null : val
    setEquipConds(prev => ({ ...prev, [key]: newVal }))

    const row = equipRows.find((r: any) => r.equipment === eq && r.date === date)
    if (row) {
      await supabase.from('equipment_condition_rows').update({ condition: newVal }).eq('id', row.id)
    }
  }

  async function addExpense() {
    setExpenses(prev => [...prev, { vendor: '', item: '', amount: '', receipt_url: null }])
  }

  async function uploadReceipt(idx: number, file: File) {
    setExpenses(prev => prev.map((e, i) => i === idx ? { ...e, uploading: true } : e))

    // Run OCR in parallel with upload
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const mediaType = file.type || 'image/jpeg'

    const [uploadResult, ocrResult] = await Promise.allSettled([
      (async () => {
        const ext = file.name.split('.').pop()
        const path = `receipts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
        const { data, error } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
        if (error || !data) return null
        const { data: { publicUrl } } = supabase.storage.from('checklist-photos').getPublicUrl(data.path)
        return publicUrl ?? null
      })(),
      fetch('/api/ocr-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64, media_type: mediaType }),
      }).then(r => r.json()).catch(() => null),
    ])

    const url = uploadResult.status === 'fulfilled' ? uploadResult.value : null
    const ocr = ocrResult.status === 'fulfilled' ? ocrResult.value : null

    setExpenses(prev => prev.map((e, i) => {
      if (i !== idx) return e
      return {
        ...e,
        receipt_url: url,
        uploading: false,
        vendor: e.vendor || ocr?.vendor || e.vendor,
        item: e.item || ocr?.item || e.item,
        amount: e.amount || ocr?.amount || e.amount,
      }
    }))
  }

  async function saveExpenses() {
    if (!woRef.current) return
    for (const exp of expenses) {
      const amt = parseFloat(exp.amount) || null
      if (exp.id) {
        await supabase.from('expense_rows').update({
          vendor: exp.vendor, item: exp.item, amount: amt, receipt_url: exp.receipt_url,
        }).eq('id', exp.id)
      } else if (exp.vendor || exp.item || amt) {
        const { data: inserted } = await supabase.from('expense_rows').insert({
          work_order_id: woRef.current,
          vendor: exp.vendor, item: exp.item, amount: amt,
          receipt_url: exp.receipt_url, submitted_by: 'runner',
        }).select('id').single()
        if (inserted) {
          setExpenses(prev => prev.map((e, i) => expenses.indexOf(exp) === i ? { ...e, id: inserted.id } : e))
        }
      }
    }
  }

  async function uploadNAPhoto(file: File) {
    if (!woRef.current) return
    setNaUploading(true)
    const ext = file.name.split('.').pop()
    const path = `na-photos/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

    const { data, error: uploadError } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
    console.log('[NA photo] storage upload:', { data, error: uploadError })

    if (!uploadError && data) {
      const { data: { publicUrl } } = supabase.storage.from('checklist-photos').getPublicUrl(data.path)
      console.log('[NA photo] publicUrl:', publicUrl)

      if (publicUrl) {
        let updated: string[] = []
        setNeedsAttentionPhotos(prev => { updated = [...prev, publicUrl]; return updated })
        const { error: dbError } = await supabase.from('work_orders')
          .update({ needs_attention_photos: updated })
          .eq('id', woRef.current)
        console.log('[NA photo] work_orders update:', { updated, error: dbError })
      }
    }

    setNaUploading(false)
    if (naFileRef.current) naFileRef.current.value = ''
  }

  async function handleFinish() {
    if (!woRef.current) return
    setSubmitting(true)
    const now = new Date().toISOString()
    await supabase.from('work_orders').update({
      runner_finished: true,
      runner_finished_at: now,
      status: 'submitted',
      submitted_at: now,
    }).eq('id', woRef.current)
    setSubmitting(false)
    setRunnerFinished(true)
    setShowFinishConfirm(false)
  }

  async function handleSaveChanges() {
    if (!woRef.current) return
    setSaving(true)
    await supabase.from('work_orders').update({
      session_notes: sessionNotes,
      needs_attention_notes: needsAttentionNotes || null,
      needs_attention_photos: needsAttentionPhotos.length > 0 ? needsAttentionPhotos : null,
    }).eq('id', woRef.current)
    await saveExpenses()
    setSaving(false)
  }

  const sessionDates = Array.from(new Set(stRows.map((r: any) => r.date).filter(Boolean))).sort() as string[]

  if (loading) return (
    <div style={{ minHeight: '100dvh', background: '#0d0f14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b90a8', fontFamily: 'Syne, sans-serif' }}>
      Loading…
    </div>
  )

  return (
    <div style={{ minHeight: '100dvh', background: '#0d0f14', fontFamily: 'Syne, sans-serif', paddingBottom: 100 }}>
      {/* Header */}
      <div style={{
        background: '#161920', borderBottom: `3px solid ${meta.color}`,
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={() => router.push(`/runner/${studio}`)} style={{ background: 'none', border: 'none', color: '#8b90a8', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>←</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#e8eaf2' }}>
            Work Order
          </div>
          <div style={{ fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>
            {wo?.client_name || wo?.client || '—'} · {wo?.session_date ?? ''}
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 16px' }}>
        {/* Session Info */}
        <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderRadius: 12, padding: '14px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b90a8', marginBottom: 10 }}>Session Info</div>
          {[
            ['Client', wo?.client || wo?.client_name],
            ['Artist', wo?.artist],
            ['Engineer', wo?.engineer],
            ['Date', wo?.session_date],
            ['Time', [wo?.from_time, wo?.to_time].filter(Boolean).join(' – ')],
            ['Studio', (wo?.studios ?? []).join(', ')],
          ].filter(([, v]) => v).map(([l, v]) => (
            <div key={String(l)} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 10, color: '#8b90a8', fontFamily: 'DM Mono, monospace', minWidth: 60 }}>{l}</span>
              <span style={{ fontSize: 11, color: '#e8eaf2', fontFamily: 'DM Mono, monospace' }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Equipment Condition */}
        {sessionDates.length > 0 && (
          <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderRadius: 12, padding: '14px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b90a8', marginBottom: 12 }}>
              Equipment Condition
            </div>
            {EQUIPMENT.map(eq => (
              <div key={eq} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e8eaf2', marginBottom: 6 }}>{eq}</div>
                {sessionDates.map(date => {
                  const key = `${eq}||${date}`
                  const cond = equipConds[key]
                  return (
                    <div key={date} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: '#8b90a8', fontFamily: 'DM Mono, monospace', minWidth: 72 }}>{date}</span>
                      <button
                        onClick={() => toggleEquip(eq, date, 'ok')}
                        style={{
                          flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                          background: cond === 'ok' ? '#16a34a33' : '#2a2e3d',
                          color: cond === 'ok' ? '#4ade80' : '#8b90a8',
                        }}
                      >
                        ✓ OK
                      </button>
                      <button
                        onClick={() => toggleEquip(eq, date, 'not_ok')}
                        style={{
                          flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                          background: cond === 'not_ok' ? '#dc262633' : '#2a2e3d',
                          color: cond === 'not_ok' ? '#f87171' : '#8b90a8',
                        }}
                      >
                        ✗ Not OK
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {/* Session Notes */}
        <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderRadius: 12, padding: '14px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b90a8', marginBottom: 10 }}>
            Session Notes
          </div>
          <textarea
            value={sessionNotes}
            onChange={e => setSessionNotes(e.target.value)}
            placeholder="Any notes for this session…"
            style={{
              width: '100%', background: '#0d0f14', border: '1px solid #2a2e3d',
              borderRadius: 8, padding: '10px 12px', color: '#e8eaf2', fontSize: 12,
              fontFamily: 'DM Mono, monospace', resize: 'vertical', minHeight: 80,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Needs Attention / Runner Notes */}
        <div style={{ background: '#161920', border: '1px solid rgba(249,115,22,0.35)', borderRadius: 12, padding: '14px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#f97316', marginBottom: 10 }}>
            Needs Attention / Runner Notes
          </div>
          <textarea
            value={needsAttentionNotes}
            onChange={e => setNeedsAttentionNotes(e.target.value)}
            placeholder="Flag anything that needs management attention — damage, issues, missing items…"
            style={{
              width: '100%', background: '#0d0f14', border: '1px solid #2a2e3d',
              borderRadius: 8, padding: '10px 12px', color: '#e8eaf2', fontSize: 12,
              fontFamily: 'DM Mono, monospace', resize: 'vertical', minHeight: 80,
              outline: 'none', boxSizing: 'border-box', marginBottom: 10,
            }}
          />
          {/* Photo thumbnails */}
          {needsAttentionPhotos.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {needsAttentionPhotos.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'block', flexShrink: 0 }}>
                  <img src={url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '2px solid #f9731655', display: 'block' }} />
                </a>
              ))}
            </div>
          )}
          {/* Upload button */}
          <input ref={naFileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadNAPhoto(f) }} />
          <button onClick={() => naFileRef.current?.click()} disabled={naUploading} style={{ background: '#2a2e3d', border: 'none', borderRadius: 8, padding: '8px 14px', color: naUploading ? '#8b90a8' : '#e8eaf2', fontSize: 12, fontWeight: 600, cursor: naUploading ? 'not-allowed' : 'pointer', fontFamily: 'Syne, sans-serif' }}>
            {naUploading ? 'Uploading…' : '📷 Add Photo'}
          </button>
        </div>

        {/* Expenses */}
        <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderRadius: 12, padding: '14px 14px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b90a8' }}>
              Expenses
            </div>
            <button
              onClick={addExpense}
              style={{ background: meta.color + '22', color: meta.color, border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
            >
              + Add
            </button>
          </div>

          {expenses.length === 0 && (
            <div style={{ fontSize: 12, color: '#8b90a8', textAlign: 'center', padding: '12px 0' }}>No expenses yet</div>
          )}

          {expenses.map((exp, i) => (
            <div key={i} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: i < expenses.length - 1 ? '1px solid #2a2e3d' : 'none' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <input
                  placeholder="Vendor"
                  value={exp.vendor}
                  onChange={e => setExpenses(prev => prev.map((x, j) => j === i ? { ...x, vendor: e.target.value } : x))}
                  style={inputStyle}
                />
                <input
                  placeholder="Amount $"
                  type="number"
                  value={exp.amount}
                  onChange={e => setExpenses(prev => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                  style={inputStyle}
                />
              </div>
              <input
                placeholder="Item description"
                value={exp.item}
                onChange={e => setExpenses(prev => prev.map((x, j) => j === i ? { ...x, item: e.target.value } : x))}
                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
              />
              {/* Receipt upload */}
              {exp.receipt_url ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#4ade80', fontFamily: 'DM Mono, monospace' }}>✓ Receipt uploaded</span>
                  <a href={exp.receipt_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#8b90a8' }}>view</a>
                </div>
              ) : (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: '#8b90a8' }}>
                  <span style={{ background: '#2a2e3d', padding: '4px 10px', borderRadius: 6 }}>
                    {exp.uploading ? 'Uploading…' : '📷 Add Receipt'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={e => { if (e.target.files?.[0]) uploadReceipt(i, e.target.files[0]) }}
                  />
                </label>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Finish confirmation dialog */}
      {showFinishConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
          <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderRadius: 16, padding: '24px 20px', width: '100%', maxWidth: 320 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e8eaf2', marginBottom: 8, fontFamily: 'Syne, sans-serif' }}>Finish Work Order?</div>
            <div style={{ fontSize: 13, color: '#8b90a8', fontFamily: 'DM Mono, monospace', marginBottom: 20, lineHeight: 1.5 }}>Are you sure this WO is complete?</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowFinishConfirm(false)} style={{ flex: 1, padding: '12px 0', background: '#2a2e3d', color: '#e8eaf2', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>Cancel</button>
              <button onClick={handleFinish} disabled={submitting} style={{ flex: 1, padding: '12px 0', background: meta.color, color: '#0d0f14', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1, fontFamily: 'Syne, sans-serif' }}>
                {submitting ? 'Finishing…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer — Cancel | Save | Finish (always visible, WO stays editable after finish) */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: '#0d0f14', borderTop: '1px solid #2a2e3d' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => router.push(`/runner/${studio}`)}
            style={{ flex: 1, padding: '14px 0', background: '#1e2130', color: '#e8eaf2', border: '1px solid #2a2e3d', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSaveChanges}
            disabled={saving}
            style={{ flex: 1, padding: '14px 0', background: '#1e2130', color: '#e8eaf2', border: '1px solid #2a2e3d', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'Syne, sans-serif' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => setShowFinishConfirm(true)}
            style={{ flex: 2, padding: '14px 0', background: runnerFinished ? '#16a34a33' : meta.color, color: runnerFinished ? '#4ade80' : '#0d0f14', border: runnerFinished ? '1px solid #4ade8055' : 'none', borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
          >
            {runnerFinished ? '✓ Finished' : 'Finish Work Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#0d0f14', border: '1px solid #2a2e3d', borderRadius: 8,
  padding: '8px 10px', color: '#e8eaf2', fontSize: 12,
  fontFamily: 'DM Mono, monospace', outline: 'none', width: '100%',
}
