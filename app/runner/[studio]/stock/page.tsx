'use client'
// SOFT SKIN PORT, 2026-08-14. SECTIONS 2026-08-24. OPTION C + HISTORY,
// 2026-08-24 (Eli picked C from docs/design-refs/stock-density-options.html):
//   · Collapsible category groups (header = name · count · low badge) so 98
//     items are a set of jumps, not 30 screens of scroll.
//   · ONE LINE per item: name + par level left, qty + Low right (~40px, was
//     ~110px). Tap the name to expand: notes + the item's past checks.
//   · qty is TEXT — the paper sheet says "0.5", "1.25", "IFAK", "✓", and the
//     app must not be dumber than the clipboard it replaces.
//   · History lives in stock_checks (one row per item per date — the sheet's
//     date columns). stock_items keeps mirroring CURRENT qty/low/notes for
//     lib/dailyOps + DailyOpsModal, which read it.
//   · OFFICE group renders last: greyed off-day, pulsing DUE TODAY badge on
//     Wednesday, auto-expanded on Wednesday. Warn-don't-block.
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
  section: StockSection; target: string; sort_order: number; category: string | null
}
type CheckRow = { date: string; qty: string; low: boolean }

const OFFICE_KEY = '__office__'
const FLAT_KEY = '__flat__'

