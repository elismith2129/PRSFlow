'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /hiring — one case per person-event, and the checklist for it (2026-09-21).
// Rail: HR → Hiring. Owner + manager only (RLS says the same).
//
// Eli: "type a name, select new hire, promotion, or separation and then the
// checklists for each of those." The list is the whole page until a case is
// opened. Starting a case is one line — name, kind, one date — and the
// checklist dates itself from that date (lib/hrChecklists.ts). Separation
// asks "how is this ending?" first because that answer sets the final-pay
// deadline (LC 201/202), which then sits at the top of its list.
//
// Session 1 (this): cases + checklist. The two Documents rows are ticked by
// hand for now. Session 2: the offer letter / job description form, send,
// sign at /sign/<token>, PDF — after which those rows tick themselves.
// Mock: docs/design-refs/hiring-options.html.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { dbResult } from '@/lib/db'
import { getLocalToday } from '@/lib/time'
import { SectionHeader } from '@/components/ui/SectionHeader'
import {
  ANCHOR_LABEL, KIND_LABEL, SEPARATION_LABEL, finalPayDue,
  type HrCaseKind, type SeparationType,
} from '@/lib/hrChecklists'
import {
  createCase, fmtDate, nextUp, progress,
  type HrCase, type HrCaseItem,
} from '@/lib/hrCases'

const KINDS: HrCaseKind[] = ['new_hire', 'promotion', 'separation']
const SEP_TYPES: SeparationType[] = ['involuntary', 'quit_72_notice', 'quit_short_notice']
const STUDIOS: NonNullable<HrCase['studio']>[] = ['PRS', 'ARS', 'ERS', 'TRK']

const KIND_FILL: Record<HrCaseKind, string> = {
  new_hire: 'c-fill-uncon',
  promotion: 'c-fill-warm',
  separation: 'c-fill-cold',
}

