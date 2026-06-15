'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'

const STUDIO_META: Record<string, { label: string; color: string }> = {
  paramount: { label: 'Paramount', color: '#c8f04e' },
  ameraycan: { label: 'Ameraycan', color: '#EF4444' },
  encore: { label: 'Encore', color: '#4e8ff0' },
  track: { label: 'Track', color: '#F97316' },
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
  const meta = STUDIO_META[studio] ?? { label: studio, color: '#c8f04e' }
  const today = new Date().toISOString().slice(0, 10)

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
    for (const it of items) {
      const payload = { studio, item: it.item, qty: parseInt(it.qty) || 0, notes: it.notes, low: it.low }
      if (it.id) {
        await supabase.from('stock_items').update(payload).eq('id', it.id)
      } else {
        const { data } = await supabase.from('stock_items').insert(payload).select().single()
        if (data) it.id = data.id
      }
    }
    await supabase.from('daily_ops_submissions').upsert({
      studio, date: today, category: 'stock',
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'studio,date,category' })
    setSaving(false)
    router.push(`/runner/${studio}`)
  }

  if (loading) return <div style={{ minHeight: '100dvh', background: '#0d0f14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b90a8', fontFamily: 'Syne, sans-serif' }}>Loading…</div>

  const lowCount = items.filter(i => i.low).length

  return (
    <div style={{ minHeight: '100dvh', background: '#0d0f14', fontFamily: 'Syne, sans-serif', paddingBottom: 100 }}>
      <div style={{ background: '#161920', borderBottom: `3px solid ${meta.color}`, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.push(`/runner/${studio}`)} style={{ background: 'none', border: 'none', color: '#8b90a8', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>←</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#e8eaf2' }}>Stock List</div>
          <div style={{ fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>{meta.label}{lowCount > 0 ? ` · ${lowCount} low` : ''}</div>
        </div>
      </div>

      <div style={{ padding: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it, i) => (
            <div key={i} style={{ background: '#161920', border: `1px solid ${it.low ? 'rgba(249,115,22,0.27)' : '#2a2e3d'}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: '#e8eaf2', fontWeight: 600 }}>{it.item}</span>
                <button
                  onClick={() => setItems(prev => prev.map((x, j) => j === i ? { ...x, low: !x.low } : x))}
                  style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: it.low ? 'rgba(249,115,22,0.13)' : '#2a2e3d', color: it.low ? '#F97316' : '#8b90a8' }}
                >
                  {it.low ? '⚠ Low' : 'OK'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  placeholder="Qty"
                  value={it.qty}
                  onChange={e => setItems(prev => prev.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                  style={{ width: 70, background: '#0d0f14', border: '1px solid #2a2e3d', borderRadius: 8, padding: '6px 8px', color: '#e8eaf2', fontSize: 12, fontFamily: 'DM Mono, monospace', outline: 'none' }}
                />
                <input
                  placeholder="Notes"
                  value={it.notes}
                  onChange={e => setItems(prev => prev.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))}
                  style={{ flex: 1, background: '#0d0f14', border: '1px solid #2a2e3d', borderRadius: 8, padding: '6px 10px', color: '#e8eaf2', fontSize: 12, fontFamily: 'DM Mono, monospace', outline: 'none' }}
                />
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setItems(prev => [...prev, { item: '', qty: '', notes: '', low: false }])}
          style={{ marginTop: 12, width: '100%', padding: '12px', background: '#161920', border: '1px dashed #2a2e3d', borderRadius: 12, color: '#8b90a8', fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
        >
          + Add Item
        </button>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: '#0d0f14', borderTop: '1px solid #2a2e3d' }}>
        <button onClick={save} disabled={saving} style={{ width: '100%', padding: '14px 0', background: meta.color, color: '#0d0f14', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'Syne, sans-serif' }}>
          {saving ? 'Saving…' : 'Save Stock List'}
        </button>
      </div>
    </div>
  )
}
