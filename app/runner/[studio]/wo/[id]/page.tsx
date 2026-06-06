'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import TimeInput from '@/components/shared/TimeInput'

const STUDIO_META: Record<string, { label: string; abbr: string; color: string }> = {
  paramount: { label: 'Paramount', abbr: 'PRS', color: '#c8f04e' },
  ameraycan: { label: 'Ameraycan', abbr: 'ARS', color: '#f04e7a' },
  encore: { label: 'Encore', abbr: 'ERS', color: '#4e8ff0' },
  track: { label: 'Track', abbr: 'TRS', color: '#f0a24e' },
}

const EQUIPMENT = ['Speakers', 'Microphone', 'Console']

function timeToMins(t: string): number {
  if (!t) return NaN
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!m) return NaN
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const ap = (m[3] ?? '').toUpperCase()
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + min
}
function calcHours(from: string, to: string): number | null {
  if (!from || !to) return null
  const f = timeToMins(from)
  const t = timeToMins(to)
  if (isNaN(f) || isNaN(t)) return null
  let diff = t - f
  if (diff < 0) diff += 24 * 60
  return diff > 0 ? parseFloat((diff / 60).toFixed(2)) : null
}
function calcCharge(fromTime: string, toTime: string, rate: string): number | null {
  const h = calcHours(fromTime, toTime)
  if (h == null) return null
  const r = parseFloat(String(rate).replace(/[^0-9.]/g, ''))
  return !isNaN(r) && r > 0 ? parseFloat((h * r).toFixed(2)) : null
}
function defaultEngHrs(r: any): string {
  if (r.eng_hours != null) return String(r.eng_hours)
  if (r.total_hours != null) return String(r.total_hours)
  const h = calcHours(r.from_time ?? '', r.to_time ?? '')
  return h != null ? String(h) : ''
}

type EquipCond = Record<string, 'ok' | 'not_ok' | null>
type Expense = { id?: string; vendor: string; item: string; amount: string; receipt_url: string | null; uploading?: boolean }

