'use client'
// ─────────────────────────────────────────────────────────────────────────────
// YOUR LIST — the full modal (Eli, 2026-09-24; mock docs/design-refs/
// your-list-modal-options.html, round 2).
//
// "Lori's tasks on the dashboard are truncated and she has nowhere to see all
// of them. Click the tasks module and a large modal pops up with the full
// list, untruncated. And she — anyone with a task list — can add tasks for
// herself: a single task, or a recurring one, daily / weekly / monthly, set
// the day. But she can't remove any I created. One list, no tabs: a recurring
// item shows only on its day. A place to view all recurring though."
//
// ONE LIST, grouped Due today · Not due today · Done — the same rows the
// dashboard box shows (the page hands them in), so the two can never
// disagree. A weekly / monthly item is simply absent on other days; the foot
// link unfolds the whole schedule IN this modal (not a tab).
//
// + ADD is one composer: text → One-time (today / tomorrow / a date → a
// dashboard_tasks row assigned to self) or Repeats (Daily / Weekly + day pills
// / Monthly + day-of-month → a myday_duties row, lib/myday.createPersonalDuty).
// The same composer edits one of your own recurring items.
//
// THE LOCK: an item set by an owner (or seeded) wears 🔒 and has no × / ✎.
// dutyEditable() is the UI's copy of the RLS rule; for tasks, a task someone
// else assigned you is theirs. Removing a recurring item retires it
// (is_active=false) — its past ticks stay.
//
// Rendered inside .n-home so the noir tokens apply; fixed overlay above the
// nav ladder's modals (10004, same as the billing modals).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import type { DashboardTask, UserProfile } from '@/lib/supabase'
import {
  type DutyView, type MyDayDuty, type MyDayRole, type DutyCadence,
  dutyEditable, cadenceLabel, createPersonalDuty, updatePersonalDuty, retirePersonalDuty,
} from '@/lib/myday'
import { addFlag, doneFlag, removeFlag } from '@/lib/flags'
import { getLocalToday } from '@/lib/time'
import { formatCurrency } from '@/lib/format'
import type { InvoiceRow } from '@/lib/billing'

export type YourListModalProps = {
  who: string
  roleLabel: string
  /** The seat's duty role — null on the owner's own "Mine" tab (no duties). */
  seatRole: MyDayRole | null
  viewer: UserProfile | null
  /** The viewer is looking at their OWN seat (or is an owner): may add + tick. */
  isOwnSeat: boolean
  approvals: InvoiceRow[]
  views: DutyView[]
  tasks: DashboardTask[]
  /** Every active duty on this seat (for the schedule section). */
  seatDuties: MyDayDuty[]
  savingDutyId: string | null
  onToggleDuty: (v: DutyView) => void
  onGoto: (href: string) => void
  onChanged: () => void
  onClose: () => void
}

