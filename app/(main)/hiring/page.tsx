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
// Second pass same day (Eli: "needs to be more interactive and understandable
// as to what you are doing"): the page explains itself. Empty state = the
// three kinds as cards saying what each one carries; the form previews what
// it is about to create before you commit; a case leads with "Next up".
// Skin = soft (§7c): raised panels, c-seg housing for choices, teal primary.
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
  ANCHOR_LABEL, KIND_LABEL, SEPARATION_LABEL, finalPayDue, resolveChecklist,
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

// What each kind is FOR — shown on the cards so nobody has to guess.
const KIND_BLURB: Record<HrCaseKind, { what: string; carries: string }> = {
  new_hire: {
    what: 'Someone new is starting.',
    carries: 'Offer letter and job description to sign · the ADP hire, step by step · notices, I-9, CalSavers, training — each with its deadline.',
  },
  promotion: {
    what: 'Someone on staff moves up.',
    carries: 'Offer letter and job description to sign · the ADP changes (position, rate, manager flag) · PRSFlo role · supervisor training if they now supervise.',
  },
  separation: {
    what: 'Someone is leaving.',
    carries: 'Asks how it\'s ending first — that sets when the final check is due · the packet · the ADP termination · CalSavers, PIN, keys, file.',
  },
}

const panel: React.CSSProperties = {
  background: 'var(--c-srf)', boxShadow: 'var(--c-softsh)', borderRadius: 16, padding: '14px 18px',
}
const fL: React.CSSProperties = {
  display: 'block', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.11em', textTransform: 'uppercase', opacity: 0.45, marginBottom: 4,
}
const muted: React.CSSProperties = { fontSize: 11.5, color: 'var(--c-fg-3)', lineHeight: 1.5 }

