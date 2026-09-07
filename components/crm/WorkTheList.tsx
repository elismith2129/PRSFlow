'use client'
// ─────────────────────────────────────────────────────────────────────────────
// WORK THE LIST — the dealer (Eli ruling 2026-09-07, "19-year-olds at the
// helm"). One lead at a time, no judgment anywhere in the loop:
//   · the queue is DETERMINISTIC (lib/crm): fresh uncontacted first (speed to
//     lead), then due leads worst-overdue first; priority-tier leads are
//     upper management's and are never dealt here
//   · Flo's play says why this move and what to say — the why is the teaching
//   · contact buttons prefill the message; outcome buttons write the touch,
//     schedule the next one, and deal the next card
//   · outcomes: Answered → next touch on cadence · No answer → retry tomorrow
//     (a no-answer is not a completed conversation) · Not interested → cold
//     (the weekly roundup owns cold) · Wants to book → hot + hand-off to the
//     full lead page
//   · every outcome asks /api/lead-ai for a fresh play, so the lead's NEXT
//     deal is already thought through
// Leads arrive as a prop (the CRM page's fetch + leadsVersion realtime pair);
// the touch scorecard has its own fetch + lead_activity channel below.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react'
import { supabase, Lead, LeadStatus } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { NEXT_TOUCH_DAYS } from '@/lib/settings'
import { isDue, isParked, overdueDays, daysSince } from '@/lib/crm'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { SectionHeader } from '@/components/ui/SectionHeader'

type Method = 'call' | 'text' | 'email'

const GENERIC_PLAY = {
  why: 'First contact — a fast, friendly call beats a perfect one tomorrow.',
  say: "Hi, this is Paramount Recording — saw you reached out. What are you looking to book, and when were you thinking?",
  method: 'call' as Method,
}