type Mode = 'once' | 'repeat'
type Due = 'today' | 'tomorrow' | 'date'

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DOW_LONG = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function shiftIso(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function fmtDay(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function ord(n: number): string {
  const suf = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'
  return `${n}${suf}`
}
/** Next date on/after `from` that a cadence lands on — for the read-back line. */
function nextDue(cadence: DutyCadence, days: number[], from: string): string | null {
  if (cadence === 'daily') return from
  for (let i = 0; i < 62; i++) {
    const iso = shiftIso(from, i)
    const d = new Date(iso + 'T12:00:00')
    if (cadence === 'weekly' && days.includes(d.getDay())) return iso
    if (cadence === 'monthly' && days.includes(d.getDate())) return iso
  }
  return null
}

export function YourListModal(p: YourListModalProps) {
  const today = getLocalToday()
  const viewerLite = p.viewer ? { id: p.viewer.id, role: p.viewer.role } : null
  const isOwner = p.viewer?.role === 'owner'

  // ── Composer state ─────────────────────────────────────────────────────────
  const [composing, setComposing] = useState(false)
  const [editing, setEditing] = useState<MyDayDuty | null>(null)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Mode>('once')
  const [due, setDue] = useState<Due>('today')
  const [dueDate, setDueDate] = useState(today)
  const [cadence, setCadence] = useState<DutyCadence>('weekly')
  const [dow, setDow] = useState<number[]>([])
  const [dom, setDom] = useState<number>(1)
  const [busy, setBusy] = useState(false)
  const [showRecurring, setShowRecurring] = useState(false)
  const [confirmRetire, setConfirmRetire] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  function openComposer(d?: MyDayDuty) {
    if (d) {
      setEditing(d); setText(d.label); setMode('repeat'); setCadence(d.cadence)
      setDow(d.cadence === 'weekly' ? (d.due_days ?? []) : [])
      setDom(d.cadence === 'monthly' ? (d.due_days?.[0] ?? 1) : 1)
    } else {
      setEditing(null); setText(''); setMode('once'); setDue('today'); setDueDate(today)
      setCadence('weekly'); setDow([]); setDom(1)
    }
    setComposing(true)
  }
  function closeComposer() { setComposing(false); setEditing(null) }

  const dueIso = due === 'today' ? today : due === 'tomorrow' ? shiftIso(today, 1) : dueDate
  const repeatDays = cadence === 'weekly' ? dow : cadence === 'monthly' ? [dom] : []
  const repeatValid = cadence === 'daily' || repeatDays.length > 0
  const canSubmit = text.trim().length > 0 && (mode === 'once' ? !!dueIso : repeatValid) && !busy
  const readback = (() => {
    if (!text.trim()) return 'Type it, then say when.'
    if (mode === 'once') return <>One-time · due <b>{dueIso === today ? 'today' : dueIso === shiftIso(today, 1) ? 'tomorrow' : fmtDay(dueIso)}</b></>
    if (cadence === 'daily') return <>Repeats <b>every day</b> · first due <b>today</b></>
    if (cadence === 'weekly') {
      if (dow.length === 0) return 'Pick at least one day.'
      const names = dow.slice().sort((a, b) => a - b).map(d => DOW_LONG[d])
      const nd = nextDue('weekly', dow, today)
      return <>Repeats <b>weekly on {names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}</b>{nd && <> · first due <b>{nd === today ? 'today' : fmtDay(nd)}</b></>}</>
    }
    const nd = nextDue('monthly', [dom], today)
    return <>Repeats <b>monthly on the {ord(dom)}</b>{nd && <> · first due <b>{nd === today ? 'today' : fmtDay(nd)}</b></>} · stays red past the day until done</>
  })()

  async function submit() {
    if (!canSubmit || !p.viewer) return
    setBusy(true)
    let ok = false
    if (editing) {
      ok = await updatePersonalDuty(editing.id, { label: text, cadence, due_days: repeatDays })
    } else if (mode === 'once') {
      const f = await addFlag({ text, kind: 'office', studio: null, assignedTo: p.viewer.id, dueDate: dueIso, photoPath: null, by: p.viewer })
      ok = !!f
    } else if (p.seatRole) {
      ok = await createPersonalDuty({ label: text, cadence, due_days: repeatDays, role: p.seatRole }, { id: p.viewer.id, role: p.viewer.role })
    }
    setBusy(false)
    if (!ok) return
    closeComposer()
    p.onChanged()
  }

  async function retire(d: MyDayDuty) {
    setBusy(true)
    const ok = await retirePersonalDuty(d.id)
    setBusy(false)
    setConfirmRetire(null)
    if (ok) p.onChanged()
  }
  async function finishTask(t: DashboardTask) {
    if (busy) return
    setBusy(true)
    const ok = await doneFlag(t.id, { note: null, vendor: null, cost: null })
    setBusy(false)
    if (ok) p.onChanged()
  }
  async function dropTask(t: DashboardTask) {
    if (busy) return
    if (!window.confirm(`Remove "${t.text}"?`)) return
    setBusy(true)
    const ok = await removeFlag(t.id)
    setBusy(false)
    if (ok) p.onChanged()
  }

  // ── Grouping ───────────────────────────────────────────────────────────────
  const shown = p.views.filter(v => v.isShown)
  const dueViews = shown.filter(v => v.isDue && !v.done)
  const notDueViews = shown.filter(v => !v.isDue && !v.done)
  const doneViews = shown.filter(v => v.done)
  const dueTasks = p.tasks.filter(t => !t.due_date || t.due_date <= today)
  const laterTasks = p.tasks.filter(t => t.due_date && t.due_date > today)
  const dueCount = p.approvals.length + dueViews.length + dueTasks.length
  const total = dueCount + notDueViews.length + laterTasks.length + doneViews.length
  const recurring = useMemo(() => {
    const by: Record<DutyCadence, MyDayDuty[]> = { daily: [], weekly: [], monthly: [] }
    for (const d of p.seatDuties) by[d.cadence]?.push(d)
    return by
  }, [p.seatDuties])

  // ── Styles (noir tokens from .n-home) ──────────────────────────────────────
  const S = {
    wrap: { position: 'fixed', inset: 0, zIndex: 10004, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 } as React.CSSProperties,
    modal: { width: '100%', maxWidth: 860, maxHeight: '86vh', background: 'var(--n-card)', color: 'var(--n-ink)', borderRadius: 20, boxShadow: '0 20px 60px rgba(0,0,0,.6), 0 0 0 1px var(--n-wash2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' } as React.CSSProperties,
    head: { display: 'flex', alignItems: 'flex-end', gap: 16, padding: '18px 22px 10px', flexWrap: 'wrap' } as React.CSSProperties,
    who: { fontFamily: "'Bebas Neue', 'Archivo Black', sans-serif", fontSize: 32, letterSpacing: '0.02em', lineHeight: 1 } as React.CSSProperties,
    day: { fontSize: 11, color: 'var(--n-ink3)', marginTop: 4 } as React.CSSProperties,
    bar: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 22px 10px', flexWrap: 'wrap' } as React.CSSProperties,
    lab: { fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--n-ink3)' } as React.CSSProperties,
    body: { overflowY: 'auto', minHeight: 0, padding: '2px 22px 22px' } as React.CSSProperties,
    grp: { display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 6px', fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--n-ink3)' } as React.CSSProperties,
    ln: { flex: 1, height: 1, background: 'var(--n-wash2)' } as React.CSSProperties,
    it: (dim?: boolean, done?: boolean) => ({ display: 'grid', gridTemplateColumns: '20px 58px minmax(0,1fr) auto 26px', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: 'var(--n-wash)', marginBottom: 5, opacity: done ? .4 : dim ? .7 : 1 }) as React.CSSProperties,
    bx: (done?: boolean) => ({ width: 18, height: 18, borderRadius: 6, background: 'var(--n-wash2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: 'var(--n-ok)', cursor: 'pointer' }) as React.CSSProperties,
    tag: (ap?: boolean) => ({ fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: ap ? 'var(--n-uncon)' : 'var(--n-ink3)' }) as React.CSSProperties,
    tx: (red?: boolean, done?: boolean) => ({ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: red ? 'var(--n-hot)' : 'var(--n-ink)', textDecoration: done ? 'line-through' : undefined }) as React.CSSProperties,
    meta: { display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' } as React.CSSProperties,
    cad: (mine?: boolean) => ({ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: mine ? 'var(--n-ink2)' : 'var(--n-ink3)', background: 'var(--n-stage)', borderRadius: 99, padding: '3px 8px' }) as React.CSSProperties,
    mn: (hot?: boolean) => ({ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 10, color: hot ? 'var(--n-hot)' : 'var(--n-ink3)', fontWeight: hot ? 600 : 400 }) as React.CSSProperties,
    xbtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n-ink3)', fontSize: 13, textAlign: 'center', padding: 0 } as React.CSSProperties,
    pill: (on: boolean) => ({ borderRadius: 99, padding: '6px 12px', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', background: on ? 'var(--n-ink)' : 'var(--n-card)', color: on ? 'var(--n-stage)' : 'var(--n-ink2)', cursor: 'pointer', border: 'none', font: 'inherit' }) as React.CSSProperties,
    dowb: (on: boolean) => ({ width: 30, height: 30, borderRadius: 99, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, background: on ? 'var(--n-warm)' : 'var(--n-card)', color: on ? '#1c2626' : 'var(--n-ink2)', cursor: 'pointer', border: 'none', font: 'inherit' }) as React.CSSProperties,
    primary: { borderRadius: 99, padding: '7px 16px', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'var(--n-ink)', color: 'var(--n-stage)', border: 'none', cursor: 'pointer', font: 'inherit' } as React.CSSProperties,
    quiet: { fontSize: 12, color: 'var(--n-ink3)', padding: '10px 2px' } as React.CSSProperties,
  }

  const dutyRow = (v: DutyView, dim?: boolean) => {
    const d = v.duty
    const mine = !!d.owner_profile_id
    const editable = dutyEditable(d, viewerLite)
    const mn = v.overdueDays > 0 ? `${v.overdueDays}D LATE` : v.backlogDays > 0 ? `${v.backlogDays + 1} DAYS` : !v.isDue && !v.done ? 'NOT DUE' : undefined
    const red = !v.done && (v.overdueDays > 0 || v.backlogDays > 0)
    return (
      <div key={d.id} style={{ ...S.it(dim, v.done), opacity: p.savingDutyId === d.id ? .5 : S.it(dim, v.done).opacity }}>
        <span style={S.bx(v.done)} onClick={() => p.isOwnSeat && p.onToggleDuty(v)} title={v.done ? 'Undo' : 'Done'}>{v.done ? '✓' : ''}</span>
        <span style={S.tag()}>duty</span>
        <span style={S.tx(red, v.done)}>{d.label}</span>
        <span style={S.meta}>
          <span style={S.cad(mine)}>{cadenceLabel(d)}</span>
          {mn && <span style={S.mn(red)}>{mn}</span>}
        </span>
        {d.locked && !isOwner
          ? <span title="Set by Eli — permanent" style={{ fontSize: 11, textAlign: 'center', color: 'var(--n-ink3)' }}>🔒</span>
          : editable
            ? <button type="button" style={S.xbtn} title="Edit this item" onClick={() => openComposer(d)}>✎</button>
            : <span />}
      </div>
    )
  }
  const taskRow = (t: DashboardTask, dim?: boolean) => {
    const own = !!p.viewer && (t.assigned_by === p.viewer.id || isOwner)
    return (
      <div key={t.id} style={S.it(dim)}>
        <span style={S.bx()} onClick={() => p.isOwnSeat && finishTask(t)} title="Done" />
        <span style={S.tag()}>task</span>
        <span style={S.tx()}>
          {t.text}
          {t.due_date && t.due_date !== today && <span style={{ fontSize: 10.5, color: 'var(--n-ink3)', marginLeft: 6 }}>{t.due_date < today ? 'was due ' : 'due '}{fmtDay(t.due_date)}</span>}
        </span>
        <span style={S.meta}><span style={S.cad(own)}>One-time</span></span>
        {own
          ? <button type="button" style={S.xbtn} title="Remove — yours" onClick={() => dropTask(t)}>×</button>
          : <span title="Assigned to you — ask whoever set it" style={{ fontSize: 11, textAlign: 'center', color: 'var(--n-ink3)' }}>🔒</span>}
      </div>
    )
  }

  return (
    <div style={S.wrap} onClick={p.onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <div style={S.who}>YOUR LIST · {p.who.toUpperCase()}</div>
            <div style={S.day}>{fmtDay(today)}{p.roleLabel ? ` · ${p.roleLabel}` : ''}</div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{doneViews.length} / {total}</div>
            <div style={S.lab}>done today</div>
          </div>
          <button type="button" onClick={p.onClose} aria-label="Close" style={{ ...S.xbtn, fontSize: 20, marginBottom: 4 }}>×</button>
        </div>
        <div style={S.bar}>
          <span style={S.lab}>Everything on you today</span>
          {p.isOwnSeat && (
            <button type="button" style={{ ...S.primary, marginLeft: 'auto', opacity: composing ? .4 : 1 }} onClick={() => !composing && openComposer()}>+ Add</button>
          )}
        </div>

        <div style={S.body}>
          {/* ── Composer ─────────────────────────────────────────────────── */}
          {composing && (
            <div style={{ background: 'var(--n-stage)', borderRadius: 16, padding: '14px 16px', margin: '4px 0 14px', boxShadow: 'inset 3px 3px 9px rgba(0,0,0,.34), inset -3px -3px 9px rgba(255,255,255,.03)' }}>
              <div style={{ ...S.lab, marginBottom: 6 }}>{editing ? 'Edit your item' : 'New item on your list'}</div>
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                autoFocus
                placeholder="What needs doing"
                onKeyDown={e => { if (e.key === 'Enter') submit() }}
                style={{ display: 'block', width: '100%', boxSizing: 'border-box', background: 'var(--n-card)', border: 'none', outline: 'none', borderRadius: 12, padding: '9px 12px', font: 'inherit', fontSize: 13, color: 'var(--n-ink)', marginBottom: 12 }}
              />
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {!editing && (
                  <div>
                    <div style={{ ...S.lab, marginBottom: 6 }}>When</div>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button type="button" style={S.pill(mode === 'once')} onClick={() => setMode('once')}>One-time</button>
                      <button type="button" style={S.pill(mode === 'repeat')} onClick={() => setMode('repeat')} disabled={!p.seatRole} title={!p.seatRole ? 'Recurring items live on a staff seat' : undefined}>Repeats</button>
                    </div>
                  </div>
                )}
                {mode === 'once' && !editing && (
                  <div>
                    <div style={{ ...S.lab, marginBottom: 6 }}>Due</div>
                    <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <button type="button" style={S.pill(due === 'today')} onClick={() => setDue('today')}>Today</button>
                      <button type="button" style={S.pill(due === 'tomorrow')} onClick={() => setDue('tomorrow')}>Tomorrow</button>
                      <button type="button" style={S.pill(due === 'date')} onClick={() => setDue('date')}>Pick a date</button>
                      {due === 'date' && <input type="date" value={dueDate} min={today} onChange={e => setDueDate(e.target.value)} style={{ background: 'var(--n-card)', color: 'var(--n-ink)', border: 'none', borderRadius: 10, padding: '5px 8px', font: 'inherit', fontSize: 12 }} />}
                    </div>
                  </div>
                )}
                {mode === 'repeat' && (
                  <>
                    <div>
                      <div style={{ ...S.lab, marginBottom: 6 }}>How often</div>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        {(['daily', 'weekly', 'monthly'] as DutyCadence[]).map(c => (
                          <button key={c} type="button" style={S.pill(cadence === c)} onClick={() => setCadence(c)}>{c}</button>
                        ))}
                      </div>
                    </div>
                    {cadence === 'weekly' && (
                      <div>
                        <div style={{ ...S.lab, marginBottom: 6 }}>Which days</div>
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          {DOW.map((l, i) => (
                            <button key={i} type="button" style={S.dowb(dow.includes(i))} onClick={() => setDow(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])} title={DOW_LONG[i]}>{l}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {cadence === 'monthly' && (
                      <div>
                        <div style={{ ...S.lab, marginBottom: 6 }}>On the</div>
                        <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          <input type="number" min={1} max={31} value={dom} onChange={e => setDom(Math.min(31, Math.max(1, parseInt(e.target.value) || 1)))} style={{ width: 56, height: 30, borderRadius: 10, background: 'var(--n-card)', color: 'var(--n-ink)', border: 'none', textAlign: 'center', fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 13 }} />
                          <span style={{ fontSize: 10.5, color: 'var(--n-ink3)' }}>of the month</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--n-ink2)' }}>{readback}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                  {editing && !editing.locked && (
                    confirmRetire === editing.id
                      ? <span style={{ fontSize: 11, color: 'var(--n-ink2)' }}>Remove it? Past ticks are kept. <button type="button" style={{ ...S.xbtn, color: 'var(--n-hot)', fontSize: 11, fontWeight: 800, marginLeft: 6 }} onClick={() => retire(editing)}>Remove</button> <button type="button" style={{ ...S.xbtn, fontSize: 11, marginLeft: 6 }} onClick={() => setConfirmRetire(null)}>Keep</button></span>
                      : <button type="button" style={{ ...S.xbtn, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }} onClick={() => setConfirmRetire(editing.id)}>Remove</button>
                  )}
                  <button type="button" style={{ ...S.xbtn, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }} onClick={closeComposer}>Cancel</button>
                  <button type="button" style={{ ...S.primary, opacity: canSubmit ? 1 : .4 }} disabled={!canSubmit} onClick={submit}>{busy ? 'Saving…' : editing ? 'Save' : 'Add to my list'}</button>
                </span>
              </div>
            </div>
          )}

          {/* ── Due today ────────────────────────────────────────────────── */}
          <div style={{ ...S.grp, marginTop: composing ? 4 : 10 }}><b style={{ color: dueCount > 0 ? 'var(--n-warm)' : 'var(--n-ink2)' }}>Due today · {dueCount}</b><span style={S.ln} /></div>
          {p.approvals.map(r => (
            <div key={`ap-${r.workOrderId}`} style={S.it()} onClick={() => p.onGoto('/billing')}>
              <span style={S.bx()} />
              <span style={S.tag(true)}>approve</span>
              <span style={S.tx()}>Approve — {r.client}<span style={{ fontSize: 10.5, color: 'var(--n-ink3)', marginLeft: 6 }}>{formatCurrency(String(r.total))}</span></span>
              <span style={S.meta}><span style={S.mn()}>→ billing</span></span>
              <span />
            </div>
          ))}
          {dueViews.map(v => dutyRow(v))}
          {dueTasks.map(t => taskRow(t))}
          {dueCount === 0 && <div style={S.quiet}>Nothing due — quiet day.</div>}

          {/* ── Not due today ────────────────────────────────────────────── */}
          {(notDueViews.length > 0 || laterTasks.length > 0) && (
            <>
              <div style={S.grp}><b style={{ color: 'var(--n-ink2)' }}>Not due today · {notDueViews.length + laterTasks.length}</b><span style={S.ln} /></div>
              {notDueViews.map(v => dutyRow(v, true))}
              {laterTasks.map(t => taskRow(t, true))}
            </>
          )}

          {/* ── Done ─────────────────────────────────────────────────────── */}
          {doneViews.length > 0 && (
            <>
              <div style={S.grp}><b style={{ color: 'var(--n-ink2)' }}>Done · {doneViews.length}</b><span style={S.ln} /></div>
              {doneViews.map(v => dutyRow(v))}
            </>
          )}

          {/* ── Foot: the one link out ───────────────────────────────────── */}
          {p.seatRole && (
            <div style={{ marginTop: 16, paddingTop: 10, borderTop: '1px solid var(--n-wash2)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: 'var(--n-ink3)' }}>
              <span>Recurring items show here only on their day.</span>
              <button type="button" onClick={() => setShowRecurring(v => !v)} style={{ ...S.xbtn, marginLeft: 'auto', color: 'var(--n-ink2)', fontSize: 10.5, fontWeight: 700, textDecoration: 'underline' }}>
                {p.seatDuties.length} recurring · {showRecurring ? 'hide ▴' : 'view ▾'}
              </button>
            </div>
          )}
          {showRecurring && p.seatRole && (['daily', 'weekly', 'monthly'] as DutyCadence[]).map(c => recurring[c].length === 0 ? null : (
            <div key={c}>
              <div style={S.grp}><b style={{ color: 'var(--n-ink2)', textTransform: 'capitalize' }}>{c} · {recurring[c].length}</b><span style={S.ln} /></div>
              {recurring[c].map(d => {
                const mine = !!d.owner_profile_id
                const editable = dutyEditable(d, viewerLite)
                return (
                  <div key={d.id} style={S.it()}>
                    {editable ? <button type="button" style={S.xbtn} title="Edit" onClick={() => openComposer(d)}>✎</button> : <span />}
                    <span style={S.tag()}>duty</span>
                    <span style={S.tx()}>{d.label}</span>
                    <span style={S.meta}>
                      {c !== 'daily' && <span style={S.cad(mine)}>{cadenceLabel(d).replace(/^(Weekly|Monthly) · /, '')}</span>}
                      <span style={S.cad(mine)}>{mine ? 'Mine' : 'Set by Eli'}</span>
                    </span>
                    {d.locked && !isOwner
                      ? <span title="Permanent" style={{ fontSize: 11, textAlign: 'center', color: 'var(--n-ink3)' }}>🔒</span>
                      : editable
                        ? (confirmRetire === d.id
                          ? <button type="button" style={{ ...S.xbtn, color: 'var(--n-hot)', fontSize: 10, fontWeight: 800 }} onClick={() => retire(d)} title="Confirm remove">sure?</button>
                          : <button type="button" style={S.xbtn} title="Remove — yours" onClick={() => setConfirmRetire(d.id)}>×</button>)
                        : <span />}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