export default function HiringPage() {
  const { profile } = useUserProfile()
  const [cases, setCases] = useState<HrCase[]>([])
  const [items, setItems] = useState<HrCaseItem[]>([])
  const [people, setPeople] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [starting, setStarting] = useState(false)

  // New-case form
  const [kind, setKind] = useState<HrCaseKind>('new_hire')
  const [name, setName] = useState('')
  const [staffId, setStaffId] = useState<string>('')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [studio, setStudio] = useState<HrCase['studio']>(null)
  const [anchor, setAnchor] = useState('')
  const [sepType, setSepType] = useState<SeparationType>('quit_72_notice')
  const [noticeDate, setNoticeDate] = useState('')
  const [noticeTime, setNoticeTime] = useState('')
  const [saving, setSaving] = useState(false)

  const canManage = profile?.role === 'owner' || profile?.role === 'manager'
  const today = getLocalToday()

  const load = useCallback(async () => {
    const [{ data: c }, { data: i }, { data: p }] = await Promise.all([
      supabase.from('hr_cases').select('*').order('anchor_date', { ascending: true }),
      supabase.from('hr_case_items').select('*').order('sort_order', { ascending: true }),
      supabase.from('user_profiles').select('*').is('deleted_at', null).order('display_name'),
    ])
    setCases((c ?? []) as HrCase[])
    setItems((i ?? []) as HrCaseItem[])
    setPeople((p ?? []) as UserProfile[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = supabase
      .channel('hiring-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hr_cases' }, () => { load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hr_case_items' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const itemsOf = useCallback((caseId: string) => items.filter(i => i.case_id === caseId), [items])
  const nameOf = (id: string | null) => people.find(p => p.id === id)?.display_name ?? ''

  // Picking an existing person fills the name and email for promotion / separation.
  useEffect(() => {
    if (kind === 'new_hire') { setStaffId(''); return }
    const p = people.find(x => x.id === staffId)
    if (p) { setName(p.display_name); setEmail(p.email ?? '') }
  }, [kind, staffId, people])

  const previewFinalPay = kind === 'separation' && anchor
    ? finalPayDue(sepType, anchor, noticeDate ? `${noticeDate}T${noticeTime || '12:00'}:00` : null)
    : null

  async function start() {
    if (!profile) return
    if (!name.trim()) { alert('Whose case is this?'); return }
    if (!anchor) { alert(`${ANCHOR_LABEL[kind]} is needed — the checklist dates itself from it.`); return }
    setSaving(true)
    const res = await createCase({
      kind,
      subject_name: name,
      staff_id: kind === 'new_hire' ? null : (staffId || null),
      recipient_email: email,
      new_title: title,
      studio,
      anchor_date: anchor,
      separation_type: kind === 'separation' ? sepType : null,
      notice_at: kind === 'separation' && noticeDate ? new Date(`${noticeDate}T${noticeTime || '12:00'}:00`).toISOString() : null,
      created_by: profile.id,
    })
    setSaving(false)
    if ('error' in res) { dbResult('Starting the case', { message: res.error }); return }
    setName(''); setStaffId(''); setEmail(''); setTitle(''); setStudio(null); setAnchor(''); setNoticeDate(''); setNoticeTime('')
    setStarting(false)
    setOpenId(res.id)
    load()
  }

  async function toggle(it: HrCaseItem) {
    if (!profile) return
    const done = !it.done_at
    const { error } = await supabase
      .from('hr_case_items')
      .update({ done_at: done ? new Date().toISOString() : null, done_by: done ? profile.id : null })
      .eq('id', it.id)
    if (!dbResult('Saving the checklist', error)) return
    load()
  }

  async function setStatus(c: HrCase, status: HrCase['status']) {
    const { error } = await supabase
      .from('hr_cases')
      .update({ status, closed_at: status === 'closed' ? new Date().toISOString() : null })
      .eq('id', c.id)
    if (!dbResult(status === 'closed' ? 'Closing the case' : 'Reopening the case', error)) return
    if (status === 'closed') setOpenId(null)
    load()
  }

  async function linkStaff(c: HrCase, id: string) {
    const p = people.find(x => x.id === id)
    const { error } = await supabase
      .from('hr_cases')
      .update({ staff_id: id || null, recipient_email: c.recipient_email || p?.email || null })
      .eq('id', c.id)
    if (!dbResult('Linking the staff record', error)) return
    load()
  }

  async function removeCase(c: HrCase) {
    const its = itemsOf(c.id)
    if (its.some(i => i.done_at)) { alert('This case has ticked items — close it instead of deleting it.'); return }
    if (!confirm(`Delete the ${KIND_LABEL[c.kind].toLowerCase()} case for ${c.subject_name}? Only for one opened by mistake.`)) return
    const { error } = await supabase.from('hr_cases').delete().eq('id', c.id)
    if (!dbResult('Deleting the case', error)) return
    setOpenId(null)
    load()
  }

  // ── styles (same idiom as /punches) ────────────────────────────────────
  const card: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)',
    borderRadius: 18, padding: '14px 16px',
  }
  const btn = (primary = false): React.CSSProperties => ({
    padding: '7px 14px', minHeight: 34, borderRadius: 99,
    background: primary ? 'var(--c-wash2)' : 'var(--c-wash)',
    color: 'var(--c-fg)', border: 'none', font: 'inherit',
    fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  })
  const label: React.CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: '0.11em', textTransform: 'uppercase', opacity: 0.45, marginBottom: 4 }
  const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }
  const seg = (on: boolean, tone?: 'warm' | 'hot'): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 99, border: 'none', font: 'inherit', cursor: 'pointer',
    fontSize: 9.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase',
    background: on ? (tone === 'hot' ? 'var(--c-st-hot)' : tone === 'warm' ? 'var(--c-st-warm)' : 'var(--c-wash2)') : 'transparent',
    color: on ? (tone ? 'var(--c-chip-ink)' : 'var(--c-fg)') : 'var(--c-fg)',
    opacity: on ? 1 : 0.5,
  })

  if (!canManage) {
    return <div style={{ opacity: 0.55, fontSize: 13, padding: 20 }}>Hiring is manager territory.</div>
  }

  const openCases = cases.filter(c => c.status === 'open')
  const closedCases = cases.filter(c => c.status === 'closed')
  const current = openId ? cases.find(c => c.id === openId) ?? null : null
  const staffPool = people.filter(p => p.role !== 'runner')

  // ── a case ──────────────────────────────────────────────────────────────
  if (current) {
    const its = itemsOf(current.id)
    const pr = progress(its)
    const groups = its.reduce<{ grp: string; rows: HrCaseItem[] }[]>((acc, it) => {
      const g = acc.find(x => x.grp === it.grp)
      if (g) g.rows.push(it); else acc.push({ grp: it.grp, rows: [it] })
      return acc
    }, [])
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
        <div>
          <button style={{ ...btn(), padding: '5px 12px', minHeight: 28, fontSize: 11 }} onClick={() => setOpenId(null)}>← All cases</button>
        </div>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="c-arch" style={{ fontSize: 19, letterSpacing: '-0.02em' }}>{current.subject_name}</span>
            <span className={`c-pill ${KIND_FILL[current.kind]}`}>{KIND_LABEL[current.kind]}</span>
            {current.new_title && <span className="c-pill" style={{ background: 'var(--c-wash2)', color: 'var(--c-fg)' }}>{current.new_title}</span>}
            {current.studio && <span style={{ fontSize: 11, opacity: 0.5 }}>{current.studio}</span>}
            <span className="c-mono" style={{ marginLeft: 'auto', fontSize: 11.5, opacity: 0.7 }}>
              {ANCHOR_LABEL[current.kind].toLowerCase()} {fmtDate(current.anchor_date)} · {pr.done} / {pr.total}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            {current.kind !== 'new_hire' || current.staff_id ? (
              <span style={{ fontSize: 11.5, opacity: 0.6 }}>
                {current.staff_id ? `Staff record: ${nameOf(current.staff_id)}` : 'No staff record linked'}
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, opacity: 0.75 }}>
                Link staff record
                <select className="c-input" style={{ width: 'auto', height: 28, fontSize: 11.5 }} value="" onChange={e => linkStaff(current, e.target.value)}>
                  <option value="">once it exists…</option>
                  {staffPool.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
              </span>
            )}
            {current.recipient_email && <span style={{ fontSize: 11.5, opacity: 0.6 }}>· {current.recipient_email}</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {current.status === 'open'
                ? <button style={btn(true)} onClick={() => setStatus(current, 'closed')}>Close case</button>
                : <button style={btn(true)} onClick={() => setStatus(current, 'open')}>Reopen</button>}
              <button style={{ ...btn(), opacity: 0.6 }} onClick={() => removeCase(current)}>Delete</button>
            </span>
          </div>

          {current.kind === 'separation' && (
            <div style={{
              marginTop: 12, borderRadius: 12, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5,
              background: current.separation_type === 'involuntary' ? 'rgba(255,90,77,.14)' : 'var(--c-wash)',
              border: current.separation_type === 'involuntary' ? '1px solid rgba(255,90,77,.4)' : 'none',
            }}>
              <b style={{ color: current.separation_type === 'involuntary' ? 'var(--c-st-hot)' : undefined }}>
                {current.separation_type ? SEPARATION_LABEL[current.separation_type] : 'Separation'} · final pay due {fmtDate(current.final_pay_due, { year: true })}
              </b>
              {current.separation_type === 'involuntary' && (
                <> — the check has to exist before the conversation. Eli's approval and 48 hours' notice to Lynair. Late = up to 30 days of wages in penalties (LC 201/203).</>
              )}
              {current.separation_type === 'quit_72_notice' && <> — paid on the last day (LC 202).</>}
              {current.separation_type === 'quit_short_notice' && <> — within 72 hours of notice (LC 202).</>}
              {current.notice_at && <span style={{ opacity: 0.6 }}> · notice given {new Date(current.notice_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
            </div>
          )}
        </div>

        {groups.map(g => {
          const done = g.rows.filter(r => r.done_at).length
          return (
            <div key={g.grp} style={card}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <div style={{ ...label, marginBottom: 0 }}>{g.grp}</div>
                <span className="c-mono" style={{ fontSize: 10, opacity: 0.45 }}>{done} / {g.rows.length}</span>
                {g.grp === 'Documents' && (
                  <span style={{ fontSize: 10.5, opacity: 0.45, marginLeft: 'auto' }}>sending and signing from here comes next — tick by hand for now</span>
                )}
              </div>
              {g.rows.map((it, i) => {
                const isDone = !!it.done_at
                const overdue = !isDone && !!it.due_on && it.due_on < today
                return (
                  <div key={it.id} style={{
                    display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 10, padding: '9px 0', alignItems: 'start',
                    boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
                  }}>
                    <button
                      aria-label={isDone ? 'Untick' : 'Tick'}
                      onClick={() => toggle(it)}
                      style={{
                        width: 18, height: 18, marginTop: 2, borderRadius: 6, cursor: 'pointer', padding: 0,
                        border: `1.5px ${it.auto_key ? 'dashed' : 'solid'} ${isDone ? 'var(--c-st-booked)' : 'var(--c-fg)'}`,
                        background: isDone ? 'var(--c-st-booked)' : 'transparent', opacity: isDone ? 1 : 0.5,
                        position: 'relative',
                      }}
                    >
                      {isDone && <span style={{ position: 'absolute', left: 5, top: 1, width: 5, height: 9, borderRight: '2px solid var(--c-chip-ink)', borderBottom: '2px solid var(--c-chip-ink)', transform: 'rotate(45deg)' }} />}
                    </button>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, opacity: isDone ? 0.5 : 1, textDecoration: isDone ? 'line-through' : 'none' }}>{it.label}</div>
                      {it.help && !isDone && <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 2, lineHeight: 1.5 }}>{it.help}</div>}
                      {isDone && it.done_by && <div style={{ fontSize: 10.5, opacity: 0.45, marginTop: 1 }}>{nameOf(it.done_by)} · {fmtDate(it.done_at)}</div>}
                    </div>
                    <div className="c-mono" style={{
                      fontSize: 10, textAlign: 'right', whiteSpace: 'nowrap', opacity: isDone ? 0.35 : 0.85,
                      color: overdue ? 'var(--c-st-hot)' : it.is_legal ? 'var(--c-st-warm)' : 'var(--c-fg)',
                    }}>
                      {it.due_on ? fmtDate(it.due_on) : ''}
                      {it.owner_role && <span style={{ display: 'block', fontSize: 8.5, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.55, fontFamily: 'inherit', color: 'var(--c-fg)' }}>{it.owner_role}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
        <div style={{ fontSize: 10.5, opacity: 0.4, lineHeight: 1.5 }}>
          Dashed box = the app will tick this itself once documents send from here. Orange date = a legal deadline. Red = past it. The name under a date is the usual owner from PRG-P02; anyone with this page can tick anything — we record who.
        </div>
      </div>
    )
  }

  // ── the list ────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 860 }}>
      <div>
        <SectionHeader
          title="Open cases"
          count={openCases.length || undefined}
          countColor="orange"
          action={{ label: starting ? 'Cancel' : '+ New case', onClick: () => setStarting(s => !s) }}
        />

        {starting && (
          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'var(--c-wash)', borderRadius: 99, padding: 3, width: 'fit-content' }}>
              {KINDS.map(k => (
                <button key={k} style={seg(kind === k, k === 'promotion' ? 'warm' : k === 'separation' ? 'hot' : undefined)} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {kind === 'new_hire' ? (
                <div style={field}><div style={label}>Name</div>
                  <input className="c-input" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" /></div>
              ) : (
                <div style={field}><div style={label}>Who</div>
                  <select className="c-input" value={staffId} onChange={e => setStaffId(e.target.value)}>
                    <option value="">Pick a person…</option>
                    {staffPool.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </select></div>
              )}
              <div style={field}><div style={label}>{ANCHOR_LABEL[kind]}</div>
                <input className="c-input" type="date" value={anchor} onChange={e => setAnchor(e.target.value)} /></div>
              {kind !== 'separation' && (
                <div style={field}><div style={label}>{kind === 'promotion' ? 'New title' : 'Title'}</div>
                  <input className="c-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Studio Manager" /></div>
              )}
              <div style={field}><div style={label}>Studio</div>
                <select className="c-input" value={studio ?? ''} onChange={e => setStudio((e.target.value || null) as HrCase['studio'])}>
                  <option value="">—</option>
                  {STUDIOS.map(s => <option key={s} value={s}>{s}</option>)}
                </select></div>
              <div style={field}><div style={label}>{kind === 'new_hire' ? 'Personal email' : 'Email for documents'}</div>
                <input className="c-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="them@gmail.com" /></div>
            </div>

            {kind === 'separation' && (
              <div style={{ marginTop: 12 }}>
                <div style={label}>How is this ending?</div>
                <div style={{ display: 'flex', gap: 4, background: 'var(--c-wash)', borderRadius: 99, padding: 3, width: 'fit-content', flexWrap: 'wrap' }}>
                  {SEP_TYPES.map(s => (
                    <button key={s} style={seg(sepType === s, s === 'involuntary' ? 'hot' : undefined)} onClick={() => setSepType(s)}>{SEPARATION_LABEL[s]}</button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 10, maxWidth: 420 }}>
                  <div style={field}><div style={label}>Notice given · date</div>
                    <input className="c-input" type="date" value={noticeDate} onChange={e => setNoticeDate(e.target.value)} /></div>
                  <div style={field}><div style={label}>Time</div>
                    <input className="c-input" type="time" value={noticeTime} onChange={e => setNoticeTime(e.target.value)} /></div>
                </div>
                {previewFinalPay && (
                  <div style={{
                    marginTop: 10, borderRadius: 12, padding: '9px 12px', fontSize: 12, lineHeight: 1.5,
                    background: sepType === 'involuntary' ? 'rgba(255,90,77,.14)' : 'var(--c-wash)',
                  }}>
                    <b style={{ color: sepType === 'involuntary' ? 'var(--c-st-hot)' : undefined }}>Final pay due {fmtDate(previewFinalPay, { year: true })}</b>
                    {sepType === 'involuntary' && ' — at the moment of termination. The check must exist before the conversation; Eli approval and 48 hrs notice to Lynair.'}
                    {sepType === 'quit_72_notice' && ' — on the last day.'}
                    {sepType === 'quit_short_notice' && ' — 72 hours from notice.'}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button style={btn(true)} disabled={saving} onClick={start}>{saving ? 'Starting…' : 'Start case'}</button>
              <button style={btn()} onClick={() => setStarting(false)}>Cancel</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ ...card, opacity: 0.5 }}>Loading…</div>
        ) : openCases.length === 0 ? (
          <div style={{ ...card, opacity: 0.5, fontSize: 13 }}>No open cases. Start one for a new hire, a promotion, or a separation.</div>
        ) : (
          <div style={card}>
            {openCases.map((c, i) => {
              const its = itemsOf(c.id)
              const pr = progress(its)
              const nx = nextUp(its, today)
              return (
                <div key={c.id} onClick={() => setOpenId(c.id)} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 14px', padding: '11px 0', cursor: 'pointer', alignItems: 'center',
                  boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 13.5 }}>{c.subject_name}</b>
                      <span className={`c-pill ${KIND_FILL[c.kind]}`}>{KIND_LABEL[c.kind]}</span>
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.new_title ? `${c.new_title} · ` : ''}{ANCHOR_LABEL[c.kind].toLowerCase()} {fmtDate(c.anchor_date)}
                      {c.kind === 'separation' && c.final_pay_due && <> · final pay {fmtDate(c.final_pay_due)}</>}
                      {nx && (
                        <> · <span style={{ color: nx.overdue ? 'var(--c-st-hot)' : nx.legal ? 'var(--c-st-warm)' : undefined, opacity: 1 }}>
                          {nx.overdue ? 'overdue' : 'next'}: {nx.label.length > 48 ? nx.label.slice(0, 46) + '…' : nx.label} ({fmtDate(nx.due)})
                        </span></>
                      )}
                    </div>
                  </div>
                  <div className="c-mono" style={{ fontSize: 11, opacity: 0.7, textAlign: 'right' }}>
                    {pr.done} / {pr.total}
                    <div style={{ height: 4, borderRadius: 99, background: 'var(--c-wash2)', width: 110, marginTop: 5, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pr.total ? Math.round(100 * pr.done / pr.total) : 0}%`, background: 'var(--c-st-booked)' }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <SectionHeader
          title={`Closed · ${closedCases.length}`}
          action={closedCases.length ? { label: showClosed ? 'Hide' : 'Show', onClick: () => setShowClosed(s => !s) } : undefined}
        />
        {showClosed && closedCases.length > 0 && (
          <div style={card}>
            {closedCases.map((c, i) => (
              <div key={c.id} onClick={() => setOpenId(c.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer', opacity: 0.7,
                boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
              }}>
                <b style={{ fontSize: 13 }}>{c.subject_name}</b>
                <span className={`c-pill ${KIND_FILL[c.kind]}`}>{KIND_LABEL[c.kind]}</span>
                <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 'auto' }}>closed {fmtDate(c.closed_at)}</span>
              </div>
            ))}
          </div>
        )}
        {!showClosed && closedCases.length === 0 && (
          <div style={{ fontSize: 11, opacity: 0.4 }}>Closed cases keep their checklist and, once documents send from here, the signed copies — that's the personnel file.</div>
        )}
      </div>
    </div>
  )
}
