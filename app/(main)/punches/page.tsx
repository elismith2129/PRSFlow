'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /punches — the HR punch page (2026-08-14). Rail: HR → Punches.
//
// Three sections, top to bottom, in queue order:
//   1. QUEUE       pending requests — approve (with optional time adjust) or
//                  reject with a reason. Visible to all managers (HR-SPEC §5.6).
//   2. ENTER IN ADP  approved-but-not-entered, with the auto-composed ADP
//                  comment (HR-SPEC §5.5) and a copy button. Mark entered.
//   3. THE RECORD  per-person breakdown, trailing 90 days: how many misses,
//                  how they were reported, colour-coded green→red. COUNTS, NOT
//                  POINTS (Eli's ruling). A true % needs shift counts — that
//                  arrives with scheduling; until then the denominator line
//                  says so instead of faking one.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { dbResult } from '@/lib/db'
import { SectionHeader } from '@/components/ui/SectionHeader'
import {
  PunchRequest, REPORT_CLASS_LABEL, composeAdpComment, fromDbTime, missBand,
  punchTypeLabel, to24h, windowFloor,
} from '@/lib/punches'

// Same derivation MicInventorySection and OpenItemsSection use (their local
// copies) — initials column is the source of truth, display-name fallback.
function profileInitials(displayName: string | null | undefined): string {
  if (!displayName?.trim()) return ''
  const p = displayName.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

export default function PunchesPage() {
  const { profile } = useUserProfile()
  const [reqs, setReqs] = useState<PunchRequest[]>([])
  const [people, setPeople] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  // Per-request inline edits in the queue: adjusted time / reject reason.
  const [adjust, setAdjust] = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const canManage = profile?.role === 'owner' || profile?.role === 'manager'

  const load = useCallback(async () => {
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase
        .from('punch_correction_requests')
        .select('*')
        .order('submitted_at', { ascending: false }),
      supabase
        .from('user_profiles')
        .select('*')
        .is('deleted_at', null),
    ])
    setReqs((r ?? []) as PunchRequest[])
    setPeople((p ?? []) as UserProfile[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const channel = supabase
      .channel('punches-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'punch_correction_requests' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const nameOf = (id: string) => people.find(p => p.id === id)?.display_name ?? '—'
  const myInitials = profile?.initials || profileInitials(profile?.display_name ?? '') || 'MGR'

  async function review(r: PunchRequest, verdict: 'approve' | 'reject') {
    if (!profile) return
    let approved_time: string | null = null
    let status: PunchRequest['status'] = 'rejected'
    if (verdict === 'approve') {
      const typed = (adjust[r.id] ?? '').trim()
      if (typed) {
        const t = to24h(typed)
        if (!t) { alert('Adjusted time not understood — use a time like 6:00 PM.'); return }
        approved_time = t
        status = t === r.claimed_time.slice(0, 5) ? 'approved' : 'adjusted'
      } else {
        approved_time = r.claimed_time
        status = 'approved'
      }
    }
    const { error } = await supabase
      .from('punch_correction_requests')
      .update({
        status,
        approved_time,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        reviewer_note: verdict === 'reject' ? (rejectNote.trim() || null) : null,
      })
      .eq('id', r.id)
    if (!dbResult('Saving punch review', error)) return
    setRejecting(null); setRejectNote('')
    load()
  }

  async function markEntered(r: PunchRequest, comment: string) {
    const { error } = await supabase
      .from('punch_correction_requests')
      .update({ status: 'entered_in_adp', entered_at: new Date().toISOString(), adp_comment: comment })
      .eq('id', r.id)
    if (!dbResult('Marking entered in ADP', error)) return
    load()
  }

  function copyComment(r: PunchRequest) {
    const comment = composeAdpComment(r, myInitials)
    navigator.clipboard?.writeText(comment).then(() => {
      setCopiedId(r.id)
      setTimeout(() => setCopiedId(null), 1600)
    })
  }

  const pending = reqs.filter(r => r.status === 'pending')
  const toEnter = reqs.filter(r => r.status === 'approved' || r.status === 'adjusted')
  const floor = windowFloor()
  const inWindow = reqs.filter(r => r.shift_date >= floor && r.status !== 'rejected')

  // Per-person record: everyone with a request in the window, plus every
  // active non-owner staff member so clean records show as clean.
  const tracked = people
    .filter(p => p.role !== 'owner')
    .map(p => {
      const rows = inWindow.filter(r => r.staff_id === p.id)
      return {
        person: p,
        total: rows.length,
        sameDay: rows.filter(r => r.report_class === 'self_same_day').length,
        late: rows.filter(r => r.report_class === 'self_late').length,
        found: rows.filter(r => r.report_class === 'manager_found').length,
      }
    })
    .sort((a, b) => b.total - a.total || a.person.display_name.localeCompare(b.person.display_name))

  const card: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)',
    borderRadius: 18, padding: '14px 16px',
  }
  const well: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: 'var(--c-wash)', borderRadius: 10, padding: '4px 10px', minHeight: 34,
  }
  const btn = (primary = false): React.CSSProperties => ({
    padding: '7px 14px', minHeight: 34, borderRadius: 99,
    background: primary ? 'var(--c-wash2)' : 'var(--c-wash)',
    color: 'var(--c-fg)', border: 'none', font: 'inherit',
    fontSize: 12, fontWeight: 700, cursor: 'pointer',
  })

  if (!canManage) {
    return <div style={{ opacity: 0.55, fontSize: 13, padding: 20 }}>Punches are manager territory.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 860 }}>

      <div>
        <SectionHeader title="Punch queue" count={pending.length || undefined} countColor="orange" />
        {loading ? (
          <div style={{ ...card, opacity: 0.5 }}>Loading…</div>
        ) : pending.length === 0 ? (
          <div style={{ ...card, opacity: 0.5, fontSize: 13 }}>Nothing waiting. </div>
        ) : pending.map(r => (
          <div key={r.id} style={{ ...card, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <b style={{ fontSize: 14 }}>{nameOf(r.staff_id)}</b>
              <span style={{ fontSize: 12.5 }}>{punchTypeLabel(r.punch_type)} · {r.shift_date} · should say <b className="c-mono">{fromDbTime(r.claimed_time)}</b></span>
              {r.studio && <span style={{ fontSize: 11, opacity: 0.5 }}>{r.studio}</span>}
              <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 'auto' }}>{REPORT_CLASS_LABEL[r.report_class]}</span>
            </div>
            {r.employee_note && <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 8 }}>“{r.employee_note}”</div>}
            {rejecting === r.id ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ ...well, flex: 1, minWidth: 200 }}>
                  <input
                    value={rejectNote}
                    onChange={e => setRejectNote(e.target.value)}
                    placeholder="Reason (they'll see it)"
                    style={{ flex: 1, background: 'transparent', border: 'none', font: 'inherit', color: 'var(--c-fg)', outline: 'none', fontSize: 12.5 }}
                  />
                </span>
                <button style={btn(true)} onClick={() => review(r, 'reject')}>Reject</button>
                <button style={btn()} onClick={() => { setRejecting(null); setRejectNote('') }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={well}>
                  <span style={{ fontSize: 10, fontWeight: 800, opacity: 0.45, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Adjust</span>
                  <input
                    value={adjust[r.id] ?? ''}
                    onChange={e => setAdjust(a => ({ ...a, [r.id]: e.target.value }))}
                    placeholder={fromDbTime(r.claimed_time)}
                    style={{ width: 76, background: 'transparent', border: 'none', font: 'inherit', color: 'var(--c-fg)', outline: 'none', fontSize: 12.5 }}
                  />
                </span>
                <button style={btn(true)} onClick={() => review(r, 'approve')}>Approve</button>
                <button style={btn()} onClick={() => setRejecting(r.id)}>Reject…</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div>
        <SectionHeader title="Enter in ADP" count={toEnter.length || undefined} countColor="lime" />
        {toEnter.length === 0 ? (
          <div style={{ ...card, opacity: 0.5, fontSize: 13 }}>All caught up.</div>
        ) : toEnter.map(r => {
          const comment = composeAdpComment(r, myInitials)
          return (
            <div key={r.id} style={{ ...card, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <b style={{ fontSize: 14 }}>{nameOf(r.staff_id)}</b>
                <span style={{ fontSize: 12.5 }}>{punchTypeLabel(r.punch_type)} · {r.shift_date} · <b className="c-mono">{fromDbTime(r.approved_time ?? r.claimed_time)}</b></span>
                {r.status === 'adjusted' && <span className="c-pill c-fill-warm">adjusted</span>}
              </div>
              <div className="c-mono" style={{ fontSize: 12, background: 'var(--c-wash)', borderRadius: 10, padding: '8px 11px', marginBottom: 9 }}>
                {comment}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btn(true)} onClick={() => copyComment(r)}>
                  {copiedId === r.id ? 'Copied ✓' : 'Copy comment'}
                </button>
                <button style={btn()} onClick={() => markEntered(r, comment)}>Entered in ADP ✓</button>
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <SectionHeader title="The record · last 90 days" />
        <div style={card}>
          <div style={{ fontSize: 11, opacity: 0.45, marginBottom: 10, lineHeight: 1.5 }}>
            Counts, not points. Green is a clean record; the number is misses in
            the window. Percentages arrive when scheduling does — until the app
            knows how many shifts someone worked, a percentage would be a guess.
          </div>
          {tracked.map((t, i) => {
            const band = missBand(t.total)
            return (
              <div key={t.person.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
                boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
              }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: band.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.person.display_name}
                  <span style={{ fontSize: 10.5, fontWeight: 400, opacity: 0.45, marginLeft: 7 }}>{t.person.role}</span>
                </div>
                {t.total > 0 && (
                  <span style={{ fontSize: 11, opacity: 0.55, flexShrink: 0 }}>
                    {t.sameDay > 0 && `${t.sameDay} same-day`}
                    {t.late > 0 && `${t.sameDay > 0 ? ' · ' : ''}${t.late} late`}
                    {t.found > 0 && `${(t.sameDay > 0 || t.late > 0) ? ' · ' : ''}${t.found} mgr-found`}
                  </span>
                )}
                <span style={{ fontSize: 12, fontWeight: 800, color: band.color, flexShrink: 0, minWidth: 64, textAlign: 'right' }}>
                  {band.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
