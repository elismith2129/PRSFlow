'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /hiring — one case per person-event, and the checklist for it (2026-09-21).
// Rail: HR → Hiring. Owner + manager only (RLS says the same).
//
// Eli: "type a name, select new hire, promotion, or separation and then the
// checklists for each of those." Then, same day: "needs to be more
// interactive and understandable… i want it to walk you through this stuff.
// needs to be idiot proof. we do these so rarely it's hard to build the
// muscle that just knows how to do this."
//
// So starting a case is a WALK-THROUGH, one question per screen:
//   1 What's happening   (new hire / promotion / separation — cards that say
//                         what each one carries)
//   2 Who                (a name, or a person from the roster)
//   3 The position       (from /positions — this is how the list KNOWS
//                         whether the job supervises, its vacation, its hours)
//     or, for a separation, how it's ending — that sets the final-pay date
//   4 Review             (plain words: what this creates, the deadlines, why
//                         the supervisory rows are or aren't there) → Start
// Inside a case the first group with open items is marked NOW, and the
// header leads with Next up. Skin = soft (§7c).
//
// Session 1: cases + checklist (this). Session 2: offer letter / job
// description form, send, sign at /sign/<token>, PDF — after which the two
// Documents rows tick themselves. Mock: docs/design-refs/hiring-options.html.
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
  type HrCase, type HrCaseItem, type HrPosition,
} from '@/lib/hrCases'

const KINDS: HrCaseKind[] = ['new_hire', 'promotion', 'separation']
const SEP_TYPES: SeparationType[] = ['involuntary', 'quit_72_notice', 'quit_short_notice']
const STUDIOS: NonNullable<HrCase['studio']>[] = ['PRS', 'ARS', 'ERS', 'TRK']

const KIND_FILL: Record<HrCaseKind, string> = {
  new_hire: 'c-fill-uncon',
  promotion: 'c-fill-warm',
  separation: 'c-fill-cold',
}

// What each kind is FOR — on the cards so nobody has to guess.
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

const SEP_EXPLAIN: Record<SeparationType, string> = {
  involuntary: 'Final pay is due at the moment of termination. The check must exist before the conversation — Eli\'s approval and 48 hours\' notice to Lynair.',
  quit_72_notice: 'They gave 72 hours or more. Final pay is due on their last day.',
  quit_short_notice: 'They gave less than 72 hours. Final pay is due within 72 hours of when they told us.',
}

const panel: React.CSSProperties = {
  background: 'var(--c-srf)', boxShadow: 'var(--c-softsh)', borderRadius: 16, padding: '14px 18px',
}
const fL: React.CSSProperties = {
  display: 'block', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.11em', textTransform: 'uppercase', opacity: 0.45, marginBottom: 4,
}
const muted: React.CSSProperties = { fontSize: 11.5, color: 'var(--c-fg-3)', lineHeight: 1.5 }
const hint: React.CSSProperties = { ...muted, fontSize: 10.5, marginTop: 4 }

type Step = 1 | 2 | 3 | 4