export function WorkTheList({ leads, loading, myInitials, onReload, onOpenLead }: {
  leads: Lead[]
  loading: boolean
  myInitials: string
  onReload: () => Promise<void>
  onOpenLead: (id: number) => void
}) {
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [touchesToday, setTouchesToday] = useState<number | null>(null)
  const [activityVersion, setActivityVersion] = useState(0)
  const [method, setMethod] = useState<Method>('call')

  // ── The queue: deterministic, priority excluded, skips are session-local. ──
  const queue = useMemo(() => {
    const workable = (l: Lead) =>
      l.ai_tier !== 'priority' && l.needs_contact !== false && !skipped.has(l.id)
    const fresh = leads
      .filter(l => (l.status === 'uncontacted' || (!l.last_contact && !['booked', 'dead', 'leasing'].includes(l.status))) && workable(l))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const due = leads
      .filter(l => (l.status === 'hot' || l.status === 'warm') && isDue(l) && !isParked(l) && workable(l))
      .sort((a, b) => overdueDays(b) - overdueDays(a) || a.id - b.id)
    return [...fresh, ...due]
  }, [leads, skipped])
  const current: Lead | undefined = queue[0]
  const play = current?.ai_play?.say ? {
    why: current.ai_play.why || GENERIC_PLAY.why,
    say: current.ai_play.say,
    method: (['call', 'text', 'email'].includes(current.ai_play.method || '') ? current.ai_play.method : 'call') as Method,
  } : GENERIC_PLAY

  // Default the outcome's method to Flo's suggestion, per card.
  useEffect(() => { setMethod(play.method); setCopied(false) }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scorecard: my touches today (activity notes start "XX - "). ────────────
  useEffect(() => {
    if (!myInitials) return
    const startIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    supabase.from('lead_activity').select('note').eq('type', 'touch').gte('created_at', startIso)
      .then(({ data }) => {
        setTouchesToday((data ?? []).filter(r => (r.note || '').startsWith(`${myInitials} - `)).length)
      })
  }, [myInitials, activityVersion])
  useEffect(() => {
    const ch = supabase.channel('crm-work-scorecard')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lead_activity' },
        () => setActivityVersion(v => v + 1))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  /** Ask Flo to re-read this lead so its next deal has a fresh play.
   *  Fire-and-forget: the play is a convenience, the touch is the record. */
  async function refreshPlay(leadId: number) {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      fetch('/api/lead-ai', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId }),
      }).catch((): void => undefined)
    } catch { /* no session — the sweep will catch it */ }
  }

  async function logOutcome(kind: 'answered' | 'noanswer' | 'notinterested' | 'book') {
    if (!current || busy) return
    setBusy(true)
    const l = current
    const now = new Date().toISOString()
    const m = method === 'call' ? 'Call' : method === 'text' ? 'Text' : 'Email'
    const patch: Partial<Lead> = { last_contact: now, needs_contact: false }
    let note = ''
    if (kind === 'answered') {
      const st: LeadStatus = l.status === 'warm' ? 'warm' : 'hot'
      patch.status = st
      const khu = new Date(); khu.setDate(khu.getDate() + NEXT_TOUCH_DAYS[st])
      patch.keep_hot_until = khu.toISOString()
      note = `${myInitials} - ${m} - Answered`
    } else if (kind === 'noanswer') {
      // A no-answer is not a finished conversation — retry TOMORROW, not in 5d.
      const st: LeadStatus = l.status === 'warm' ? 'warm' : 'hot'
      patch.status = st
      const khu = new Date(); khu.setDate(khu.getDate() + 1)
      patch.keep_hot_until = khu.toISOString()
      note = `${myInitials} - ${m} - No answer, retry tomorrow`
    } else if (kind === 'notinterested') {
      patch.status = 'cold'
      patch.keep_hot_until = null
      note = `${myInitials} - ${m} - Not interested → Cold`
    } else {
      patch.status = 'hot'
      const khu = new Date(); khu.setDate(khu.getDate() + NEXT_TOUCH_DAYS.hot)
      patch.keep_hot_until = khu.toISOString()
      note = `${myInitials} - ${m} - Wants to book`
    }
    const { error: e1 } = await supabase.from('leads').update(patch).eq('id', l.id)
    if (!dbResult('Logging outcome', e1)) { setBusy(false); return }
    const { error: e2 } = await supabase.from('lead_activity').insert({ lead_id: l.id, type: 'touch', note })
    dbResult('Saving activity note', e2)
    refreshPlay(l.id)
    if (kind === 'book') onOpenLead(l.id)
    await onReload()
    setBusy(false)
  }

  const name = current
    ? (current.label && current.artist_name
        ? `${current.label} / ${current.artist_name}`
        : `${current.fname ?? ''} ${current.lname ?? ''}`.trim() || current.company || `Lead ${current.id}`)
    : ''
  const od = current ? overdueDays(current) : 0
  const smsHref = current?.phone ? `sms:${current.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(play.say)}` : null
  const mailHref = current?.email ? `mailto:${current.email}?subject=${encodeURIComponent('Paramount Recording Studios')}&body=${encodeURIComponent(play.say)}` : null
  const telHref = current?.phone ? `tel:${current.phone.replace(/[^\d+]/g, '')}` : null

  const outcomeBtn: React.CSSProperties = { flex: 1, minHeight: 44, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }

  return (
    <div className="c-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0, maxWidth: 680, width: '100%', margin: '0 auto' }}>
      <SectionHeader carved title="Work the List" count={queue.length > 0 ? queue.length : undefined} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: 'var(--c-fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 800 }}>
          {queue.length === 0 ? 'Queue clear' : `${queue.length} to work — Flo deals, you talk`}
        </span>
        {touchesToday !== null && (
          <span style={{ fontSize: 10, color: 'var(--c-fg-2)', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Your touches today: {touchesToday}
          </span>
        )}
      </div>

      {loading ? (
        <div className="c-sub" style={{ padding: 24, textAlign: 'center' }}>Loading…</div>
      ) : !current ? (
        <div style={{ padding: '36px 16px', textAlign: 'center' }}>
          <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 18, marginBottom: 6 }}>You're done.</div>
          <div className="c-sub">Every lead in the queue has been worked{touchesToday ? ` — ${touchesToday} touches today` : ''}. New inquiries will land here the moment they arrive.</div>
        </div>
      ) : (
        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* WHO */}
          <div className="c-well" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 20, letterSpacing: '-0.01em' }}>{name}</span>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-fg-2)' }}>{current.status}</span>
              {od > 0 && (
                <span style={{ padding: '2px 8px', borderRadius: 99, background: 'var(--c-st-hot)', color: 'var(--c-hot-text, #fff4f2)', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  overdue {od}d
                </span>
              )}
            </div>
            <div className="c-sub" style={{ marginTop: 4 }}>
              {[
                current.status === 'uncontacted' || !current.last_contact
                  ? `new · came in ${daysSince(current.created_at) === 0 ? 'today' : `${daysSince(current.created_at)}d ago`} via ${current.source || 'unknown'}`
                  : `last touch ${daysSince(current.last_contact)}d ago`,
                current.session_date ? `wants ${current.session_date}${current.session_end_date ? `–${current.session_end_date}` : ''}` : null,
                current.quote ? `quoted ${current.quote}` : current.rate_daily ? `${current.rate_daily}/day` : null,
                current.location || null,
              ].filter(Boolean).join(' · ')}
            </div>
            {current.notes && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--c-fg-2)', maxHeight: 60, overflowY: 'auto' }}>{current.notes}</div>
            )}
          </div>

          {/* THE PLAY */}
          <div className="c-well" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
              <PRSFloIcon size={16} />
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }}>Flo's play</span>
            </div>
            <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--c-fg-2)', marginBottom: 8 }}>{play.why}</div>
            <div style={{ fontSize: 14, lineHeight: 1.5, userSelect: 'text' }}>“{play.say}”</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                className="c-soft c-soft-sm c-control c-raised"
                onClick={() => { try { navigator.clipboard.writeText(play.say); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch {} }}
              >{copied ? 'Copied ✓' : 'Copy message'}</button>
              {telHref && <a className="c-soft c-soft-sm c-control c-raised" style={{ textDecoration: 'none' }} href={telHref} onClick={() => setMethod('call')}>Call {current.phone}</a>}
              {smsHref && <a className="c-soft c-soft-sm c-control c-raised" style={{ textDecoration: 'none' }} href={smsHref} onClick={() => setMethod('text')}>Text it</a>}
              {mailHref && <a className="c-soft c-soft-sm c-control c-raised" style={{ textDecoration: 'none' }} href={mailHref} onClick={() => setMethod('email')}>Email it</a>}
            </div>
          </div>

          {/* THE OUTCOME — the only decision is what happened. */}
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>
              What happened? (logged as {method})
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="c-soft c-control c-raised" style={outcomeBtn} disabled={busy} onClick={() => logOutcome('answered')}>Answered</button>
              <button className="c-soft c-control c-raised" style={outcomeBtn} disabled={busy} onClick={() => logOutcome('noanswer')}>No answer</button>
              <button className="c-soft c-control c-raised" style={outcomeBtn} disabled={busy} onClick={() => logOutcome('book')}>Wants to book</button>
              <button className="c-soft c-control c-raised" style={outcomeBtn} disabled={busy} onClick={() => logOutcome('notinterested')}>Not interested</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <button className="c-soft c-soft-sm c-control" style={{ color: 'var(--c-fg-3)' }} disabled={busy}
                onClick={() => current && setSkipped(prev => new Set(prev).add(current.id))}>
                Skip for now
              </button>
              <button className="c-soft c-soft-sm c-control" style={{ color: 'var(--c-fg-3)' }} disabled={busy}
                onClick={() => current && onOpenLead(current.id)}>
                Open full lead →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
