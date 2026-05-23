'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'

const STUDIO_META: Record<string, { label: string; color: string }> = {
  paramount: { label: 'Paramount', color: '#c8f04e' },
  ameraycan: { label: 'Ameraycan', color: '#f04e7a' },
  encore: { label: 'Encore', color: '#4e8ff0' },
  track: { label: 'Track', color: '#f0a24e' },
}

type MicItem = { id?: string; name: string; serial: string; location: string; condition: 'good' | 'fair' | 'damaged' | ''; notes: string }

const DEFAULT_MICS = [
  'Neumann U87',
  'AKG C414',
  'Shure SM7B',
  'Shure SM58',
  'Rode NT1',
  'Sennheiser MD421',
  'AKG D112',
  'Electrovoice RE20',
]

const CONDITION_COLORS: Record<string, string> = {
  good: '#4ade80',
  fair: '#f0a24e',
  damaged: '#f87171',
  '': '#8b90a8',
}

export default function MicsPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio, color: '#c8f04e' }

  const [mics, setMics] = useState<MicItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('mic_inventory').select('*').eq('studio', studio).order('name')
      if (data && data.length > 0) {
        setMics(data.map((r: any) => ({ id: r.id, name: r.name ?? '', serial: r.serial ?? '', location: r.location ?? '', condition: r.condition ?? '', notes: r.notes ?? '' })))
      } else {
        setMics(DEFAULT_MICS.map(name => ({ name, serial: '', location: '', condition: '', notes: '' })))
      }
      setLoading(false)
    }
    load()
  }, [studio])

  async function save() {
    setSaving(true)
    for (const mic of mics) {
      const payload = { studio, name: mic.name, serial: mic.serial, location: mic.location, condition: mic.condition || null, notes: mic.notes }
      if (mic.id) {
        await supabase.from('mic_inventory').update(payload).eq('id', mic.id)
      } else {
        const { data } = await supabase.from('mic_inventory').insert(payload).select().single()
        if (data) mic.id = data.id
      }
    }
    setSaving(false)
    alert('Mic inventory saved')
  }

  if (loading) return <div style={{ minHeight: '100dvh', background: '#0d0f14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b90a8', fontFamily: 'Syne, sans-serif' }}>Loading…</div>

  const damagedCount = mics.filter(m => m.condition === 'damaged').length

  return (
    <div style={{ minHeight: '100dvh', background: '#0d0f14', fontFamily: 'Syne, sans-serif', paddingBottom: 100 }}>
      <div style={{ background: '#161920', borderBottom: `3px solid ${meta.color}`, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.push(`/runner/${studio}`)} style={{ background: 'none', border: 'none', color: '#8b90a8', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>←</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#e8eaf2' }}>Mic Inventory</div>
          <div style={{ fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>
            {meta.label}{damagedCount > 0 ? ` · ${damagedCount} damaged` : ''}
          </div>
        </div>
      </div>

      <div style={{ padding: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mics.map((mic, i) => (
            <div key={i} style={{ background: '#161920', border: `1px solid ${mic.condition === 'damaged' ? '#f8717144' : '#2a2e3d'}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#e8eaf2' }}>{mic.name}</span>
                <select
                  value={mic.condition}
                  onChange={e => setMics(prev => prev.map((x, j) => j === i ? { ...x, condition: e.target.value as MicItem['condition'] } : x))}
                  style={{ background: '#0d0f14', border: `1px solid ${CONDITION_COLORS[mic.condition] ?? '#2a2e3d'}44`, borderRadius: 8, padding: '4px 8px', color: CONDITION_COLORS[mic.condition], fontSize: 11, fontWeight: 700, outline: 'none' }}
                >
                  <option value="">Not checked</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="damaged">Damaged</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                <input placeholder="Serial #" value={mic.serial} onChange={e => setMics(prev => prev.map((x, j) => j === i ? { ...x, serial: e.target.value } : x))}
                  style={{ background: '#0d0f14', border: '1px solid #2a2e3d', borderRadius: 8, padding: '6px 8px', color: '#e8eaf2', fontSize: 11, fontFamily: 'DM Mono, monospace', outline: 'none' }} />
                <input placeholder="Location/stand" value={mic.location} onChange={e => setMics(prev => prev.map((x, j) => j === i ? { ...x, location: e.target.value } : x))}
                  style={{ background: '#0d0f14', border: '1px solid #2a2e3d', borderRadius: 8, padding: '6px 8px', color: '#e8eaf2', fontSize: 11, fontFamily: 'DM Mono, monospace', outline: 'none' }} />
              </div>
              {(mic.condition === 'fair' || mic.condition === 'damaged') && (
                <input placeholder="Issue notes…" value={mic.notes} onChange={e => setMics(prev => prev.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))}
                  style={{ width: '100%', boxSizing: 'border-box', background: '#0d0f14', border: '1px solid #2a2e3d', borderRadius: 8, padding: '6px 8px', color: '#e8eaf2', fontSize: 11, fontFamily: 'DM Mono, monospace', outline: 'none' }} />
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() => setMics(prev => [...prev, { name: '', serial: '', location: '', condition: '', notes: '' }])}
          style={{ marginTop: 12, width: '100%', padding: '12px', background: '#161920', border: '1px dashed #2a2e3d', borderRadius: 12, color: '#8b90a8', fontSize: 13, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}
        >
          + Add Mic
        </button>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: '#0d0f14', borderTop: '1px solid #2a2e3d' }}>
        <button onClick={save} disabled={saving} style={{ width: '100%', padding: '14px 0', background: meta.color, color: '#0d0f14', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'Syne, sans-serif' }}>
          {saving ? 'Saving…' : 'Save Mic Inventory'}
        </button>
      </div>
    </div>
  )
}
