'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /daily-ops — the studio manager's morning (spec §19, built 2026-08-14).
// Mock: docs/design-refs/daily-ops-final.html.
//
// LEFT   the queue (exceptions; tap to clear; empty = "Yesterday is done"),
//        PAGINATED at 10 (Eli, 2026-08-17) so the studio-tasks manager below
//        never scrolls out of view on a bad morning.
// RIGHT  the sweep — 2×2 studio cards, one night's full picture, each with
//        the shift log (preview → popup). The DATE IS THE SWEEP'S HERO and
//        pages by ‹ › or swipe (Eli, 2026-08-17) — browsing previous nights
//        here is what replaced the retired daily-ops log.
//
// NOT here: work orders (Billing's review bucket), punches (HR), tonight's
// live status (dashboard). One copy of everything — §19.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { dbResult } from '@/lib/db'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Hint } from '@/components/ui/Hint'
import {
  OPS_STUDIOS, QueueItem, StudioNight, loadNight, markReviewed,
  opsDate, prettyDate, unmarkReviewed,
} from '@/lib/dailyOps'

type StudioTask = {
  id: string
  studio: string
  task: string
  created_by_name: string | null
  created_at: string
  done_at: string | null
}

const DUTY_COLOR: Record<string, string> = {
  done: 'var(--c-st-booked)',
  flagged: 'var(--c-st-warm)',
  missing: 'var(--c-st-hot)',
}

/** Queue page size — keeps the studio-tasks card in view under a long queue. */
const QUEUE_PAGE = 10

