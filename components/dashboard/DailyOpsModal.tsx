'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { getChecklistSections } from '@/lib/checklist-items'
import { SignedImage } from '@/components/shared/SignedImage'
import { fmtClock } from '@/lib/format'

// ─── Appendix B: Stock list defaults ─────────────────────────────────────────

const STOCK_DEFAULT = [
  'Water bottles (24-pack)',
  'Coffee pods',
  'Paper towels',
  'Toilet paper',
  'Trash bags',
  'Cleaning spray',
  'Hand soap',
  'CD-Rs / blank media',
  'Printer paper',
  'Pens / markers',
]

// ─── Mic inventory groups (global) ───────────────────────────────────────────

const MIC_GROUPS = [
  { group: 'Large Diaphragm Condenser', mics: ['Neumann U87', 'AKG C414', 'Rode NT1'] },
  { group: 'Dynamic', mics: ['Shure SM7B', 'Shure SM58', 'Sennheiser MD421'] },
  { group: 'Bass / Kick', mics: ['AKG D112', 'Electrovoice RE20'] },
]

const CONDITION_COLORS: Record<string, string> = {
  good: 'var(--c-st-booked)', fair: 'var(--c-st-warm)', damaged: 'var(--c-st-hot)', '': 'var(--c-st-dead)',
}

