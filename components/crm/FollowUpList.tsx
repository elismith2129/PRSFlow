'use client'

// FOLLOW-UP LIST (owner + Eli, 2026-10-22/23 — v1.47.0).
// The owner: "a list of people that didn't book but that i think are
// potentials that we hit up once a week. say last 90 days."
// Mock + every ruling: docs/design-refs/follow-up-list-options.html (round 2, C1).
//
// WHAT IS ON IT: leads created 30 to 110 days ago that didn't book — cold and
// DNB included (ruled Oct 22). WINDOW (v1.47.2, Eli): "this list is so
// redundant … from 30 days ago to 110 days ago. this way it'll remove the
// leads that we are actively booking in the pipeline." Under 30 days a lead
// belongs to Needs Action. It drops off when it books (status booked, or it
// already became a work order) or ages past 110 days. Leasing is not a
// follow-up lead.
//
// ORDER: Unranked first ("so they don't fall through"), then 3 → 2 → 1. Inside
// a group: returning clients before new ones, then whoever has gone longest
// without a follow-up.
//
// THE RATING: one manual 1–3, size and seriousness folded together. Set on the
// new-lead form, the lead profile, or right here. No 0–100 score (ruled out).
//
// THE TICK = A FOLLOW-UP. It opens a small pop-up: How (Call / Text / Email,
// required), an optional one-line note, Save — which writes a lead_activity
// row (type 'followup') so it also lands in the lead's Activity. The pop-up
// shows the lead's whole activity thread underneath, since these people get
// hit up over years. "Done this week" = a follow-up since Monday; the row
// greys out and un-greys by itself next Monday. Red date = 7+ days, or never.
//
// COLOUR (C1): the lead's status colour as a bar down the left edge. The
// rating gets no colour of its own — warm/cold already mean something.
//
// Who: every office admin (owner / manager / billing / asst_manager) — the
// people who can already open the CRM. RLS on lead_activity matches.

import React, { useEffect, useState } from 'react'
import { supabase, Lead } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { useUserProfile } from '@/hooks/useUserProfile'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { AllStarMark } from '@/components/shared/AllStar'

export type FollowUpEntry = { initials: string; method: string; note: string; created_at: string }
export type FollowUpMap = Record<number, FollowUpEntry>

export const FOLLOW_UP_MIN_DAYS = 30
export const FOLLOW_UP_MAX_DAYS = 110
const OVERDUE_DAYS = 7
const DAY_MS = 86400000
const METHODS = ['Call', 'Text', 'Email'] as const
type Method = typeof METHODS[number]

const EDGE: Record<string, string> = {
  hot: 'var(--c-st-hot)',
  warm: 'var(--c-st-warm)',
  cold: 'var(--c-st-cold)',
  uncontacted: 'var(--c-st-uncon)',
  dead: 'var(--c-st-dead)',
}
const STATUS_WORD: Record<string, string> = { dead: 'DNB', uncontacted: 'New lead' }

/** "EL - Follow-up · Text - said maybe January" → its parts. */
export function parseFollowUpNote(note: string, created_at: string): FollowUpEntry {
  const parts = (note || '').split(' - ')
  return {
    initials: (parts[0] || '').trim(),
    method: (parts[1] || '').replace(/^Follow-up\s*·\s*/, '').trim(),
    note: parts.slice(2).join(' - ').trim(),
    created_at,
  }
}

export function isFollowUpLead(l: Lead, now = Date.now()): boolean {
  if (l.status === 'booked' || l.status === 'leasing') return false
  if (l.work_order_id) return false
  const created = new Date(l.created_at).getTime()
  if (!Number.isFinite(created)) return false
  const age = now - created
  return age >= FOLLOW_UP_MIN_DAYS * DAY_MS && age <= FOLLOW_UP_MAX_DAYS * DAY_MS
}

/** Monday 00:00, local time — the weekly tick resets here. */
function weekStart(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

const isReturning = (l: Lead) => !!l.client_id && !l.first_time

function leadName(l: Lead): string {
  const person = `${l.fname || ''} ${l.lname || ''}`.trim()
  if (l.label) return [l.label, person, l.artist_name].filter(Boolean).join(' / ')
  return [person || l.company, l.artist_name].filter(Boolean).join(' · ')
}

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS))
}