export default function RunnerWOPage() {
  const router = useRouter()
  const { studio, id: woIdParam } = useParams<{ studio: string; id: string }>()
  const searchParams = useSearchParams()
  const bookingId = searchParams.get('booking_id')
  const meta = STUDIO_META[studio] ?? { label: studio, abbr: '?', color: '#c8f04e' }

  const woRef = useRef<string | null>(null)
  const [resolvedWoId, setResolvedWoId] = useState<string | null>(null)
  const [wo, setWo]           = useState<any>(null)
  const [booking, setBooking] = useState<any>(null)
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
  const [otHours, setOtHours] = useState<Record<string, string>>({})
  const [engHoursMap, setEngHoursMap] = useState<Record<string, string>>({})
  const [fromTimeMap, setFromTimeMap] = useState<Record<string, string>>({})
  const [toTimeMap, setToTimeMap] = useState<Record<string, string>>({})
  const [engFromTimeMap, setEngFromTimeMap] = useState<Record<string, string>>({})
  const [engToTimeMap, setEngToTimeMap] = useState<Record<string, string>>({})
  const initFromTimeRef = useRef<Record<string, string>>({})
  const initToTimeRef = useRef<Record<string, string>>({})
  const initEngFromTimeRef = useRef<Record<string, string>>({})
  const initEngToTimeRef = useRef<Record<string, string>>({})
  const [equipNotes, setEquipNotes] = useState<Record<string, { id: string; note: string; photo_urls: string[] }>>({})
  const [openNoteKey, setOpenNoteKey] = useState<string | null>(null)
  const [noteUploading, setNoteUploading] = useState(false)
  const [notesModalRowId, setNotesModalRowId] = useState<string | null>(null)
  const [notesModalText, setNotesModalText] = useState('')
  const [expandedEngRow, setExpandedEngRow] = useState<string | null>(null)
  const [engPopoverPos, setEngPopoverPos] = useState<{ top: number; left: number } | null>(null)
  const notesScrollRef = useRef(0)
  const equipNoteFileRef = useRef<HTMLInputElement>(null)
  const pendingNoteKey = useRef<{ key: string; equipment: string; date: string } | null>(null)

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
      setResolvedWoId(resolvedId)

      // Fetch WO first to get booking_id, then fetch linked booking + rows in parallel
      const { data: woData } = await supabase.from('work_orders').select('*').eq('id', resolvedId).single()

      const [{ data: bkData }, { data: st }, { data: eq }, { data: exp }, { data: eqNotes }] = await Promise.all([
        (woData?.booking_id || bookingId)
          ? supabase.from('bookings').select('*').eq('id', woData?.booking_id || bookingId).single()
          : Promise.resolve({ data: null }),
        supabase.from('studio_time_rows').select('*').eq('work_order_id', resolvedId).order('sort_order'),
        supabase.from('equipment_condition_rows').select('*').eq('work_order_id', resolvedId),
        supabase.from('expense_rows').select('*').eq('work_order_id', resolvedId).order('created_at'),
        supabase.from('equipment_condition_notes').select('*').eq('work_order_id', resolvedId),
      ])

      setWo(woData)
      setBooking(bkData)
      let finalStRows = st ?? []
      let finalEngHours: Record<string, string> = {}
      let finalFromTimes: Record<string, string> = {}
      let finalToTimes: Record<string, string> = {}
      let finalEngFromTimes: Record<string, string> = {}
      let finalEngToTimes: Record<string, string> = {}
      function buildMaps(rows: any[]) {
        finalEngHours = {}; finalFromTimes = {}; finalToTimes = {}
        finalEngFromTimes = {}; finalEngToTimes = {}
        for (const r of rows) {
          finalEngHours[r.id] = defaultEngHrs(r)
          finalFromTimes[r.id] = r.from_time ?? ''
          finalToTimes[r.id] = r.to_time ?? ''
          finalEngFromTimes[r.id] = r.eng_from_time ?? r.from_time ?? ''
          finalEngToTimes[r.id] = r.eng_to_time ?? r.to_time ?? ''
        }
      }
      buildMaps(finalStRows)

      if (finalStRows.length === 0 && bkData && resolvedId) {
        const startD = new Date(bkData.start_date + 'T12:00:00')
        const endD = bkData.end_date ? new Date(bkData.end_date + 'T12:00:00') : startD
        const seedDates: string[] = []
        for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
          seedDates.push(d.toISOString().split('T')[0])
        }
        const isDR = bkData.rate_type === 'day' || (!bkData.rate && !!bkData.rate_daily)
        const rateVal = isDR ? (bkData.rate_daily ?? '') : (bkData.rate ?? '')
        const seedInserts = seedDates.map((date, i) => ({
          work_order_id: resolvedId,
          booking_id: bkData.id,
          date,
          studio: bkData.studio ?? '',
          session_info: [bkData.artist, bkData.engineer_name].filter(Boolean).join(' / ') || '',
          from_time: bkData.from_time ?? '',
          to_time: bkData.to_time ?? '',
          total_hours: !isDR ? calcHours(bkData.from_time ?? '', bkData.to_time ?? '') : null,
          rate: rateVal,
          charge: !isDR ? calcCharge(bkData.from_time ?? '', bkData.to_time ?? '', rateVal) : null,
          day_count: isDR ? 1 : null,
          sort_order: i,
        }))
        const { data: seeded } = await supabase.from('studio_time_rows').insert(seedInserts).select()
        if (seeded && seeded.length > 0) {
          finalStRows = seeded
          buildMaps(seeded)
        }
      }

      setStRows(finalStRows)
      setEngHoursMap(finalEngHours)
      setFromTimeMap(finalFromTimes)
      setToTimeMap(finalToTimes)
      setEngFromTimeMap(finalEngFromTimes)
      setEngToTimeMap(finalEngToTimes)
      initFromTimeRef.current = { ...finalFromTimes }
      initToTimeRef.current = { ...finalToTimes }
      initEngFromTimeRef.current = { ...finalEngFromTimes }
      initEngToTimeRef.current = { ...finalEngToTimes }
      setEquipRows(eq ?? [])
      if (eqNotes?.length) {
        const map: Record<string, { id: string; note: string; photo_urls: string[] }> = {}
        for (const n of eqNotes) map[`${n.equipment}||${n.date}`] = { id: n.id, note: n.note ?? '', photo_urls: n.photo_urls ?? [] }
        setEquipNotes(map)
      }
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

  // Real-time: full re-fetch when admin edits the WO record
  // sessionNotes, needsAttentionNotes, needsAttentionPhotos, and equipConds
  // are separate state vars and are never touched here.
  useEffect(() => {
    if (!resolvedWoId) return

    console.log(`[RT] Subscribing to work_orders on /runner/wo/${resolvedWoId}, filter: id=eq.${resolvedWoId}`)
    const channel = supabase
      .channel(`runner-wo-${resolvedWoId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'work_orders',
        filter: `id=eq.${resolvedWoId}`,
      }, async (payload) => {
        console.log(`[RT] Real-time event received on /runner/wo/${resolvedWoId}, work_orders:`, payload)
        const updated = payload.new as any
        setWo(updated)
        const [{ data: bkData }, { data: st }] = await Promise.all([
          updated.booking_id
            ? supabase.from('bookings').select('*').eq('id', updated.booking_id).single()
            : Promise.resolve({ data: null }),
          supabase.from('studio_time_rows').select('*').eq('work_order_id', resolvedWoId).order('sort_order'),
        ])
        if (bkData) setBooking(bkData)
        if (st) setStRows(st)
      })
      .subscribe((status, err) => {
        console.log(`[RT] work_orders subscription status on /runner/wo/${resolvedWoId}:`, status, err ?? '')
      })

    return () => {
      console.log(`[RT] Unsubscribing from work_orders on /runner/wo/${resolvedWoId}`)
      supabase.removeChannel(channel)
    }
  }, [resolvedWoId])

  // Subscribe to studio_time_rows for this WO — updates state instantly when admin
  // changes rates, dates, or any row field (booking save, rate sync, etc.)
  useEffect(() => {
    if (!resolvedWoId) return
    const channel = supabase
      .channel(`runner-wo-strows-${resolvedWoId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'studio_time_rows',
        filter: `work_order_id=eq.${resolvedWoId}`,
      }, async () => {
        const { data: st } = await supabase
          .from('studio_time_rows')
          .select('*')
          .eq('work_order_id', resolvedWoId!)
          .order('sort_order')
        if (st) {
          setStRows(st)
          // Initialize otHours for any new row IDs without overwriting runner-typed values
          setOtHours(prev => {
            const next = { ...prev }
            for (const r of st) {
              if (!(r.id in next)) next[r.id] = String(r.ot_hours ?? '0')
            }
            return next
          })
          setFromTimeMap(prev => {
            const next = { ...prev }
            for (const r of st) {
              const init = initFromTimeRef.current[r.id]
              if (!(r.id in next) || prev[r.id] === init) {
                next[r.id] = r.from_time ?? ''
                initFromTimeRef.current[r.id] = r.from_time ?? ''
              }
            }
            return next
          })
          setToTimeMap(prev => {
            const next = { ...prev }
            for (const r of st) {
              const init = initToTimeRef.current[r.id]
              if (!(r.id in next) || prev[r.id] === init) {
                next[r.id] = r.to_time ?? ''
                initToTimeRef.current[r.id] = r.to_time ?? ''
              }
            }
            return next
          })
          setEngFromTimeMap(prev => {
            const next = { ...prev }
            for (const r of st) {
              const val = r.eng_from_time ?? r.from_time ?? ''
              const init = initEngFromTimeRef.current[r.id]
              if (!(r.id in next) || prev[r.id] === init) {
                next[r.id] = val
                initEngFromTimeRef.current[r.id] = val
              }
            }
            return next
          })
          setEngToTimeMap(prev => {
            const next = { ...prev }
            for (const r of st) {
              const val = r.eng_to_time ?? r.to_time ?? ''
              const init = initEngToTimeRef.current[r.id]
              if (!(r.id in next) || prev[r.id] === init) {
                next[r.id] = val
                initEngToTimeRef.current[r.id] = val
              }
            }
            return next
          })
          setEngHoursMap(prev => {
            const next = { ...prev }
            for (const r of st) {
              if (!(r.id in next)) {
                next[r.id] = defaultEngHrs(r)
              } else if (r.eng_hours != null) {
                // Admin set eng_hours — accept it only if runner hasn't manually overridden
                const autoDefault = r.total_hours != null
                  ? String(r.total_hours)
                  : (() => { const h = calcHours(r.from_time ?? '', r.to_time ?? ''); return h != null ? String(h) : '' })()
                if (prev[r.id] === autoDefault) next[r.id] = String(r.eng_hours)
              }
            }
            return next
          })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [resolvedWoId])

  async function toggleEquip(eq: string, date: string, val: 'ok' | 'not_ok') {
    const key = `${eq}||${date}`
    const newVal = equipConds[key] === val ? null : val
    setEquipConds(prev => ({ ...prev, [key]: newVal }))
    const row = equipRows.find((r: any) => r.equipment === eq && r.date === date)
    if (row) {
      await supabase.from('equipment_condition_rows').update({ condition: newVal }).eq('id', row.id)
    }
    if (newVal === 'not_ok') setOpenNoteKey(key)
    else setOpenNoteKey(prev => prev === key ? null : prev)
  }

  async function upsertEquipNote(key: string, equipment: string, date: string, updates: { note?: string; photo_urls?: string[] }) {
    if (!woRef.current) return
    const current = equipNotes[key]
    const merged = { note: current?.note ?? '', photo_urls: current?.photo_urls ?? [], ...updates }
    if (current?.id) {
      await supabase.from('equipment_condition_notes').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', current.id)
      setEquipNotes(prev => ({ ...prev, [key]: { ...prev[key], ...updates } }))
    } else {
      const { data } = await supabase.from('equipment_condition_notes').insert({
        work_order_id: woRef.current, equipment, date, note: merged.note, photo_urls: merged.photo_urls,
      }).select('id').single()
      if (data) setEquipNotes(prev => ({ ...prev, [key]: { id: data.id, note: merged.note, photo_urls: merged.photo_urls } }))
    }
  }

  async function uploadEquipNotePhoto(file: File) {
    const pending = pendingNoteKey.current
    if (!pending || !woRef.current) return
    setNoteUploading(true)
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `equip-notes/${woRef.current}/${pending.equipment.toLowerCase()}_${pending.date}_${Date.now()}.${ext}`
    const { data, error } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
    if (!error && data) {
      const { data: { publicUrl } } = supabase.storage.from('checklist-photos').getPublicUrl(data.path)
      const currentPhotos = equipNotes[pending.key]?.photo_urls ?? []
      await upsertEquipNote(pending.key, pending.equipment, pending.date, { photo_urls: [...currentPhotos, publicUrl] })
    }
    setNoteUploading(false)
    if (equipNoteFileRef.current) equipNoteFileRef.current.value = ''
    pendingNoteKey.current = null
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
      console.log('[NA photo] publicUrl value:', publicUrl, '| type:', typeof publicUrl, '| truthy:', !!publicUrl)

      if (publicUrl) {
        const newPhotos = [...needsAttentionPhotos, publicUrl]
        setNeedsAttentionPhotos(newPhotos)
        const { error: dbError } = await supabase.from('work_orders')
          .update({ needs_attention_photos: newPhotos })
          .eq('id', woRef.current)
        console.log('[NA photo] work_orders update:', { newPhotos, error: dbError })
      } else {
        console.error('[NA photo] publicUrl is falsy — thumbnail will not render. Check checklist-photos bucket is public.')
      }
    } else {
      console.error('[NA photo] upload failed:', uploadError)
    }

    setNaUploading(false)
    if (naFileRef.current) naFileRef.current.value = ''
  }

  async function deleteNAPhoto(url: string) {
    const updated = needsAttentionPhotos.filter(u => u !== url)
    setNeedsAttentionPhotos(updated)
    if (woRef.current) {
      await supabase.from('work_orders')
        .update({ needs_attention_photos: updated.length > 0 ? updated : null })
        .eq('id', woRef.current)
    }
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

    // Save time/hours/charge for all rows (per-row row_rate_type)
    const hasEngineer = !!(wo?.engineer || booking?.engineer_name)
    if (stRows.length > 0) {
      await Promise.all(stRows.map((r: any) => {
        const update: Record<string, any> = {}
        const from = fromTimeMap[r.id] ?? r.from_time ?? ''
        const to = toTimeMap[r.id] ?? r.to_time ?? ''
        update.from_time = from || null
        update.to_time = to || null
        if (r.row_rate_type === 'day') {
          const actualHrs = calcHours(from, to) ?? 0
          const autoOtHrs = Math.max(0, parseFloat(actualHrs.toFixed(2)) - 12)
          const otRateNum = parseFloat(String(r.ot_rate ?? '0').replace(/[^0-9.]/g, '')) || 0
          update.ot_hours = autoOtHrs || null
          update.ot_charge = autoOtHrs > 0 && otRateNum > 0 ? parseFloat((autoOtHrs * otRateNum).toFixed(2)) : null
        } else {
          const hrs = calcHours(from, to)
          const rateNum = parseFloat(String(r.rate ?? '').replace(/[^0-9.]/g, '')) || 0
          update.total_hours = hrs
          update.charge = hrs != null && rateNum > 0 ? parseFloat((hrs * rateNum).toFixed(2)) : null
        }
        if (hasEngineer) {
          const engRaw = r.eng_rate || booking?.engineer_rate || ''
          const er = parseFloat(String(engRaw).replace(/[^0-9.]/g, '')) || 0
          const ef = engFromTimeMap[r.id] ?? r.eng_from_time ?? from
          const et = engToTimeMap[r.id] ?? r.eng_to_time ?? to
          const engHrs = calcHours(ef, et)
          update.eng_from_time = ef || null
          update.eng_to_time = et || null
          update.eng_hours = engHrs
          update.eng_charge = engHrs != null && engHrs > 0 && er > 0 ? parseFloat((engHrs * er).toFixed(2)) : null
        }
        return supabase.from('studio_time_rows').update(update).eq('id', r.id)
      }))
    }

    setSaving(false)
    router.push(`/runner/${studio}`)
  }

  async function saveNotesModal() {
    if (!notesModalRowId) return
    await supabase.from('studio_time_rows').update({ session_info: notesModalText }).eq('id', notesModalRowId)
    setStRows(prev => prev.map((r: any) => r.id === notesModalRowId ? { ...r, session_info: notesModalText } : r))
    document.body.style.overflow = ''
    setNotesModalRowId(null)
    window.scrollTo({ top: notesScrollRef.current, behavior: 'instant' })
  }

  function getInitials(name: string) {
    return name.split(/\s+/).filter(Boolean).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
  }

  const sessionDates = Array.from(new Set(stRows.map((r: any) => r.date).filter(Boolean))).sort() as string[]

  if (loading) return (
    <div style={{ minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden', background: '#0d0f14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b90a8', fontFamily: 'Syne, sans-serif' }}>
      Loading…
    </div>
  )

  return (
    <div style={{ minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden', background: '#0d0f14', fontFamily: 'Syne, sans-serif', paddingBottom: 100 }}>
      {/* Session Notes Bottom Sheet */}
      {notesModalRowId && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxHeight: '38vh', zIndex: 10002, display: 'flex', flexDirection: 'column', background: '#161920', borderTop: '3px solid #c8f04e', borderRadius: '16px 16px 0 0', overflow: 'hidden', boxSizing: 'border-box' }}>
          <div style={{ width: '100%', boxSizing: 'border-box', padding: '14px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: '#f0f0f0' }}>Session Notes</span>
            <button onClick={() => { document.body.style.overflow = ''; setNotesModalRowId(null); window.scrollTo({ top: notesScrollRef.current, behavior: 'instant' }) }} style={{ background: 'none', border: 'none', color: '#8b90a8', fontSize: 22, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
          </div>
          <textarea
            value={notesModalText}
            onChange={e => setNotesModalText(e.target.value)}
            placeholder="Song names, notes, instructions…"
            style={{ flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', outline: 'none', color: '#e8eaf2', fontFamily: 'DM Mono, monospace', fontSize: 13, padding: '0 16px', resize: 'none', lineHeight: 1.6, overflowY: 'auto' }}
            autoFocus
          />
          <div style={{ width: '100%', boxSizing: 'border-box', display: 'flex', gap: 10, padding: '10px 16px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', flexShrink: 0 }}>
            <button onClick={saveNotesModal} style={{ flex: 1, background: '#c8f04e', color: '#0d0f14', border: 'none', borderRadius: 8, padding: '11px 0', fontFamily: 'Syne', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Save</button>
            <button onClick={() => { document.body.style.overflow = ''; setNotesModalRowId(null); window.scrollTo({ top: notesScrollRef.current, behavior: 'instant' }) }} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', color: '#8b90a8', border: 'none', borderRadius: 8, padding: '11px 0', fontFamily: 'Syne', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {/* Engineer name popover */}
      {expandedEngRow && engPopoverPos && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => { setExpandedEngRow(null); setEngPopoverPos(null) }} />
          <div style={{ position: 'fixed', top: engPopoverPos.top - 8, left: engPopoverPos.left, transform: 'translateY(-100%)', zIndex: 99, background: '#1a1e28', border: '1px solid #c8f04e', borderRadius: 6, padding: '6px 10px', whiteSpace: 'nowrap' }}>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: '#c8f04e' }}>{wo?.engineer || booking?.engineer_name || ''}</span>
          </div>
        </>
      )}
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
            {booking?.client_name || wo?.client_name || wo?.client || '—'} · {booking?.start_date || wo?.session_date || ''}
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 16px' }}>
        {/* Session Info */}
        <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderRadius: 12, padding: '14px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b90a8', marginBottom: 10 }}>Session Info</div>
          {[
            [wo?.payment_status === 'Billing' ? 'Label / A&R' : 'Client',
             wo?.payment_status === 'Billing'
               ? (() => {
                   const lbl  = booking?.label || wo?.label || ''
                   const anr  = booking?.client_name || wo?.client || ''
                   if (lbl && anr) return `${lbl} / ${anr}`
                   return lbl || anr || null
                 })()
               : (booking?.client_name || wo?.client || wo?.client_name)],
            ['Artist',   booking?.artist   || wo?.artist],
            ['Engineer', booking?.engineer_name || wo?.engineer],
            ['Date',     booking?.start_date   || wo?.session_date],
            ['Time',     [booking?.from_time || wo?.from_time, booking?.to_time || wo?.to_time].filter(Boolean).join(' – ')],
            ['Studio',   booking?.studio || (wo?.studios ?? []).join(', ')],
          ].filter(([, v]) => v).map(([l, v]) => (
            <div key={String(l)} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 10, color: '#8b90a8', fontFamily: 'DM Mono, monospace', minWidth: 60 }}>{l}</span>
              <span style={{ fontSize: 11, color: '#e8eaf2', fontFamily: 'DM Mono, monospace' }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Studio Time */}
        {(() => {
          const thStyle: React.CSSProperties = {
            padding: '5px 8px', fontSize: 8, fontFamily: 'Syne, sans-serif', fontWeight: 700,
            letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#8b90a8',
            borderRight: '1px solid #2a2e3d',
          }
          const tdStyle: React.CSSProperties = {
            padding: '8px 8px', fontSize: 11, fontFamily: 'DM Mono, monospace', color: '#e8eaf2',
            borderRight: '1px solid #2a2e3d', display: 'flex', alignItems: 'center',
          }

          const stTotal = stRows.reduce((s: number, r: any) => {
            const liveFrom = fromTimeMap[r.id] ?? r.from_time ?? ''
            const liveTo = toTimeMap[r.id] ?? r.to_time ?? ''
            if (r.row_rate_type === 'day') {
              const rateDailyNum = parseFloat(String(r.rate_daily ?? r.rate ?? '').replace(/[^0-9.]/g, '')) || 0
              const actualHrs = calcHours(liveFrom, liveTo) ?? 0
              const autoOtHrs = Math.max(0, parseFloat(actualHrs.toFixed(2)) - 12)
              const otRateNum = parseFloat(String(r.ot_rate ?? '0').replace(/[^0-9.]/g, '')) || 0
              return s + rateDailyNum + (autoOtHrs > 0 && otRateNum > 0 ? autoOtHrs * otRateNum : 0)
            }
            const liveHrs = calcHours(liveFrom, liveTo)
            const rateNum = parseFloat(String(r.rate ?? '').replace(/[^0-9.]/g, '')) || 0
            return s + (liveHrs != null && rateNum > 0 ? liveHrs * rateNum : (parseFloat(String(r.charge ?? '0')) || 0))
          }, 0)
          const engName = wo?.engineer || booking?.engineer_name || ''
          const engTotal = stRows.reduce((sum: number, r: any) => {
            const engRateRaw = r.eng_rate || booking?.engineer_rate || ''
            const rate = parseFloat(String(engRateRaw).replace(/[^0-9.]/g, '')) || 0
            if (!rate) return sum
            const ef = engFromTimeMap[r.id] ?? r.eng_from_time ?? r.from_time ?? ''
            const et = engToTimeMap[r.id] ?? r.eng_to_time ?? r.to_time ?? ''
            const hrs = calcHours(ef, et) ?? 0
            return sum + (hrs > 0 ? hrs * rate : 0)
          }, 0)

          return (
            <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b90a8', padding: '12px 14px 8px' }}>Studio Time</div>
              {stRows.length === 0 ? (
                <div style={{ padding: '14px', color: '#8b90a8', fontSize: 12, fontFamily: 'DM Mono, monospace', textAlign: 'center' }}>
                  Session times will appear here
                </div>
              ) : (
                /* Unified compact table: Date | Notes | From | To | Hrs | Type | Rate | OT Rate | Total */
                /* Eng sub-row: blank | Initials | eng_from | eng_to | engHrs | blank | eng_rate | blank | engCharge */
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ minWidth: 444 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '54px 44px 52px 52px 34px 32px 62px 56px 58px', background: '#0d0f14', borderTop: '1px solid #2a2e3d', borderBottom: '1px solid #2a2e3d' }}>
                      {['Date', 'Notes', 'From', 'To', 'Hrs', 'Type', 'Rate', 'OT', 'Total'].map(h => <div key={h} style={thStyle}>{h}</div>)}
                    </div>
                    <div>
                      {stRows.map((r: any) => {
                        const isDayRow = r.row_rate_type === 'day'
                        const liveFrom = fromTimeMap[r.id] ?? r.from_time ?? ''
                        const liveTo = toTimeMap[r.id] ?? r.to_time ?? ''
                        const engRateForRow = parseFloat(String(r.eng_rate || booking?.engineer_rate || '').replace(/[^0-9.]/g, '')) || 0
                        const engLiveFrom = engFromTimeMap[r.id] ?? r.eng_from_time ?? r.from_time ?? ''
                        const engLiveFrom2 = engLiveFrom
                        const engLiveTo = engToTimeMap[r.id] ?? r.eng_to_time ?? r.to_time ?? ''
                        const engLiveHours = calcHours(engLiveFrom2, engLiveTo)
                        const liveEngCharge = engLiveHours != null && engLiveHours > 0 && engRateForRow > 0 ? parseFloat((engLiveHours * engRateForRow).toFixed(2)) : null

                        let rowTotal: number | null = null
                        if (isDayRow) {
                          const rateDailyNum = parseFloat(String(r.rate_daily ?? r.rate ?? '').replace(/[^0-9.]/g, '')) || 0
                          const actualHrs = calcHours(liveFrom, liveTo) ?? 0
                          const autoOtHrs = Math.max(0, parseFloat(actualHrs.toFixed(2)) - 12)
                          const otRateNum = parseFloat(String(r.ot_rate ?? '0').replace(/[^0-9.]/g, '')) || 0
                          const otCharge = autoOtHrs > 0 && otRateNum > 0 ? autoOtHrs * otRateNum : 0
                          rowTotal = rateDailyNum > 0 ? parseFloat((rateDailyNum + otCharge).toFixed(2)) : null
                        } else {
                          const liveHours = calcHours(liveFrom, liveTo)
                          const rateNum = parseFloat(String(r.rate ?? '').replace(/[^0-9.]/g, '')) || 0
                          rowTotal = liveHours != null && rateNum > 0 ? parseFloat((liveHours * rateNum).toFixed(2)) : null
                        }

                        const rowHrs = calcHours(liveFrom, liveTo)
                        const rowHrsDisplay = isDayRow ? (rowHrs ?? 12) : (rowHrs ?? '—')
                        const hasNotes = !!(r.session_info || '').trim()
                        const tSel = { background: 'transparent', color: '#e8eaf2', border: 'none', fontSize: 10, fontFamily: 'DM Mono, monospace', width: '100%' }
                        const initials = engName ? getInitials(engName) : ''
                        const engExpanded = expandedEngRow === r.id
                        return (
                          <div key={r.id}>
                            <div style={{ display: 'grid', gridTemplateColumns: '54px 44px 52px 52px 34px 32px 62px 56px 58px', borderBottom: engName ? 'none' : '1px solid #2a2e3d' }}>
                              <div style={{ ...tdStyle, color: '#8b90a8', fontSize: 9 }}>{r.date || '—'}</div>
                              <div style={{ ...tdStyle, padding: '4px 3px' }}>
                                <button
                                  onClick={() => { notesScrollRef.current = window.scrollY; document.body.style.overflow = 'hidden'; setNotesModalRowId(r.id); setNotesModalText(r.session_info || '') }}
                                  style={{ width: '100%', padding: '3px 4px', border: `1px solid ${hasNotes ? '#c8f04e' : '#3a3f52'}`, borderRadius: 4, background: hasNotes ? 'rgba(200,240,78,0.08)' : 'transparent', color: hasNotes ? '#c8f04e' : '#4a4f64', fontSize: 9, fontFamily: 'Syne', cursor: 'pointer' }}
                                >Notes</button>
                              </div>
                              <div style={{ ...tdStyle, padding: '2px 3px' }}><TimeInput value={liveFrom} onChange={v => setFromTimeMap(prev => ({ ...prev, [r.id]: v }))} style={tSel} /></div>
                              <div style={{ ...tdStyle, padding: '2px 3px' }}><TimeInput value={liveTo} onChange={v => setToTimeMap(prev => ({ ...prev, [r.id]: v }))} style={tSel} /></div>
                              <div style={{ ...tdStyle, color: '#8b90a8', fontSize: 9 }}>{rowHrsDisplay !== '—' ? `${rowHrsDisplay}h` : '—'}</div>
                              <div style={{ ...tdStyle, fontSize: 8, color: isDayRow ? '#c8f04e' : '#8b90a8' }}>{isDayRow ? 'Day' : 'Hr'}</div>
                              <div style={{ ...tdStyle, color: '#8b90a8', fontSize: 9 }}>
                                {isDayRow
                                  ? (parseFloat(String(r.rate_daily ?? r.rate ?? '').replace(/[^0-9.]/g, '')) > 0 ? `$${parseFloat(String(r.rate_daily ?? r.rate ?? '').replace(/[^0-9.]/g, '')).toLocaleString()}/d` : '—')
                                  : (parseFloat(String(r.rate ?? '').replace(/[^0-9.]/g, '')) > 0 ? `$${parseFloat(String(r.rate ?? '').replace(/[^0-9.]/g, ''))}/hr` : '—')
                                }
                              </div>
                              <div style={{ ...tdStyle, color: '#8b90a8', fontSize: 9 }}>
                                {parseFloat(String(r.ot_rate ?? '0').replace(/[^0-9.]/g, '')) > 0 ? `$${parseFloat(String(r.ot_rate ?? '0').replace(/[^0-9.]/g, ''))}/hr` : '—'}
                              </div>
                              <div style={{ ...tdStyle, color: rowTotal != null ? meta.color : '#4a4f64', fontWeight: rowTotal != null ? 700 : 400, borderRight: 'none', fontSize: 10 }}>
                                {rowTotal != null ? `$${rowTotal.toFixed(2)}` : '—'}
                              </div>
                            </div>
                            {engName && (
                              <div style={{ display: 'grid', gridTemplateColumns: '54px 44px 52px 52px 34px 32px 62px 56px 58px', borderBottom: '1px solid #2a2e3d', background: 'rgba(200,240,78,0.03)' }}>
                                <div style={{ ...tdStyle }} />
                                <div style={{ ...tdStyle, padding: '4px 3px' }}>
                                  <button
                                    onClick={e => {
                                      if (engExpanded) { setExpandedEngRow(null); setEngPopoverPos(null) }
                                      else {
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                        setExpandedEngRow(r.id)
                                        setEngPopoverPos({ top: rect.top, left: rect.left })
                                      }
                                    }}
                                    style={{ padding: '2px 5px', border: '1px solid #c8f04e', borderRadius: 4, background: 'rgba(200,240,78,0.08)', color: '#c8f04e', fontSize: 9, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer' }}
                                  >{initials}</button>
                                </div>
                                <div style={{ ...tdStyle, padding: '2px 3px' }}><TimeInput value={engLiveFrom2} onChange={v => setEngFromTimeMap(prev => ({ ...prev, [r.id]: v }))} style={{ ...tSel, color: '#c8f04e' }} /></div>
                                <div style={{ ...tdStyle, padding: '2px 3px' }}><TimeInput value={engLiveTo} onChange={v => setEngToTimeMap(prev => ({ ...prev, [r.id]: v }))} style={{ ...tSel, color: '#c8f04e' }} /></div>
                                <div style={{ ...tdStyle, color: '#8b90a8', fontSize: 9 }}>{engLiveHours != null ? `${engLiveHours}h` : '—'}</div>
                                <div style={{ ...tdStyle }} />
                                <div style={{ ...tdStyle, color: '#8b90a8', fontSize: 9 }}>{engRateForRow > 0 ? `$${engRateForRow}/hr` : '—'}</div>
                                <div style={{ ...tdStyle }} />
                                <div style={{ ...tdStyle, color: liveEngCharge != null ? meta.color : '#4a4f64', fontWeight: liveEngCharge != null ? 700 : 400, borderRight: 'none', fontSize: 10 }}>
                                  {liveEngCharge != null ? `$${liveEngCharge.toFixed(2)}` : '—'}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
              {stRows.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 14px', borderTop: '1px solid #2a2e3d', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 700, color: '#e8eaf2' }}>
                    Studio: <span style={{ color: meta.color }}>${stTotal.toFixed(2)}</span>
                  </span>
                  {engTotal > 0 && (
                    <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', fontWeight: 700, color: '#e8eaf2' }}>
                      Eng: <span style={{ color: meta.color }}>${engTotal.toFixed(2)}</span>
                    </span>
                  )}
                  {engTotal > 0 && (
                    <span style={{ fontSize: 13, fontFamily: 'DM Mono, monospace', fontWeight: 700, color: '#e8eaf2', borderTop: '1px solid #2a2e3d', paddingTop: 4 }}>
                      Total: <span style={{ color: meta.color }}>${(stTotal + engTotal).toFixed(2)}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {/* Equipment Condition */}
        {sessionDates.length > 0 && (
          <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b90a8', padding: '12px 14px 8px' }}>
              Equipment Condition
            </div>
            <input ref={equipNoteFileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadEquipNotePhoto(f) }} />
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: `${130 + Math.max(sessionDates.length, 1) * 90}px` }}>
                {/* Header row */}
                <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${Math.max(sessionDates.length, 1)}, 90px)`, background: '#0d0f14', borderBottom: '1px solid #2a2e3d' }}>
                  <div style={{ padding: '5px 8px', fontSize: 8, fontFamily: 'Syne, sans-serif', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#8b90a8', borderRight: '1px solid #2a2e3d', position: 'sticky' as const, left: 0, background: '#0d0f14', zIndex: 1 }}>Equipment</div>
                  {sessionDates.map(d => (
                    <div key={d} style={{ padding: '5px 8px', fontSize: 9, fontFamily: 'DM Mono, monospace', color: '#8b90a8', borderRight: '1px solid #2a2e3d', textAlign: 'center' as const }}>{d}</div>
                  ))}
                </div>
                {/* Equipment rows */}
                {EQUIPMENT.map(eq => {
                  const openDate = openNoteKey?.startsWith(`${eq}||`) ? openNoteKey.split('||')[1] : null
                  return (
                    <div key={eq}>
                      <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${Math.max(sessionDates.length, 1)}, 90px)`, borderBottom: '1px solid #2a2e3d' }}>
                        <div style={{ padding: '8px', fontSize: 12, fontWeight: 600, color: '#e8eaf2', fontFamily: 'Syne, sans-serif', borderRight: '1px solid #2a2e3d', position: 'sticky' as const, left: 0, background: '#161920', zIndex: 1, display: 'flex', alignItems: 'center' }}>{eq}</div>
                        {sessionDates.map(date => {
                          const key = `${eq}||${date}`
                          const cond = equipConds[key]
                          const hasNote = !!(equipNotes[key]?.note || (equipNotes[key]?.photo_urls?.length ?? 0) > 0)
                          return (
                            <div key={date} style={{ padding: '6px 4px', borderRight: '1px solid #2a2e3d', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                              <button onClick={() => toggleEquip(eq, date, 'ok')} style={{ width: '100%', padding: '4px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: 'Syne, sans-serif', background: cond === 'ok' ? '#16a34a33' : '#2a2e3d', color: cond === 'ok' ? '#4ade80' : '#8b90a8' }}>✓ OK</button>
                              <div style={{ display: 'flex', gap: 3, alignItems: 'center', width: '100%' }}>
                                <button onClick={() => toggleEquip(eq, date, 'not_ok')} style={{ flex: 1, padding: '4px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: 'Syne, sans-serif', background: cond === 'not_ok' ? '#dc262633' : '#2a2e3d', color: cond === 'not_ok' ? '#f87171' : '#8b90a8' }}>✗ Not OK</button>
                                {cond === 'not_ok' && hasNote && (
                                  <span style={{ width: 6, height: 6, borderRadius: 3, background: '#f0a24e', flexShrink: 0 }} />
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {/* Note expansion — inline below the equipment row */}
                      {openDate && (
                        <div style={{ padding: '10px 12px', background: '#0d0f14', borderBottom: '1px solid #2a2e3d' }}>
                          <div style={{ fontSize: 9, fontFamily: 'Syne, sans-serif', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#f0a24e', marginBottom: 6 }}>
                            {eq} — {openDate}
                          </div>
                          <textarea
                            value={equipNotes[`${eq}||${openDate}`]?.note ?? ''}
                            onChange={e => {
                              const k = `${eq}||${openDate}`
                              setEquipNotes(prev => ({ ...prev, [k]: { ...(prev[k] ?? { id: '', photo_urls: [] }), note: e.target.value } }))
                            }}
                            onBlur={e => upsertEquipNote(`${eq}||${openDate}`, eq, openDate, { note: e.target.value })}
                            placeholder="Describe the issue…"
                            style={{ width: '100%', background: 'transparent', border: '1px solid #2a2e3d', borderRadius: 6, color: '#e8eaf2', fontFamily: 'DM Mono, monospace', fontSize: 12, padding: '8px 10px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', minHeight: 64 }}
                          />
                          {(equipNotes[`${eq}||${openDate}`]?.photo_urls?.length ?? 0) > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                              {equipNotes[`${eq}||${openDate}`].photo_urls.map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noreferrer">
                                  <img src={url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(249,115,22,0.3)', display: 'block' }} />
                                </a>
                              ))}
                            </div>
                          )}
                          <button
                            onClick={() => { pendingNoteKey.current = { key: `${eq}||${openDate}`, equipment: eq, date: openDate }; equipNoteFileRef.current?.click() }}
                            disabled={noteUploading}
                            style={{ marginTop: 8, background: '#2a2e3d', border: 'none', borderRadius: 6, padding: '7px 14px', color: noteUploading ? '#8b90a8' : '#e8eaf2', fontSize: 12, fontWeight: 600, cursor: noteUploading ? 'not-allowed' : 'pointer', fontFamily: 'Syne, sans-serif' }}
                          >
                            {noteUploading ? 'Uploading…' : '📷 Add Photo'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
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
                <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                  <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                    <img src={url} alt="" onError={() => console.error('[NA photo] img failed to load:', url)} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '2px solid rgba(249,115,22,0.35)', display: 'block' }} />
                  </a>
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); deleteNAPhoto(url) }}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, background: '#f87171', border: 'none', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0 }}
                  >✕</button>
                </div>
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
