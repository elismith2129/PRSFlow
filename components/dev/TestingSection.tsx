'use client'
// DEV → Testing. PIN-gated checklists a staff member works through, recording
// Works / Doesn't work plus a note per item.
//
// Batch and item definitions come from lib/testBatches.ts (code, versioned with
// the features they cover). Only verdicts live in the database (`test_results`),
// keyed by (batch_id, item_id) — a single tester runs these, so there's no
// per-person dimension.
//
// The PIN is a soft gate, NOT security: it keeps a curious staff member from
// wandering into a testing run, nothing more. Everything behind it is already
// readable by any signed-in staff under RLS, so there's nothing here to protect —
// don't let this pattern spread to anything that matters.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { TEST_BATCHES, type TestBatch } from '@/lib/testBatches'
import { useUserProfile } from '@/hooks/useUserProfile'

const TESTING_PIN = '4321'
const PIN_OK_KEY = 'dev_testing_unlocked'

type Verdict = { status: 'pass' | 'fail'; note: string | null; tested_by: string | null; updated_at: string }

export function TestingSection() {
  const { profile } = useUserProfile()
  const testerName = profile?.display_name || 'Staff'

  // Unlocked for the browser session only — a fresh tab asks again.
  const [unlocked, setUnlocked] = useState(false)
  const [pinEntry, setPinEntry] = useState('')
  const [pinError, setPinError] = useState(false)

  const [batchId, setBatchId] = useState<string>(TEST_BATCHES[0]?.id ?? '')
  const [results, setResults] = useState<Record<string, Verdict>>({})
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [openNote, setOpenNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [areaFilter, setAreaFilter] = useState<string>('')

  useEffect(() => {
    try { if (sessionStorage.getItem(PIN_OK_KEY) === '1') setUnlocked(true) } catch { /* ignore */ }
  }, [])

  const batch: TestBatch | undefined = useMemo(
    () => TEST_BATCHES.find(b => b.id === batchId),
    [batchId],
  )

  const load = useCallback(async () => {
    if (!batchId) return
    const { data } = await supabase
      .from('test_results')
      .select('item_id, status, note, tested_by, updated_at')
      .eq('batch_id', batchId)
    const map: Record<string, Verdict> = {}
    for (const r of data || []) {
      map[(r as any).item_id] = {
        status: (r as any).status,
        note: (r as any).note,
        tested_by: (r as any).tested_by,
        updated_at: (r as any).updated_at,
      }
    }
    setResults(map)
    setLoading(false)
  }, [batchId])

  useEffect(() => { if (unlocked) load() }, [unlocked, load])

  // Standing rule: pair every fetch with a realtime subscription. Also means Eli
  // watching on a laptop sees verdicts land as the tester works.
  useEffect(() => {
    if (!unlocked || !batchId) return
    const channel = supabase
      .channel(`test-results-${batchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'test_results' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [unlocked, batchId, load])

  async function setVerdict(itemId: string, status: 'pass' | 'fail') {
    if (!batch) return
    const note = (noteDrafts[itemId] ?? results[itemId]?.note ?? '') || null
    const row = {
      batch_id: batch.id, item_id: itemId, status, note,
      tested_by: testerName, updated_at: new Date().toISOString(),
    }
    // Optimistic — a tester tapping through 40 items shouldn't wait on a round trip.
    setResults(prev => ({ ...prev, [itemId]: { status, note, tested_by: testerName, updated_at: row.updated_at } }))
    const { error } = await supabase.from('test_results').upsert(row, { onConflict: 'batch_id,item_id' })
    if (!dbResult('Saving test result', error)) load() // reload to undo the optimistic set
  }

  async function saveNote(itemId: string) {
    const existing = results[itemId]
    const note = (noteDrafts[itemId] ?? '') || null
    if (!batch) return
    // A note before a verdict is fine — default to fail, since notes are almost
    // always written when something is wrong.
    const status = existing?.status ?? 'fail'
    const row = {
      batch_id: batch.id, item_id: itemId, status, note,
      tested_by: testerName, updated_at: new Date().toISOString(),
    }
    setResults(prev => ({ ...prev, [itemId]: { status, note, tested_by: testerName, updated_at: row.updated_at } }))
    const { error } = await supabase.from('test_results').upsert(row, { onConflict: 'batch_id,item_id' })
    if (!dbResult('Saving note', error)) { load(); return }
    setOpenNote(null)
  }

  // ── PIN gate ──
  if (!unlocked) {
    return (
      <div style={{ maxWidth: 320, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: 'var(--text)', marginBottom: 6 }}>Testing</div>
        <div style={{ fontSize: 12, fontFamily: 'Inter', color: 'var(--text2)', marginBottom: 18, lineHeight: 1.6 }}>
          Enter the testing PIN to open the checklists.
        </div>
        <input
          value={pinEntry}
          onChange={e => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 4)
            setPinEntry(v)
            setPinError(false)
            if (v.length === 4) {
              if (v === TESTING_PIN) {
                try { sessionStorage.setItem(PIN_OK_KEY, '1') } catch { /* ignore */ }
                setUnlocked(true)
              } else {
                setPinError(true)
                setPinEntry('')
              }
            }
          }}
          inputMode="numeric"
          autoFocus
          placeholder="••••"
          style={{
            width: 140, textAlign: 'center', letterSpacing: '0.5em',
            background: 'var(--surface2)', border: `1px solid ${pinError ? 'var(--hot)' : 'var(--border)'}`,
            borderRadius: 8, color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 20,
            padding: '12px 0', outline: 'none',
          }}
        />
        {pinError && (
          <div style={{ marginTop: 10, fontSize: 11, fontFamily: 'Inter', color: 'var(--hot)' }}>Incorrect PIN</div>
        )}
      </div>
    )
  }

  if (!batch) {
    return <div style={{ padding: 20, color: 'var(--text2)', fontFamily: 'Inter', fontSize: 12 }}>No test batches defined.</div>
  }

  const areas = Array.from(new Set(batch.items.map(i => i.area)))
  const shown = areaFilter ? batch.items.filter(i => i.area === areaFilter) : batch.items
  const passed = batch.items.filter(i => results[i.id]?.status === 'pass').length
  const failed = batch.items.filter(i => results[i.id]?.status === 'fail').length
  const untested = batch.items.length - passed - failed

  const pill = (label: string, count: number, color: string, active: boolean, onClick: () => void): React.ReactNode => (
    <button
      onClick={onClick}
      style={{
        padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : 'transparent',
        color: active ? color : 'var(--text2)',
        fontFamily: 'Syne', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
      }}
    >
      {label} {count}
    </button>
  )

  return (
    <div>
      {/* Batch header + progress */}
      <div style={{ marginBottom: 16 }}>
        {TEST_BATCHES.length > 1 && (
          <select
            value={batchId}
            onChange={e => { setBatchId(e.target.value); setLoading(true); setAreaFilter('') }}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'Inter', fontSize: 12, padding: '6px 9px', marginBottom: 10 }}
          >
            {TEST_BATCHES.map(b => <option key={b.id} value={b.id}>{b.title} · {b.version}</option>)}
          </select>
        )}
        <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 20, color: 'var(--text)' }}>{batch.title}</div>
        <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--text3)', marginBottom: 8 }}>{batch.version} · {batch.date}</div>
        <div style={{ fontSize: 12, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.7, marginBottom: 12 }}>{batch.intro}</div>

        {/* Progress bar — pass/fail proportions at a glance. */}
        <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--surface2)', marginBottom: 10 }}>
          <div style={{ width: `${(passed / batch.items.length) * 100}%`, background: 'var(--booked)' }} />
          <div style={{ width: `${(failed / batch.items.length) * 100}%`, background: 'var(--hot)' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {pill('Works', passed, 'var(--booked)', false, () => {})}
          {pill('Broken', failed, 'var(--hot)', false, () => {})}
          {pill('Not tested', untested, 'var(--text3)', false, () => {})}
        </div>
      </div>

      {/* Area filter — a 40-item batch is easier in sections. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button
          onClick={() => setAreaFilter('')}
          style={{ padding: '5px 11px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${!areaFilter ? 'var(--accent)' : 'var(--border)'}`, background: !areaFilter ? 'rgba(var(--accent-rgb),0.12)' : 'transparent', color: !areaFilter ? 'var(--accent)' : 'var(--text2)', fontFamily: 'Syne', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}
        >
          All
        </button>
        {areas.map(a => {
          const on = areaFilter === a
          const areaItems = batch.items.filter(i => i.area === a)
          const areaDone = areaItems.filter(i => results[i.id]).length
          return (
            <button
              key={a}
              onClick={() => setAreaFilter(on ? '' : a)}
              style={{ padding: '5px 11px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'rgba(var(--accent-rgb),0.12)' : 'transparent', color: on ? 'var(--accent)' : 'var(--text2)', fontFamily: 'Inter', fontSize: 11 }}
            >
              {a} <span style={{ color: 'var(--text3)' }}>{areaDone}/{areaItems.length}</span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontFamily: 'Inter', fontSize: 12 }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map((item, i) => {
            const v = results[item.id]
            const isPass = v?.status === 'pass'
            const isFail = v?.status === 'fail'
            const borderColor = isPass ? 'rgba(20,184,166,0.45)' : isFail ? 'rgba(239,68,68,0.45)' : 'var(--border)'
            const noteOpen = openNote === item.id
            return (
              <div key={item.id} style={{ background: 'var(--surface)', border: `1px solid ${borderColor}`, borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>
                    {String(batch.items.indexOf(item) + 1).padStart(2, '0')}
                  </span>
                  <span style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)' }}>{item.area}</span>
                </div>
                <div style={{ fontSize: 14, fontFamily: 'Inter', fontWeight: 600, color: 'var(--text)', lineHeight: 1.45, marginBottom: 6 }}>
                  {item.what}
                </div>
                <div style={{ fontSize: 12, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.65, marginBottom: 12 }}>
                  {item.how}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    onClick={() => setVerdict(item.id, 'pass')}
                    style={{ flex: '1 1 120px', padding: '10px 0', borderRadius: 8, cursor: 'pointer', border: `1px solid ${isPass ? 'var(--booked)' : 'var(--border)'}`, background: isPass ? 'rgba(20,184,166,0.16)' : 'transparent', color: isPass ? 'var(--booked)' : 'var(--text2)', fontFamily: 'Syne', fontWeight: 700, fontSize: 12 }}
                  >
                    {isPass ? '✓ Works' : 'Works'}
                  </button>
                  <button
                    onClick={() => setVerdict(item.id, 'fail')}
                    style={{ flex: '1 1 120px', padding: '10px 0', borderRadius: 8, cursor: 'pointer', border: `1px solid ${isFail ? 'var(--hot)' : 'var(--border)'}`, background: isFail ? 'rgba(239,68,68,0.16)' : 'transparent', color: isFail ? 'var(--hot)' : 'var(--text2)', fontFamily: 'Syne', fontWeight: 700, fontSize: 12 }}
                  >
                    {isFail ? '✕ Doesn’t work' : 'Doesn’t work'}
                  </button>
                  <button
                    onClick={() => {
                      setNoteDrafts(p => ({ ...p, [item.id]: p[item.id] ?? v?.note ?? '' }))
                      setOpenNote(noteOpen ? null : item.id)
                    }}
                    style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: v?.note ? 'var(--accent)' : 'var(--text3)', fontFamily: 'Syne', fontWeight: 700, fontSize: 11 }}
                  >
                    {v?.note ? 'Note ✓' : 'Note'}
                  </button>
                </div>

                {noteOpen && (
                  <div style={{ marginTop: 10 }}>
                    <textarea
                      value={noteDrafts[item.id] ?? ''}
                      onChange={e => setNoteDrafts(p => ({ ...p, [item.id]: e.target.value }))}
                      rows={3}
                      autoFocus
                      placeholder="What did you see? Be specific — what you tapped, what happened."
                      style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: 'Inter', fontSize: 13, padding: '10px 12px', outline: 'none', resize: 'vertical', lineHeight: 1.6 }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button onClick={() => saveNote(item.id)} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: 'var(--bg)', fontFamily: 'Syne', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Save note</button>
                      <button onClick={() => setOpenNote(null)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontFamily: 'Syne', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                    </div>
                  </div>
                )}

                {!noteOpen && v?.note && (
                  <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--surface2)', borderLeft: '2px solid var(--accent)', borderRadius: '0 4px 4px 0', fontSize: 12, fontFamily: 'Inter', color: 'var(--text2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {v.note}
                  </div>
                )}

                {v && (
                  <div style={{ marginTop: 8, fontSize: 10, fontFamily: 'Inter', color: 'var(--text3)' }}>
                    {v.tested_by || 'Staff'} · {new Date(v.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