export default function DailyOpsPage() {
  const router = useRouter()
  const { profile } = useUserProfile()
  const [offset, setOffset] = useState(1)         // 1 = last night
  const date = opsDate(offset)

  const [queue, setQueue] = useState<QueueItem[]>([])
  const [studios, setStudios] = useState<StudioNight[]>([])
  const [tasks, setTasks] = useState<StudioTask[]>([])
  const [loading, setLoading] = useState(true)
  const [logOpen, setLogOpen] = useState<StudioNight | null>(null)
  const [newTask, setNewTask] = useState('')
  const [newTaskStudio, setNewTaskStudio] = useState<string>('paramount')
  const [qPage, setQPage] = useState(0)
  // Swipe start point for the sweep's day paging (touch only; buttons on desktop).
  const [touchX, setTouchX] = useState<number | null>(null)

  // A new night starts back at the queue's first page.
  useEffect(() => { setQPage(0) }, [date])

  const load = useCallback(async () => {
    const [night, { data: taskData }] = await Promise.all([
      loadNight(date),
      supabase.from('studio_tasks').select('*').is('deleted_at', null).order('created_at'),
    ])
    setQueue(night.queue)
    setStudios(night.studios)
    const visible = ((taskData ?? []) as StudioTask[]).filter(
      t => !t.done_at || t.done_at.slice(0, 10) >= date,
    )
    visible.sort((a, b) => Number(!!a.done_at) - Number(!!b.done_at))
    setTasks(visible)
    setLoading(false)
  }, [date])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('daily-ops-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_ops_reviews' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flags' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_note_docs' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_tasks' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_ops_submissions' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const me = profile?.display_name || profile?.initials || 'Manager'

  async function clearItem(item: QueueItem) {
    // A flag is cleared by ACKNOWLEDGING the flag — the flag system stays the
    // record of it (§19). Everything else writes a review marker.
    if (item.flagId) {
      const { error } = await supabase.from('flags').update({
        status: 'acknowledged',
        acknowledged_by: me,
        acknowledged_at: new Date().toISOString(),
      }).eq('id', item.flagId)
      if (!dbResult('Acknowledging flag', error)) return
      load()
      return
    }
    setQueue(prev => prev.map(q => q.key === item.key ? { ...q, reviewed: !q.reviewed } : q))
    const { error } = item.reviewed
      ? await unmarkReviewed(date, item.key)
      : await markReviewed(date, item.key, me)
    if (!dbResult('Saving review', error)) load()
  }

  async function toggleTask(t: StudioTask) {
    const nextDone = t.done_at ? null : new Date().toISOString()
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, done_at: nextDone } : x))
    const { error } = await supabase.from('studio_tasks').update({ done_at: nextDone }).eq('id', t.id)
    if (!dbResult('Saving task', error)) load()
  }

  async function addTask() {
    if (!newTask.trim()) return
    const { error } = await supabase.from('studio_tasks').insert({
      studio: newTaskStudio,
      task: newTask.trim(),
      created_by_name: me,
    })
    if (!dbResult('Adding task', error)) return
    setNewTask('')
    load()
  }

  const open = queue.filter(q => !q.reviewed)
  // Queue pagination — derived, and self-clamping when items clear off the end.
  const qPages = Math.max(1, Math.ceil(queue.length / QUEUE_PAGE))
  const qPageSafe = Math.min(qPage, qPages - 1)
  const queuePage = queue.slice(qPageSafe * QUEUE_PAGE, (qPageSafe + 1) * QUEUE_PAGE)

  // Sweep day paging — buttons and swipe share these.
  const goEarlier = () => setOffset(o => o + 1)
  const goLater = () => setOffset(o => Math.max(1, o - 1))
  const card: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)',
    borderRadius: 18, padding: '14px 16px',
  }
  const wash: React.CSSProperties = {
    background: 'var(--c-wash)', border: 'none', borderRadius: 10,
    padding: '9px 12px', color: 'var(--c-fg)', font: 'inherit', fontSize: 12.5, outline: 'none',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 5fr) 7fr', gap: 16, alignItems: 'start' }}>

        {/* ══ LEFT — queue, then tasks ══ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
              <SectionHeader title="Needs you" count={open.length || undefined} countColor="orange" />
              <Hint tip="Yesterday's exceptions, worst first: flags, then anything that never came in, then missing mics, then notes. Tap an item's circle once you've dealt with it — clearing is shared with every manager." />
            </div>
            {loading ? (
              <div style={{ opacity: 0.5, fontSize: 13 }}>Loading…</div>
            ) : queue.length === 0 || open.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '18px 10px' }}>
                <div className="c-arch" style={{ fontSize: 17, color: 'var(--c-st-booked)', marginBottom: 3 }}>
                  Yesterday is done.
                </div>
                <div style={{ fontSize: 12.5, opacity: 0.55 }}>
                  {queue.length === 0 ? 'Nothing went wrong.' : 'Every exception handled — the sweep is your receipt.'}
                </div>
              </div>
            ) : queuePage.map((q, i) => (
              <div
                key={q.key}
                onClick={() => clearItem(q)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 11, padding: '10px 2px',
                  cursor: 'pointer', opacity: q.reviewed ? 0.35 : 1,
                  boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
                }}
              >
                <span style={{
                  width: 9, height: 9, borderRadius: 99, marginTop: 5, flexShrink: 0,
                  background: q.severity === 'hot' ? 'var(--c-st-hot)' : 'var(--c-st-warm)',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, textDecoration: q.reviewed ? 'line-through' : undefined }}>
                    {q.title}
                  </div>
                  <div style={{ fontSize: 11.5, opacity: 0.55, marginTop: 1 }}>{q.sub}</div>
                </div>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', opacity: 0.45, marginTop: 4, flexShrink: 0 }}>
                  {q.abbr}
                </span>
                <span style={{
                  width: 26, height: 26, borderRadius: 99, flexShrink: 0,
                  background: q.reviewed ? 'var(--c-st-booked)' : 'var(--c-wash2)',
                  color: q.reviewed ? 'var(--c-chip-ink)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
                }}>✓</span>
              </div>
            ))}
            {/* Pager — only when the queue overflows a page, so quiet mornings
                look exactly as before. */}
            {qPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                <button onClick={() => setQPage(p => Math.max(0, p - 1))} disabled={qPageSafe === 0}
                  style={{ ...wash, cursor: qPageSafe === 0 ? 'default' : 'pointer', fontWeight: 700, opacity: qPageSafe === 0 ? 0.35 : 1, padding: '6px 12px' }}>‹</button>
                <span style={{ fontSize: 11, opacity: 0.5 }}>Page {qPageSafe + 1} of {qPages}</span>
                <button onClick={() => setQPage(p => Math.min(qPages - 1, p + 1))} disabled={qPageSafe === qPages - 1}
                  style={{ ...wash, cursor: qPageSafe === qPages - 1 ? 'default' : 'pointer', fontWeight: 700, opacity: qPageSafe === qPages - 1 ? 0.35 : 1, padding: '6px 12px' }}>›</button>
              </div>
            )}
          </div>

          <div style={card}>
            <SectionHeader title="Studio tasks · what the opener sees" />
            {tasks.length === 0 && <div style={{ fontSize: 12.5, opacity: 0.5, marginBottom: 8 }}>No tasks out.</div>}
            {tasks.map((t, i) => (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', fontSize: 12.5,
                boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
              }}>
                <button
                  onClick={() => toggleTask(t)}
                  aria-label={t.done_at ? 'Mark not done' : 'Mark done'}
                  style={{
                    width: 20, height: 20, borderRadius: 99, flexShrink: 0, border: 'none', font: 'inherit',
                    background: t.done_at ? 'var(--c-st-booked)' : 'var(--c-wash2)',
                    color: t.done_at ? 'var(--c-chip-ink)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: 'pointer',
                  }}
                >✓</button>
                <span style={{
                  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  opacity: t.done_at ? 0.4 : 1, textDecoration: t.done_at ? 'line-through' : undefined,
                }}>{t.task}</span>
                <span style={{ fontSize: 10.5, opacity: 0.45, flexShrink: 0 }}>
                  {OPS_STUDIOS.find(s => s.key === t.studio)?.abbr ?? t.studio}
                  {t.done_at
                    ? ` · done ${new Date(t.done_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                    : t.created_by_name ? ` · ${t.created_by_name}` : ''}
                </span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <select value={newTaskStudio} onChange={e => setNewTaskStudio(e.target.value)} style={{ ...wash, fontWeight: 700, cursor: 'pointer' }}>
                {OPS_STUDIOS.map(s => <option key={s.key} value={s.key}>{s.abbr}</option>)}
              </select>
              <input
                value={newTask}
                onChange={e => setNewTask(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTask() }}
                placeholder="Leave a task for whoever opens…"
                style={{ ...wash, flex: 1 }}
              />
              <button onClick={addTask} style={{ ...wash, background: 'var(--c-wash2)', fontWeight: 700, cursor: 'pointer', padding: '9px 16px' }}>Add</button>
            </div>
          </div>
        </div>

        {/* ══ RIGHT — the sweep. The date is the hero; ‹ ›  or a swipe pages
            through previous nights (this browsing IS the old daily-ops log). ══ */}
        <div
          onTouchStart={e => setTouchX(e.touches[0].clientX)}
          onTouchEnd={e => {
            if (touchX === null) return
            const dx = e.changedTouches[0].clientX - touchX
            setTouchX(null)
            // Swipe right → earlier night, swipe left → later (clamped at last night).
            if (dx > 50) goEarlier()
            else if (dx < -50) goLater()
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
            <div>
              <div className="c-label" style={{ marginBottom: 3 }}>The sweep · every studio<Hint tip="One card per studio: the five duties, who worked, and the day's shift log. Use ‹ › (or swipe) to browse previous days — this is also the ops history." /></div>
              <span className="c-arch" style={{ fontSize: 24, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
                {/* "Yesterday", not "Last night" — the studios run 24/7
                    (terminology ruling, Eli 2026-08-17: day, never night). */}
                {offset === 1 ? 'Yesterday' : prettyDate(date)}
              </span>
              <span style={{ fontSize: 12, opacity: 0.5, marginLeft: 10 }}>{prettyDate(date)}</span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button onClick={goEarlier} aria-label="Earlier night"
                style={{ ...wash, cursor: 'pointer', fontWeight: 700, padding: '7px 14px' }}>‹</button>
              <button onClick={goLater} disabled={offset === 1} aria-label="Later night"
                style={{ ...wash, cursor: offset === 1 ? 'default' : 'pointer', fontWeight: 700, opacity: offset === 1 ? 0.4 : 1, padding: '7px 14px' }}>›</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
            {studios.map(s => (
              <div key={s.studio} style={card}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <span className="c-arch" style={{ fontSize: 15, letterSpacing: '-0.02em' }}>{s.label}</span>
                  <span style={{ fontSize: 10.5, opacity: 0.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.who}</span>
                </div>
                {s.duties.map(d => (
                  <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0, background: DUTY_COLOR[d.state] ?? 'var(--c-wash2)' }} />
                    {d.label}
                    <span style={{ marginLeft: 'auto', fontSize: 10.5, opacity: 0.5, flexShrink: 0 }}>{d.detail}</span>
                  </div>
                ))}
                {s.entries.length > 0 ? (
                  <div
                    onClick={() => setLogOpen(s)}
                    style={{ marginTop: 8, background: 'var(--c-wash)', borderRadius: 12, padding: '9px 11px', cursor: 'pointer' }}
                  >
                    <div className="c-label" style={{ marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Shift notes · {s.entries.length} {s.entries.length === 1 ? 'runner' : 'runners'}</span>
                      <span style={{ opacity: 0.8, fontWeight: 800, textTransform: 'none', letterSpacing: 0 }}>View →</span>
                    </div>
                    <div style={{
                      fontSize: 11.5, lineHeight: 1.5, opacity: 0.8,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {s.entries[0].author_name}: {s.entries[0].text}
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 8, background: 'var(--c-wash)', borderRadius: 12, padding: '9px 11px', fontSize: 11.5, opacity: 0.45, fontStyle: 'italic' }}>
                    No shift notes.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Shift-log popup — the full night */}
      {logOpen && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setLogOpen(null) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10001,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div style={{
            width: 'min(560px, 92vw)', maxHeight: '80vh', overflowY: 'auto',
            background: 'var(--c-srf, var(--c-bg))', color: 'var(--c-fg)',
            borderRadius: 20, boxShadow: 'var(--c-softsh)', padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="c-arch" style={{ fontSize: 17 }}>{logOpen.label} · shift notes</span>
              <span style={{ fontSize: 11.5, opacity: 0.5 }}>{prettyDate(date)}</span>
            </div>
            {logOpen.entries.map((e, i) => (
              <div key={e.id} style={{ padding: '10px 0', boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined }}>
                <div className="c-mono" style={{ fontSize: 10.5, fontWeight: 800, opacity: 0.5, marginBottom: 4 }}>
                  {e.author_name.toUpperCase()}{e.role ? ` · ${e.role.toUpperCase()}` : ''} · {new Date(e.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{e.text}</div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setLogOpen(null)} style={{ ...wash, background: 'var(--c-wash2)', fontWeight: 700, cursor: 'pointer', padding: '9px 18px' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
