'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import TimeInput from '@/components/shared/TimeInput'
import { SignedImage } from '@/components/shared/SignedImage'
import { calcHours, getLocalToday } from '@/lib/time'
import { dbResult } from '@/lib/db'
import { useStaffPools } from '@/components/shared/StaffPicker'
import { formatCurrency, stripCurrency } from '@/lib/format'

const STUDIO_META: Record<string, { label: string; abbr: string }> = {
  paramount: { label: 'Paramount', abbr: 'PRS' },
  ameraycan: { label: 'Ameraycan', abbr: 'ARS' },
  encore: { label: 'Encore', abbr: 'ERS' },
  track: { label: 'Track', abbr: 'TRS' },
}

const EQUIPMENT = ['Speakers', 'Microphone', 'Console']

// Canonical time math + currency formatters now live in lib/time.ts /
// lib/format.ts (Phase 1 audit fix). calcCharge keeps this page's
// (from, to, rate) signature as a thin wrapper over the canonical helpers.
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

export default function RunnerWOPage() {
  const router = useRouter()
  const { studio, id: woIdParam } = useParams<{ studio: string; id: string }>()
  const searchParams = useSearchParams()
  const bookingId = searchParams.get('booking_id')
  const meta = STUDIO_META[studio] ?? { label: studio, abbr: '?' }

  const woRef = useRef<string | null>(null)
  const [resolvedWoId, setResolvedWoId] = useState<string | null>(null)
  const [woMissing, setWoMissing] = useState<string | null>(null)
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
  const [payRows, setPayRows] = useState<{ id: string; payment_type: string; amount: string; memo: string; last_four: string }[]>([])
  const payIdsInDb = useRef<Set<string>>(new Set())
  const [signatureData, setSignatureData] = useState('')
  const [printName, setPrintName] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawingRef = useRef(false)
  const initialSigRef = useRef('')
  const [submitting, setSubmitting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [otHours, setOtHours] = useState<Record<string, string>>({})
  const [engHoursMap, setEngHoursMap] = useState<Record<string, string>>({})
  // Day scope for the Studio Time table. Defaults to today; a 30-day work order
  // is unusable as one flat list on a phone.
  const [showAllDays, setShowAllDays] = useState(false)
  // Staff reassignment. The row being edited + the draft name; the roster comes
  // from the shared pool hook so the runner and the CRM lead picker can't offer
  // different lists.
  const [staffEditRowId, setStaffEditRowId] = useState<string | null>(null)
  const [staffDraft, setStaffDraft] = useState('')
  const [staffSaving, setStaffSaving] = useState(false)
  const staffPools = useStaffPools()
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
        // Adopt-only: the runner never creates a work order. WO creation happens at
        // booking-save (admin). If none exists yet, fall through to the error state below.
        //
        // Resolve via the booking card's OWN work_order_id first. Post-rebuild a
        // WO writes several projection cards that all carry work_order_id, while
        // work_orders.booking_id names only the original — so the reverse lookup
        // below fails for every card except that one. See the matching comment in
        // app/runner/[studio]/page.tsx.
        const { data: bk } = await supabase
          .from('bookings')
          .select('work_order_id')
          .eq('id', bookingId)
          .maybeSingle()
        if (bk?.work_order_id) resolvedId = bk.work_order_id
      }

      if (!resolvedId && bookingId) {
        // Fallback for pre-rebuild bookings whose work_order_id was never set.
        const { data: existingRows } = await supabase
          .from('work_orders')
          .select('id')
          .eq('booking_id', bookingId)
          .order('created_at', { ascending: true })
          .limit(1)
        if (existingRows?.[0]) resolvedId = existingRows[0].id
      }

      if (!resolvedId) {
        setWoMissing('Work order not yet created — contact office.')
        setLoading(false)
        return
      }
      woRef.current = resolvedId
      setResolvedWoId(resolvedId)

      // Fetch WO first to get booking_id, then fetch linked booking + rows in parallel
      const { data: woData } = await supabase.from('work_orders').select('*').eq('id', resolvedId).single()
      if (!woData) {
        // Stale / deleted WO id in the URL — never blank-render.
        setWoMissing('Work order not found — contact office.')
        setLoading(false)
        return
      }

      const [{ data: bkData }, { data: st }, { data: eq }, { data: pay }, { data: eqNotes }] = await Promise.all([
        (woData?.booking_id || bookingId)
          ? supabase.from('bookings').select('*').eq('id', woData?.booking_id || bookingId).single()
          : Promise.resolve({ data: null }),
        supabase.from('studio_time_rows').select('*').eq('work_order_id', resolvedId).order('sort_order'),
        supabase.from('equipment_condition_rows').select('*').eq('work_order_id', resolvedId),
        supabase.from('payment_rows').select('*').eq('work_order_id', resolvedId).order('recorded_at'),
        supabase.from('equipment_condition_notes').select('*').eq('work_order_id', resolvedId),
      ])

      if (!bkData) {
        // WO with no linked booking (orphan) — show an error instead of blank session/client.
        // After centralized creation every WO has a valid booking_id, so this is defensive.
        setWoMissing('This work order is not linked to a booking — contact office.')
        setLoading(false)
        return
      }

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
      const conds: EquipCond = {}
      for (const r of eq ?? []) {
        conds[`${r.equipment}||${r.date}`] = r.condition
      }
      setEquipConds(conds)

      const payMapped = (pay ?? []).map((p: any) => ({
        id: p.id,
        payment_type: p.payment_type ?? '',
        amount: p.amount != null ? formatCurrency(String(p.amount)) : '',
        memo: p.memo ?? '',
        last_four: p.last_four ?? '',
      }))
      setPayRows(payMapped)
      payMapped.forEach((p: any) => payIdsInDb.current.add(p.id))
      initialSigRef.current = woData?.signature_data ?? ''
      setSignatureData(woData?.signature_data ?? '')
      setPrintName(woData?.print_name ?? '')

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

  useEffect(() => {
    if (loading) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = '#e8eaf2'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (initialSigRef.current) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      img.src = initialSigRef.current
    }
  }, [loading])

  function getCanvasPos(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) {
    const rect = canvas.getBoundingClientRect()
    let clientX: number, clientY: number
    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    } else if ('changedTouches' in e && (e as React.TouchEvent).changedTouches.length > 0) {
      clientX = (e as React.TouchEvent).changedTouches[0].clientX
      clientY = (e as React.TouchEvent).changedTouches[0].clientY
    } else {
      clientX = (e as React.MouseEvent).clientX
      clientY = (e as React.MouseEvent).clientY
    }
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  function startDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    isDrawingRef.current = true
    const ctx = canvas.getContext('2d')!
    ctx.strokeStyle = '#e8eaf2'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const pos = getCanvasPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  function continueDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const pos = getCanvasPos(e, canvas)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
  }

  function endDraw() {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    const canvas = canvasRef.current
    if (!canvas) return
    setSignatureData(canvas.toDataURL('image/png'))
  }

  function clearSignature() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setSignatureData('')
  }

  async function toggleEquip(eq: string, date: string, val: 'ok' | 'not_ok') {
    const key = `${eq}||${date}`
    const newVal = equipConds[key] === val ? null : val
    setEquipConds(prev => ({ ...prev, [key]: newVal }))
    const row = equipRows.find((r: any) => r.equipment === eq && r.date === date)
    if (row) {
      const { error: eqErr } = await supabase.from('equipment_condition_rows').update({ condition: newVal }).eq('id', row.id)
      if (!dbResult('Saving equipment condition', eqErr)) return
    }
    if (newVal === 'not_ok') setOpenNoteKey(key)
    else setOpenNoteKey(prev => prev === key ? null : prev)
  }

  async function upsertEquipNote(key: string, equipment: string, date: string, updates: { note?: string; photo_urls?: string[] }) {
    if (!woRef.current) return
    const current = equipNotes[key]
    const merged = { note: current?.note ?? '', photo_urls: current?.photo_urls ?? [], ...updates }
    if (current?.id) {
      const { error: eqNoteErr } = await supabase.from('equipment_condition_notes').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', current.id)
      if (!dbResult('Saving equipment note', eqNoteErr)) return
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
      // Store the storage PATH — checklist-photos is private; reads sign on demand.
      const currentPhotos = equipNotes[pending.key]?.photo_urls ?? []
      await upsertEquipNote(pending.key, pending.equipment, pending.date, { photo_urls: [...currentPhotos, data.path] })
    }
    setNoteUploading(false)
    if (equipNoteFileRef.current) equipNoteFileRef.current.value = ''
    pendingNoteKey.current = null
  }

  async function uploadNAPhoto(file: File) {
    if (!woRef.current) return
    setNaUploading(true)
    const ext = file.name.split('.').pop()
    const path = `na-photos/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

    const { data, error: uploadError } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })

    if (!uploadError && data) {
      // Store the storage PATH — checklist-photos is private; reads sign on demand.
      const newPhotos = [...needsAttentionPhotos, data.path]
      setNeedsAttentionPhotos(newPhotos)
      const { error: dbError } = await supabase.from('work_orders')
        .update({ needs_attention_photos: newPhotos })
        .eq('id', woRef.current)
      // A console.error is invisible to a runner on a phone — surface it.
      if (!dbResult('Saving attention photo', dbError)) setNeedsAttentionPhotos(needsAttentionPhotos)
    } else {
      dbResult('Uploading attention photo', uploadError)
    }

    setNaUploading(false)
    if (naFileRef.current) naFileRef.current.value = ''
  }

  async function deleteNAPhoto(url: string) {
    const updated = needsAttentionPhotos.filter(u => u !== url)
    setNeedsAttentionPhotos(updated)
    if (woRef.current) {
      const { error: rmErr } = await supabase.from('work_orders')
        .update({ needs_attention_photos: updated.length > 0 ? updated : null })
        .eq('id', woRef.current)
      // Put the photo back on screen if the removal didn't land.
      if (!dbResult('Removing attention photo', rmErr)) setNeedsAttentionPhotos(needsAttentionPhotos)
    }
  }

  async function handleSaveChanges() {
    if (!woRef.current) return
    setSaving(true)
    // Every write's error is collected and reported ONCE at the end.
    //
    // This function used to `router.push` back to the studio hub unconditionally,
    // with none of its writes checked — so a save that failed on flaky studio wifi
    // bounced the runner to the hub believing their shift was recorded, and nothing
    // surfaced anywhere. On failure we now report and STAY on the page so the work
    // is still on screen to retry.
    const failed: string[] = []
    let firstError: { message?: string; details?: string; code?: string } | null = null
    const note = (label: string, error: any) => {
      if (!error) return
      failed.push(label)
      if (!firstError) firstError = error
    }

    const { error: woErr } = await supabase.from('work_orders').update({
      session_notes: sessionNotes,
      needs_attention_notes: needsAttentionNotes || null,
      needs_attention_photos: needsAttentionPhotos.length > 0 ? needsAttentionPhotos : null,
      print_name: printName || null,
      signature_data: signatureData || null,
    }).eq('id', woRef.current)
    note('work order', woErr)

    const woId = woRef.current
    if (needsAttentionNotes.trim()) {
      const artistPart = booking?.artist || wo?.artist || ''
      const clientPart = booking?.client_name || wo?.client || booking?.label || wo?.label || ''
      const sessionParts = [artistPart, clientPart].filter(Boolean).join(' / ')
      const sourceLabel = sessionParts ? `${meta.label} · ${sessionParts}` : meta.label
      const { data: existingFlag } = await supabase
        .from('flags')
        .select('id')
        .eq('source_id', woId)
        .eq('source', 'wo_flag')
        .maybeSingle()
      if (existingFlag) {
        await supabase.from('flags').update({
          runner_note: needsAttentionNotes.trim(),
          status: 'pending',
        }).eq('id', existingFlag.id)
      } else {
        await supabase.from('flags').insert({
          studio,
          source: 'wo_flag',
          source_id: woId,
          source_label: sourceLabel,
          runner_note: needsAttentionNotes.trim(),
          status: 'pending',
        })
      }
    } else {
      const { data: existingFlag } = await supabase
        .from('flags')
        .select('id')
        .eq('source_id', woId)
        .eq('source', 'wo_flag')
        .maybeSingle()
      if (existingFlag) {
        await supabase.from('flags').update({
          status: 'resolved',
          resolved_note: 'Needs attention cleared by runner',
        }).eq('id', existingFlag.id)
      }
    }

    // Save time/hours/charge for all rows (per-row row_rate_type)
    const hasEngineer = !!(wo?.engineer || booking?.engineer_name)
    if (stRows.length > 0) {
      const stResults = await Promise.all(stRows.map((r: any) => {
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
          const otHrsNum = parseFloat(otHours[r.id] || '0') || 0
          const otRateNum = parseFloat(String(r.ot_rate ?? r.rate ?? '0').replace(/[^0-9.]/g, '')) || 0
          update.ot_hours = otHrsNum || null
          update.ot_charge = otHrsNum > 0 && otRateNum > 0 ? parseFloat((otHrsNum * otRateNum).toFixed(2)) : null
        }
        if (hasEngineer || r.eng_name) {
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
      for (const res of stResults) note('studio time', (res as any)?.error)
    }

    // Save payment rows
    const payToSave = payRows.filter(p => p.payment_type || p.amount)
    const payResults = await Promise.all(payToSave.map(p => {
      const payload = {
        id: p.id,
        work_order_id: woRef.current!,
        payment_type: p.payment_type || null,
        amount: stripCurrency(p.amount),
        memo: p.memo || null,
        last_four: p.last_four || null,
      }
      return payIdsInDb.current.has(p.id)
        ? supabase.from('payment_rows').update(payload).eq('id', p.id)
        : supabase.from('payment_rows').insert(payload)
    }))
    for (const res of payResults) note('payments', (res as any)?.error)

    setSaving(false)
    if (failed.length > 0) {
      // Stay put — the runner's unsaved work is still on screen to retry.
      dbResult(`Saving ${Array.from(new Set(failed)).join(', ')}`, firstError)
      return
    }
    router.push(`/runner/${studio}`)
  }

  // Reassign the staff member on a studio-time row.
  //
  // Written straight to the database rather than queued for Save, because
  // eng_name is NOT part of handleSaveChanges (that only persists the engineer's
  // times/hours/charge) — a queued edit would be silently dropped. Matches how
  // the date cell on this table already writes immediately.
  //
  // scope 'all' targets every row sharing the edited row's ROLE, so changing the
  // engineer across a 30-day booking can't wipe out the assistants. A 30-day run
  // otherwise meant setting the same name thirty times.
  // Reassign the staff member on ONE row.
  //
  // Deliberately single-day only. Bulk changes across a run belong to Admin's
  // batch edit — a runner is recording what actually happened on their shift, and
  // an accidental "all days" from a phone would silently rewrite staffing on days
  // they have no visibility into.
  async function saveStaffName() {
    const row: any = stRows.find((x: any) => x.id === staffEditRowId)
    if (!row) return
    const name = staffDraft.trim()
    setStaffSaving(true)
    // eng_visible so a name typed onto a previously-cleared row actually shows.
    const patch = { eng_name: name || null, eng_visible: true }
    const { error } = await supabase.from('studio_time_rows').update(patch).eq('id', row.id)
    setStaffSaving(false)
    if (!dbResult('Updating staff', error)) return
    setStRows((prev: any[]) => prev.map((x: any) => x.id === row.id ? { ...x, ...patch } : x))
    setStaffEditRowId(null)
    setExpandedEngRow(null)
    setEngPopoverPos(null)
  }

  async function saveNotesModal() {
    if (!notesModalRowId) return
    const { error: noteErr } = await supabase.from('studio_time_rows').update({ session_info: notesModalText }).eq('id', notesModalRowId)
    if (!dbResult('Saving session notes', noteErr)) return
    setStRows(prev => prev.map((r: any) => r.id === notesModalRowId ? { ...r, session_info: notesModalText } : r))
    const scrollY = notesScrollRef.current
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.width = ''
    setNotesModalRowId(null)
    window.scrollTo({ top: scrollY, behavior: 'instant' })
  }

  function getInitials(name: string) {
    return name.split(/\s+/).filter(Boolean).map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
  }

  function shortDate(d: string) {
    if (!d) return '—'
    const parts = d.split('-')
    if (parts.length < 3) return d
    return `${parseInt(parts[1], 10)}-${parseInt(parts[2], 10)}`
  }

  const sessionDates = Array.from(new Set(stRows.map((r: any) => r.date).filter(Boolean))).sort() as string[]

  const stTotal = stRows.reduce((s: number, r: any) => {
    const liveFrom = fromTimeMap[r.id] ?? r.from_time ?? ''
    const liveTo = toTimeMap[r.id] ?? r.to_time ?? ''
    const otRateNum = parseFloat(String(r.ot_rate ?? r.rate ?? '0').replace(/[^0-9.]/g, '')) || 0
    if (r.row_rate_type === 'day') {
      const rateDailyNum = parseFloat(String(r.rate_daily ?? r.rate ?? '').replace(/[^0-9.]/g, '')) || 0
      const actualHrs = calcHours(liveFrom, liveTo) ?? 0
      const autoOtHrs = Math.max(0, parseFloat(actualHrs.toFixed(2)) - 12)
      return s + rateDailyNum + (autoOtHrs > 0 && otRateNum > 0 ? autoOtHrs * otRateNum : 0)
    }
    const liveHrs = calcHours(liveFrom, liveTo)
    const rateNum = parseFloat(String(r.rate ?? '').replace(/[^0-9.]/g, '')) || 0
    const otHrsNum = parseFloat(otHours[r.id] || '0') || 0
    const base = liveHrs != null && rateNum > 0 ? liveHrs * rateNum : (parseFloat(String(r.charge ?? '0')) || 0)
    return s + base + (otHrsNum > 0 && otRateNum > 0 ? otHrsNum * otRateNum : 0)
  }, 0)

  const engTotal = stRows.reduce((sum: number, r: any) => {
    const engRateRaw = r.eng_rate || booking?.engineer_rate || ''
    const rate = parseFloat(String(engRateRaw).replace(/[^0-9.]/g, '')) || 0
    if (!rate) return sum
    const ef = engFromTimeMap[r.id] ?? r.eng_from_time ?? r.from_time ?? ''
    const et = engToTimeMap[r.id] ?? r.eng_to_time ?? r.to_time ?? ''
    const hrs = calcHours(ef, et) ?? 0
    return sum + (hrs > 0 ? hrs * rate : 0)
  }, 0)

  const rentTotal = ((wo?.rental_rows ?? []) as any[]).reduce((s: number, r: any) => {
    return s + (parseFloat(String(r.charge ?? '0').replace(/[^0-9.]/g, '')) || 0)
  }, 0)

  const totalPaid = payRows.reduce((s, p) => s + (stripCurrency(p.amount) ?? 0), 0)
  const grandTotal = stTotal + engTotal + rentTotal
  const balanceDue = grandTotal - totalPaid

  if (loading) return (
    <div style={{ minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontFamily: 'Syne, sans-serif' }}>
      Loading…
    </div>
  )

  if (woMissing) return (
    <div style={{ minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Syne, sans-serif' }}>
      <div style={{ maxWidth: 320, padding: 24, background: 'var(--surface)', border: '1px solid rgba(240,78,122,0.35)', borderRadius: 12, textAlign: 'center' }}>
        <div style={{ color: '#f04e7a', fontFamily: 'Inter', fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>{woMissing}</div>
        <button onClick={() => router.back()} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 18px', fontFamily: 'Inter', fontSize: 11, cursor: 'pointer' }}>Back</button>
      </div>
    </div>
  )

  const isCompleted = wo?.status === 'completed'
  const isCOD = (booking?.payment_type ?? wo?.payment_status ?? '').toString().toUpperCase() === 'COD'

  return (
    <div style={{ minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden', background: 'var(--bg)', fontFamily: 'Syne, sans-serif', paddingBottom: 100 }}>
      {/*
        Session Notes — FULL-SCREEN on purpose. This was a 38vh card pinned to
        bottom:16, which put it exactly where the iOS keyboard appears: autoFocus
        opened the keyboard, the keyboard overlaid the sheet, and the runner saw
        nothing. Filling the screen from the top keeps the title, the Save button
        and the first lines of text above the keyboard. Save is duplicated in the
        header for the same reason — the footer buttons sit behind the keyboard
        while typing.
      */}
      {notesModalRowId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10002, display: 'flex', flexDirection: 'column', background: 'var(--surface)', boxSizing: 'border-box' }}>
          <div style={{ width: '100%', boxSizing: 'border-box', paddingTop: 'calc(14px + env(safe-area-inset-top))', paddingBottom: 10, paddingLeft: 16, paddingRight: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: '#f0f0f0' }}>Session Notes</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={saveNotesModal} style={{ background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 6, padding: '7px 16px', fontFamily: 'Syne', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Save</button>
              <button onClick={() => { const scrollY = notesScrollRef.current; document.body.style.position = ''; document.body.style.top = ''; document.body.style.width = ''; setNotesModalRowId(null); window.scrollTo({ top: scrollY, behavior: 'instant' }) }} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 26, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
            </div>
          </div>
          <textarea
            value={notesModalText}
            onChange={e => setNotesModalText(e.target.value)}
            placeholder="Song names, notes, instructions…"
            style={{ flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontFamily: 'Inter', fontSize: 16, paddingTop: 14, paddingBottom: 0, paddingLeft: 16, paddingRight: 16, resize: 'none', lineHeight: 1.6, overflowY: 'auto' }}
            autoFocus
          />
          <div style={{ width: '100%', boxSizing: 'border-box', display: 'flex', gap: 10, paddingTop: 10, paddingLeft: 16, paddingRight: 16, paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', flexShrink: 0 }}>
            <button onClick={saveNotesModal} style={{ flex: 1, background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 8, padding: '11px 0', fontFamily: 'Syne', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Save</button>
            <button onClick={() => { const scrollY = notesScrollRef.current; document.body.style.position = ''; document.body.style.top = ''; document.body.style.width = ''; setNotesModalRowId(null); window.scrollTo({ top: scrollY, behavior: 'instant' }) }} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', color: 'var(--text2)', border: 'none', borderRadius: 8, padding: '11px 0', fontFamily: 'Syne', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {/* Engineer name popover */}
      {expandedEngRow && engPopoverPos && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => { setExpandedEngRow(null); setEngPopoverPos(null) }} />
          <div style={{ position: 'fixed', top: engPopoverPos.top - 8, left: engPopoverPos.left, transform: 'translateY(-100%)', zIndex: 99, background: 'var(--surface2)', border: '1px solid var(--accent)', borderRadius: 6, padding: '6px 10px', whiteSpace: 'nowrap' }}>
            {(() => {
              // Per-day staff name: the expanded row's eng_name, falling back to
              // the WO/booking engineer (or booking assistant for 2ND rows).
              const row: any = stRows.find((x: any) => x.id === expandedEngRow)
              const isAsst = row?.eng_role === 'assistant'
              const name = row?.eng_name || (isAsst ? (booking?.assistant_name || '') : (wo?.engineer || booking?.engineer_name || ''))
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'Inter', fontSize: 12, color: isAsst ? 'var(--warm)' : 'var(--accent)' }}>
                    {isAsst ? '2ND · ' : '1ST · '}{name || 'Unassigned'}
                  </span>
                  {!row?.admin_locked && (
                    <button
                      onClick={() => {
                        // Seed the draft with the row's OWN name only. Deliberately
                        // not the WO-level fallback — that would silently pin an
                        // inherited name onto the row on save.
                        setStaffDraft(row?.eng_name || '')
                        setStaffEditRowId(row.id)
                        setExpandedEngRow(null)
                        setEngPopoverPos(null)
                      }}
                      style={{ padding: '3px 9px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontFamily: 'Syne', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', cursor: 'pointer' }}
                    >
                      Change
                    </button>
                  )}
                </span>
              )
            })()}
          </div>
        </>
      )}
      {/* Staff reassignment sheet. Centred rather than anchored to the pill: the
          pill sits mid-table on a narrow screen and an anchored dropdown had
          nowhere to open. Top-anchored so the keyboard can't cover it. */}
      {staffEditRowId && (() => {
        const row: any = stRows.find((x: any) => x.id === staffEditRowId)
        if (!row) return null
        const isAsst = (row.eng_role || 'assistant') === 'assistant'
        const pool = isAsst ? staffPools.assistant : staffPools.engineer
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 10003, background: 'rgba(0,0,0,0.6)' }} onClick={() => setStaffEditRowId(null)} />
            <div style={{ position: 'fixed', top: 'calc(24px + env(safe-area-inset-top))', left: 12, right: 12, zIndex: 10004, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
                  {isAsst ? 'Assistant (2ND)' : 'Engineer (1ST)'}
                </span>
                <button onClick={() => setStaffEditRowId(null)} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 24, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
              <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--text3)', marginBottom: 12 }}>
                {shortDate(row.date || '')}{row.studio ? ` · ${row.studio}` : ''}
              </div>
              {/* A real tappable list, NOT <datalist>. iOS Safari renders datalist
                  as a floating autofill-style bubble mid-screen with no visible
                  dropdown — you had to know to type. autoComplete/autoCorrect off
                  also stops iOS offering "AutoFill Contact" over a name field. */}
              <input
                value={staffDraft}
                onChange={e => setStaffDraft(e.target.value)}
                placeholder={isAsst ? 'Assistant name' : 'Engineer name'}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: 'Inter', fontSize: 16, padding: '11px 12px', outline: 'none', marginBottom: 10 }}
              />
              {pool.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, maxHeight: 168, overflowY: 'auto' }}>
                  {pool.map(n => {
                    const on = staffDraft.trim().toLowerCase() === n.toLowerCase()
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setStaffDraft(n)}
                        style={{ padding: '9px 12px', borderRadius: 999, border: `1px solid ${on ? (isAsst ? 'var(--warm)' : 'var(--accent)') : 'var(--border)'}`, background: on ? (isAsst ? 'rgba(249,115,22,0.12)' : 'rgba(var(--accent-rgb),0.12)') : 'var(--surface2)', color: on ? (isAsst ? 'var(--warm)' : 'var(--accent)') : 'var(--text)', fontFamily: 'Inter', fontSize: 13, cursor: 'pointer' }}
                      >
                        {n}
                      </button>
                    )
                  })}
                </div>
              )}
              <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text3)', marginBottom: 14 }}>
                Tap a name, or type one that isn’t listed. Clear the field to unassign.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={() => saveStaffName()}
                  disabled={staffSaving}
                  style={{ width: '100%', background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 8, padding: '12px 0', fontFamily: 'Syne', fontWeight: 700, fontSize: 14, cursor: staffSaving ? 'default' : 'pointer', opacity: staffSaving ? 0.6 : 1 }}
                >
                  {staffSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {/* Header */}
      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={() => router.push(`/runner/${studio}`)} style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>←</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
            Work Order
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'Inter' }}>
            {booking?.client_name || wo?.client_name || wo?.client || '—'} · {booking?.start_date || wo?.session_date || ''}
          </div>
        </div>
      </div>

      {isCompleted && (
        <div style={{ background: 'rgba(20,184,166,0.12)', borderBottom: '1px solid rgba(20,184,166,0.3)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--booked)' }}>✓</span>
          <span style={{ fontSize: 12, color: 'var(--booked)', fontFamily: 'Inter', fontWeight: 700 }}>This work order has been completed by admin. It is now read-only.</span>
        </div>
      )}

      <div style={{ padding: '16px 16px', pointerEvents: isCompleted ? 'none' : undefined, opacity: isCompleted ? 0.65 : 1 }}>
        {/* Session Info */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 10 }}>Session Info</div>
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
            ['Assistant', booking?.assistant_name],
            ['Date',     booking?.start_date   || wo?.session_date],
            ['Time',     [booking?.from_time || wo?.from_time, booking?.to_time || wo?.to_time].filter(Boolean).join(' – ')],
            ['Studio',   booking?.studio || (wo?.studios ?? []).join(', ')],
          ].filter(([, v]) => v).map(([l, v]) => (
            <div key={String(l)} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'Inter', minWidth: 60 }}>{l}</span>
              <span style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'Inter' }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Studio Time */}
        {(() => {
          // Centred columns: this is a short-value numeric table, so left-aligned
          // cells left ragged gaps against their headers. 9px → 11px on the header
          // and 11px → 12px in the body; the old sizes were below comfortable
          // reading on a phone, which was the actual complaint.
          const thStyle: React.CSSProperties = {
            padding: '6px 6px', fontSize: 9, fontFamily: 'Syne, sans-serif', fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text2)',
            borderRight: '1px solid var(--border)', whiteSpace: 'nowrap', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' as const,
          }
          const tdStyle: React.CSSProperties = {
            padding: '8px 6px', fontSize: 12, fontFamily: 'Inter', color: 'var(--text)',
            borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', textAlign: 'center' as const, overflow: 'hidden',
          }

          const engName = wo?.engineer || booking?.engineer_name || ''

          // Distinct dated days on this WO — drives the scope toggle's label and
          // whether it's worth showing at all.
          const stDates = Array.from(new Set(stRows.map((r: any) => r.date).filter(Boolean))) as string[]
          const stDayCount = stDates.length
          // Today's rows, plus any undated row (manually added, not yet dated) so
          // it can never become invisible and unreachable.
          const today = getLocalToday()
          const todayRows = stRows.filter((r: any) => !r.date || r.date === today)
          // If today has nothing, show everything rather than an empty table —
          // a WO opened a day early would otherwise look broken.
          const visibleStRows = showAllDays || todayRows.length === 0 ? stRows : todayRows
          // Zebra by DAY, not by row: each day is 2–3 lines once staff sub-rows
          // are in, so per-row striping made the grouping harder to see, not easier.
          const dayIndexFor = (d: string | null) => (d ? stDates.indexOf(d) : -1)

          // ONE grid definition for the header, the studio rows and the staff
          // sub-rows — it used to be the same literal repeated three times, so
          // header and body could drift apart. Date + Studio lead so they can be
          // frozen while the numeric columns scroll.
          const ST_GRID = '52px 58px 56px 84px 84px 44px 38px 68px 48px 58px 54px 64px'
          const ST_MIN_WIDTH = 706
          // Frozen identity columns: scrolling right used to lose which day (and
          // which room) a line belonged to — a real part of why this read badly.
          //
          // The background MUST be opaque or the scrolling columns show through the
          // frozen ones. Row tints are translucent rgba by design (they layer over
          // the card), so compose them: paint the tint as a gradient layer on top of
          // an opaque --surface base. Passing the raw rgba here is the bug that made
          // the staff row's times bleed under the date column.
          const opaqueBg = (tint?: string) =>
            tint ? `linear-gradient(${tint}, ${tint}), var(--surface)` : 'var(--surface)'
          const stickyCell = (left: number, tint?: string): React.CSSProperties => ({
            position: 'sticky', left, zIndex: 2, background: opaqueBg(tint),
          })

          return (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
              {/* Header: title + day scope. A 30-day work order is unreadable as
                  one list, and a runner on shift wants tonight — so this defaults
                  to today and keeps everything one tap away for when a client asks
                  about the whole run. Filtering only affects what's RENDERED;
                  handleSaveChanges iterates all of stRows, so edits to hidden days
                  still save. */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px 8px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)' }}>Studio Time</span>
                {stDayCount > 1 && (
                  <button
                    onClick={() => setShowAllDays(v => !v)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${showAllDays ? 'var(--accent)' : 'var(--border)'}`, background: showAllDays ? 'rgba(var(--accent-rgb),0.10)' : 'transparent', color: showAllDays ? 'var(--accent)' : 'var(--text2)', fontFamily: 'Syne', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {showAllDays ? `All ${stDayCount} days` : 'Today only'}
                  </button>
                )}
              </div>
              {stRows.length === 0 ? (
                <div style={{ padding: '14px', color: 'var(--text2)', fontSize: 12, fontFamily: 'Inter', textAlign: 'center' }}>
                  Session times will appear here
                </div>
              ) : visibleStRows.length === 0 ? (
                <div style={{ padding: '14px', color: 'var(--text2)', fontSize: 12, fontFamily: 'Inter', textAlign: 'center' }}>
                  Nothing scheduled today — tap “All {stDayCount} days”.
                </div>
              ) : (
                /* Date | Studio | Notes | From | To | Hrs | Type | Rate | OT Hrs | OT Rate | OT Chg | Total */
                <div style={{ overflowX: 'auto', width: '100%' }}>
                  <div style={{ minWidth: ST_MIN_WIDTH }}>
                    <div style={{ display: 'grid', gridTemplateColumns: ST_GRID, background: 'var(--bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                      {['Date', 'Studio', 'Notes', 'From', 'To', 'Hrs', 'Type', 'Rate', 'OT Hrs', 'OT Rate', 'OT Chg', 'Total'].map((h, hi) => (
                        <div key={h} style={{ ...thStyle, ...(hi < 2 ? stickyCell(hi === 0 ? 0 : 52, 'var(--bg)') : {}), zIndex: hi < 2 ? 3 : undefined }}>{h}</div>
                      ))}
                    </div>
                    <div>
                      {visibleStRows.map((r: any) => {
                        const isDayRow = r.row_rate_type === 'day'
                        const liveFrom = fromTimeMap[r.id] ?? r.from_time ?? ''
                        const liveTo = toTimeMap[r.id] ?? r.to_time ?? ''
                        const engRateForRow = parseFloat(String(r.eng_rate || booking?.engineer_rate || '').replace(/[^0-9.]/g, '')) || 0
                        const engLiveFrom = engFromTimeMap[r.id] ?? r.eng_from_time ?? r.from_time ?? ''
                        const engLiveTo = engToTimeMap[r.id] ?? r.eng_to_time ?? r.to_time ?? ''
                        const engLiveHours = calcHours(engLiveFrom, engLiveTo)
                        const liveEngCharge = engLiveHours != null && engLiveHours > 0 && engRateForRow > 0 ? parseFloat((engLiveHours * engRateForRow).toFixed(2)) : null
                        const rowHrs = calcHours(liveFrom, liveTo)
                        const otRateNum = parseFloat(String(r.ot_rate ?? r.rate ?? '0').replace(/[^0-9.]/g, '')) || 0

                        let autoOtHrs = 0
                        let otCharge = 0
                        let rowTotal: number | null = null
                        if (isDayRow) {
                          const rateDailyNum = parseFloat(String(r.rate_daily ?? r.rate ?? '').replace(/[^0-9.]/g, '')) || 0
                          autoOtHrs = Math.max(0, parseFloat((rowHrs ?? 0).toFixed(2)) - 12)
                          otCharge = autoOtHrs > 0 && otRateNum > 0 ? parseFloat((autoOtHrs * otRateNum).toFixed(2)) : 0
                          rowTotal = rateDailyNum > 0 ? parseFloat((rateDailyNum + otCharge).toFixed(2)) : null
                        } else {
                          const liveHours = rowHrs
                          const rateNum = parseFloat(String(r.rate ?? '').replace(/[^0-9.]/g, '')) || 0
                          const otHrsNum = parseFloat(otHours[r.id] || '0') || 0
                          otCharge = otHrsNum > 0 && otRateNum > 0 ? parseFloat((otHrsNum * otRateNum).toFixed(2)) : 0
                          const base = liveHours != null && rateNum > 0 ? parseFloat((liveHours * rateNum).toFixed(2)) : null
                          rowTotal = base != null ? parseFloat((base + otCharge).toFixed(2)) : null
                        }

                        // 12px, not 10 — the old size was below comfortable reading
                        // on a phone, which is most of why this table felt bad.
                        const tSel = { background: 'transparent', color: 'var(--text)', border: 'none', fontSize: 12, fontFamily: 'Inter', width: '100%', textAlign: 'center' as const }
                        // Per-day staff: row eng_name first, else the WO/booking-level
                        // engineer (or booking assistant for 2ND rows).
                        const isAsstRow = r.eng_role === 'assistant'
                        const rowStaffName = r.eng_name || (isAsstRow ? (booking?.assistant_name || '') : engName)
                        const initials = rowStaffName ? getInitials(rowStaffName) : ''
                        const engExpanded = expandedEngRow === r.id
                        const hasNotes = !!(r.session_info || '').trim()

                        // A blank studio IS the encoding for a standalone staff row
                        // (the WO's "+ Add Engineer" / "+ Add Assistant" buttons).
                        // Those have no room, times or rate, so rendering them as a
                        // full studio-time line produced a row of dashes that looked
                        // like a duplicate of the day above it — the runner view was
                        // written before standalone staff rows existed. Render the
                        // staff line only.
                        const isStaffOnlyRow = !(r.studio || '').trim()

                        // Respect eng_visible, as the admin table does. Without this
                        // a row whose staff line was explicitly cleared still showed
                        // one, because rowStaffName falls back to the WO-level
                        // engineer — the second half of the apparent duplication.
                        const showStaffRow = !!rowStaffName && (isStaffOnlyRow || r.eng_visible !== false)

                        // Zebra by day so each day's 2–3 lines read as one block.
                        // Locked rows keep their teal tint (it means something).
                        const dayIdx = dayIndexFor(r.date)
                        // A TINT (or none) — sticky cells composite it over an
                        // opaque base; the row itself layers it over the card.
                        const rowTint = r.admin_locked
                          ? 'rgba(20,184,166,0.06)'
                          : dayIdx >= 0 && dayIdx % 2 === 1 ? 'rgba(255,255,255,0.022)' : undefined
                        return (
                          <div key={r.id} style={{ background: rowTint ?? 'transparent' }}>
                            {!isStaffOnlyRow && (
                            <div style={{ display: 'grid', gridTemplateColumns: ST_GRID, borderBottom: showStaffRow ? 'none' : '1px solid var(--border)' }}>
                              {/* Date — frozen left. `position: sticky` is itself a
                                  positioned ancestor, so the absolute date-picker
                                  overlay below still anchors to this cell. */}
                              <div style={{ ...tdStyle, ...stickyCell(0, rowTint), color: 'var(--text)', cursor: 'pointer' }}>
                                <span style={{ pointerEvents: 'none' }}>{shortDate(r.date || '')}</span>
                                <input
                                  type="date"
                                  value={r.date || ''}
                                  onChange={e => {
                                    const newDate = e.target.value
                                    setStRows((prev: any[]) => {
                                      const sorted = prev
                                        .map((row: any) => row.id === r.id ? { ...row, date: newDate } : row)
                                        .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
                                        .map((row: any, i: number) => ({ ...row, sort_order: i }))
                                      sorted.forEach(async (row: any) => {
                                        const { error: dErr } = await supabase.from('studio_time_rows').update({ date: row.date, sort_order: row.sort_order }).eq('id', row.id)
                                        dbResult('Saving date', dErr)
                                      })
                                      return sorted
                                    })
                                  }}
                                  disabled={!!r.admin_locked}
                                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: r.admin_locked ? 'default' : 'pointer', width: '100%', height: '100%' }}
                                />
                              </div>
                              {/* Studio — frozen left, beside the date. This column
                                  did not exist on the runner view at all, which is
                                  what made two legitimate rooms on one date look
                                  like a duplicated row. */}
                              <div style={{ ...tdStyle, ...stickyCell(52, rowTint), color: 'var(--text)', fontWeight: 700 }}>
                                {r.studio || '—'}
                              </div>
                              {/* Notes — opens the full-screen sheet */}
                              <div style={{ ...tdStyle, padding: '4px 3px' }}>
                                <button
                                  onClick={() => { if (r.admin_locked) return; notesScrollRef.current = window.scrollY; document.body.style.top = `-${window.scrollY}px`; document.body.style.position = 'fixed'; document.body.style.width = '100%'; setNotesModalRowId(r.id); setNotesModalText(r.session_info || '') }}
                                  disabled={!!r.admin_locked}
                                  style={{ width: '100%', padding: '3px 4px', border: `1px solid ${hasNotes ? 'var(--accent)' : '#3a3f52'}`, borderRadius: 4, background: hasNotes ? 'rgba(var(--accent-rgb),0.08)' : 'transparent', color: hasNotes ? 'var(--accent)' : 'var(--text2)', fontSize: 11, fontFamily: 'Syne', cursor: r.admin_locked ? 'default' : 'pointer', opacity: r.admin_locked ? 0.4 : 1 }}
                                >Notes</button>
                              </div>
                              {/* From / To */}
                              <div style={{ ...tdStyle, padding: '2px 3px' }}><TimeInput value={liveFrom} onChange={v => setFromTimeMap(prev => ({ ...prev, [r.id]: v }))} style={tSel} disabled={!!r.admin_locked} /></div>
                              <div style={{ ...tdStyle, padding: '2px 3px' }}><TimeInput value={liveTo} onChange={v => setToTimeMap(prev => ({ ...prev, [r.id]: v }))} style={tSel} disabled={!!r.admin_locked} /></div>
                              {/* Hrs */}
                              <div style={{ ...tdStyle, color: 'var(--text)' }}>{rowHrs != null ? `${rowHrs}h` : '—'}</div>
                              {/* Type */}
                              <div style={{ ...tdStyle, fontSize: 11, color: isDayRow ? 'var(--accent)' : 'var(--text2)' }}>{isDayRow ? 'Day' : 'Hr'}</div>
                              {/* Rate */}
                              <div style={{ ...tdStyle, color: 'var(--text)' }}>
                                {isDayRow
                                  ? (parseFloat(String(r.rate_daily ?? r.rate ?? '').replace(/[^0-9.]/g, '')) > 0 ? `$${parseFloat(String(r.rate_daily ?? r.rate ?? '').replace(/[^0-9.]/g, '')).toLocaleString()}/d` : '—')
                                  : (parseFloat(String(r.rate ?? '').replace(/[^0-9.]/g, '')) > 0 ? `$${parseFloat(String(r.rate ?? '').replace(/[^0-9.]/g, ''))}/hr` : '—')
                                }
                              </div>
                              {/* OT Hrs — day: auto display; hourly: editable */}
                              <div style={{ ...tdStyle, padding: '2px 3px' }}>
                                {isDayRow
                                  ? <span style={{ fontSize: 9, color: 'var(--text2)' }}>{autoOtHrs > 0 ? `${autoOtHrs}h` : '—'}</span>
                                  : <input value={otHours[r.id] ?? ''} onChange={e => setOtHours(prev => ({ ...prev, [r.id]: e.target.value }))} disabled={!!r.admin_locked} style={{ ...tSel }} placeholder="0" />
                                }
                              </div>
                              {/* OT Rate */}
                              <div style={{ ...tdStyle, color: 'var(--text)' }}>
                                {otRateNum > 0 ? `$${otRateNum}` : '—'}
                              </div>
                              {/* OT Charge */}
                              <div style={{ ...tdStyle, color: otCharge > 0 ? 'var(--accent)' : 'var(--text3)', fontSize: 9 }}>
                                {otCharge > 0 ? `$${otCharge.toFixed(2)}` : '—'}
                              </div>
                              {/* Total */}
                              <div style={{ ...tdStyle, color: rowTotal != null ? 'var(--accent)' : 'var(--text3)', fontWeight: rowTotal != null ? 700 : 400, borderRight: 'none', fontSize: 10 }}>
                                {rowTotal != null ? `$${rowTotal.toFixed(2)}` : '—'}
                              </div>
                            </div>
                            )}
                            {showStaffRow && (() => {
                              // Staff rows carry their own tint on top of the day's
                              // zebra, so sticky cells need the COMBINED colour or the
                              // frozen columns would look like a different row.
                              const staffTint = r.admin_locked ? 'rgba(20,184,166,0.06)' : 'rgba(var(--accent-rgb),0.045)'
                              return (
                              <div style={{ display: 'grid', gridTemplateColumns: ST_GRID, borderBottom: '1px solid var(--border)', background: staffTint }}>
                                {/* Column 1 repeats the DATE, so the staff row still
                                    says which day it belongs to once the table is
                                    scrolled sideways and its parent row is off screen.
                                    The staff pill moved to column 3 — the Notes column —
                                    so everything identifying a line sits together. */}
                                <div style={{ ...tdStyle, ...stickyCell(0, staffTint), color: 'var(--text3)' }}>{shortDate(r.date || '')}</div>
                                <div style={{ ...tdStyle, ...stickyCell(52, staffTint), color: 'var(--text)', fontWeight: 700 }}>{r.studio || ''}</div>
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
                                    style={{ width: '100%', padding: '3px 4px', border: `1px solid ${isAsstRow ? 'var(--warm)' : 'var(--accent)'}`, borderRadius: 4, background: isAsstRow ? 'rgba(249,115,22,0.08)' : 'rgba(var(--accent-rgb),0.08)', color: isAsstRow ? 'var(--warm)' : 'var(--accent)', fontSize: 11, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer' }}
                                  >{initials}</button>
                                </div>
                                <div style={{ ...tdStyle, padding: '2px 3px' }}><TimeInput value={engLiveFrom} onChange={v => setEngFromTimeMap(prev => ({ ...prev, [r.id]: v }))} style={{ ...tSel, color: 'var(--accent)' }} disabled={!!r.admin_locked} /></div>
                                <div style={{ ...tdStyle, padding: '2px 3px' }}><TimeInput value={engLiveTo} onChange={v => setEngToTimeMap(prev => ({ ...prev, [r.id]: v }))} style={{ ...tSel, color: 'var(--accent)' }} disabled={!!r.admin_locked} /></div>
                                <div style={{ ...tdStyle, color: 'var(--text)' }}>{engLiveHours != null ? `${engLiveHours}h` : '—'}</div>
                                <div style={{ ...tdStyle }} />
                                {/* Assistants are never rated or charged on the WO —
                                    show nothing rather than an empty money cell. */}
                                <div style={{ ...tdStyle, color: 'var(--text)' }}>{!isAsstRow && engRateForRow > 0 ? `$${engRateForRow}/hr` : ''}</div>
                                <div style={{ ...tdStyle }} />
                                <div style={{ ...tdStyle }} />
                                <div style={{ ...tdStyle }} />
                                <div style={{ ...tdStyle, color: !isAsstRow && liveEngCharge != null ? 'var(--accent)' : 'var(--text3)', fontWeight: !isAsstRow && liveEngCharge != null ? 700 : 400, borderRight: 'none' }}>
                                  {isAsstRow ? '' : liveEngCharge != null ? `$${liveEngCharge.toFixed(2)}` : '—'}
                                </div>
                              </div>
                              )
                            })()}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
              {stRows.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 14px', borderTop: '1px solid var(--border)', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  <span style={{ fontSize: 12, fontFamily: 'Inter', fontWeight: 700, color: 'var(--text)' }}>
                    Studio: <span style={{ color: 'var(--accent)' }}>${stTotal.toFixed(2)}</span>
                  </span>
                  {engTotal > 0 && (
                    <span style={{ fontSize: 12, fontFamily: 'Inter', fontWeight: 700, color: 'var(--text)' }}>
                      Eng: <span style={{ color: 'var(--accent)' }}>${engTotal.toFixed(2)}</span>
                    </span>
                  )}
                  {engTotal > 0 && (
                    <span style={{ fontSize: 13, fontFamily: 'Inter', fontWeight: 700, color: 'var(--text)', borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                      Total: <span style={{ color: 'var(--accent)' }}>${(stTotal + engTotal).toFixed(2)}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {/* Equipment Condition */}
        {sessionDates.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', padding: '12px 14px 8px' }}>
              Equipment Condition
            </div>
            <input ref={equipNoteFileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadEquipNotePhoto(f) }} />
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: `${130 + Math.max(sessionDates.length, 1) * 90}px` }}>
                {/* Header row */}
                <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${Math.max(sessionDates.length, 1)}, 90px)`, background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ padding: '5px 8px', fontSize: 8, fontFamily: 'Syne, sans-serif', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text2)', borderRight: '1px solid var(--border)', position: 'sticky' as const, left: 0, background: 'var(--bg)', zIndex: 1 }}>Equipment</div>
                  {sessionDates.map(d => (
                    <div key={d} style={{ padding: '5px 8px', fontSize: 9, fontFamily: 'Inter', color: 'var(--text2)', borderRight: '1px solid var(--border)', textAlign: 'center' as const }}>{d}</div>
                  ))}
                </div>
                {/* Equipment rows */}
                {EQUIPMENT.map(eq => {
                  const openDate = openNoteKey?.startsWith(`${eq}||`) ? openNoteKey.split('||')[1] : null
                  return (
                    <div key={eq}>
                      <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${Math.max(sessionDates.length, 1)}, 90px)`, borderBottom: '1px solid var(--border)' }}>
                        <div style={{ padding: '8px', fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'Syne, sans-serif', borderRight: '1px solid var(--border)', position: 'sticky' as const, left: 0, background: 'var(--surface)', zIndex: 1, display: 'flex', alignItems: 'center' }}>{eq}</div>
                        {sessionDates.map(date => {
                          const key = `${eq}||${date}`
                          const cond = equipConds[key]
                          const hasNote = !!(equipNotes[key]?.note || (equipNotes[key]?.photo_urls?.length ?? 0) > 0)
                          return (
                            <div key={date} style={{ padding: '6px 4px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                              <button onClick={() => toggleEquip(eq, date, 'ok')} style={{ width: '100%', padding: '4px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: 'Syne, sans-serif', background: cond === 'ok' ? 'rgba(20,184,166,0.13)' : 'var(--border)', color: cond === 'ok' ? 'var(--booked)' : 'var(--text2)' }}>✓ OK</button>
                              <div style={{ display: 'flex', gap: 3, alignItems: 'center', width: '100%' }}>
                                <button onClick={() => toggleEquip(eq, date, 'not_ok')} style={{ flex: 1, padding: '4px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: 'Syne, sans-serif', background: cond === 'not_ok' ? 'rgba(239,68,68,0.13)' : 'var(--border)', color: cond === 'not_ok' ? 'var(--hot)' : 'var(--text2)' }}>✗ Not OK</button>
                                {cond === 'not_ok' && hasNote && (
                                  <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--warm)', flexShrink: 0 }} />
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {/* Note expansion — inline below the equipment row */}
                      {openDate && (
                        <div style={{ padding: '10px 12px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 9, fontFamily: 'Syne, sans-serif', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--warm)', marginBottom: 6 }}>
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
                            style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'Inter', fontSize: 12, padding: '8px 10px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', minHeight: 64 }}
                          />
                          {(equipNotes[`${eq}||${openDate}`]?.photo_urls?.length ?? 0) > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                              {equipNotes[`${eq}||${openDate}`].photo_urls.map((url, i) => (
                                <SignedImage key={i} path={url} link alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(249,115,22,0.3)', display: 'block' }} />
                              ))}
                            </div>
                          )}
                          <button
                            onClick={() => { pendingNoteKey.current = { key: `${eq}||${openDate}`, equipment: eq, date: openDate }; equipNoteFileRef.current?.click() }}
                            disabled={noteUploading}
                            style={{ marginTop: 8, background: 'var(--border)', border: 'none', borderRadius: 6, padding: '7px 14px', color: noteUploading ? 'var(--text2)' : 'var(--text)', fontSize: 12, fontWeight: 600, cursor: noteUploading ? 'not-allowed' : 'pointer', fontFamily: 'Syne, sans-serif' }}
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
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 10 }}>
            Session Notes
          </div>
          <textarea
            value={sessionNotes}
            onChange={e => setSessionNotes(e.target.value)}
            placeholder="Any notes for this session…"
            style={{
              width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '10px 12px', color: 'var(--text)', fontSize: 12,
              fontFamily: 'Inter', resize: 'vertical', minHeight: 80,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Payments */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', padding: '12px 14px 8px' }}>Payments</div>
          {payRows.map((p, i) => {
            const needsLast4 = p.payment_type === 'Credit Card' || p.payment_type === 'Debit Card'
            return (
              <div key={p.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={p.payment_type}
                    onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, payment_type: e.target.value, last_four: '' } : x))}
                    style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: p.payment_type ? 'var(--text)' : 'var(--text2)', fontFamily: 'Inter', fontSize: 11, padding: '6px 8px', outline: 'none' }}
                  >
                    <option value="">— type —</option>
                    {['Cash', 'Zelle', 'Credit Card', 'Debit Card', 'Check', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    value={p.amount}
                    onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, amount: e.target.value } : x))}
                    onBlur={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, amount: formatCurrency(e.target.value) } : x))}
                    placeholder="0.00"
                    inputMode="decimal"
                    style={{ width: 80, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'Inter', fontSize: 11, padding: '6px 8px', outline: 'none', textAlign: 'right' }}
                  />
                  <button
                    onClick={() => setPayRows(prev => prev.filter(x => x.id !== p.id))}
                    style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                  >×</button>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={p.memo}
                    onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, memo: e.target.value } : x))}
                    placeholder="Memo"
                    style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'Inter', fontSize: 11, padding: '6px 8px', outline: 'none' }}
                  />
                  {needsLast4 && (
                    <input
                      value={p.last_four}
                      onChange={e => setPayRows(prev => prev.map(x => x.id === p.id ? { ...x, last_four: e.target.value.replace(/\D/g, '').slice(0, 4) } : x))}
                      placeholder="Last 4"
                      inputMode="numeric"
                      maxLength={4}
                      style={{ width: 72, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'Inter', fontSize: 11, padding: '6px 8px', outline: 'none' }}
                    />
                  )}
                </div>
              </div>
            )
          })}
          <div style={{ padding: '10px 14px' }}>
            <button
              onClick={() => setPayRows(prev => [...prev, { id: crypto.randomUUID(), payment_type: '', amount: '', memo: '', last_four: '' }])}
              style={{ background: 'none', border: 'none', color: 'var(--text2)', fontFamily: 'Inter', fontSize: 11, cursor: 'pointer', padding: 0 }}
            >+ Add payment</button>
          </div>
        </div>

        {/* Totals */}
        {stRows.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', padding: '12px 14px 8px' }}>Totals</div>
            {([
              { label: 'Studio Total', value: stTotal, color: 'var(--text)', bold: false },
              ...(engTotal > 0 ? [{ label: 'Eng Total', value: engTotal, color: 'var(--text)', bold: false }] : []),
              ...(rentTotal > 0 ? [{ label: 'Rentals Total', value: rentTotal, color: 'var(--text)', bold: false }] : []),
              { label: 'Grand Total', value: grandTotal, color: 'var(--text)', bold: true },
              { label: 'Total Paid', value: totalPaid, color: 'var(--booked)', bold: false },
              { label: 'Balance Due', value: balanceDue, color: balanceDue > 0 ? 'var(--hot)' : 'var(--booked)', bold: true },
            ] as { label: string; value: number; color: string; bold: boolean }[]).map(({ label, value, color, bold }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--text2)' }}>{label}</span>
                <span style={{ fontSize: bold ? 13 : 11, fontFamily: 'Inter', color, fontWeight: bold ? 700 : 400 }}>${value.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Legal + Signature — COD only */}
        {isCOD && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px', marginBottom: 16 }}>
            <div style={{ fontSize: 9, fontFamily: 'Inter', color: 'var(--text3)', lineHeight: 1.8, marginBottom: 14 }}>
              By signing below, I acknowledge that I am authorized to approve charges for this session. I accept responsibility for all associated costs and understand that payment is due in full at the time of service unless otherwise agreed. I also acknowledge that Paramount Recording is not responsible for any media, personal items, or equipment left behind.
              <br /><br />
              <em>No Tapes, CDs, DVDs, Thumb Drives, Computer Drives or other Recording Media will be released until payment in full is received.</em>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'Inter' }}>Date</span>
                <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'Inter' }}>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'Inter' }}>Print Name</span>
                <input
                  value={printName}
                  onChange={e => setPrintName(e.target.value)}
                  placeholder="Full name"
                  style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #3a3f52', color: 'var(--text)', fontFamily: 'Inter', fontSize: 12, padding: '4px 2px', outline: 'none', width: '100%' }}
                />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'Inter' }}>Signature</span>
                  <button
                    onClick={clearSignature}
                    style={{ background: 'none', border: '1px solid #3a3f52', borderRadius: 6, padding: '3px 10px', color: 'var(--text2)', fontSize: 10, cursor: 'pointer', fontFamily: 'Inter' }}
                  >
                    Clear
                  </button>
                </div>
                <canvas
                  ref={canvasRef}
                  width={700}
                  height={200}
                  onMouseDown={startDraw}
                  onMouseMove={continueDraw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={continueDraw}
                  onTouchEnd={endDraw}
                  style={{ width: '100%', height: 100, background: 'var(--bg)', borderRadius: 8, border: '1px solid #3a3f52', display: 'block', touchAction: 'none', cursor: 'crosshair' }}
                />
                {signatureData && (
                  <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'Inter', marginTop: 4 }}>Signature captured ✓</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Needs Attention / Runner Notes */}
        <div style={{ background: 'var(--surface)', border: '1px solid rgba(249,115,22,0.35)', borderRadius: 12, padding: '14px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--warm)', marginBottom: 10 }}>
            Needs Attention / Runner Notes
          </div>
          <textarea
            value={needsAttentionNotes}
            onChange={e => setNeedsAttentionNotes(e.target.value)}
            placeholder="Flag anything that needs management attention — damage, issues, missing items…"
            style={{
              width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '10px 12px', color: 'var(--text)', fontSize: 12,
              fontFamily: 'Inter', resize: 'vertical', minHeight: 80,
              outline: 'none', boxSizing: 'border-box', marginBottom: 10,
            }}
          />
          {/* Photo thumbnails */}
          {needsAttentionPhotos.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {needsAttentionPhotos.map((url, i) => (
                <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                  <SignedImage path={url} link linkStyle={{ display: 'block' }} alt="" onError={() => console.error('[NA photo] img failed to load:', url)} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '2px solid rgba(249,115,22,0.35)', display: 'block' }} />
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); deleteNAPhoto(url) }}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, background: 'var(--hot)', border: 'none', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0 }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
          {/* Upload button */}
          <input ref={naFileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadNAPhoto(f) }} />
          <button onClick={() => naFileRef.current?.click()} disabled={naUploading} style={{ background: 'var(--border)', border: 'none', borderRadius: 8, padding: '8px 14px', color: naUploading ? 'var(--text2)' : 'var(--text)', fontSize: 12, fontWeight: 600, cursor: naUploading ? 'not-allowed' : 'pointer', fontFamily: 'Syne, sans-serif' }}>
            {naUploading ? 'Uploading…' : '📷 Add Photo'}
          </button>
        </div>

      </div>

      {/* Footer — Cancel | Save */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => router.push(`/runner/${studio}`)}
            style={{ flex: 1, padding: '14px 0', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSaveChanges}
            disabled={saving || isCompleted}
            style={{ flex: 2, padding: '14px 0', background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: (saving || isCompleted) ? 'not-allowed' : 'pointer', opacity: (saving || isCompleted) ? 0.5 : 1, fontFamily: 'Syne, sans-serif' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
  padding: '8px 10px', color: 'var(--text)', fontSize: 12,
  fontFamily: 'Inter', outline: 'none', width: '100%',
}