export function FollowUpList({ leads, followUps, selectedId, onSelect, onRate, onLogged, loading }: {
  leads: Lead[]
  followUps: FollowUpMap
  selectedId: number | null
  onSelect: (id: number) => void
  onRate: (id: number, rating: number | null) => void
  onLogged: () => Promise<void> | void
  loading: boolean
}) {
  const [popupId, setPopupId] = useState<number | null>(null)
  const monday = weekStart()
  const now = Date.now()

  const items = leads.filter(l => isFollowUpLead(l, now))
  const lastAt = (l: Lead) => (followUps[l.id] ? new Date(followUps[l.id].created_at).getTime() : 0)
  const doneThisWeek = (l: Lead) => lastAt(l) >= monday
  const sortGroup = (a: Lead, b: Lead) =>
    (isReturning(a) === isReturning(b) ? 0 : isReturning(a) ? -1 : 1) || lastAt(a) - lastAt(b) || a.id - b.id

  const groups: { key: string; title: string; hint?: string; rows: Lead[] }[] = [
    { key: 'u', title: 'Unranked', hint: "rate these so they don't fall through", rows: items.filter(l => !l.follow_rating).sort(sortGroup) },
    { key: '3', title: '3', rows: items.filter(l => l.follow_rating === 3).sort(sortGroup) },
    { key: '2', title: '2', rows: items.filter(l => l.follow_rating === 2).sort(sortGroup) },
    { key: '1', title: '1', rows: items.filter(l => l.follow_rating === 1).sort(sortGroup) },
  ]
  const done = items.filter(doneThisWeek).length
  const popupLead = popupId != null ? leads.find(l => l.id === popupId) || null : null

  return (
    <div className="c-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <SectionHeader carved title="Follow-up" count={items.length > 0 ? items.length : undefined} />
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--c-fg-2)', whiteSpace: 'nowrap' }}>
          {done} of {items.length} this week · leads {FOLLOW_UP_MIN_DAYS}–{FOLLOW_UP_MAX_DAYS} days old
        </span>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {loading ? (
          <div className="c-sub" style={{ padding: 20, textAlign: 'center' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div className="c-sub" style={{ padding: 20, textAlign: 'center' }}>No leads {FOLLOW_UP_MIN_DAYS}–{FOLLOW_UP_MAX_DAYS} days old to follow up.</div>
        ) : groups.map(g => g.rows.length === 0 ? null : (
          <React.Fragment key={g.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '12px 4px 4px 12px', fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: g.key === 'u' ? 'var(--c-st-hot)' : 'var(--c-fg-3)' }}>
              <span>{g.title}{g.hint && <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none', marginLeft: 6 }}>— {g.hint}</span>}</span>
              <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 400 }}>{g.rows.length}</span>
            </div>
            {g.rows.map(l => (
              <FollowUpRow
                key={l.id}
                lead={l}
                last={followUps[l.id]}
                done={doneThisWeek(l)}
                selected={selectedId === l.id}
                onSelect={() => onSelect(l.id)}
                onTick={() => setPopupId(l.id)}
                onRate={r => onRate(l.id, l.follow_rating === r ? null : r)}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
      {popupLead && (
        <FollowUpPopup
          lead={popupLead}
          onClose={() => setPopupId(null)}
          onSaved={async () => { setPopupId(null); await onLogged() }}
        />
      )}
    </div>
  )
}

function FollowUpRow({ lead, last, done, selected, onSelect, onTick, onRate }: {
  lead: Lead
  last?: FollowUpEntry
  done: boolean
  selected: boolean
  onSelect: () => void
  onTick: () => void
  onRate: (r: number) => void
}) {
  const days = last ? daysAgo(last.created_at) : null
  const overdue = days === null || days > OVERDUE_DAYS
  const sub = [
    STATUS_WORD[lead.status] || (lead.status ? lead.status[0].toUpperCase() + lead.status.slice(1) : ''),
    isReturning(lead) ? 'Returning' : 'New',
    last?.note || (lead.notes || '').split('\n')[0],
  ].filter(Boolean).join(' · ')
  return (
    <div
      onClick={onSelect}
      style={{ position: 'relative', display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) auto 64px', alignItems: 'center', gap: 10, padding: '8px 8px 8px 14px', borderRadius: 8, cursor: 'pointer', background: selected ? 'var(--c-wash)' : 'transparent' }}
    >
      <span aria-hidden style={{ position: 'absolute', left: 4, top: 7, bottom: 7, width: 3, borderRadius: 2, background: EDGE[lead.status] || 'var(--c-fg-3)', opacity: done ? 0.35 : 1 }} />
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onTick() }}
        title={done ? 'Followed up this week — log another' : 'Log a follow-up'}
        style={{ width: 18, height: 18, padding: 0, borderRadius: 4, cursor: 'pointer', display: 'grid', placeItems: 'center', border: `1.5px solid ${done ? 'var(--c-fg)' : 'var(--c-fg-3)'}`, background: done ? 'var(--c-fg)' : 'transparent', color: 'var(--c-bg)', fontSize: 11, lineHeight: 1 }}
      >{done ? '✓' : ''}</button>
      <div style={{ minWidth: 0, opacity: done ? 0.45 : 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <AllStarMark on={lead.all_star} />{leadName(lead)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--c-fg-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
      <FollowRating value={lead.follow_rating ?? null} onRate={onRate} />
      <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: overdue ? 'var(--c-st-hot)' : 'var(--c-fg-2)' }}>
          {days === null ? 'never' : days === 0 ? 'today' : `${days}d ago`}
        </div>
        <div style={{ fontSize: 10, color: 'var(--c-fg-3)', whiteSpace: 'nowrap' }}>
          {last ? [last.initials, last.method].filter(Boolean).join(' · ') : 'followed up'}
        </div>
      </div>
    </div>
  )
}

/** The three rating buttons — shared by the list, the lead profile and the new-lead form. */
export function FollowRating({ value, onRate, size = 'sm' }: {
  value: number | null
  onRate: (r: number) => void
  size?: 'sm' | 'lg'
}) {
  const lg = size === 'lg'
  return (
    <span style={{ display: 'inline-flex', gap: 4 }} onClick={e => e.stopPropagation()}>
      {[1, 2, 3].map(r => (
        <button
          key={r}
          type="button"
          onClick={() => onRate(r)}
          title={r === 3 ? '3 · big and real' : r === 2 ? '2 · maybe' : '1 · small or a long shot'}
          className={`c-soft c-soft-sm c-control${value === r ? ' c-on' : ''}`}
          style={{ minWidth: lg ? 0 : 26, padding: lg ? '6px 12px' : '2px 0', justifyContent: 'center', fontFamily: lg ? 'Inter' : "'DM Mono', monospace", fontSize: lg ? 11 : 11 }}
        >
          {lg ? (r === 3 ? '3 · big and real' : r === 2 ? '2 · maybe' : '1 · small / long shot') : r}
        </button>
      ))}
    </span>
  )
}

function FollowUpPopup({ lead, onClose, onSaved }: {
  lead: Lead
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const { profile } = useUserProfile()
  const initials = (profile?.initials || (profile?.display_name || '').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2)).toUpperCase()
  const [method, setMethod] = useState<Method | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [thread, setThread] = useState<Array<{ note: string; created_at: string; type: string }> | null>(null)

  useEffect(() => {
    let live = true
    supabase.from('lead_activity').select('note, created_at, type').eq('lead_id', lead.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!live) return
        if (!dbResult('Loading follow-up history', error)) { setThread([]); return }
        setThread(data || [])
      })
    return () => { live = false }
  }, [lead.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canSave = !!method && !!initials && !saving
  async function save() {
    if (!canSave) return
    setSaving(true)
    const text = note.trim()
    const line = `${initials} - Follow-up · ${method}${text ? ` - ${text}` : ''}`
    const { error } = await supabase.from('lead_activity').insert({ lead_id: lead.id, type: 'followup', note: line })
    setSaving(false)
    if (!dbResult('Logging follow-up', error)) return
    await onSaved()
  }

  const digits = (lead.phone || '').replace(/\D/g, '')
  const linkFor: Record<Method, string | undefined> = {
    Call: digits ? `tel:${digits}` : undefined,
    Text: digits ? `sms:${digits}` : undefined,
    Email: lead.email ? `mailto:${lead.email}` : undefined,
  }

  return (
    <div onClick={onClose} className="c-modal-backdrop" style={{ zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} className="c-sheet" style={{ width: 460, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px 8px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{leadName(lead)}</div>
            <div style={{ fontSize: 11, color: 'var(--c-fg-3)', marginTop: 2 }}>{[lead.phone, lead.email].filter(Boolean).join(' · ') || 'No phone or email on file'}</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', color: 'var(--c-fg-3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '8px 20px 14px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }}>How did you reach out?</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {METHODS.map(m => (
              <button key={m} type="button" onClick={() => setMethod(method === m ? null : m)} className={`c-soft c-control${method === m ? ' c-on' : ''}`} style={{ padding: '7px 16px', fontSize: 12 }}>{m}</button>
            ))}
            {method && linkFor[method] && (
              <a href={linkFor[method]} style={{ fontSize: 11, color: 'var(--c-fg-2)', marginLeft: 4, textDecoration: 'none' }}>
                → {method === 'Call' ? 'Dial' : method === 'Text' ? 'Text' : 'Mail'}
              </a>
            )}
          </div>
          <input
            className="c-input c-inset2"
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save() }}
            placeholder="Note (optional) — left VM, said maybe January…"
            style={{ width: '100%', padding: '9px 14px', borderRadius: 99, fontSize: 12 }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" onClick={save} disabled={!canSave} className="c-btn c-control" style={{ padding: '8px 22px', opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'not-allowed' }}>
              {saving ? 'Saving…' : 'Save follow-up'}
            </button>
            <button type="button" onClick={onClose} style={{ background: 'none', color: 'var(--c-fg-3)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            {initials && <span style={{ marginLeft: 'auto', fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--c-fg-3)' }}>as {initials}</span>}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--c-wash2)', padding: '10px 20px 16px', overflowY: 'auto', minHeight: 0, flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 6 }}>History</div>
          {thread === null ? (
            <div className="c-sub" style={{ padding: '8px 0' }}>Loading…</div>
          ) : thread.length === 0 ? (
            <div className="c-sub" style={{ padding: '8px 0' }}>Nothing logged yet.</div>
          ) : thread.map((t, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0,1fr)', gap: 10, padding: '6px 0', borderTop: i ? '1px solid var(--c-wash)' : 'none', fontSize: 12 }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--c-fg-3)' }}>
                {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <span style={{ color: t.type === 'followup' ? 'var(--c-fg)' : 'var(--c-fg-2)', wordBreak: 'break-word' }}>{t.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
