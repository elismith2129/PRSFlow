'use client'
// SOFT SKIN PORT, 2026-08-14 (one-pass runner redesign). Queries, save flow and
// the daily_ops_submissions upsert are UNTOUCHED — this is surface only.
// Old skin retired: legacy --bg/--surface/--border tokens, 1px borders (Law 1),
// Syne (§4), dashed borders. Low is status colour (--c-st-warm), the only
// colour on the page (§5).
import { useEffect, useState } from 'react'
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

type StockItem = { id?: string; item: string; qty: string; notes: string; low: boolean }

export default function StockPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio }
  const today = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) })()

  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('stock_items').select('*').eq('studio', studio).order('item')
      if (data && data.length > 0) {
        setItems(data.map((r: any) => ({ id: r.id, item: r.item ?? '', qty: r.qty != null ? String(r.qty) : '', notes: r.notes ?? '', low: r.low ?? false })))
      } else {
        setItems(DEFAULT_ITEMS.map(item => ({ item, qty: '', notes: '', low: false })))
      }
      setLoading(false)
    }
    load()
  }, [studio])

  async function save() {
    setSaving(true)
    const updated = items.map(it => ({ ...it }))
    for (let i = 0; i < updated.length; i++) {
      const it = updated[i]
      const payload = { studio, item: it.item, qty: parseInt(it.qty) || 0, notes: it.notes, low: it.low }
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {items.map((it, i) => (
            <div key={i} style={surface}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {it.id || it.item ? (
                  <span style={{ fontSize: 13, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.item}</span>
                ) : (
                  <input
                    placeholder="Item name"
                    value={it.item}
                    onChange={e => setItems(prev => prev.map((x, j) => j === i ? { ...x, item: e.target.value } : x))}
                    style={{ ...input, flex: 1, fontWeight: 700 }}
                  />
                )}
                <button
                  onClick={() => setItems(prev => prev.map((x, j) => j === i ? { ...x, low: !x.low } : x))}
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
                  onChange={e => setItems(prev => prev.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                  style={{ ...input, width: 72 }}
                />
                <input
                  placeholder="Notes"
                  value={it.notes}
                  onChange={e => setItems(prev => prev.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))}
                  style={{ ...input, flex: 1 }}
                />
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setItems(prev => [...prev, { item: '', qty: '', notes: '', low: false }])}
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