export default function StockPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio }
  const today = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) })()
  // Noon-anchored so the day-of-week can't drift across a TZ boundary.
  const isWednesday = new Date(today + 'T12:00:00').getDay() === 3

  const [items, setItems] = useState<StockItem[]>([])
  const [history, setHistory] = useState<Record<string, CheckRow[]>>({})
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [openItems, setOpenItems] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Edits are batched locally until Save — a realtime reload mid-typing would
  // wipe them, so remote changes only refresh this page while it's pristine.
  const dirtyRef = useRef(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('stock_items').select('*').eq('studio', studio)
      .order('sort_order').order('item')
    const rows = data ?? []
    const ids = rows.map((r: any) => r.id)

    // The sheet's date columns: this item's past checks, newest first.
    // Today's row (if any) hydrates the inputs; the rest render as history.
    let checks: any[] = []
    if (ids.length > 0) {
      const { data: cd } = await supabase
        .from('stock_checks').select('stock_item_id, date, qty, low, notes')
        .in('stock_item_id', ids)
        .order('date', { ascending: false })
        .limit(1500)
      checks = cd ?? []
    }
    const todayByItem: Record<string, any> = {}
    const past: Record<string, CheckRow[]> = {}
    for (const c of checks) {
      if (c.date === today) { todayByItem[c.stock_item_id] = c; continue }
      const arr = past[c.stock_item_id] ?? (past[c.stock_item_id] = [])
      if (arr.length < 5) arr.push({ date: c.date, qty: c.qty ?? '', low: !!c.low })
    }
    setHistory(past)

    if (rows.length > 0) {
      setItems(rows.map((r: any) => {
        const t = todayByItem[r.id]
        return {
          id: r.id, item: r.item ?? '',
          // A fresh day starts a fresh column, like the paper — qty is blank
          // until tonight's count; Low carries over (an item stays low until
          // someone restocks it).
          qty: t ? (t.qty ?? '') : '',
          notes: t ? (t.notes ?? '') : '',
          low: t ? !!t.low : (r.low ?? false),
          section: (r.section === 'office' ? 'office' : 'stock') as StockSection,
          target: r.target ?? '', sort_order: r.sort_order ?? 0,
          category: r.category ?? null,
        }
      }))
    } else {
      setItems(DEFAULT_ITEMS.map((item, i): StockItem => ({
        item, qty: '', notes: '', low: false, section: 'stock',
        target: '', sort_order: i + 1, category: null,
      })))
    }
    setLoading(false)
  }, [studio, today])

  useEffect(() => { load() }, [load])

  // Office opens itself on its day.
  useEffect(() => {
    if (isWednesday) setOpenGroups(prev => new Set(prev).add(OFFICE_KEY))
  }, [isWednesday])

  useEffect(() => {
    const ch = supabase
      .channel(`runner-stock-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_items', filter: `studio=eq.${studio}` }, () => {
        if (!dirtyRef.current) load()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_checks' }, () => {
        if (!dirtyRef.current) load()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [studio, load])

  function edit(idx: number, patch: Partial<StockItem>) {
    dirtyRef.current = true
    setItems(prev => prev.map((x, j) => j === idx ? { ...x, ...patch } : x))
  }

  function addItem(section: StockSection, category: string | null) {
    dirtyRef.current = true
    setItems(prev => {
      const maxSort = Math.max(0, ...prev.filter(x => x.section === section).map(x => x.sort_order))
      return [...prev, { item: '', qty: '', notes: '', low: false, section, target: '', sort_order: maxSort + 1, category }]
    })
  }

  async function save() {
    setSaving(true)
    const updated = items.map(it => ({ ...it }))

    // New items first (need ids for their check rows).
    for (let i = 0; i < updated.length; i++) {
      const it = updated[i]
      if (it.id || it.item.trim() === '') continue
      const { data } = await supabase.from('stock_items').insert({
        studio, item: it.item, qty: parseInt(it.qty) || 0, notes: it.notes, low: it.low,
        section: it.section, target: it.target, sort_order: it.sort_order, category: it.category,
      }).select().single()
      if (data) updated[i] = { ...it, id: data.id }
    }

    // Current-state mirror on stock_items (lib/dailyOps + DailyOpsModal read
    // it) + one check row per touched item — the sheet's date column.
    const mirror = updated.filter(it => it.id).map(it => ({
      id: it.id, studio, item: it.item, qty: parseInt(it.qty) || 0, notes: it.notes, low: it.low,
      section: it.section, target: it.target, sort_order: it.sort_order, category: it.category,
    }))
    if (mirror.length > 0) await supabase.from('stock_items').upsert(mirror, { onConflict: 'id' })

    const checks = updated
      .filter(it => it.id && (it.qty.trim() !== '' || it.low || it.notes.trim() !== ''))
      .map(it => ({ stock_item_id: it.id, date: today, qty: it.qty.trim(), low: it.low, notes: it.notes.trim() }))
    if (checks.length > 0) await supabase.from('stock_checks').upsert(checks, { onConflict: 'stock_item_id,date' })

    setItems(updated)
    await supabase.from('daily_ops_submissions').upsert({
      studio, date: today, category: 'stock',
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'studio,date,category' })
    dirtyRef.current = false
    setSaving(false)
    router.push(`/runner/${studio}`)
  }

  const input: React.CSSProperties = {
    background: 'var(--c-wash2)', border: 'none', borderRadius: 8,
    padding: '6px 9px', color: 'var(--c-fg)', fontSize: 12.5,
    font: 'inherit', outline: 'none',
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--c-bg)', color: 'var(--c-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  const lowCount = items.filter(i => i.low).length

  // Groups: nightly categories in seed order, then Office last. NULL category
  // (non-paramount studios) collapses to one flat, always-open list.
  type Group = { key: string; title: string; rows: { it: StockItem; idx: number }[]; office: boolean }
  const indexed = items.map((it, idx) => ({ it, idx }))
  const stockRows = indexed.filter(r => r.it.section === 'stock')
  const officeRows = indexed.filter(r => r.it.section === 'office')
  const groups: Group[] = []
  const seen = new Map<string, Group>()
  for (const r of stockRows) {
    const key = r.it.category ?? FLAT_KEY
    let g = seen.get(key)
    if (!g) { g = { key, title: r.it.category ?? '', rows: [], office: false }; seen.set(key, g); groups.push(g) }
    g.rows.push(r)
  }
  if (officeRows.length > 0) groups.push({ key: OFFICE_KEY, title: 'Office', rows: officeRows, office: true })
  const flatOnly = groups.length === 1 && groups[0].key === FLAT_KEY

  const toggleGroup = (key: string) => setOpenGroups(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const toggleItem = (id: string) => setOpenItems(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const fmtCheckDate = (iso: string) => {
    const d = new Date(iso + 'T12:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const renderRow = ({ it, idx }: { it: StockItem; idx: number }) => {
    const rowKey = it.id ?? `new-${idx}`
    const open = openItems.has(rowKey) || (!it.id && it.item === '')
    const past = it.id ? (history[it.id] ?? []) : []
    return (
      <div key={rowKey} style={{ background: 'var(--c-wash)', borderRadius: 9, marginBottom: 2, padding: '6px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {it.id || it.item ? (
            <span
              onClick={() => toggleItem(rowKey)}
              style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
            >
              {it.item}
              {it.target !== '' && <span style={{ fontSize: 9.5, opacity: 0.45, fontWeight: 400, marginLeft: 6 }}>{it.target}</span>}
              {it.notes.trim() !== '' && !open && <span style={{ fontSize: 9.5, opacity: 0.5, marginLeft: 6 }}>✎</span>}
            </span>
          ) : (
            <input
              placeholder="Item name"
              value={it.item}
              onChange={e => edit(idx, { item: e.target.value })}
              style={{ ...input, flex: 1, fontWeight: 700, background: 'var(--c-wash2)' }}
            />
          )}
          <input
            placeholder="Qty"
            value={it.qty}
            onChange={e => edit(idx, { qty: e.target.value })}
            style={{ ...input, width: 46, textAlign: 'center', flexShrink: 0, padding: '6px 4px' }}
          />
          <button
            onClick={() => edit(idx, { low: !it.low })}
            style={{
              border: 'none', font: 'inherit', cursor: 'pointer', flexShrink: 0,
              minWidth: 42, minHeight: 28, borderRadius: 99,
              fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
              background: it.low ? 'var(--c-st-warm)' : 'var(--c-wash2)',
              color: it.low ? 'var(--c-chip-ink)' : 'var(--c-fg)',
              opacity: it.low ? 1 : 0.6,
            }}
          >
            {it.low ? 'LOW' : 'OK'}
          </button>
        </div>
        {open && (
          <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              placeholder="Notes"
              value={it.notes}
              onChange={e => edit(idx, { notes: e.target.value })}
              style={{ ...input, width: '100%', boxSizing: 'border-box' }}
            />
            {past.length > 0 && (
              <div style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 10, opacity: 0.55, lineHeight: 1.7, padding: '0 2px' }}>
                {past.map(c => (
                  <span key={c.date} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
                    {fmtCheckDate(c.date)}: {c.qty || '—'}{c.low ? ' · LOW' : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

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

      <div style={{ padding: '4px 12px' }}>
        {groups.map(g => {
          const open = flatOnly || openGroups.has(g.key)
          const gLow = g.rows.filter(r => r.it.low).length
          const dimmed = g.office && !isWednesday
          return (
            <div key={g.key} style={{ opacity: dimmed ? 0.42 : 1, marginBottom: 6, background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 14, overflow: 'hidden' }}>
              {!flatOnly && (
                <div
                  onClick={() => toggleGroup(g.key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 12px', cursor: 'pointer' }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 800, letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {g.title}
                  </span>
                  {g.office && (isWednesday ? (
                    <span className="c-pill" style={{
                      background: 'var(--c-st-warm)', color: 'var(--c-chip-ink)',
                      fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                      padding: '3px 9px', animation: 'stockWedPulse 1.6s ease-in-out infinite', flexShrink: 0,
                    }}>Due today</span>
                  ) : (
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7, flexShrink: 0 }}>Wednesdays only</span>
                  ))}
                  <span style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 10, opacity: 0.5, flexShrink: 0 }}>
                    {g.rows.length}{gLow > 0 ? ` · ${gLow} low` : ''}
                  </span>
                  <span style={{ opacity: 0.4, fontSize: 10, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
                </div>
              )}
              {open && (
                <div style={{ padding: flatOnly ? '8px 6px' : '0 6px 8px' }}>
                  {g.rows.map(renderRow)}
                  <button
                    onClick={() => addItem(g.office ? 'office' : 'stock', g.office ? null : (g.key === FLAT_KEY ? null : g.title))}
                    style={{
                      marginTop: 6, width: '100%', minHeight: 38,
                      background: 'var(--c-wash)', border: 'none', borderRadius: 10,
                      color: 'var(--c-fg)', opacity: 0.6, fontSize: 12, fontWeight: 700,
                      cursor: 'pointer', font: 'inherit',
                    }}
                  >
                    + Add item
                  </button>
                </div>
              )}
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