export default function HiringPage() {
  const { profile } = useUserProfile()
  const [cases, setCases] = useState<HrCase[]>([])
  const [items, setItems] = useState<HrCaseItem[]>([])
  const [people, setPeople] = useState<UserProfile[]>([])
  const [positions, setPositions] = useState<HrPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  // The walk-through
  const [starting, setStarting] = useState(false)
  const [step, setStep] = useState<Step>(1)
  const [kind, setKind] = useState<HrCaseKind | null>(null)
  const [name, setName] = useState('')
  const [staffId, setStaffId] = useState<string>('')
  const [email, setEmail] = useState('')
  const [positionId, setPositionId] = useState<string>('')
  const [fromPositionId, setFromPositionId] = useState<string>('')
  const [studio, setStudio] = useState<HrCase['studio']>(null)
  const [anchor, setAnchor] = useState('')
  const [sepType, setSepType] = useState<SeparationType | null>(null)
  const [noticeDate, setNoticeDate] = useState('')
  const [noticeTime, setNoticeTime] = useState('')
  const [saving, setSaving] = useState(false)

  const canManage = profile?.role === 'owner' || profile?.role === 'manager'
  const today = getLocalToday()

  const load = useCallback(async () => {
    const [{ data: c }, { data: i }, { data: p }, { data: pos }] = await Promise.all([
      supabase.from('hr_cases').select('*').order('anchor_date', { ascending: true }),
      supabase.from('hr_case_items').select('*').order('sort_order', { ascending: true }),
      supabase.from('user_profiles').select('*').is('deleted_at', null).order('display_name'),
      supabase.from('hr_positions').select('*').order('sort_order').order('title'),
    ])
    setCases((c ?? []) as HrCase[])
    setItems((i ?? []) as HrCaseItem[])
    setPeople((p ?? []) as UserProfile[])
    setPositions((pos ?? []) as HrPosition[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = supabase
      .channel('hiring-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hr_cases' }, () => { load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hr_case_items' }, () => { load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hr_positions' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const itemsOf = useCallback((caseId: string) => items.filter(i => i.case_id === caseId), [items])
  const nameOf = (id: string | null) => people.find(p => p.id === id)?.display_name ?? ''
  const positionOf = (id: string | null) => positions.find(p => p.id === id) ?? null
  const activePositions = positions.filter(p => p.is_active)

  // Picking a person fills name, email, and their current position.
  useEffect(() => {
    if (kind === 'new_hire') { setStaffId(''); return }
    const p = people.find(x => x.id === staffId)
    if (p) {
      setName(p.display_name); setEmail(p.email ?? '')
      const cur = positions.find(x => x.title === p.position_title)
      setFromPositionId(cur?.id ?? '')
    }
  }, [kind, staffId, people, positions])

  function resetForm() {
    setStep(1); setKind(null); setName(''); setStaffId(''); setEmail(''); setPositionId(''); setFromPositionId('')
    setStudio(null); setAnchor(''); setSepType(null); setNoticeDate(''); setNoticeTime('')
  }
  function openWalkthrough() { resetForm(); setStarting(true) }
  function closeWalkthrough() { resetForm(); setStarting(false) }

  const position = positionOf(positionId || null)
  const fromPosition = positionOf(fromPositionId || null)
  const wasSupervisory = kind === 'promotion' ? !!fromPosition?.is_supervisory : null
  const noticeIso = noticeDate ? `${noticeDate}T${noticeTime || '12:00'}:00` : null
  const previewFinalPay = kind === 'separation' && anchor && sepType ? finalPayDue(sepType, anchor, noticeIso) : null

  // What Start will create — from the same function that writes the rows.
  const preview = kind && anchor && (kind !== 'separation' || sepType)
    ? resolveChecklist({ kind, anchor, separationType: sepType, noticeAt: noticeIso, finalPayDue: previewFinalPay, position, wasSupervisory })
    : null
  const legalPreview = (preview ?? []).filter(p => p.is_legal && p.due_on).sort((a, b) => (a.due_on! < b.due_on! ? -1 : 1))

  // Step gating — each step needs the one thing it asks for.
  const step2ok = !!name.trim() && (kind === 'new_hire' || !!staffId)
  const step3ok = kind === 'separation' ? (!!sepType && !!anchor && (sepType !== 'quit_short_notice' || !!noticeDate)) : (!!anchor && !!positionId)

  async function start() {
    if (!profile || !kind) return
    setSaving(true)
    const res = await createCase({
      kind,
      subject_name: name,
      staff_id: kind === 'new_hire' ? null : (staffId || null),
      recipient_email: email,
      new_title: position?.title ?? null,
      studio,
      anchor_date: anchor,
      separation_type: kind === 'separation' ? sepType : null,
      notice_at: kind === 'separation' && noticeIso ? new Date(noticeIso).toISOString() : null,
      position: kind === 'separation' ? null : position,
      from_position_title: kind === 'promotion' ? (fromPosition?.title ?? null) : null,
      was_supervisory: wasSupervisory,
      created_by: profile.id,
    })
    setSaving(false)
    if ('error' in res) { dbResult('Starting the case', { message: res.error }); return }
    closeWalkthrough()
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
  // Everyone with a profile, runners included (Eli, 2026-09-21: "need to be
  // able to pick runners too") — a runner gets promoted or leaves like anyone.
  const staffPool = people
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
    const nowGrp = groups.find(g => g.rows.some(r => !r.done_at))?.grp ?? null
    const involuntary = current.separation_type === 'involuntary'
    const pos = positionOf(current.position_id)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 780 }}>
        <div>
          <button type="button" className="c-control c-soft c-raised-chip" onClick={() => setOpenId(null)} style={{ fontSize: 10 }}>← All cases</button>
        </div>

        <div className="c-panel" style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="c-arch" style={{ fontSize: 20, letterSpacing: '-0.02em' }}>{current.subject_name}</span>
            <span className={`c-pill ${KIND_FILL[current.kind]}`}>{KIND_LABEL[current.kind]}</span>
            {current.new_title && <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.75 }}>{current.from_position_title ? `${current.from_position_title} → ` : ''}{current.new_title}</span>}
            {current.studio && <span style={{ fontSize: 11, opacity: 0.5 }}>{current.studio}</span>}
            <span className="c-tnum" style={{ marginLeft: 'auto', fontSize: 11.5, opacity: 0.75, whiteSpace: 'nowrap' }}>
              {ANCHOR_LABEL[current.kind]} {fmtDate(current.anchor_date, { year: true })}
            </span>
          </div>
          {pos && (
            <div style={{ ...muted, marginTop: 4 }}>
              {pos.title} {pos.is_supervisory ? 'supervises people' : 'doesn\'t supervise anyone'}
              {pos.vacation_days > 0 ? ` · ${pos.vacation_days} vacation days a year` : ''}
              {pos.default_hours_week ? ` · usually ${pos.default_hours_week} hrs a week` : ''}
              {current.kind === 'promotion' && pos.is_supervisory && current.was_supervisory ? ' · already supervised, so no new supervisor course' : ''}
            </div>
          )}

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
              {current.separation_type && <> — {SEP_EXPLAIN[current.separation_type]}</>}
              {involuntary && <> Late = up to 30 days of wages in penalties (LC 201/203).</>}
              {current.notice_at && <span style={{ opacity: 0.6 }}> · notice given {new Date(current.notice_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
            </div>
          )}
        </div>

        {groups.map(g => {
          const done = g.rows.filter(r => r.done_at).length
          const isNow = g.grp === nowGrp
          return (
            <div key={g.grp} className="c-panel" style={{ ...panel, opacity: isNow || done < g.rows.length ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ ...fL, marginBottom: 0 }}>{g.grp}</span>
                <span className="c-tnum" style={{ fontSize: 10, opacity: 0.45 }}>{done} / {g.rows.length}</span>
                {isNow && <span className="c-pill c-fill-booked" style={{ fontSize: 8.5 }}>Now</span>}
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
          Work the group marked <b>Now</b>, top to bottom. Tap a box to tick it — we record who and when. <span style={{ color: 'var(--c-st-warm)' }}>Orange</span> date = a legal deadline. <span style={{ color: 'var(--c-st-hot)' }}>Red</span> = past it. Dashed box = the app will tick this itself once documents send from here. The name under a date is who usually does it; anyone with this page can tick anything.
        </div>
      </div>
    )
  }

  // ── the walk-through ────────────────────────────────────────────────────
  const showWalkthrough = starting || (!loading && openCases.length === 0)
  const stepTitle = !kind ? 'What\'s happening?'
    : step === 2 ? 'Who is this for?'
    : step === 3 ? (kind === 'separation' ? 'How is it ending, and when?' : 'What position, and when?')
    : 'Here\'s what Start will do'

  const Nav = ({ next, nextLabel = 'Next', can = true }: { next: () => void; nextLabel?: string; can?: boolean }) => (
    <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
      <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" disabled={!can || saving} onClick={next} style={{ fontSize: 11.5, minHeight: 36, opacity: can ? 1 : 0.45 }}>{nextLabel}</button>
      <button type="button" className="c-control c-soft c-raised-chip" onClick={() => setStep(s => (s > 1 ? ((s - 1) as Step) : 1))} style={{ fontSize: 10 }}>Back</button>
      {openCases.length > 0 && <button type="button" className="c-control c-soft c-raised-chip" onClick={closeWalkthrough} style={{ fontSize: 10, marginLeft: 'auto', opacity: 0.7 }}>Cancel</button>}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 880 }}>

      {showWalkthrough && (
        <div className="c-panel" style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
            <SectionHeader title={kind ? `New ${KIND_LABEL[kind].toLowerCase()}` : 'Start a case'} />
            {kind && (
              <span className="c-tnum" style={{ fontSize: 10.5, opacity: 0.5 }}>step {step} of 4</span>
            )}
            {kind && (
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                {[1, 2, 3, 4].map(n => <span key={n} style={{ width: 22, height: 4, borderRadius: 99, background: n <= step ? 'var(--c-st-booked)' : 'var(--c-wash2)' }} />)}
              </div>
            )}
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em', marginBottom: 4 }}>{stepTitle}</div>

          {/* STEP 1 — what's happening */}
          {!kind && (
            <>
              <div style={{ ...muted, marginBottom: 12 }}>One case per person. Pick what's happening — you'll be asked one thing at a time, and nothing is created until the last screen.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {KINDS.map(k => (
                  <button key={k} type="button" className="c-control" onClick={() => { setKind(k); setStarting(true); setStep(2) }} style={{
                    textAlign: 'left', borderRadius: 14, padding: '12px 14px', border: 'none', font: 'inherit', color: 'var(--c-fg)',
                    background: 'var(--c-wash)', boxShadow: 'var(--c-ctlsh)', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer',
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`c-pill ${KIND_FILL[k]}`}>{KIND_LABEL[k]}</span>
                      <span className="c-tnum" style={{ fontSize: 10, opacity: 0.5, marginLeft: 'auto' }}>~{stepCount(k)} steps</span>
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{KIND_BLURB[k].what}</span>
                    <span style={{ ...muted, fontSize: 11 }}>{KIND_BLURB[k].carries}</span>
                  </button>
                ))}
              </div>
              {openCases.length > 0 && <div style={{ marginTop: 12 }}><button type="button" className="c-control c-soft c-raised-chip" onClick={closeWalkthrough} style={{ fontSize: 10 }}>Cancel</button></div>}
            </>
          )}

          {/* STEP 2 — who */}
          {kind && step === 2 && (
            <>
              <div style={{ ...muted, marginBottom: 12 }}>
                {kind === 'new_hire'
                  ? 'They don\'t have a PRSFlo login yet — just their name and the personal email their offer letter should go to. Their staff record gets made on day one, from the checklist.'
                  : 'Pick them from the roster. Their name and email fill in from their profile; fix the email if the letter should go somewhere else.'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px 12px', maxWidth: 560 }}>
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
                <div><label style={fL}>{kind === 'new_hire' ? 'Personal email' : 'Email for documents'}</label>
                  <input className="c-input c-inset2" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="them@gmail.com" />
                  {kind !== 'separation' && <div style={hint}>Where the offer letter and job description get sent for signature.</div>}</div>
                {kind === 'promotion' && (
                  <div><label style={fL}>Their position today</label>
                    <select className="c-input c-inset2" value={fromPositionId} onChange={e => setFromPositionId(e.target.value)}>
                      <option value="">Not on the roster yet…</option>
                      {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                    <div style={hint}>So we know whether they already supervise. If it's blank, their profile has no position set yet — pick it here.</div></div>
                )}
              </div>
              <Nav next={() => setStep(3)} can={step2ok} />
            </>
          )}

          {/* STEP 3 — position + date, or how it's ending */}
          {kind && step === 3 && kind !== 'separation' && (
            <>
              <div style={{ ...muted, marginBottom: 12 }}>
                The position decides the rest: whether they supervise (which training and ADP flag), their vacation, their usual hours. Set those on <b>Admin → Positions</b> if something's wrong here.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px 12px', maxWidth: 640 }}>
                <div><label style={fL}>{kind === 'promotion' ? 'New position' : 'Position'}</label>
                  <select className="c-input c-inset2" value={positionId} onChange={e => setPositionId(e.target.value)} autoFocus>
                    <option value="">Pick a position…</option>
                    {activePositions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                  {position && (
                    <div style={hint}>
                      {position.is_supervisory ? 'Supervises people → 2-hour harassment course, ADP Manager flag.' : 'Doesn\'t supervise → 1-hour course, no Manager flag.'}
                      {position.vacation_days > 0 ? ` ${position.vacation_days} vacation days a year.` : ' No vacation allotment.'}
                      {position.jd_body ? (position.jd_is_draft ? ' Job description is still a draft.' : '') : ' No job description on file yet.'}
                    </div>
                  )}</div>
                <div><label style={fL}>{ANCHOR_LABEL[kind]}</label>
                  <input className="c-input c-inset2" type="date" value={anchor} onChange={e => setAnchor(e.target.value)} />
                  <div style={hint}>{kind === 'new_hire' ? 'Day one. Every deadline on the list counts from here. (ADP\'s hire date is set 7 days earlier — the list says so.)' : 'The day the new title and rate take effect. ADP and PRSFlo change on this date, not before.'}</div></div>
                <div><label style={fL}>Studio</label>
                  <select className="c-input c-inset2" value={studio ?? ''} onChange={e => setStudio((e.target.value || null) as HrCase['studio'])}>
                    <option value="">—</option>
                    {STUDIOS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select></div>
              </div>
              <Nav next={() => setStep(4)} can={step3ok} />
            </>
          )}

          {kind === 'separation' && step === 3 && (
            <>
              <div style={{ ...muted, marginBottom: 10 }}>This is the one question that changes everything downstream — it sets when the final check is due, and getting that wrong costs up to 30 days of wages.</div>
              <label style={fL}>How is this ending?</label>
              <div className="c-seg c-seg-wrap">
                {SEP_TYPES.map(s => (
                  <button key={s} type="button" className={sepType === s ? (s === 'involuntary' ? 'c-on c-fill-hot' : 'c-on') : ''} onClick={() => setSepType(s)}>{SEPARATION_LABEL[s]}</button>
                ))}
              </div>
              {sepType && <div style={{ ...hint, color: sepType === 'involuntary' ? 'var(--c-st-hot)' : undefined }}>{SEP_EXPLAIN[sepType]}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px 12px', marginTop: 12, maxWidth: 560 }}>
                <div><label style={fL}>Last day</label>
                  <input className="c-input c-inset2" type="date" value={anchor} onChange={e => setAnchor(e.target.value)} />
                  <div style={hint}>Their last day worked.</div></div>
                <div><label style={fL}>Notice given · date{sepType !== 'quit_short_notice' && <span style={{ opacity: 0.6, textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}> (optional)</span>}</label>
                  <input className="c-input c-inset2" type="date" value={noticeDate} onChange={e => setNoticeDate(e.target.value)} />
                  {sepType === 'quit_short_notice' && <div style={hint}>The 72-hour clock runs from this.</div>}</div>
                {sepType === 'quit_short_notice' && (
                  <div><label style={fL}>Time</label>
                    <input className="c-input c-inset2" type="time" value={noticeTime} onChange={e => setNoticeTime(e.target.value)} /></div>
                )}
              </div>
              <Nav next={() => setStep(4)} can={step3ok} />
            </>
          )}

          {/* STEP 4 — review */}
          {kind && step === 4 && preview && (
            <>
              <div style={{ borderRadius: 12, padding: '12px 14px', background: sepType === 'involuntary' ? 'rgba(255,90,77,.14)' : 'var(--c-wash)', fontSize: 12.5, lineHeight: 1.6 }}>
                <div>
                  A <b>{preview.length}-step {KIND_LABEL[kind].toLowerCase()}</b> list for <b>{name.trim()}</b>
                  {position ? <> as <b>{position.title}</b></> : null}
                  {kind === 'promotion' && fromPosition ? <> (from {fromPosition.title})</> : null}, {ANCHOR_LABEL[kind].toLowerCase()} <b>{fmtDate(anchor, { year: true })}</b>.
                </div>
                {position && kind !== 'separation' && (
                  <div style={{ marginTop: 6 }}>
                    {position.is_supervisory
                      ? (kind === 'promotion' && wasSupervisory
                        ? <>They already supervised, so <b>no new supervisor course</b> — but the ADP Manager flag stays on the list.</>
                        : <>{position.title} <b>supervises people</b>, so the list includes the 2-hour harassment course (due {fmtDate(legalPreview.find(l => l.label.includes('upervisory'))?.due_on ?? anchor)}) and the ADP Manager flag.</>)
                      : <>{position.title} <b>doesn't supervise anyone</b>, so there's no supervisor course or Manager flag on the list.</>}
                    {position.vacation_days > 0 ? <> Vacation: {position.vacation_days} days a year, prorated on the letter.</> : null}
                  </div>
                )}
                {legalPreview.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <span style={{ color: 'var(--c-st-warm)', fontWeight: 700 }}>Legal deadlines:</span>{' '}
                    {legalPreview.slice(0, 4).map((l, i) => <span key={l.label}>{i > 0 ? ' · ' : ''}{l.label.split(' — ')[0].split(' (')[0]} by {fmtDate(l.due_on!)}</span>)}
                    {legalPreview.length > 4 ? ` · +${legalPreview.length - 4} more` : ''}
                  </div>
                )}
                {previewFinalPay && sepType && (
                  <div style={{ marginTop: 6 }}>
                    <b style={{ color: sepType === 'involuntary' ? 'var(--c-st-hot)' : undefined }}>Final pay due {fmtDate(previewFinalPay, { year: true })}.</b> {SEP_EXPLAIN[sepType]}
                  </div>
                )}
                <div style={{ ...muted, marginTop: 8 }}>
                  Nothing is sent to anyone by pressing Start. It makes the list; you work it from there.{kind !== 'separation' ? ' The letters get sent from the case once they\'re ready.' : ''}
                </div>
              </div>
              <Nav next={start} nextLabel={saving ? 'Starting…' : 'Start case'} can={!saving} />
            </>
          )}
        </div>
      )}

      {/* ── open cases ─────────────────────────────────────────────────── */}
      {(loading || openCases.length > 0) && (
        <div className="c-panel" style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
            <SectionHeader title="Open cases" count={openCases.length || undefined} countColor="orange" />
            {!starting && <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" onClick={openWalkthrough} style={{ fontSize: 11 }}>+ New case</button>}
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
