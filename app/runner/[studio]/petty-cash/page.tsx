'use client'
// A DAILY LEDGER (Eli, 2026-09-23). Reference: docs/design-refs/
// petty-cash-daily-options.html.
//
// WHAT THIS REPLACED. The page loaded EVERY entry the studio had ever made
// and labelled the original seed "Opening balance". The arithmetic was
// internally consistent — seed + all history = the real balance — but the
// label was a lie, so the number never moved and a runner reading it saw a
// figure from months ago. Two things followed, both live in production:
//   · a runner typed the night's cash into a CASH IN entry, which in a
//     perpetual ledger never washes out — it inflates that studio's balance
//     permanently;
//   · the opening stayed an editable input while every entry ever was summed
//     against it, so one well-meant correction would have added the entire
//     transaction history on top of itself.
//
// NOW: entries are scoped to the operational day, and the opening is DERIVED
// by petty_cash_opening() in SQL — the same function the office daily-ops
// modal reads, so the two surfaces cannot drift. It is a read-only fact with
// a receipt ("carried from Saturday's count, less what was logged Sunday"),
// not a field. A runner who thinks it is wrong counts the box and types the
// count; the difference is the signal, and it goes to the office.
//
// Colour is status only (§5): cash in booked-green, cash out hot, balances
// plain. The confirm sheets below are deliberately FOUR, not one per action —
// a prompt on every change trains people to tap through the one that mattered.
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { useReloadOnReturn } from '@/hooks/useReloadOnReturn'
import { draftKey, readDraft, writeDraft, clearDraft } from '@/lib/draft'
import { opsToday } from '@/lib/time'
import { useUserProfile } from '@/hooks/useUserProfile'

const STUDIO_META: Record<string, { label: string }> = {
  paramount: { label: 'Paramount' },
  ameraycan: { label: 'Ameraycan' },
  encore: { label: 'Encore' },
  track: { label: 'Track' },
}

type Entry = { id?: string; description: string; amount: string; type: 'in' | 'out' }

/** "2026-09-20" -> "Sat Sep 20". Parsed by hand: new Date('2026-09-20') is
 *  UTC midnight, which renders as the 19th west of Greenwich. */