function toISODate(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
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
  const [kind, setKind] = useState<HrCaseKind | null>(null)
  const [name, setName] = useState('')
  const [staffId, setStaffId] = useState<string>('')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [studio, setStudio] = useState<HrCase['studio']>(null)
  const [anchor, setAnchor] = useState('')
  const [sepType, setSepType] = useState<SeparationType | null>(null)
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

  function resetForm() {
    setKind(null); setName(''); setStaffId(''); setEmail(''); setTitle(''); setStudio(null)
    setAnchor(''); setSepType(null); setNoticeDate(''); setNoticeTime('')
  }

  const noticeIso = noticeDate ? `${noticeDate}T${noticeTime || '12:00'}:00` : null
  const previewFinalPay = kind === 'separation' && anchor && sepType ? finalPayDue(sepType, anchor, noticeIso) : null

  // The "here's what this will create" line — computed from the same function
  // that writes the rows, so it cannot drift from what you get.
  const preview = kind && anchor && (kind !== 'separation' || sepType)
    ? resolveChecklist({ kind, anchor, separationType: sepType, noticeAt: noticeIso, finalPayDue: previewFinalPay })
    : null
  const previewFirstLegal = preview?.filter(p => p.is_legal && p.due_on).sort((a, b) => (a.due_on! < b.due_on! ? -1 : 1))[0]
  const readyToStart = !!kind && !!name.trim() && !!anchor && (kind !== 'separation' || !!sepType)

  async function start() {
    if (!profile || !kind) return
    if (!name.trim()) { alert('Whose case is this?'); return }
    if (!anchor) { alert(`${ANCHOR_LABEL[kind]} is needed — the checklist dates itself from it.`); return }
    if (kind === 'separation' && !sepType) { alert('How is this ending? That sets the final-pay date.'); return }
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
      notice_at: kind === 'separation' && noticeIso ? new Date(noticeIso).toISOString() : null,
      created_by: profile.id,
    })
    setSaving(false)
    if ('error' in res) { dbResult('Starting the case', { message: res.error }); return }
    resetForm()
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

  if (!canManage) {
    return <div style={{ opacity: 0.55, fontSize: 13, padding: 20 }}>Hiring is manager territory.</div>
  }

  const openCases = cases.filter(c => c.status === 'open')
  const closedCases = cases.filter(c => c.status === 'closed')
  const current = openId ? cases.find(c => c.id === openId) ?? null : null
  const staffPool = people.filter(p => p.role !== 'runner')
  const stepCount = (k: HrCaseKind) => resolveChecklist({ kind: k, anchor: today, separationType: 'quit_72_notice' }).length

  // ── a case ──────────────────────────────────────────────────────────────
  if (current) {
    const its = itemsOf(current.id)
    const pr = progress(its)
    const nx = nextUp(its, today)
    const groups = its.reduce<{ grp: string; rows: HrCaseItem[] }[]>((acc, it) => {
      const g = acc.find(x => x.grp === it.grp)
      if (g) g.rows.push(it); else acc.push({ grp: it.grp, rows: [it] })
      return acc
    }, [])
    const involuntary = current.separation_type === 'involuntary'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 780 }}>
        <div>
          <button type="button" className="c-control c-soft c-raised-chip" onClick={() => setOpenId(null)} style={{ fontSize: 10 }}>← All cases</button>
        </div>

        <div className="c-panel" style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="c-arch" style={{ fontSize: 20, letterSpacing: '-0.02em' }}>{current.subject_name}</span>
            <span className={`c-pill ${KIND_FILL[current.kind]}`}>{KIND_LABEL[current.kind]}</span>
            {current.new_title && <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.75 }}>{current.new_title}</span>}
            {current.studio && <span style={{ fontSize: 11, opacity: 0.5 }}>{current.studio}</span>}
            <span className="c-tnum" style={{ marginLeft: 'auto', fontSize: 11.5, opacity: 0.75, whiteSpace: 'nowrap' }}>
              {ANCHOR_LABEL[current.kind]} {fmtDate(current.anchor_date, { year: true })}
            </span>
          </div>

          {/* progress + next up: the one line that says where this case is */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
            <div style={{ height: 6, borderRadius: 99, background: 'var(--c-wash)', flex: '1 1 160px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pr.total ? Math.round(100 * pr.done / pr.total) : 0}%`, background: 'var(--c-st-booked)', transition: 'width .3s ease' }} />
            </div>
            <span className="c-tnum" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{pr.done} of {pr.total} done</span>
          </div>
          {pr.done >= pr.total && pr.total > 0 ? (
            <div style={{ ...muted, marginTop: 6, color: 'var(--c-st-booked)' }}>Everything's ticked. Close the case when you're happy — it stays on file.</div>
          ) : nx ? (
            <div style={{ ...muted, marginTop: 6 }}>
              <b style={{ color: nx.overdue ? 'var(--c-st-hot)' : 'var(--c-fg)' }}>{nx.overdue ? 'Overdue' : 'Next up'}:</b> {nx.label}
              <span style={{ opacity: 0.7 }}> · {fmtDate(nx.due)}{nx.legal ? ' · legal deadline' : ''}</span>
            </div>
          ) : (
            <div style={{ ...muted, marginTop: 6 }}>Nothing dated is waiting — work the list top to bottom.</div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            {current.kind === 'new_hire' && !current.staff_id ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...muted }}>
                Staff record
                <select className="c-input c-inset2" style={{ width: 'auto', height: 28, fontSize: 11 }} value="" onChange={e => linkStaff(current, e.target.value)}>
                  <option value="">link once it exists…</option>
                  {staffPool.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
              </span>
            ) : (
              <span style={muted}>{current.staff_id ? `Staff record: ${nameOf(current.staff_id)}` : ''}</span>
            )}
            {current.recipient_email && <span style={muted}>{current.recipient_email}</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {current.status === 'open'
                ? <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" onClick={() => setStatus(current, 'closed')} style={{ fontSize: 10.5 }}>Close case</button>
                : <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" onClick={() => setStatus(current, 'open')} style={{ fontSize: 10.5 }}>Reopen</button>}
              <button type="button" className="c-control c-soft c-raised-chip" onClick={() => removeCase(current)} style={{ fontSize: 10, opacity: 0.7 }}>Delete</button>
            </span>
          </div>

          {current.kind === 'separation' && (
            <div style={{
              marginTop: 12, borderRadius: 12, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5,
              background: involuntary ? 'rgba(255,90,77,.14)' : 'var(--c-wash)',
            }}>
              <b style={{ color: involuntary ? 'var(--c-st-hot)' : undefined }}>
                {current.separation_type ? SEPARATION_LABEL[current.separation_type] : 'Separation'} · final pay due {fmtDate(current.final_pay_due, { year: true })}
              </b>
              {involuntary && <> — the check has to exist before the conversation. Eli's approval and 48 hours' notice to Lynair. Late = up to 30 days of wages in penalties (LC 201/203).</>}
              {current.separation_type === 'quit_72_notice' && <> — paid on the last day (LC 202).</>}
              {current.separation_type === 'quit_short_notice' && <> — within 72 hours of notice (LC 202).</>}
              {current.notice_at && <span style={{ opacity: 0.6 }}> · notice given {new Date(current.notice_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
            </div>
          )}
        </div>

        {groups.map(g => {
          const done = g.rows.filter(r => r.done_at).length
          return (
            <div key={g.grp} className="c-panel" style={panel}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                <span style={{ ...fL, marginBottom: 0 }}>{g.grp}</span>
                <span className="c-tnum" style={{ fontSize: 10, opacity: 0.45 }}>{done} / {g.rows.length}</span>
                {g.grp === 'Documents' && (
                  <span style={{ ...muted, fontSize: 10.5, marginLeft: 'auto' }}>sending and signing from here is next — tick by hand for now</span>
                )}
              </div>
              {g.rows.map((it, i) => {
                const isDone = !!it.done_at
                const overdue = !isDone && !!it.due_on && it.due_on < today
                return (
                  <div key={it.id} style={{
                    display: 'grid', gridTemplateColumns: '24px minmax(0,1fr) auto', gap: 10, padding: '8px 0', alignItems: 'start',
                    boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
                  }}>
                    <button
                      type="button"
                      className="c-control"
                      aria-label={isDone ? 'Untick' : 'Tick'}
                      title={isDone ? 'Untick' : 'Tick this off'}
                      onClick={() => toggle(it)}
                      style={{
                        width: 20, height: 20, marginTop: 1, borderRadius: 7, padding: 0, position: 'relative',
                        border: 'none', boxShadow: isDone ? 'none' : 'var(--c-ctlsh)',
                        background: isDone ? 'var(--c-st-booked)' : 'var(--c-wash2)',
                        outline: it.auto_key && !isDone ? '1.5px dashed var(--c-fg-3)' : 'none', outlineOffset: -1,
                      }}
                    >
                      {isDone && <span style={{ position: 'absolute', left: 6, top: 2, width: 5, height: 10, borderRight: '2px solid var(--c-chip-ink)', borderBottom: '2px solid var(--c-chip-ink)', transform: 'rotate(45deg)' }} />}
                    </button>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, opacity: isDone ? 0.45 : 1, textDecoration: isDone ? 'line-through' : 'none', lineHeight: 1.4 }}>{it.label}</div>
                      {it.help && !isDone && <div style={{ ...muted, fontSize: 10.5, marginTop: 2 }}>{it.help}</div>}
                      {isDone && it.done_by && <div style={{ ...muted, fontSize: 10.5, marginTop: 1 }}>{nameOf(it.done_by)} · {fmtDate(it.done_at)}</div>}
                    </div>
                    <div className="c-tnum" style={{
                      fontSize: 10.5, textAlign: 'right', whiteSpace: 'nowrap', opacity: isDone ? 0.35 : 0.9, lineHeight: 1.3,
                      color: overdue ? 'var(--c-st-hot)' : it.is_legal ? 'var(--c-st-warm)' : 'var(--c-fg)',
                    }}>
                      {it.due_on ? fmtDate(it.due_on) : ''}
                      {it.owner_role && <span style={{ display: 'block', fontSize: 8.5, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.5, fontFamily: 'Inter, sans-serif', color: 'var(--c-fg)' }}>{it.owner_role}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
        <div style={{ ...muted, fontSize: 10.5 }}>
          Tap a box to tick it — we record who and when. <span style={{ color: 'var(--c-st-warm)' }}>Orange</span> date = a legal deadline. <span style={{ color: 'var(--c-st-hot)' }}>Red</span> = past it. Dashed box = the app will tick this itself once documents send from here. The name under a date is who usually does it; anyone with this page can tick anything.
        </div>
      </div>
    )
  }

  // ── the list ────────────────────────────────────────────────────────────
  const showPicker = starting || (!loading && openCases.length === 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 880 }}>

      {/* ── start a case ───────────────────────────────────────────────── */}
      {showPicker && (
        <div className="c-panel" style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
            <SectionHeader title={kind ? `New ${KIND_LABEL[kind].toLowerCase()}` : 'Start a case'} />
            {(starting || kind) && openCases.length > 0 && (
              <button type="button" className="c-control c-soft c-raised-chip" onClick={() => { resetForm(); setStarting(false) }} style={{ fontSize: 10 }}>Cancel</button>
            )}
          </div>
          {!kind && (
            <div style={{ ...muted, marginBottom: 12 }}>
              One case per person. Pick what's happening and you get the checklist for it, already dated, with the ADP steps spelled out.
            </div>
          )}

          {/* the three kinds, as cards — pick one */}
          {!kind ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {KINDS.map(k => (
                <button
                  key={k}
                  type="button"
                  className="c-control"
                  onClick={() => { setKind(k); setStarting(true) }}
                  style={{
                    textAlign: 'left', borderRadius: 14, padding: '12px 14px', border: 'none', font: 'inherit', color: 'var(--c-fg)',
                    background: 'var(--c-wash)', boxShadow: 'var(--c-ctlsh)', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`c-pill ${KIND_FILL[k]}`}>{KIND_LABEL[k]}</span>
                    <span className="c-tnum" style={{ fontSize: 10, opacity: 0.5, marginLeft: 'auto' }}>{stepCount(k)} steps</span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{KIND_BLURB[k].what}</span>
                  <span style={{ ...muted, fontSize: 11 }}>{KIND_BLURB[k].carries}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              {/* kind switcher, one housing */}
              <div className="c-seg" style={{ marginBottom: 12 }}>
                {KINDS.map(k => (
                  <button key={k} type="button" className={kind === k ? `c-on ${KIND_FILL[k]}` : ''} onClick={() => { setKind(k); setSepType(null) }}>{KIND_LABEL[k]}</button>
                ))}
              </div>
              <div style={{ ...muted, marginBottom: 12 }}>{KIND_BLURB[kind].what} {KIND_BLURB[kind].carries}</div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px 12px' }}>
                {kind === 'new_hire' ? (
                  <div><label style={fL}>Their name</label>
                    <input className="c-input c-inset2" value={name} onChange={e => setName(e.target.value)} placeholder="First and last" autoFocus /></div>
                ) : (
                  <div><label style={fL}>Who</label>
                    <select className="c-input c-inset2" value={staffId} onChange={e => setStaffId(e.target.value)} autoFocus>
                      <option value="">Pick a person…</option>
                      {staffPool.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                    </select></div>
                )}
                <div><label style={fL}>{ANCHOR_LABEL[kind]}</label>
                  <input className="c-input c-inset2" type="date" value={anchor} onChange={e => setAnchor(e.target.value)} /></div>
                {kind !== 'separation' && (
                  <div><label style={fL}>{kind === 'promotion' ? 'New title' : 'Title'}</label>
                    <input className="c-input c-inset2" value={title} onChange={e => setTitle(e.target.value)} placeholder="Studio Manager" /></div>
                )}
                <div><label style={fL}>Studio</label>
                  <select className="c-input c-inset2" value={studio ?? ''} onChange={e => setStudio((e.target.value || null) as HrCase['studio'])}>
                    <option value="">—</option>
                    {STUDIOS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select></div>
                <div><label style={fL}>{kind === 'new_hire' ? 'Personal email' : 'Email for documents'}</label>
                  <input className="c-input c-inset2" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="them@gmail.com" /></div>
              </div>

              {kind === 'separation' && (
                <div style={{ marginTop: 14 }}>
                  <label style={fL}>How is this ending? <span style={{ opacity: 0.6, textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>— this sets when the final check is due</span></label>
                  <div className="c-seg c-seg-wrap">
                    {SEP_TYPES.map(s => (
                      <button key={s} type="button" className={sepType === s ? (s === 'involuntary' ? 'c-on c-fill-hot' : 'c-on') : ''} onClick={() => setSepType(s)}>{SEPARATION_LABEL[s]}</button>
                    ))}
                  </div>
                  {sepType === 'quit_short_notice' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 12px', marginTop: 10, maxWidth: 380 }}>
                      <div><label style={fL}>Notice given · date</label>
                        <input className="c-input c-inset2" type="date" value={noticeDate} onChange={e => setNoticeDate(e.target.value)} /></div>
                      <div><label style={fL}>Time</label>
                        <input className="c-input c-inset2" type="time" value={noticeTime} onChange={e => setNoticeTime(e.target.value)} /></div>
                    </div>
                  )}
                  {sepType && sepType !== 'quit_short_notice' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 12px', marginTop: 10, maxWidth: 380 }}>
                      <div><label style={fL}>Notice given · date <span style={{ opacity: 0.6, textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>(optional)</span></label>
                        <input className="c-input c-inset2" type="date" value={noticeDate} onChange={e => setNoticeDate(e.target.value)} /></div>
                    </div>
                  )}
                </div>
              )}

              {/* what pressing Start will do */}
              <div style={{ marginTop: 14, borderRadius: 12, padding: '10px 12px', fontSize: 12, lineHeight: 1.55, background: previewFinalPay && sepType === 'involuntary' ? 'rgba(255,90,77,.14)' : 'var(--c-wash)' }}>
                {!preview ? (
                  <span style={{ opacity: 0.6 }}>
                    {kind === 'separation' && !sepType ? 'Pick how it\'s ending and the ' : 'Add the '}{ANCHOR_LABEL[kind].toLowerCase()} and I'll show you what this creates.
                  </span>
                ) : (
                  <>
                    <b>Start</b> makes a {preview.length}-step {KIND_LABEL[kind].toLowerCase()} list for <b>{name.trim() || '…'}</b>, dated from {fmtDate(anchor, { year: true })}.
                    {previewFirstLegal && <> First legal deadline: <b style={{ color: 'var(--c-st-warm)' }}>{previewFirstLegal.label.split(' — ')[0]}</b> by {fmtDate(previewFirstLegal.due_on!)}.</>}
                    {previewFinalPay && (
                      <> <b style={{ color: sepType === 'involuntary' ? 'var(--c-st-hot)' : undefined }}>Final pay due {fmtDate(previewFinalPay, { year: true })}</b>
                        {sepType === 'involuntary' && ' — at the moment of termination. The check must exist before the conversation.'}
                        {sepType === 'quit_72_notice' && ' — on the last day.'}
                        {sepType === 'quit_short_notice' && (noticeDate ? ' — 72 hours from notice.' : ' — 72 hours from notice; add the notice date to get the exact day.')}
                      </>
                    )}
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" disabled={saving || !readyToStart} onClick={start} style={{ fontSize: 11.5, minHeight: 36, opacity: readyToStart ? 1 : 0.45 }}>
                  {saving ? 'Starting…' : 'Start case'}
                </button>
                <button type="button" className="c-control c-soft c-raised-chip" onClick={() => { resetForm(); setStarting(openCases.length === 0) }} style={{ fontSize: 10 }}>Back</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── open cases ─────────────────────────────────────────────────── */}
      {(loading || openCases.length > 0) && (
        <div className="c-panel" style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
            <SectionHeader title="Open cases" count={openCases.length || undefined} countColor="orange" />
            {!starting && <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" onClick={() => setStarting(true)} style={{ fontSize: 11 }}>+ New case</button>}
          </div>
          {loading ? (
            <div style={{ ...muted, padding: '6px 0' }}>Loading…</div>
          ) : openCases.map((c, i) => {
            const its = itemsOf(c.id)
            const pr = progress(its)
            const nx = nextUp(its, today)
            return (
              <div key={c.id} role="button" tabIndex={0} onClick={() => setOpenId(c.id)} onKeyDown={e => { if (e.key === 'Enter') setOpenId(c.id) }} style={{
                display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '4px 14px', padding: '9px 0', cursor: 'pointer', alignItems: 'center',
                boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 13.5 }}>{c.subject_name}</b>
                    <span className={`c-pill ${KIND_FILL[c.kind]}`}>{KIND_LABEL[c.kind]}</span>
                    {c.new_title && <span style={{ fontSize: 11.5, opacity: 0.6 }}>{c.new_title}</span>}
                    <span className="c-tnum" style={{ fontSize: 10.5, opacity: 0.5 }}>{ANCHOR_LABEL[c.kind].toLowerCase()} {fmtDate(c.anchor_date)}</span>
                  </div>
                  <div style={{ ...muted, fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pr.done >= pr.total && pr.total > 0 ? (
                      <span style={{ color: 'var(--c-st-booked)' }}>All done — close it</span>
                    ) : nx ? (
                      <><span style={{ color: nx.overdue ? 'var(--c-st-hot)' : nx.legal ? 'var(--c-st-warm)' : undefined }}>{nx.overdue ? 'Overdue' : 'Next'}:</span> {nx.label} · {fmtDate(nx.due)}</>
                    ) : 'Work the list top to bottom'}
                    {c.kind === 'separation' && c.final_pay_due && <> · final pay {fmtDate(c.final_pay_due)}</>}
                  </div>
                </div>
                <div className="c-tnum" style={{ fontSize: 11, opacity: 0.75, textAlign: 'right' }}>
                  {pr.done} / {pr.total}
                  <div style={{ height: 4, borderRadius: 99, background: 'var(--c-wash)', width: 100, marginTop: 5, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pr.total ? Math.round(100 * pr.done / pr.total) : 0}%`, background: 'var(--c-st-booked)' }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── closed ─────────────────────────────────────────────────────── */}
      {closedCases.length > 0 && (
        <div className="c-panel" style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: showClosed ? 6 : 0 }}>
            <SectionHeader title={`Closed · ${closedCases.length}`} />
            <button type="button" className="c-control c-soft c-raised-chip" onClick={() => setShowClosed(s => !s)} style={{ fontSize: 10 }}>{showClosed ? 'Hide' : 'Show'}</button>
          </div>
          {showClosed && closedCases.map((c, i) => (
            <div key={c.id} role="button" tabIndex={0} onClick={() => setOpenId(c.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer', opacity: 0.7,
              boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
            }}>
              <b style={{ fontSize: 13 }}>{c.subject_name}</b>
              <span className={`c-pill ${KIND_FILL[c.kind]}`}>{KIND_LABEL[c.kind]}</span>
              <span className="c-tnum" style={{ fontSize: 10.5, opacity: 0.55, marginLeft: 'auto' }}>closed {fmtDate(c.closed_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
