'use client'
// ─────────────────────────────────────────────────────────────────────────────
// ApProfilesSection — the label AP submission procedures, browsed and edited.
//
// SHAPE = THE ORG CHART (Eli, 2026-09-08: "broken up into majors with their
// subsidiaries under them and then the independent ones"). A major owns one or
// more procedures; its labels sit under whichever one they use. An independent
// is one label, one procedure.
//
// The first version was a flat 260px list of 26 procedure names, which forced
// the hierarchy into the NAME ("Sony — Arista / Alamo") and hid the labels
// entirely until you clicked. Laying the hierarchy out makes the fact that
// matters visible without a click: UMG is ONE procedure everyone shares, Sony
// is FOUR different ones. (It also had a real bug — the list buttons had no
// `display: block`, so they rendered inline and overlapped each other.)
//
// Vocabulary: these are CLIENTS, not "divisions". The mock said "+ add
// division" and Eli asked what it meant, which is the answer — it is jargon,
// and under Independents it means nothing at all.
//
// ⚠ NEVER ADD A PASSWORD FIELD. `credential_hint` is a pointer to where the
// password lives, not the password — see migration 20260908120000 (these
// portals hold our remittance bank details, and every table is copied to the
// Drive backup nightly).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { toast } from '@/components/ui/Toaster'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useClientsVersion } from '@/hooks/useClientsVersion'
import type { ApProfile, ApStep } from '@/components/billing/ApCard'

type LabelClient = { id: string; name: string; ap_profile_id: string | null }

/** `family` is the storage key; this is what a person calls it. 'Other' is
 *  INDEPENDENTS — a label with nobody above it, not a leftovers bucket. */
const FAMILY_ORDER = ['UMG', 'WMG', 'Sony'] as const
const FAMILY_NAME: Record<string, string> = {
  UMG: 'Universal Music Group',
  WMG: 'Warner Music Group',
  Sony: 'Sony Music',
  Other: 'Independents',
}
const FAMILIES = ['UMG', 'WMG', 'Sony', 'Other']
const METHODS = [
  { v: 'email', label: 'Email' },
  { v: 'portal', label: 'Portal' },
  { v: 'form', label: 'Web form' },
  { v: 'mixed', label: 'Mixed' },
]

const blank = (): Partial<ApProfile> => ({
  name: '', family: 'Other', submission_method: 'email', po_required: false,
  steps: [], is_global: false,
})

const isPortal = (m: string) => m === 'portal' || m === 'form' || m === 'mixed'

/** The name to show UNDER a major's heading. The stored names carry the family
 *  in their text ("Sony — Arista / Alamo") because the AP card shows them with
 *  no heading above — there, that context is the whole point. Here the heading
 *  already says Sony, so repeating it reads as a stutter. Display-only: the
 *  stored name is untouched, and the card keeps the long form. */
function shortName(p: ApProfile): string {
  const n = p.name
  if (n === FAMILY_NAME[p.family]) return 'Standard submission'
  const prefix = /^(Sony|Warner|Universal)\s+[—-]\s+/
  return n.replace(prefix, '')
}

// ── shared styles ────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 800, letterSpacing: '0.09em',
  textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 4, display: 'block',
}
const inp: React.CSSProperties = {
  width: '100%', background: 'var(--c-wash)', border: 'none', borderRadius: 9,
  padding: '8px 10px', color: 'var(--c-fg)', font: 'inherit', fontSize: 12.5,
}

function Pill({ tone, children }: { tone?: 'po' | 'nopo' | 'pay' | 'check'; children: React.ReactNode }) {
  const bg = tone === 'po' ? 'var(--c-st-warm)'
    : tone === 'pay' ? 'var(--c-st-booked)'
    : tone === 'check' ? 'var(--c-st-uncon)'
    : tone === 'nopo' ? 'rgba(207,214,212,.2)'
    : 'var(--c-wash2)'
  const ink = tone === 'po' || tone === 'pay' || tone === 'check' ? 'var(--c-chip-ink)' : 'var(--c-fg-2)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 99,
      fontSize: 10.5, fontWeight: 800, letterSpacing: '0.02em', background: bg, color: ink,
    }}>{children}</span>
  )
}

