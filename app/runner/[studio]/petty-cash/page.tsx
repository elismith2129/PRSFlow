'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'

const STUDIO_META: Record<string, { label: string }> = {
  paramount: { label: 'Paramount' },
  ameraycan: { label: 'Ameraycan' },
  encore: { label: 'Encore' },
  track: { label: 'Track' },
}

type Entry = { id?: string; description: string; amount: string; type: 'in' | 'out' }

export default function PettyCashPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio }
  const today = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) })()

  const [entries, setEntries] = useState<Entry[]>([])
  const [openingBalance, setOpeningBalance] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // True once the runner edits anything; blocks the realtime refetch so a live update
  // never clobbers unsaved local entries. Reset to false whenever we load fresh data.
  const dirtyRef = useRef(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('petty_cash_entries')
      .select('*')
      .eq('studio', studio)
      .order('date')
      .order('created_at')
    setEntries((data ?? []).map((e: any) => ({
      id: e.id, description: e.description ?? '', amount: e.amount != null ? String(e.amount) : '', type: e.type ?? 'out',
    })))
    // Check opening balance
    const { data: ob } = await supabase.from('petty_cash_balances').select('amount').eq('studio', studio).order('date', { ascending: false }).limit(1).maybeSingle()
    setOpeningBalance(ob?.amount != null ? String(ob.amount) : '')
    setLoading(false)
    dirtyRef.current = false
  }, [studio])

  useEffect(() => { load() }, [load])

  // Real-time: refetch entries/balance live when clean; skip while the runner is mid-edit.
  useEffect(() => {
    const channel = supabase
      .channel(`runner-petty-cash-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'petty_cash_entries' }, () => { if (!dirtyRef.current) load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'petty_cash_balances' }, () => { if (!dirtyRef.current) load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studio, load])

  async function addEntry() {
    dirtyRef.current = true
    setEntries(prev => [...prev, { description: '', amount: '', type: 'out' }])
  }

  async function save() {
    setSaving(true)
    setSaveError(null)

    // Save opening balance
    if (openingBalance) {
      const { error: balErr } = await supabase.from('petty_cash_balances').upsert(
        { studio, date: today, amount: parseFloat(openingBalance) || 0 },
        { onConflict: 'studio,date' }
      )
      if (balErr) { setSaveError(`Balance save failed: ${balErr.message}`); setSaving(false); return }
    }

    // Save entries
    const updated = entries.map(e => ({ ...e }))
    for (let i = 0; i < updated.length; i++) {
      const e = updated[i]
      const amt = parseFloat(e.amount) || 0
      if (!e.description && !amt) continue
      if (e.id) {
        const { error } = await supabase.from('petty_cash_entries')
          .update({ description: e.description, amount: amt, type: e.type }).eq('id', e.id)
        if (error) { setSaveError(`Entry save failed: ${error.message}`); setSaving(false); return }
      } else {
        const { data, error } = await supabase.from('petty_cash_entries')
          .insert({ studio, date: today, description: e.description, amount: amt, type: e.type })
          .select().single()
        if (error) { setSaveError(`Entry save failed: ${error.message}`); setSaving(false); return }
        if (data) updated[i] = { ...e, id: data.id }
      }
    }
    setEntries(updated)

    const { error: subErr } = await supabase.from('daily_ops_submissions').upsert(
      { studio, date: today, category: 'petty_cash', submitted_at: new Date().toISOString() },
      { onConflict: 'studio,date,category' }
    )
    if (subErr) { setSaveError(`Submission record failed: ${subErr.message}`); setSaving(false); return }

    setSaving(false)
    router.push(`/runner/${studio}`)
  }

  const totalIn = entries.filter(e => e.type === 'in').reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const totalOut = entries.filter(e => e.type === 'out').reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const closing = (parseFloat(openingBalance) || 0) + totalIn - totalOut

  if (loading) return <div style={{ minHeight: '100dvh', background: '#0d0f14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b90a8', fontFamily: 'Syne, sans-serif' }}>Loading…</div>

  return (
    <div style={{ minHeight: '100dvh', background: '#0d0f14', fontFamily: 'Syne, sans-serif', paddingBottom: 100 }}>
      <div style={{ background: '#161920', borderBottom: '1px solid var(--border)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => router.push(`/runner/${studio}`)} style={{ background: 'none', border: 'none', color: '#8b90a8', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>←</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#e8eaf2' }}>Petty Cash</div>
          <div style={{ fontSize: 11, color: '#8b90a8', fontFamily: 'DM Mono, monospace' }}>{meta.label} · Running Ledger</div>
        </div>
      </div>

      <div style={{ padding: '16px' }} onChangeCapture={() => { dirtyRef.current = true }}>
        {/* Balances */}
        <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderRadius: 12, padding: '14px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b90a8', marginBottom: 12 }}>Balances</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#8b90a8' }}>Opening Balance</span>
            <input
              type="number"
              value={openingBalance}
              onChange={e => setOpeningBalance(e.target.value)}
              placeholder="0.00"
              style={{ width: 80, textAlign: 'right', background: '#2a2e3d', border: 'none', borderRadius: 6, padding: '4px 8px', color: '#e8eaf2', fontSize: 12, fontFamily: 'DM Mono, monospace', outline: 'none' }}
            />
          </div>
          {[['Cash In', `+$${totalIn.toFixed(2)}`, '#14B8A6'], ['Cash Out', `-$${totalOut.toFixed(2)}`, '#EF4444'], ['Closing Balance', `$${closing.toFixed(2)}`, '#c8f04e']].map(([l, v, c]) => (
            <div key={String(l)} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#8b90a8' }}>{l}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: String(c), fontFamily: 'DM Mono, monospace' }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Entries */}
        <div style={{ background: '#161920', border: '1px solid #2a2e3d', borderRadius: 12, padding: '14px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b90a8' }}>Transactions</div>
            <button onClick={addEntry} style={{ background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>+ Add</button>
          </div>

          {entries.length === 0 && <div style={{ fontSize: 12, color: '#8b90a8', textAlign: 'center', padding: '12px 0' }}>No entries yet</div>}

          {entries.map((e, i) => (
            <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < entries.length - 1 ? '1px solid #2a2e3d' : 'none' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, marginBottom: 6 }}>
                <input
                  placeholder="Description"
                  value={e.description}
                  onChange={ev => setEntries(prev => prev.map((x, j) => j === i ? { ...x, description: ev.target.value } : x))}
                  style={{ background: '#0d0f14', border: '1px solid #2a2e3d', borderRadius: 8, padding: '7px 10px', color: '#e8eaf2', fontSize: 12, fontFamily: 'DM Mono, monospace', outline: 'none' }}
                />
                <input
                  type="number"
                  placeholder="$"
                  value={e.amount}
                  onChange={ev => setEntries(prev => prev.map((x, j) => j === i ? { ...x, amount: ev.target.value } : x))}
                  style={{ width: 70, background: '#0d0f14', border: '1px solid #2a2e3d', borderRadius: 8, padding: '7px 8px', color: '#e8eaf2', fontSize: 12, fontFamily: 'DM Mono, monospace', outline: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => { dirtyRef.current = true; setEntries(prev => prev.map((x, j) => j === i ? { ...x, type: x.type === 'in' ? 'out' : 'in' } : x)) }}
                  style={{ background: '#0d0f14', border: `1px solid ${e.type === 'in' ? '#14B8A6' : '#EF4444'}`, borderRadius: 8, padding: '7px 10px', color: e.type === 'in' ? '#14B8A6' : '#EF4444', fontSize: 12, fontWeight: 700, fontFamily: 'DM Mono, monospace', cursor: 'pointer', minWidth: 44 }}
                >
                  {e.type === 'in' ? 'In' : 'Out'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 16px', background: '#0d0f14', borderTop: '1px solid #2a2e3d' }}>
        {saveError && (
          <div style={{ fontSize: 11, color: '#f87171', fontFamily: 'DM Mono, monospace', textAlign: 'center', marginBottom: 8, padding: '6px 10px', background: '#f8717122', borderRadius: 8 }}>
            {saveError}
          </div>
        )}
        <button onClick={save} disabled={saving} style={{ width: '100%', padding: '14px 0', background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'Syne, sans-serif' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
