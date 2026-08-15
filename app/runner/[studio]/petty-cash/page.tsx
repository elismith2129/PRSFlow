'use client'
// SOFT SKIN PORT, 2026-08-14 (one-pass runner redesign). All queries, the
// dirtyRef realtime guard, save flow and error surfacing are UNTOUCHED —
// surface only. Old skin retired (legacy tokens, 1px borders, Syne). Colour is
// status only (§5): cash in booked-green, cash out hot, closing balance plain.
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

  const surface: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))',
    boxShadow: 'var(--c-softsh)',
    borderRadius: 16,
    padding: '13px 14px',
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

  return (
    <div style={{
      minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden',
      background: 'var(--c-bg)', color: 'var(--c-fg)', paddingBottom: 130,
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
          <div className="c-arch" style={{ fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Petty cash</div>
          <div style={{ fontSize: 11.5, opacity: 0.5 }}>{meta.label} · running ledger</div>
        </div>
      </div>

      <div style={{ padding: '4px 14px', display: 'flex', flexDirection: 'column', gap: 14 }} onChangeCapture={() => { dirtyRef.current = true }}>
        {/* Balances */}
        <div style={surface}>
          <div className="c-label" style={{ marginBottom: 10 }}>Balances</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
            <span style={{ fontSize: 12.5, opacity: 0.6 }}>Opening balance</span>
            <input
              type="number"
              value={openingBalance}
              onChange={e => setOpeningBalance(e.target.value)}
              placeholder="0.00"
              className="c-mono"
              style={{ ...input, width: 92, textAlign: 'right', minHeight: 36, padding: '6px 10px' }}
            />
          </div>
          {([
            ['Cash in', `+$${totalIn.toFixed(2)}`, 'var(--c-st-booked)'],
            ['Cash out', `-$${totalOut.toFixed(2)}`, 'var(--c-st-hot)'],
            ['Closing balance', `$${closing.toFixed(2)}`, 'var(--c-fg)'],
          ] as const).map(([l, v, c]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 12.5, opacity: 0.6 }}>{l}</span>
              <span className="c-mono" style={{ fontSize: 13, fontWeight: 700, color: c }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Entries */}
        <div style={surface}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div className="c-label" style={{ marginBottom: 0 }}>Transactions</div>
            <button
              onClick={addEntry}
              style={{
                background: 'var(--c-wash)', border: 'none', borderRadius: 99,
                padding: '6px 14px', minHeight: 32, color: 'var(--c-fg)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', font: 'inherit',
              }}
            >+ Add</button>
          </div>

          {entries.length === 0 && <div style={{ fontSize: 12.5, opacity: 0.5, textAlign: 'center', padding: '12px 0' }}>No entries yet</div>}

          {entries.map((e, i) => (
            <div key={i} style={{
              padding: '8px 0',
              boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
                <input
                  placeholder="Description"
                  value={e.description}
                  onChange={ev => setEntries(prev => prev.map((x, j) => j === i ? { ...x, description: ev.target.value } : x))}
                  style={input}
                />
                <input
                  type="number"
                  placeholder="$"
                  value={e.amount}
                  onChange={ev => setEntries(prev => prev.map((x, j) => j === i ? { ...x, amount: ev.target.value } : x))}
                  className="c-mono"
                  style={{ ...input, width: 76 }}
                />
                <button
                  type="button"
                  onClick={() => { dirtyRef.current = true; setEntries(prev => prev.map((x, j) => j === i ? { ...x, type: x.type === 'in' ? 'out' : 'in' } : x)) }}
                  className="c-pill"
                  style={{
                    border: 'none', font: 'inherit', cursor: 'pointer', minWidth: 48, minHeight: 40,
                    background: e.type === 'in' ? 'var(--c-st-booked)' : 'var(--c-st-hot)',
                    color: e.type === 'in' ? 'var(--c-chip-ink)' : 'var(--c-hot-text)',
                    justifyContent: 'center',
                  }}
                >
                  {e.type === 'in' ? 'In' : 'Out'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '12px 14px calc(16px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(to top, var(--c-bg) 68%, transparent)',
      }}>
        {saveError && (
          <div style={{
            fontSize: 12, color: 'var(--c-st-hot)', fontWeight: 700, textAlign: 'center',
            marginBottom: 8, padding: '7px 10px',
            background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 10,
          }}>
            {saveError}
          </div>
        )}
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
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