/** The at-a-glance row for a procedure — channel, PO discipline, how they pay. */
function ProcPills({ p }: { p: ApProfile }) {
  return (
    <>
      <Pill>{isPortal(p.submission_method) ? `🔐 ${p.portal_name || 'Portal'}` : '✉︎ Email'}</Pill>
      {p.po_required ? <Pill tone="po">PO required</Pill> : <Pill tone="nopo">No PO</Pill>}
      {p.payment_method && (
        <Pill tone={/check/i.test(p.payment_method) ? 'check' : 'pay'}>{p.payment_method}</Pill>
      )}
    </>
  )
}

export function ApProfilesSection() {
  const { profile: me } = useUserProfile()
  // Reads `clients`, so it watches the SHARED version counter — CLAUDE.md
  // forbids a second clients channel.
  const clientsVersion = useClientsVersion()
  const [rows, setRows] = useState<ApProfile[]>([])
  const [labels, setLabels] = useState<LabelClient[]>([])
  const [editing, setEditing] = useState<Partial<ApProfile> | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  /** Which procedure has its client picker open. One at a time — two open
   *  pickers on one screen is two places to type the same search. */
  const [picking, setPicking] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('ap_profiles').select('*').order('name')
    if (!dbResult('Loading AP procedures', error)) return
    setRows((data ?? []) as ApProfile[])
    const { data: cl, error: clErr } = await supabase
      // NO deleted_at filter — `clients` has no such column. PostgREST rejects
      // the whole query on an unknown column, which would show an empty list
      // with no error: "we have no clients" rather than "the query is broken".
      .from('clients').select('id, name, ap_profile_id').eq('type', 'label').order('name')
    dbResult('Loading clients', clErr, { silent: true })
    setLabels((cl ?? []) as LabelClient[])
  }, [])

  useEffect(() => { load() }, [load, clientsVersion])

  useEffect(() => {
    const ch = supabase.channel('ap-profiles-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ap_profiles' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const clientsFor = useCallback(
    (profileId: string) => labels.filter(l => l.ap_profile_id === profileId), [labels])

  /** Link or unlink one client. Optimistic: a save round-trip per tick is what
   *  makes someone abandon a 25-item job and go back to the spreadsheet. */
  const setLink = useCallback(async (clientId: string, profileId: string | null) => {
    setBusy(clientId)
    const before = labels
    setLabels(ls => ls.map(l => (l.id === clientId ? { ...l, ap_profile_id: profileId } : l)))
    const { error } = await supabase.from('clients').update({ ap_profile_id: profileId }).eq('id', clientId)
    setBusy(null)
    if (!dbResult('Linking client', error)) { setLabels(before); load() }
  }, [labels, load])

  const save = useCallback(async () => {
    if (!editing) return
    if (!editing.name?.trim()) { toast('A procedure needs a name', 'error'); return }
    const steps = (editing.steps ?? []).filter(s => (s.title ?? '').trim())
    const payload = {
      name: editing.name.trim(), family: editing.family ?? 'Other',
      submission_method: editing.submission_method ?? 'email',
      po_required: !!editing.po_required, po_notes: editing.po_notes || null,
      portal_name: editing.portal_name || null, portal_url: editing.portal_url || null,
      login_email: editing.login_email || null, credential_hint: editing.credential_hint || null,
      submit_to: editing.submit_to || null, cc_to: editing.cc_to || null,
      payment_method: editing.payment_method || null, steps,
      tips: editing.tips || null, updated_by: me?.id ?? null,
    }
    const { error } = editingId
      ? await supabase.from('ap_profiles').update(payload).eq('id', editingId)
      : await supabase.from('ap_profiles').insert(payload)
    if (!dbResult('Saving AP procedure', error)) return
    toast('Procedure saved', 'success')
    setEditing(null); setEditingId(null); load()
  }, [editing, editingId, me?.id, load])

  const byFamily = useMemo(() => {
    const m: Record<string, ApProfile[]> = {}
    for (const r of rows) {
      if (r.is_global) continue          // the general reference card is not a label
      ;(m[r.family] ??= []).push(r)
    }
    return m
  }, [rows])

  const unlinkedCount = labels.filter(l => !l.ap_profile_id).length

  // ── The editor takes the whole page — a form and a browse competing for one
  //    screen is what made the first version cramped. ──────────────────────────
  if (editing) {
    return (
      <ProcedureForm
        draft={editing}
        isNew={!editingId}
        onChange={setEditing}
        onSave={save}
        onCancel={() => { setEditing(null); setEditingId(null) }}
        sharedWith={editingId ? clientsFor(editingId).length : 0}
      />
    )
  }

  /** One procedure: its pills, its clients, and the picker. */
  const renderProc = (p: ApProfile, compact = false) => {
    const mine = clientsFor(p.id)
    const open = picking === p.id
    const addable = labels
      .filter(l => l.ap_profile_id !== p.id)
      .filter(l => !query || l.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 60)
    return (
      <div key={p.id} style={{
        background: compact ? 'var(--c-wash)' : 'rgba(242,239,231,.04)',
        borderRadius: 11, padding: '12px 14px', marginBottom: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>{compact ? p.name : shortName(p)}</span>
          <ProcPills p={p} />
          <button
            onClick={() => { setEditing({ ...p, steps: [...(p.steps ?? [])] }); setEditingId(p.id) }}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--c-fg-3)', cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 700 }}
          >Edit ›</button>
        </div>

        {/* Zero clients is the state that needs attention, so it is stated
            rather than rendered as an empty space. */}
        {mine.length === 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--c-st-warm)', marginTop: 9 }}>
            ⚠︎ No clients linked — invoices for this label show no AP button.
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 9 }}>
          {mine.map(c => (
            <span key={c.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5,
              background: 'var(--c-wash2)', borderRadius: 99, padding: '3px 5px 3px 10px', color: 'var(--c-fg-2)',
            }}>
              {c.name}
              <button
                onClick={() => setLink(c.id, null)}
                disabled={busy === c.id}
                title="Unlink"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-fg-3)', fontSize: 12, lineHeight: 1, padding: '0 2px' }}
              >×</button>
            </span>
          ))}
          <button
            onClick={() => { setPicking(open ? null : p.id); setQuery('') }}
            style={{
              fontSize: 11.5, border: '1px dashed var(--c-fg-3)', background: 'none',
              color: 'var(--c-fg-3)', borderRadius: 99, padding: '3px 10px', cursor: 'pointer', font: 'inherit',
            }}
          >{open ? '× close' : '+ add client'}</button>
        </div>

        {open && (
          <div style={{ marginTop: 10 }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search your label clients…"
              style={{ ...inp, marginBottom: 6 }}
            />
            <div style={{ maxHeight: 210, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {addable.length === 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--c-fg-3)' }}>
                  {query ? 'No label client matches that.' : 'Every label client is already linked here.'}
                </div>
              )}
              {addable.map(c => (
                <button
                  key={c.id}
                  onClick={() => setLink(c.id, p.id)}
                  disabled={busy === c.id}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'center', gap: 8, textAlign: 'left',
                    background: 'var(--c-wash2)', border: 'none', borderRadius: 8, padding: '7px 10px',
                    cursor: 'pointer', color: 'var(--c-fg)', font: 'inherit', fontSize: 12.5,
                  }}
                >
                  <span style={{ color: 'var(--c-st-booked)', fontWeight: 900 }}>+</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
                  {/* A client already pointing elsewhere is the one you must not
                      move by accident — name where it would come from. */}
                  {c.ap_profile_id && (
                    <span style={{ fontSize: 10, color: 'var(--c-st-warm)' }}>
                      moves from {rows.find(r => r.id === c.ap_profile_id)?.name ?? 'another'}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--c-fg-3)' }}>
          {rows.filter(r => !r.is_global).length} procedures · {labels.length - unlinkedCount} of {labels.length} label clients linked
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => { setEditing(blank()); setEditingId(null) }}
          className="c-btn" style={{ fontSize: 11.5 }}
        >+ New procedure</button>
      </div>

      {/* ── MAJORS ───────────────────────────────────────────────────────── */}
      <div style={{ ...lbl, marginBottom: 10 }}>Majors</div>
      {FAMILY_ORDER.map(fam => {
        const procs = byFamily[fam] ?? []
        if (procs.length === 0) return null
        const linked = procs.reduce((n, p) => n + clientsFor(p.id).length, 0)
        const shut = collapsed[fam]
        return (
          <div key={fam} style={{ background: 'var(--c-wash)', borderRadius: 14, marginBottom: 12, overflow: 'hidden' }}>
            <button
              onClick={() => setCollapsed(c => ({ ...c, [fam]: !shut }))}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--c-fg)', font: 'inherit',
              }}
            >
              <span className="c-arch" style={{ fontSize: 16 }}>{FAMILY_NAME[fam]}</span>
              <span style={{ fontSize: 11.5, color: 'var(--c-fg-3)' }}>
                {procs.length} procedure{procs.length === 1 ? '' : 's'} · {linked} client{linked === 1 ? '' : 's'}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-fg-3)' }}>{shut ? '▸' : '▾'}</span>
            </button>
            {!shut && <div style={{ padding: '0 16px 14px' }}>{procs.map(p => renderProc(p))}</div>}
          </div>
        )
      })}

      {/* ── INDEPENDENTS ─────────────────────────────────────────────────── */}
      <div style={{ ...lbl, margin: '26px 0 10px' }}>
        Independents — one label, one procedure
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8 }}>
        {(byFamily['Other'] ?? []).map(p => renderProc(p, true))}
      </div>

      {/* Unlinked clients are the work left to do, so the number is on screen
          rather than something you have to go and count. */}
      {unlinkedCount > 0 && (
        <div style={{ marginTop: 20, fontSize: 12, color: 'var(--c-fg-3)' }}>
          {unlinkedCount} label client{unlinkedCount === 1 ? '' : 's'} not linked to any procedure —
          their invoices show no AP button. Use “+ add client” above to place them.
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The procedure form. Unchanged in substance from the first version — it was
// the BROWSE that was wrong, not the editing.
// ─────────────────────────────────────────────────────────────────────────────
function ProcedureForm({
  draft, isNew, onChange, onSave, onCancel, sharedWith,
}: {
  draft: Partial<ApProfile>
  isNew: boolean
  onChange: (d: Partial<ApProfile>) => void
  onSave: () => void
  onCancel: () => void
  sharedWith: number
}) {
  const set = <K extends keyof ApProfile>(k: K, v: ApProfile[K]) => onChange({ ...draft, [k]: v })
  const steps = draft.steps ?? []
  const setStep = (i: number, patch: Partial<ApStep>) => {
    const next = [...steps]; next[i] = { ...next[i], ...patch }; onChange({ ...draft, steps: next })
  }
  const move = (i: number, by: number) => {
    const j = i + by; if (j < 0 || j >= steps.length) return
    const next = [...steps]; ;[next[i], next[j]] = [next[j], next[i]]; onChange({ ...draft, steps: next })
  }
  const field = (label: string, node: React.ReactNode) => (
    <div style={{ marginBottom: 10 }}><span style={lbl}>{label}</span>{node}</div>
  )

  return (
    <div style={{ maxWidth: 720 }}>
      <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--c-fg-3)', cursor: 'pointer', font: 'inherit', fontSize: 12, padding: 0, marginBottom: 12 }}>
        ‹ All procedures
      </button>

      {/* Editing a shared procedure changes it for every client on it — said
          before they type, not after. */}
      {sharedWith > 1 && (
        <div style={{ padding: '9px 11px', borderRadius: 9, marginBottom: 14, background: 'rgba(255,169,77,.14)', fontSize: 12 }}>
          ⚠︎ {sharedWith} clients share this procedure. Changes apply to all of them.
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>{field('Name', (
          <input style={inp} value={draft.name ?? ''} onChange={e => set('name', e.target.value)} />
        ))}</div>
        <div style={{ flex: '0 0 150px' }}>{field('Belongs to', (
          <select style={inp} value={draft.family ?? 'Other'} onChange={e => set('family', e.target.value)}>
            {FAMILIES.map(f => <option key={f} value={f}>{FAMILY_NAME[f]}</option>)}
          </select>
        ))}</div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>{field('Submission', (
          <select style={inp} value={draft.submission_method ?? 'email'} onChange={e => set('submission_method', e.target.value)}>
            {METHODS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
        ))}</div>
        <div style={{ flex: 1 }}>{field('Pays by', (
          <input style={inp} placeholder="ACH / Check in Mail / ACH via Bill.com"
            value={draft.payment_method ?? ''} onChange={e => set('payment_method', e.target.value)} />
        ))}</div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', marginBottom: 10 }}>
        <input type="checkbox" checked={!!draft.po_required} onChange={e => set('po_required', e.target.checked)} />
        PO required before sending
      </label>
      {field('PO notes', (
        <input style={inp} value={draft.po_notes ?? ''} onChange={e => set('po_notes', e.target.value)} />
      ))}

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>{field('Send to', (
          <input style={inp} value={draft.submit_to ?? ''} onChange={e => set('submit_to', e.target.value)} />
        ))}</div>
        <div style={{ flex: 1 }}>{field('Copy', (
          <input style={inp} value={draft.cc_to ?? ''} onChange={e => set('cc_to', e.target.value)} />
        ))}</div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>{field('Portal name', (
          <input style={inp} value={draft.portal_name ?? ''} onChange={e => set('portal_name', e.target.value)} />
        ))}</div>
        <div style={{ flex: 1 }}>{field('Portal URL', (
          <input style={inp} value={draft.portal_url ?? ''} onChange={e => set('portal_url', e.target.value)} />
        ))}</div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>{field('Login email', (
          <input style={inp} value={draft.login_email ?? ''} onChange={e => set('login_email', e.target.value)} />
        ))}</div>
        <div style={{ flex: 1 }}>{field('Where the password lives', (
          <input style={inp} placeholder="Locked note — ask Eli or billing"
            value={draft.credential_hint ?? ''} onChange={e => set('credential_hint', e.target.value)} />
        ))}</div>
      </div>
      {/* Said in the UI, not only in a migration comment: the person most likely
          to paste a password here is the one reading this form. */}
      <div style={{ fontSize: 11, color: 'var(--c-fg-3)', marginTop: -4, marginBottom: 14 }}>
        Never put an actual password in this field. These portals can redirect our payments,
        and every table is copied to the Drive backup each night.
      </div>

      {field('Watch out', (
        <textarea style={{ ...inp, minHeight: 54, resize: 'vertical' }}
          value={draft.tips ?? ''} onChange={e => set('tips', e.target.value)} />
      ))}

      <div style={{ ...lbl, marginTop: 14 }}>Steps</div>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
          <div style={{
            flex: '0 0 21px', height: 21, borderRadius: '50%', marginTop: 7,
            background: 'var(--c-fg)', color: 'var(--c-bg)', fontSize: 11, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{i + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input style={{ ...inp, marginBottom: 4, fontWeight: 700 }} placeholder="Short action — always visible"
              value={s.title ?? ''} onChange={e => setStep(i, { title: e.target.value })} />
            <textarea style={{ ...inp, minHeight: 46, resize: 'vertical' }} placeholder="Detail — collapsed behind “Show detail”"
              value={s.detail ?? ''} onChange={e => setStep(i, { detail: e.target.value })} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
            <button onClick={() => move(i, -1)} title="Move up" style={{ background: 'none', border: 'none', color: 'var(--c-fg-3)', cursor: 'pointer' }}>▲</button>
            <button onClick={() => move(i, 1)} title="Move down" style={{ background: 'none', border: 'none', color: 'var(--c-fg-3)', cursor: 'pointer' }}>▼</button>
            <button onClick={() => onChange({ ...draft, steps: steps.filter((_, j) => j !== i) })}
              title="Remove step" style={{ background: 'none', border: 'none', color: 'var(--c-st-hot)', cursor: 'pointer' }}>×</button>
          </div>
        </div>
      ))}
      <button onClick={() => onChange({ ...draft, steps: [...steps, { title: '', detail: '' }] })}
        className="c-btn" style={{ fontSize: 11.5, marginTop: 2 }}>+ Add step</button>

      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button onClick={onSave} className="c-btn"
          style={{ background: 'var(--c-fg)', color: 'var(--c-bg)', fontWeight: 800 }}>
          {isNew ? 'Create procedure' : 'Save'}
        </button>
        <button onClick={onCancel} className="c-btn">Cancel</button>
      </div>
    </div>
  )
}
