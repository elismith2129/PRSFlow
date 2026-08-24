'use client'
// SOFT SKIN PORT, 2026-08-14 (one-pass runner redesign). Queries, save flow and
// the daily_ops_submissions upsert are UNTOUCHED — this is surface only.
// Old skin retired: legacy --bg/--surface/--border tokens, 1px borders (Law 1),
// Syne (§4), dashed borders. Low is status colour (--c-st-warm), the only
// colour on the page (§5).
//
// SECTIONS, 2026-08-24 (Eli): the list is split into PRS STOCK (nightly — the
// sheet's own rule: check PRS-X items daily) and OFFICE (WEDNESDAYS ONLY).
// The office section is greyed every other day and gets a pulsing DUE TODAY
// badge on Wednesday — visible, never blocking (warn-don't-block, house rule).
// Real item lists + par levels seeded by migration 20260824140000; the page
// renders in sheet order (sort_order), no longer alphabetically.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'

const STUDIO_META: Record<string, { label: string }> = {
  paramount: { label: 'Paramount' },
  ameraycan: { label: 'Ameraycan' },
  encore: { label: 'Encore' },
  track: { label: 'Track' },
}

const DEFAULT_ITEMS = [
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

type StockSection = 'stock' | 'office'
type StockItem = {
  id?: string; item: string; qty: string; notes: string; low: boolean
  section: StockSection; target: string; sort_order: number
}

export default function StockPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio }
  const today = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) })()
  // Noon-anchored so the day-of-week can't drift across a TZ boundary.
  const isWednesday = new Date(today + 'T12:00:00').getDay() === 3

  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Edits are batched locally until Save — a realtime reload mid-typing would
  // wipe them, so remote changes only refresh this page while it's pristine.
  const dirtyRef = useRef(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('stock_items').select('*').eq('studio', studio)
      .order('sort_order').order('item')
    if (data && data.length > 0) {
      setItems(data.map((r: any) => ({
        id: r.id, item: r.item ?? '', qty: r.qty != null ? String(r.qty) : '',
        notes: r.notes ?? '', low: r.low ?? false,
        section: (r.section === 'office' ? 'office' : 'stock') as StockSection,
        target: r.target ?? '', sort_order: r.sort_order ?? 0,
      })))
    } else {
      setItems(DEFAULT_ITEMS.map((item, i) => ({
        item, qty: '', notes: '', low: false, section: 'stock' as StockSection, target: '', sort_order: i + 1,
      })))
    }
    setLoading(false)
  }, [studio])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const ch = supabase
      .channel(`runner-stock-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_items', filter: `studio=eq.${studio}` }, () => {
        if (!dirtyRef.current) load()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [studio, load])

  function edit(idx: number, patch: Partial<StockItem>) {
    dirtyRef.current = true
    setItems(prev => prev.map((x, j) => j === idx ? { ...x, ...patch } : x))
  }

  function addItem(section: StockSection) {
    dirtyRef.current = true
    setItems(prev => {
      const maxSort = Math.max(0, ...prev.filter(x => x.section === section).map(x => x.sort_order))
      return [...prev, { item: '', qty: '', notes: '', low: false, section, target: '', sort_order: maxSort + 1 }]
    })
  }

  async function save() {
    setSaving(true)
    const updated = items.map(it => ({ ...it }))
    for (let i = 0; i < updated.length; i++) {
      const it = updated[i]
      const payload = {
        studio, item: it.item, qty: parseInt(it.qty) || 0, notes: it.notes, low: it.low,
        section: it.section, target: it.target, sort_order: it.sort_order,
      }
      if (it.id) {
        await supabase.from('stock_items').update(payload).eq('id', it.id)
      } else {
        const { data } = await supabase.from('stock_items').insert(payload).select().single()
        if (data) updated[i] = { ...it, id: data.id }
      }
    }
    setItems(updated)
    await supabase.from('daily_ops_submissions').upsert({
      studio, date: today, category: 'stock',
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'studio,date,category' })
    dirtyRef.current = false
    setSaving(false)
    router.push(`/runner/${studio}`)
  }

  const surface: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))',
    boxShadow: 'var(--c-softsh)',
    borderRadius: 16,
    padding: '11px 13px',
  }
  const input: React.CSSProperties = {
    background: 'var(--c-wash)', border: 'none', borderRadius: 10,
    padding: '9px 11px', color: 'var(--c-fg)', fontSize: 13,
    font: 'inherit', outline: 'none', minHeight: 40,
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--c-bg)', color: 'var(--c-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  const lowCount = items.filter(i => i.low).length
  const hasOffice = items.some(i => i.section === 'office')

  // Section order: nightly stock first, office last. A studio with no office
  // rows (everyone but paramount today) renders one untitled list, unchanged.
  const sections: { key: StockSection; rows: { it: StockItem; idx: number }[] }[] = (
    hasOffice ? (['stock', 'office'] as StockSection[]) : (['stock'] as StockSection[])
  ).map(key => ({
    key,
    rows: items.map((it, idx) => ({ it, idx })).filter(r => r.it.section === key),
  }))

  const renderCard = ({ it, idx }: { it: StockItem; idx: number }) => (
    <div key={it.id ?? `new-${idx}`} style={surface}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        {it.id || it.item ? (
          <span style={{ minWidth: 0, overflow: 'hidden' }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.item}</span>
            {it.target !== '' && (
              <span style={{ display: 'block', fontSize: 10.5, opacity: 0.5, marginTop: 1 }}>Stock: {it.target}</span>
            )}
          </span>
        ) : (
          <input
            placeholder="Item name"
            value={it.item}
            onChange={e => edit(idx, { item: e.target.value })}
            style={{ ...input, flex: 1, fontWeight: 700 }}
          />
        )}
        <button
          onClick={() => edit(idx, { low: !it.low })}
          className="c-pill"
          style={{
            border: 'none', font: 'inherit', cursor: 'pointer', flexShrink: 0, minHeight: 30,
            background: it.low ? 'var(--c-st-warm)' : 'var(--c-wash2)',
            color: it.low ? 'var(--c-chip-ink)' : 'var(--c-fg)',
            opacity: it.low ? 1 : 0.7,
          }}
        >
          {it.low ? 'Low' : 'OK'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="number"
          placeholder="Qty"
          value={it.qty}
          onChange={e => edit(idx, { qty: e.target.value })}
          style={{ ...input, width: 72 }}
        />
        <input
          placeholder="Notes"
          value={it.notes}
          onChange={e => edit(idx, { notes: e.target.value })}
          style={{ ...input, flex: 1 }}
        />
      </div>
    </div>
  )

  return (
    <div style={{
      minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden',
      background: 'var(--c-bg)', color: 'var(--c-fg)', paddingBottom: 110,
    }}>
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
          <div className="c-arch" style={{ fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Stock</div>
          <div style={{ fontSize: 11.5, opacity: 0.5 }}>
            {meta.label}
            {lowCount > 0 && <span style={{ color: 'var(--c-st-warm)', opacity: 1, fontWeight: 700 }}> · {lowCount} low</span>}
          </div>
        </div>
      </div>

      <div style={{ padding: '4px 14px' }}>
        {sections.map(({ key, rows }) => {
          const isOffice = key === 'office'
          // Office is a Wednesday job: greyed the rest of the week, pulsing on
          // the day. Still editable — visibility is the guard, not a lock.
          const dimmed = isOffice && !isWednesday
          return (
            <div key={key} style={{ opacity: dimmed ? 0.42 : 1, marginTop: hasOffice && isOffice ? 22 : 0 }}>
              {hasOffice && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 3px 9px' }}>
                  <span style={{
                    fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em',
                    textTransform: 'uppercase', opacity: 0.6,
                  }}>
                    {isOffice ? 'Office' : 'PRS Stock'}
                  </span>
                  {!isOffice && (
                    <span style={{ fontSize: 10, opacity: 0.45 }}>Check PRS-X items daily</span>
                  )}
                  {isOffice && (isWednesday ? (
                    <span className="c-pill" style={{
                      background: 'var(--c-st-warm)', color: 'var(--c-chip-ink)',
                      fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                      padding: '3px 10px', animation: 'stockWedPulse 1.6s ease-in-out infinite',
                    }}>Due today</span>
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7 }}>
                      Wednesdays only
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {rows.map(renderCard)}
              </div>
              <button
                onClick={() => addItem(key)}
                style={{
                  marginTop: 12, width: '100%', minHeight: 48,
                  background: 'var(--c-wash)', border: 'none', borderRadius: 14,
                  color: 'var(--c-fg)', opacity: 0.75, fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', font: 'inherit',
                }}
              >
                + Add item
              </button>
            </div>
          )
        })}
      </div>

      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '12px 14px calc(16px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(to top, var(--c-bg) 68%, transparent)',
      }}>
        <button
          onClick={save}
          disabled={saving}
          className="c-control c-raised"
          style={{
            width: '100%', minHeight: 52, borderRadius: 14,
            background: 'var(--c-wash2)', color: 'var(--c-fg)',
            border: 'none', font: 'inherit', fontSize: 14, fontWeight: 800,
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
            boxShadow: 'var(--c-softsh)',
          }}
        >
          {saving ? 'Saving…' : 'Save stock list'}
        </button>
      </div>
    </div>
  )
}