const CATEGORY_LABELS: Record<string, string> = {
  opening_checklist: 'Opening Checklist',
  closing_checklist: 'Closing Checklist',
  petty_cash: 'Petty Cash',
  stock_list: 'Stock List',
  mic_inventory: 'Mic Inventory',
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type DailyOpsSubmission = {
  id: string
  studio: string
  category: string
  date: string
  staff_name: string | null
  submitted_at: string | null
  admin_approved_at: string | null
  admin_approved_by: string | null
}

type Props = {
  category: string
  studio: string
  today: string
  studioLabel: string
  submission: DailyOpsSubmission | null
  onClose: () => void
  onApprove: () => Promise<void>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtShortDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
// Canonical formatter (lib/format). Local alias keeps existing call sites.
const fmtTime = fmtClock

function SectionHead({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase',
      color: 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif",
      paddingBottom: 6, marginBottom: 12,
    }}>
      {label}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DailyOpsModal({ category, studio, today, studioLabel, submission, onClose, onApprove }: Props) {
  const [approving, setApproving] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(true)

  // Checklist
  const [checklistData, setChecklistData] = useState<any>(null)

  // Petty cash
  const [cashEntries, setCashEntries] = useState<any[]>([])
  const [openingBalance, setOpeningBalance] = useState<number | null>(null)

  // Stock
  const [stockItems, setStockItems] = useState<any[]>([])

  // Mics (global)
  const [micItems, setMicItems] = useState<any[]>([])

  // History
  const [history, setHistory] = useState<DailyOpsSubmission[]>([])

  const isSubmitted = !!submission?.submitted_at
  const isApproved = !!submission?.admin_approved_at

  // TODO: replace with real auth role check when auth is built
  const canApprove = true

  useEffect(() => {
    loadDetail()
    loadHistory()
  }, [category, studio, today]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDetail() {
    setLoadingDetail(true)

    if (category === 'opening_checklist' || category === 'closing_checklist') {
      const type = category === 'opening_checklist' ? 'opening' : 'closing'
      const { data } = await supabase
        .from('checklists').select('*')
        .eq('studio', studio).eq('type', type).eq('date', today)
        .maybeSingle()
      setChecklistData(data ?? null)
    }

    if (category === 'petty_cash') {
      const [{ data: entries }, { data: bal }] = await Promise.all([
        supabase.from('petty_cash_entries').select('*').eq('studio', studio).eq('date', today).order('created_at'),
        supabase.from('petty_cash_balances').select('*').eq('studio', studio).eq('date', today).maybeSingle(),
      ])
      setCashEntries(entries ?? [])
      setOpeningBalance(bal?.amount ?? null)
    }

    if (category === 'stock_list') {
      const { data } = await supabase.from('stock_items').select('*').eq('studio', studio).order('item')
      setStockItems(data ?? [])
    }

    if (category === 'mic_inventory') {
      const { data } = await supabase.from('mic_inventory').select('*').order('studio').order('name')
      setMicItems(data ?? [])
    }

    setLoadingDetail(false)
  }

  async function loadHistory() {
    const dates: string[] = []
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today + 'T12:00:00')
      d.setDate(d.getDate() - i)
      dates.push(d.toISOString().slice(0, 10))
    }
    let q = supabase
      .from('daily_ops_submissions').select('*')
      .eq('category', category).in('date', dates)
      .order('date', { ascending: false })
    if (category !== 'mic_inventory') q = q.eq('studio', studio)
    const { data } = await q
    setHistory((data ?? []) as DailyOpsSubmission[])
  }

  // Real-time: this modal is a read-only admin view, so a full refetch on any change
  // to the tables it renders is safe. (stock_items + mic_inventory are omitted — those
  // relations don't exist in the DB; the modal reads them with a null fallback.)
  useEffect(() => {
    const channel = supabase
      .channel(`dailyops-modal-${studio}-${category}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklists' }, () => { loadDetail() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'petty_cash_entries' }, () => { loadDetail() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'petty_cash_balances' }, () => { loadDetail() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_ops_submissions' }, () => { loadHistory() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [category, studio, today]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleApprove() {
    setApproving(true)
    await onApprove()
    setApproving(false)
  }

  // ─── Form renderers ──────────────────────────────────────────────────────────

  function renderChecklist() {
    const sections   = getChecklistSections(studio, category)
    const totalItems = sections.reduce((n, s) => n + s.items.length, 0)

    const checkedByText: Record<string, boolean> = {}
    if (checklistData?.items) {
      for (const row of checklistData.items) checkedByText[row.item] = row.checked
    }
    const doneCount = Object.values(checkedByText).filter(Boolean).length

    const photosToShow: string[] = checklistData?.needs_attention_photos ?? checklistData?.photo_urls ?? []
    const notesText: string      = checklistData?.needs_attention_notes ?? checklistData?.notes ?? ''
    const flagged: boolean        = !!checklistData?.needs_attention

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Needs Attention banner — shown AT TOP before checklist */}
        {flagged && (
          <div className="c-inset2" style={{ borderRadius: 20, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: notesText || photosToShow.length > 0 ? 10 : 0 }}>
              <span style={{ fontSize: 14, color: 'var(--c-fg-2)' }}>⚠</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-fg-2)', fontFamily: "'Archivo Black', sans-serif" }}>
                Flagged by runner — Needs Attention
              </span>
            </div>
            {notesText && (
              <div style={{ fontSize: 12, color: 'var(--c-fg)', fontFamily: 'Inter', lineHeight: 1.6, background: 'var(--c-wash)', borderRadius: 14, padding: '10px 12px', marginBottom: photosToShow.length > 0 ? 10 : 0 }}>
                {notesText}
              </div>
            )}
            {photosToShow.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {photosToShow.map((url, i) => (
                  <SignedImage key={i} path={url} link alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Progress */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--c-fg-2)', fontFamily: 'Inter' }}>
            {`${doneCount} / ${totalItems} checked`}
          </span>
          {checklistData?.staff_name && (
            <span style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>
              {checklistData.staff_name}
              {checklistData.completed_at && ` · ${fmtTime(checklistData.completed_at)}`}
            </span>
          )}
        </div>

        {/* Sections */}
        {sections.map(sec => (
          <div key={sec.section}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif", marginBottom: 6, paddingLeft: 2 }}>
              {sec.section}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sec.items.map((item, i) => {
                const on = checkedByText[item] ?? false
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    background: 'var(--c-bg)', borderRadius: 8, padding: '9px 12px',
                    }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1,
                      background: on ? 'var(--c-fg)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {on && <span style={{ fontSize: 10, color: 'var(--c-bg)', fontWeight: 900 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 12, color: on ? 'var(--c-fg)' : 'var(--c-fg-2)', fontFamily: "'Archivo Black', sans-serif", lineHeight: 1.45, textDecoration: on ? 'none' : 'none' }}>
                      {item}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Notes (shown separately if not already in banner) */}
        {notesText && !flagged && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif", marginBottom: 6 }}>Notes</div>
            <div style={{ fontSize: 12, color: 'var(--c-fg)', fontFamily: 'Inter', lineHeight: 1.6, background: 'var(--c-wash)', borderRadius: 14, padding: '10px 12px' }}>
              {notesText}
            </div>
          </div>
        )}

        {/* Photos (shown separately if not already in banner) */}
        {photosToShow.length > 0 && !flagged && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif", marginBottom: 6 }}>Photos</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {photosToShow.map((url, i) => (
                <SignedImage key={i} path={url} link alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }} />
              ))}
            </div>
          </div>
        )}

      </div>
    )
  }

  function renderPettyCash() {
    const totalIn  = cashEntries.filter(e => e.type === 'in').reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0)
    const totalOut = cashEntries.filter(e => e.type === 'out').reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0)
    const closing  = (openingBalance ?? 0) + totalIn - totalOut

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Balance summary */}
        <div className="c-inset2" style={{ borderRadius: 20, padding: '14px 16px' }}>
          {([
            ['Opening Balance', openingBalance != null ? `$${Number(openingBalance).toFixed(2)}` : '—', 'var(--c-fg-2)'],
            ['Cash In', `+$${totalIn.toFixed(2)}`, 'var(--c-fg)'],
            ['Cash Out', `-$${totalOut.toFixed(2)}`, 'var(--c-fg)'],
            ['Closing Balance', `$${closing.toFixed(2)}`, 'var(--c-fg)'],
          ] as [string, string, string][]).map(([l, v, c], i, arr) => (
            <div key={l} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 0', }}>
              <span style={{ fontSize: 11, color: 'var(--c-fg-2)', fontFamily: "'Archivo Black', sans-serif" }}>{l}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: c, fontFamily: 'Inter' }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Transaction ledger */}
        {cashEntries.length > 0 ? (
          <div className="c-inset2" style={{ borderRadius: 20, overflow: 'hidden', padding: '4px 0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 48px', padding: '6px 14px', background: 'var(--c-wash)' }}>
              {['Description', 'Amount', 'Type'].map(h => (
                <span key={h} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif" }}>{h}</span>
              ))}
            </div>
            {cashEntries.map((e: any, i: number) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 48px',
                padding: '9px 14px',
                }}>
                <span style={{ fontSize: 11, color: 'var(--c-fg)', fontFamily: 'Inter' }}>{e.description || '—'}</span>
                <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'Inter', color: 'var(--c-fg)' }}>
                  {e.type === 'in' ? '+' : '−'}${Number(e.amount).toFixed(2)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>{e.type}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>No transactions recorded.</div>
        )}
      </div>
    )
  }

  function renderStock() {
    const items = stockItems.length > 0
      ? stockItems
      : STOCK_DEFAULT.map(item => ({ item, qty: null as number | null, notes: '', low: false }))
    const lowCount = items.filter((i: any) => i.low).length

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {lowCount > 0 && (
          <div className="c-inset2" style={{ borderRadius: 14, padding: '8px 12px', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-fg-2)', fontFamily: 'Inter' }}>
              ⚠ {lowCount} item{lowCount !== 1 ? 's' : ''} flagged low
            </span>
          </div>
        )}
        {items.map((it: any, i: number) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--c-bg)', borderRadius: 8, padding: '9px 12px',
          }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--c-fg)', fontFamily: "'Archivo Black', sans-serif" }}>{it.item}</div>
              {it.notes && <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 2 }}>{it.notes}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {it.qty != null && (
                <span style={{ fontSize: 11, color: 'var(--c-fg-2)', fontFamily: 'Inter' }}>×{it.qty}</span>
              )}
              <span style={{
                fontSize: 9, fontWeight: 700, fontFamily: 'Inter',
                padding: '2px 7px', borderRadius: 4,
                color: 'var(--c-chip-ink)',
                background: it.low ? 'var(--c-st-warm)' : 'var(--c-st-booked)',
              }}>
                {it.low ? 'LOW' : 'OK'}
              </span>
            </div>
          </div>
        ))}
      </div>
    )
  }

  function renderMics() {
    if (micItems.length === 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {MIC_GROUPS.map(g => (
            <div key={g.group}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif", marginBottom: 6 }}>
                {g.group}
              </div>
              {g.mics.map(name => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--c-bg)', borderRadius: 8, padding: '9px 12px', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--c-fg)', fontFamily: "'Archivo Black', sans-serif" }}>{name}</span>
                  <span style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>—</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )
    }

    // Group by studio
    const byStudio: Record<string, any[]> = {}
    for (const mic of micItems) {
      const s = mic.studio || 'Unknown'
      if (!byStudio[s]) byStudio[s] = []
      byStudio[s].push(mic)
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {Object.entries(byStudio).map(([s, mics]) => (
          <div key={s}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif", marginBottom: 6 }}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </div>
            {mics.map((mic: any, i: number) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'var(--c-bg)', borderRadius: 8, padding: '9px 12px', marginBottom: 4,
              }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--c-fg)', fontFamily: "'Archivo Black', sans-serif" }}>{mic.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 2 }}>
                    {[mic.serial && `S/N: ${mic.serial}`, mic.location].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {mic.condition && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, fontFamily: 'Inter',
                    color: CONDITION_COLORS[mic.condition] ?? 'var(--c-fg-3)',
                    background: (CONDITION_COLORS[mic.condition] ?? 'var(--c-fg-2)') + '22',
                    padding: '2px 8px', borderRadius: 4,
                  }}>
                    {mic.condition}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  function renderHistory() {
    if (history.length === 0) {
      return (
        <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>
          No submissions in the last 7 days.
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {history.map((h, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--c-bg)', borderRadius: 8, padding: '9px 12px',
          }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--c-fg)', fontFamily: 'Inter' }}>{fmtShortDate(h.date)}</div>
              {h.staff_name && <div style={{ fontSize: 9, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 2 }}>{h.staff_name}</div>}
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {h.submitted_at ? (
                <span className="c-pill c-fill-booked" style={{ fontSize: 9 }}>Submitted</span>
              ) : (
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--c-fg-3)', background: 'var(--c-wash)', padding: '2px 7px', borderRadius: 4, fontFamily: 'Inter' }}>Pending</span>
              )}
              {h.admin_approved_at && (
                <span className="c-pill c-fill-booked" style={{ fontSize: 9 }}>Approved</span>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  // Petty cash, Checklists, Stock and Mic Inventory always show content (live — no submission gate)
  const alwaysShowContent = category === 'petty_cash' || category === 'stock_list' || category === 'mic_inventory' || category === 'opening_checklist' || category === 'closing_checklist'
  const isChecklist = category === 'opening_checklist' || category === 'closing_checklist'
  const hasLiveProgress = isChecklist && !!checklistData

  const modal = (
    <div
      className="c-modal-backdrop" style={{ zIndex: 10002 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="c-sheet" style={{ width: '100%', maxWidth: 680, maxHeight: '88dvh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{
          padding: '18px 22px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={onClose} aria-label="Back" className="c-control c-raised" style={{ width: 34, height: 34, borderRadius: 99, flexShrink: 0, background: 'var(--c-bg)', color: 'var(--c-fg)', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
            <div>
              <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 800, fontSize: 16, color: 'var(--c-fg)' }}>
                {CATEGORY_LABELS[category] ?? category}
              </div>
              <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 2 }}>
                {category === 'mic_inventory' ? 'Global' : studioLabel}
                {' · '}
                {fmtShortDate(today)}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--c-fg-3)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 22px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>

          {/* Status badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              padding: '3px 10px', borderRadius: 6, fontFamily: 'Inter',
              color: 'var(--c-chip-ink)',
              background: isApproved || isSubmitted ? 'var(--c-st-booked)' : hasLiveProgress ? 'var(--c-st-warm)' : 'var(--c-st-dead)',
            }}>
              {isApproved ? 'Approved' : isSubmitted ? 'Submitted' : hasLiveProgress ? 'In Progress' : 'Not Started'}
            </span>
            {submission?.staff_name && (
              <span style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>
                {submission.staff_name}
                {submission.submitted_at && ` · ${fmtTime(submission.submitted_at)}`}
              </span>
            )}
          </div>

          {/* Content */}
          <section>
            <SectionHead label={isChecklist && !isSubmitted ? 'Current Progress' : 'Submitted Content'} />
            {!isSubmitted && !alwaysShowContent ? (
              <div className="c-inset2" style={{ borderRadius: 20, padding: '32px 22px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--c-fg-2)', fontFamily: "'Archivo Black', sans-serif", marginBottom: 6 }}>
                  Awaiting runner submission
                </div>
                <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>
                  The runner has not submitted this form yet today.
                </div>
              </div>
            ) : loadingDetail ? (
              <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>Loading…</div>
            ) : (
              <>
                {(category === 'opening_checklist' || category === 'closing_checklist') && renderChecklist()}
                {category === 'petty_cash' && renderPettyCash()}
                {category === 'stock_list' && renderStock()}
                {category === 'mic_inventory' && renderMics()}
              </>
            )}
          </section>

          {/* 7-day history */}
          <section>
            <SectionHead label="7-Day History" />
            {renderHistory()}
          </section>

          {/* ── Approve button — BOTTOM ONLY, after all content ── */}
          {isSubmitted && !isApproved && canApprove && (
            <div style={{ paddingTop: 20 }}>
              <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginBottom: 14, lineHeight: 1.6 }}>
                You have reviewed all submitted content above. Approving confirms this submission is complete and accurate.
              </div>
              <button
                onClick={handleApprove}
                disabled={approving}
                className="c-btn c-control c-raised-primary c-block" style={{ padding: '14px 0', fontSize: 12, justifyContent: 'center', cursor: approving ? 'not-allowed' : 'pointer' }}
              >
                {approving ? 'Approving…' : 'Approve Submission'}
              </button>
            </div>
          )}

          {isApproved && submission?.admin_approved_at && (
            <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 10, color: 'var(--c-fg-2)', fontFamily: 'Inter' }}>
              ✓ Approved {fmtTime(submission.admin_approved_at)}
              {submission.admin_approved_by ? ` by ${submission.admin_approved_by}` : ''}
            </div>
          )}

        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modal, document.body)
}