function fmtShort(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return d
  const dt = new Date(y, m - 1, day)
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function PettyCashPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio }
  // Operational day (8:50 AM roll, 2026-08-28) — after-midnight entries
  // belong to the night in progress.
  const today = opsToday()

  const { profile } = useUserProfile()
  const [entries, setEntries] = useState<Entry[]>([])
  // DERIVED, never typed. petty_cash_opening() in SQL owns the rule; this is
  // only its answer, plus the trail that explains it to the runner.
  const [opening, setOpening] = useState(0)
  const [openWhy, setOpenWhy] = useState<{ sinceDate: string | null; base: number; moved: number; countedBy: string | null } | null>(null)
  const [showWhy, setShowWhy] = useState(false)
  const [countNote, setCountNote] = useState('')
  // Which confirm sheet is up, if any. One at a time, always dismissible.
  const [ask, setAsk] = useState<null | { kind: 'cashin'; idx: number } | { kind: 'edit'; idx: number } | { kind: 'save' }>(null)
  // Entries already on the record that the runner has confirmed they mean to
  // change. Asked ONCE per entry per visit — asking on every keystroke is how
  // a prompt becomes something people tap through without reading.
  const unlockedRef = useRef<Set<string>>(new Set())
  // A cash-in the runner has confirmed really is money going into the box.
  const cashInOkRef = useRef<Set<number>>(new Set())
  // What's physically in the box at close (ERS, 2026-09-15). Typed, never
  // derived — the point is comparing it against the computed closing balance.
  const [countedClose, setCountedClose] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // True once the runner edits anything; blocks the realtime refetch so a live update
  // never clobbers unsaved local entries. Reset to false whenever we load fresh data.
  const dirtyRef = useRef(false)

  const load = useCallback(async () => {
    // TONIGHT ONLY. The missing .eq('date') here is what made this a perpetual
    // ledger; the office modal has always scoped to one day, so this is the
    // side that was wrong.
    const { data } = await supabase
      .from('petty_cash_entries')
      .select('*')
      .eq('studio', studio)
      .eq('date', today)
      .order('created_at')
    let loaded: Entry[] = (data ?? []).map((e: any) => ({
      id: e.id, description: e.description ?? '', amount: e.amount != null ? String(e.amount) : '', type: e.type ?? 'out',
    }))
    // THE OPENING — one round trip to the rule that both surfaces share.
    const { data: op } = await supabase.rpc('petty_cash_opening', { p_studio: studio, p_date: today })
    const openNum = Number(op ?? 0)

    // The receipt behind that number: the last night anyone counted, and what
    // has been logged since. Shown on tap — a runner who cannot see WHY the
    // opening is what it is will eventually try to "fix" it.
    const { data: lastCount } = await supabase
      .from('petty_cash_balances')
      .select('date, counted_close, counted_by_name')
      .eq('studio', studio).lt('date', today)
      .not('counted_close', 'is', null)
      // NOT .maybeSingle() — banned for new code since Aug 10.
      .order('date', { ascending: false }).limit(1)
    const lc = lastCount?.[0]
    const base = lc?.counted_close != null ? Number(lc.counted_close) : 0
    setOpenWhy({
      sinceDate: lc?.date ?? null,
      base,
      moved: Math.round((openNum - base) * 100) / 100,
      countedBy: lc?.counted_by_name ?? null,
    })
    setOpening(openNum)

    // Today's count only — yesterday's count is yesterday's.
    const { data: tc } = await supabase.from('petty_cash_balances').select('counted_close, count_note').eq('studio', studio).eq('date', today).limit(1)
    let counted = tc?.[0]?.counted_close != null ? String(tc[0].counted_close) : ''
    let note = tc?.[0]?.count_note ?? ''
    dirtyRef.current = false

    // Unsaved draft from a previous visit (lib/draft): unsaved entries come
    // back, a typed balance wins, and the page counts as dirty so realtime
    // doesn't clobber it. Cleared on successful save.
    // openingBalance is still READ off older drafts so a half-typed night from
    // before this change does not throw — but it is discarded, because the
    // opening is no longer the runner's to set.
    const draft = readDraft<{ newEntries: Entry[]; openingBalance?: string | null; countedClose?: string | null; countNote?: string | null }>(draftKey('petty', studio, today))
    if (draft && (draft.newEntries.length > 0 || draft.countedClose != null || draft.countNote != null)) {
      loaded = [...loaded, ...draft.newEntries]
      if (draft.countedClose != null) counted = draft.countedClose
      if (draft.countNote != null) note = draft.countNote
      dirtyRef.current = true
    }

    setEntries(loaded)
    setCountedClose(counted)
    setCountNote(note)
    setLoading(false)
  }, [studio, today])

  // Mirror unsaved input to the draft as it changes.
  useEffect(() => {
    if (loading || !dirtyRef.current) return
    writeDraft(draftKey('petty', studio, today), {
      newEntries: entries.filter(e => !e.id && (e.description || e.amount)),
      countedClose,
      countNote,
    })
  }, [entries, countedClose, countNote, loading, studio, today])

  useEffect(() => { load() }, [load])
  // Same dirty-guard as the realtime channel: never clobber a half-typed entry.
  useReloadOnReturn(useCallback(() => { if (!dirtyRef.current) load() }, [load]))

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

    // The day row: the DERIVED opening (stamped so the office modal and any
    // later report read the same number the runner saw), plus tonight's count,
    // who counted it and anything they noticed. `amount` is no longer typed.
    {
      const { error: balErr } = await supabase.from('petty_cash_balances').upsert(
        {
          studio, date: today, amount: opening,
          counted_close: countedClose.trim() === '' ? null : (parseFloat(countedClose) || 0),
          counted_by_name: countedClose.trim() === '' ? null : ((profile?.display_name || '').trim() || null),
          count_note: countNote.trim() === '' ? null : countNote.trim(),
        },
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

    // Every write succeeded — only now does the draft die. A failed save above
    // returns early and the draft keeps their typing.
    clearDraft(draftKey('petty', studio, today))
    dirtyRef.current = false
    setSaving(false)
    router.push(`/runner/${studio}`)
  }

  // "Counted — no change" (ERS runner feedback, 2026-09-02): a night where the
  // box matched needed the same record as a night with transactions, but the
  // only button said "Save", which reads as "save my edits" — so runners with
  // nothing to type just left, and the sweep showed petty cash "not done".
  // The button runs the SAME save(): it re-stamps today's balance row and the
  // petty_cash submission, which is exactly what "I counted it and it's the
  // same" means. Shown only when there's nothing new typed — once they add an
  // entry, Save is the act.
  const hasNewEntries = entries.some(e => !e.id && (e.description || e.amount))

  /** Every edit to an entry funnels through here so the two guards cannot be
   *  bypassed by one of the three inputs forgetting to call them. */
  function patchEntry(i: number, patch: Partial<Entry>) {
    const e = entries[i]
    if (!e) return
    dirtyRef.current = true
    // GUARD 1 — changing something the office can already see.
    if (e.id && !unlockedRef.current.has(e.id)) { setAsk({ kind: 'edit', idx: i }); return }
    const next = { ...e, ...patch }
    // GUARD 2 — a cash IN that is suspiciously close to tonight's opening is
    // almost certainly the balance being typed in as a transaction. That is
    // the mistake that put fake money in the ledger, so it gets stopped where
    // it is made rather than found weeks later.
    if (next.type === 'in' && !cashInOkRef.current.has(i) && looksLikeBalance(parseFloat(next.amount) || 0)) {
      setEntries(prev => prev.map((x, j) => j === i ? next : x))
      setAsk({ kind: 'cashin', idx: i })
      return
    }
    setEntries(prev => prev.map((x, j) => j === i ? next : x))
  }

  /** The guard's own escape hatch: applies a patch WITHOUT re-asking, used by
   *  the sheets themselves when the runner has already answered. */
  function patchEntryForce(i: number, patch: Partial<Entry>) {
    dirtyRef.current = true
    setEntries(prev => prev.map((x, j) => j === i ? { ...x, ...patch } : x))
  }

  /** Within 5% (or $5, whichever is larger) of the opening — "almost exactly
   *  tonight's balance". Deliberately loose: a false prompt costs one tap, a
   *  miss costs a permanently wrong ledger. */
  function looksLikeBalance(amt: number): boolean {
    if (amt <= 0 || opening <= 0) return false
    return Math.abs(amt - opening) <= Math.max(5, opening * 0.05)
  }

  const totalIn = entries.filter(e => e.type === 'in').reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const totalOut = entries.filter(e => e.type === 'out').reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const closing = opening + totalIn - totalOut
  const countedNum = countedClose.trim() === '' ? null : (parseFloat(countedClose) || 0)
  const diff = countedNum == null ? null : Math.round((countedNum - closing) * 100) / 100

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
          <div style={{ fontSize: 11.5, opacity: 0.5 }}>{meta.label} · {fmtShort(today)}</div>
        </div>
      </div>

      <div style={{ padding: '4px 14px', display: 'flex', flexDirection: 'column', gap: 14 }} onChangeCapture={() => { dirtyRef.current = true }}>
        {/* Balances */}
        <div style={surface}>
          <div className="c-label" style={{ marginBottom: 10 }}>Balances</div>
          {/* READ-ONLY, WITH A RECEIPT. This was an editable input, and every
              entry in the studio's history was summed against it — one
              well-meant correction would have added the whole history on top
              of itself. It is now the answer from petty_cash_opening(), and
              tapping it shows where the number came from. */}
          <button
            type="button"
            onClick={() => setShowWhy(v => !v)}
            style={{
              width: '100%', background: 'none', border: 'none', padding: 0, font: 'inherit',
              color: 'var(--c-fg)', textAlign: 'left', cursor: 'pointer', marginBottom: 9,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, opacity: 0.6 }}>Opening {showWhy ? '▾' : '▸'}</span>
              <span className="c-mono" style={{ fontSize: 13, fontWeight: 700 }}>${opening.toFixed(2)}</span>
            </div>
            <div style={{ fontSize: 10.5, opacity: 0.45, lineHeight: 1.4, marginTop: 2 }}>
              {openWhy?.sinceDate
                ? `Carried from ${fmtShort(openWhy.sinceDate)}'s count${openWhy.moved !== 0 ? `, ${openWhy.moved < 0 ? 'less' : 'plus'} $${Math.abs(openWhy.moved).toFixed(2)} logged since` : ''}`
                : 'No count on record yet — starting from the seed the office set'}
            </div>
          </button>
          {showWhy && (
            <div style={{ background: 'var(--c-wash)', borderRadius: 11, padding: '10px 11px', marginBottom: 10, fontSize: 12 }}>
              {openWhy?.sinceDate ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ opacity: 0.6 }}>{fmtShort(openWhy.sinceDate)} — counted{openWhy.countedBy ? ` by ${openWhy.countedBy}` : ''}</span>
                    <span className="c-mono" style={{ fontWeight: 700 }}>${openWhy.base.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ opacity: 0.6 }}>Logged since</span>
                    <span className="c-mono" style={{ fontWeight: 700, color: openWhy.moved < 0 ? 'var(--c-st-hot)' : 'var(--c-st-booked)' }}>
                      {openWhy.moved < 0 ? '−' : '+'}${Math.abs(openWhy.moved).toFixed(2)}
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ opacity: 0.6, marginBottom: 6 }}>Nobody has counted this box in the app yet, so tonight starts from the seed the office set.</div>
              )}
              <div style={{ opacity: 0.55, lineHeight: 1.5, marginTop: 7, paddingTop: 7, boxShadow: '0 -1px 0 var(--c-wash2)' }}>
                Not what&rsquo;s in the box? Don&rsquo;t try to change this. Count the box, type it into <b>Counted at close</b>, and the difference goes to the office.
              </div>
            </div>
          )}
          {([
            ['Cash in', `+$${totalIn.toFixed(2)}`, 'var(--c-st-booked)'],
            ['Cash out', `-$${totalOut.toFixed(2)}`, 'var(--c-st-hot)'],
            ['Should be in the box', `$${closing.toFixed(2)}`, 'var(--c-fg)'],
          ] as const).map(([l, v, c]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 12.5, opacity: 0.6 }}>{l}</span>
              <span className="c-mono" style={{ fontSize: 13, fontWeight: 700, color: c }}>{v}</span>
            </div>
          ))}
          {/* COUNTED AT CLOSE (ERS, 2026-09-15): the closer counts the box and
              types it; the line under it says whether the box agrees with
              the ledger. A mismatch is information, not a block — the office
              reads it in the daily-ops modal. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--c-wash2)' }}>
            <span style={{ fontSize: 12.5, opacity: 0.6 }}>Counted at close</span>
            <input
              type="number"
              inputMode="decimal"
              value={countedClose}
              onChange={e => setCountedClose(e.target.value)}
              placeholder="0.00"
              className="c-mono"
              style={{ ...input, width: 92, textAlign: 'right', minHeight: 36, padding: '6px 10px' }}
            />
          </div>
          {diff != null && (
            <div style={{
              marginTop: 7, fontSize: 11, fontWeight: 700, textAlign: 'right',
              color: diff === 0 ? 'var(--c-st-booked)' : 'var(--c-st-warm)',
            }}>
              {diff === 0
                ? 'Matches the ledger'
                : `${diff > 0 ? 'Over' : 'Short'} by $${Math.abs(diff).toFixed(2)} vs the ledger`}
            </div>
          )}
        </div>

        {/* Entries */}
        <div style={surface}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div className="c-label" style={{ marginBottom: 0 }}>Tonight</div>
            <button
              onClick={addEntry}
              style={{
                background: 'var(--c-wash)', border: 'none', borderRadius: 99,
                padding: '6px 14px', minHeight: 32, color: 'var(--c-fg)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', font: 'inherit',
              }}
            >+ Add</button>
          </div>

          {entries.length === 0 && <div style={{ fontSize: 12.5, opacity: 0.5, textAlign: 'center', padding: '12px 0' }}>Nothing logged tonight</div>}

          {entries.map((e, i) => (
            <div key={i} style={{
              padding: '8px 0',
              boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
                <input
                  placeholder="Description"
                  value={e.description}
                  onChange={ev => patchEntry(i, { description: ev.target.value })}
                  style={input}
                />
                <input
                  type="number"
                  placeholder="$"
                  value={e.amount}
                  onChange={ev => patchEntry(i, { amount: ev.target.value })}
                  className="c-mono"
                  style={{ ...input, width: 76 }}
                />
                <button
                  type="button"
                  onClick={() => patchEntry(i, { type: e.type === 'in' ? 'out' : 'in' })}
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
        {!hasNewEntries && (
          <button
            onClick={() => setAsk({ kind: 'save' })}
            disabled={saving}
            className="c-control"
            style={{
              width: '100%', minHeight: 46, borderRadius: 14, marginBottom: 8,
              background: 'var(--c-srf, var(--c-bg))', color: 'var(--c-fg)',
              border: 'none', font: 'inherit', fontSize: 13, fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
              boxShadow: 'var(--c-softsh)',
            }}
          >
            {saving ? 'Recording…' : 'Counted — no change'}
            <span style={{ display: 'block', fontSize: 10, fontWeight: 400, opacity: 0.55, marginTop: 1 }}>
              records tonight&rsquo;s count with the balance as it stands
            </span>
          </button>
        )}
        <button
          onClick={() => setAsk({ kind: 'save' })}
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

      {/* ── THE FOUR MOMENTS ───────────────────────────────────────────────
          Prompts sit only where money moves or something cannot be walked
          back. The mismatch prompt is folded into the save sheet rather than
          firing on its own: the runner is already looking at the count there,
          and two sheets back to back is how people learn to tap through. */}
      {ask && (
        <div
          onClick={() => setAsk(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.55)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            padding: '20px 14px calc(20px + env(safe-area-inset-bottom))',
          }}
        >
          <div
            onClick={ev => ev.stopPropagation()}
            style={{
              width: '100%', maxWidth: 420, background: 'var(--c-srf, var(--c-bg))',
              boxShadow: 'var(--c-softsh)', borderRadius: 18, padding: 16,
            }}
          >
            {ask.kind === 'cashin' && (() => {
              const amt = parseFloat(entries[ask.idx]?.amount || '0') || 0
              return (
                <>
                  <div className="c-arch" style={{ fontSize: 15, lineHeight: 1.3, marginBottom: 7 }}>
                    Is this really money going <i>into</i> the box?
                  </div>
                  <p style={{ fontSize: 12.5, color: 'var(--c-fg-2)', lineHeight: 1.55, margin: '0 0 10px' }}>
                    You&rsquo;re adding <b style={{ color: 'var(--c-st-booked)' }}>+${amt.toFixed(2)}</b> as cash in — almost exactly tonight&rsquo;s opening balance of ${opening.toFixed(2)}.
                  </p>
                  <p style={{ fontSize: 12.5, color: 'var(--c-fg-2)', lineHeight: 1.55, margin: '0 0 10px' }}>
                    The opening is carried for you. Only log cash <b>in</b> when someone physically <b>put money into the box</b>.
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                    <button
                      className="c-control"
                      onClick={() => { patchEntryForce(ask.idx, { type: 'out', amount: '' }); setAsk(null) }}
                      style={{ flex: 1, minHeight: 46, borderRadius: 12, border: 'none', font: 'inherit', fontSize: 12.5, fontWeight: 700, background: 'var(--c-wash)', color: 'var(--c-fg)', cursor: 'pointer' }}
                    >That&rsquo;s not right</button>
                    <button
                      className="c-control"
                      onClick={() => { cashInOkRef.current.add(ask.idx); setAsk(null) }}
                      style={{ flex: 1, minHeight: 46, borderRadius: 12, border: 'none', font: 'inherit', fontSize: 12.5, fontWeight: 700, background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)', cursor: 'pointer' }}
                    >Yes, money went in</button>
                  </div>
                </>
              )
            })()}

            {ask.kind === 'edit' && (() => {
              const e = entries[ask.idx]
              return (
                <>
                  <div className="c-arch" style={{ fontSize: 15, lineHeight: 1.3, marginBottom: 7 }}>This was already recorded</div>
                  <p style={{ fontSize: 12.5, color: 'var(--c-fg-2)', lineHeight: 1.55, margin: '0 0 10px' }}>
                    <b>{e?.description || 'This entry'}</b>{e?.amount ? ` — $${(parseFloat(e.amount) || 0).toFixed(2)}` : ''} is already saved, and the office can see it.
                  </p>
                  <p style={{ fontSize: 12.5, color: 'var(--c-fg-2)', lineHeight: 1.55, margin: '0 0 10px' }}>
                    If the money moved again, add a <b>new</b> entry so both are on the record. Change this one only if it was typed wrong.
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                    <button
                      className="c-control"
                      onClick={() => { setAsk(null); addEntry() }}
                      style={{ flex: 1, minHeight: 46, borderRadius: 12, border: 'none', font: 'inherit', fontSize: 12.5, fontWeight: 700, background: 'var(--c-wash)', color: 'var(--c-fg)', cursor: 'pointer' }}
                    >Add a new entry</button>
                    <button
                      className="c-control"
                      onClick={() => { if (e?.id) unlockedRef.current.add(e.id); setAsk(null) }}
                      style={{ flex: 1, minHeight: 46, borderRadius: 12, border: 'none', font: 'inherit', fontSize: 12.5, fontWeight: 700, background: 'var(--c-st-hot)', color: 'var(--c-hot-text)', cursor: 'pointer' }}
                    >It was typed wrong</button>
                  </div>
                </>
              )
            })()}

            {ask.kind === 'save' && (
              <>
                <div className="c-arch" style={{ fontSize: 15, lineHeight: 1.3, marginBottom: 10 }}>
                  Closing out {fmtShort(today)}
                </div>
                <div style={{ background: 'var(--c-wash)', borderRadius: 11, padding: '10px 11px', marginBottom: 10 }}>
                  {([
                    ['Opened at', `$${opening.toFixed(2)}`, 'var(--c-fg)'],
                    ['In', `+$${totalIn.toFixed(2)}`, 'var(--c-st-booked)'],
                    ['Out', `-$${totalOut.toFixed(2)}`, 'var(--c-st-hot)'],
                    ['Should be', `$${closing.toFixed(2)}`, 'var(--c-fg)'],
                    ['You counted', countedNum == null ? 'not counted' : `$${countedNum.toFixed(2)}`, countedNum == null ? 'var(--c-fg-3)' : 'var(--c-fg)'],
                  ] as const).map(([l, v, c]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5, opacity: 0.6 }}>{l}</span>
                      <span className="c-mono" style={{ fontSize: 13, fontWeight: 700, color: c }}>{v}</span>
                    </div>
                  ))}
                </div>
                {/* MISMATCH: information, never a block. The office would far
                    rather have a short box on the record than a runner
                    quietly "fixing" it to match. */}
                {diff != null && diff !== 0 && (
                  <>
                    <p style={{ fontSize: 12.5, color: 'var(--c-st-warm)', fontWeight: 700, lineHeight: 1.5, margin: '0 0 8px' }}>
                      The box is ${Math.abs(diff).toFixed(2)} {diff > 0 ? 'over' : 'short'}.
                    </p>
                    <p style={{ fontSize: 12.5, color: 'var(--c-fg-2)', lineHeight: 1.55, margin: '0 0 8px' }}>
                      That&rsquo;s fine to record — the office would rather know. Check the coins, then tell them anything you noticed.
                    </p>
                    <input
                      value={countNote}
                      onChange={ev => { dirtyRef.current = true; setCountNote(ev.target.value) }}
                      placeholder="Note for the office (optional)"
                      style={{ ...input, width: '100%', marginBottom: 10 }}
                    />
                  </>
                )}
                <p style={{ fontSize: 12.5, color: 'var(--c-fg-2)', lineHeight: 1.55, margin: '0 0 4px' }}>
                  {countedNum == null
                    ? <>Nobody counted the box tonight, so tomorrow opens at <b>${closing.toFixed(2)}</b> — the ledger&rsquo;s figure, not a count.</>
                    : <>Tomorrow opens at <b>${countedNum.toFixed(2)}</b>, unless something is logged before then.</>}
                  {profile?.display_name ? <> Your name goes on this.</> : null}
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                  <button
                    className="c-control"
                    onClick={() => setAsk(null)}
                    style={{ flex: 1, minHeight: 46, borderRadius: 12, border: 'none', font: 'inherit', fontSize: 12.5, fontWeight: 700, background: 'var(--c-wash)', color: 'var(--c-fg)', cursor: 'pointer' }}
                  >Back</button>
                  <button
                    className="c-control"
                    disabled={saving}
                    onClick={() => { setAsk(null); save() }}
                    style={{ flex: 1, minHeight: 46, borderRadius: 12, border: 'none', font: 'inherit', fontSize: 12.5, fontWeight: 700, background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
                  >{saving ? 'Saving…' : 'Close out the night'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
