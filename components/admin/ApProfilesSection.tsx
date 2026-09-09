'use client'
// ─────────────────────────────────────────────────────────────────────────────
// ApProfilesSection — edit the label AP submission procedures.
//
// The procedures were seeded from the AP structure spreadsheet, but AP contacts,
// portals and PO rules change constantly and the person who knows is billing,
// not whoever is holding a terminal. Without this, every correction is a
// migration — which means it does not happen, and the card slowly starts lying
// to the new hire it was built for. That is the failure mode this prevents.
//
// Write access is billing + manager + owner (the ap_profiles RLS policies); the
// UI does not re-check, it lets the policy refuse. Delete is owner-only, and is
// deliberately absent here: a procedure with clients linked to it should be
// corrected, not deleted, and unlinking happens on the client.
//
// ⚠ NEVER ADD A PASSWORD FIELD. `credential_hint` is a pointer to where the
// password lives, not the password — see migration 20260908120000 for the
// reasoning (these portals hold our remittance bank details, and every table is
// copied to a Drive backup nightly).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { toast } from '@/components/ui/Toaster'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useClientsVersion } from '@/hooks/useClientsVersion'
import type { ApProfile, ApStep } from '@/components/billing/ApCard'

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

export function ApProfilesSection() {
  const { profile: me } = useUserProfile()
  // This panel reads `clients`, so it must react to client changes — via the
  // SHARED version counter, never a second clients channel (CLAUDE.md).
  const clientsVersion = useClientsVersion()
  const [rows, setRows] = useState<ApProfile[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<ApProfile> | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  /** Every label client, with its current link. The linking panel works off
   *  this rather than a query per procedure — there are a few hundred clients
   *  at most, and one fetch keeps the counts and the panel from disagreeing. */
  const [labels, setLabels] = useState<{ id: string; name: string; ap_profile_id: string | null }[]>([])
  const [clientQuery, setClientQuery] = useState('')
  const [linking, setLinking] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('ap_profiles').select('*').order('family').order('name')
    if (!dbResult('Loading AP procedures', error)) return
    setRows((data ?? []) as ApProfile[])
    // How many clients use each procedure — editing a shared one touches every
    // division that inherits it, and the editor should say so before you type.
    const { data: cl } = await supabase
      .from('clients')
      .select('id, name, ap_profile_id')
      // NO deleted_at filter — `clients` has no such column (verified against
      // the Client interface, 2026-09-08). PostgREST rejects the whole query on
      // an unknown column, so this would have returned an empty list with no
      // visible error: the linking panel would just look like you have no
      // clients. Soft delete lives on leads and tasks, not here.
      .eq('type', 'label')
      .order('name')
    const rows = (cl ?? []) as { id: string; name: string; ap_profile_id: string | null }[]
    setLabels(rows)
    const c: Record<string, number> = {}
    for (const r of rows) if (r.ap_profile_id) c[r.ap_profile_id] = (c[r.ap_profile_id] ?? 0) + 1
    setCounts(c)
  }, [])

  useEffect(() => { load() }, [load, clientsVersion])

  // Standing rule: every fetch pairs with a realtime subscription.
  useEffect(() => {
    const ch = supabase.channel('ap-profiles-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ap_profiles' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const open = (r: ApProfile) => { setSel(r.id); setDraft({ ...r, steps: [...(r.steps ?? [])] }) }
  const openNew = () => { setSel('new'); setDraft(blank()) }

  const set = <K extends keyof ApProfile>(k: K, v: ApProfile[K]) =>
    setDraft(d => (d ? { ...d, [k]: v } : d))

  const setStep = (i: number, patch: Partial<ApStep>) =>
    setDraft(d => {
      if (!d) return d
      const steps = [...(d.steps ?? [])]
      steps[i] = { ...steps[i], ...patch }
      return { ...d, steps }
    })

  const moveStep = (i: number, by: number) =>
    setDraft(d => {
      if (!d) return d
      const steps = [...(d.steps ?? [])]
      const j = i + by
      if (j < 0 || j >= steps.length) return d
      ;[steps[i], steps[j]] = [steps[j], steps[i]]
      return { ...d, steps }
    })

  const save = useCallback(async () => {
    if (!draft) return
    if (!draft.name?.trim()) { toast('A procedure needs a name', 'error'); return }
    setSaving(true)
    // Drop steps with no title — an empty row would render as a numbered blank
    // on the card, which reads as a missing instruction rather than nothing.
    const steps = (draft.steps ?? []).filter(s => (s.title ?? '').trim())
    const payload = {
      name: draft.name.trim(),
      family: draft.family ?? 'Other',
      submission_method: draft.submission_method ?? 'email',
      po_required: !!draft.po_required,
      po_notes: draft.po_notes || null,
      portal_name: draft.portal_name || null,
      portal_url: draft.portal_url || null,
      login_email: draft.login_email || null,
      credential_hint: draft.credential_hint || null,
      submit_to: draft.submit_to || null,
      cc_to: draft.cc_to || null,
      payment_method: draft.payment_method || null,
      steps,
      tips: draft.tips || null,
      updated_by: me?.id ?? null,
    }
    const { error } = sel === 'new'
      ? await supabase.from('ap_profiles').insert(payload)
      : await supabase.from('ap_profiles').update(payload).eq('id', sel!)
    setSaving(false)
    if (!dbResult('Saving AP procedure', error)) return
    toast('Procedure saved', 'success')
    setSel(null); setDraft(null); load()
  }, [draft, sel, me?.id, load])

  /** Point a client at this procedure, or clear it. One row at a time and
   *  optimistic, because the list is long and a save-button round trip per tick
   *  is what makes people give up halfway and go back to the spreadsheet. */
  const setClientLink = useCallback(async (clientId: string, profileId: string | null) => {
    setLinking(clientId)
    const before = labels
    setLabels(ls => ls.map(l => (l.id === clientId ? { ...l, ap_profile_id: profileId } : l)))
    setCounts(c => {
      const next = { ...c }
      const prev = before.find(l => l.id === clientId)?.ap_profile_id
      if (prev) next[prev] = Math.max(0, (next[prev] ?? 1) - 1)
      if (profileId) next[profileId] = (next[profileId] ?? 0) + 1
      return next
    })
    const { error } = await supabase
      .from('clients').update({ ap_profile_id: profileId }).eq('id', clientId)
    setLinking(null)
    if (!dbResult('Linking client', error)) { setLabels(before); load() }
  }, [labels, load])

  // Split the client list around the open procedure. `addable` deliberately
  // INCLUDES clients linked elsewhere (flagged in the row) rather than hiding
  // them — a division moving between procedures is a real edit, and hiding it
  // would leave someone hunting for a client that is right there.
  const linkedHere = labels.filter(l => l.ap_profile_id === sel)
  const addable = labels
    .filter(l => l.ap_profile_id !== sel)
    .filter(l => !clientQuery || l.name.toLowerCase().includes(clientQuery.toLowerCase()))
    .slice(0, 200)

  // ── styles (carved tokens, inline per house convention) ────────────────────
  const wrap: React.CSSProperties = { display: 'flex', gap: 16, alignItems: 'flex-start' }
  const listS: React.CSSProperties = { flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 4 }
  const itemS = (on: boolean): React.CSSProperties => ({
    textAlign: 'left', padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
    background: on ? 'var(--c-wash2)' : 'var(--c-wash)', border: 'none',
    color: 'var(--c-fg)', font: 'inherit', fontSize: 12.5,
  })
  const lbl: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 4, display: 'block',
  }
  const inp: React.CSSProperties = {
    width: '100%', background: 'var(--c-wash)', border: 'none', borderRadius: 9,
    padding: '8px 10px', color: 'var(--c-fg)', font: 'inherit', fontSize: 12.5,
  }
  const field = (label: string, node: React.ReactNode) => (
    <div style={{ marginBottom: 10 }}><span style={lbl}>{label}</span>{node}</div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ ...lbl, marginBottom: 0 }}>AP submission procedures</div>
        <div style={{ flex: 1 }} />
        <button onClick={openNew} className="c-btn" style={{ fontSize: 11.5 }}>+ New procedure</button>
      </div>

      <div style={wrap}>
        <div style={listS}>
          {FAMILIES.concat('Global').map(fam => {
            const inFam = rows.filter(r => (r.is_global ? 'Global' : r.family) === fam)
            if (inFam.length === 0) return null
            return (
              <div key={fam} style={{ marginBottom: 6 }}>
                <div style={{ ...lbl, marginTop: 6 }}>{fam}</div>
                {inFam.map(r => (
                  <button key={r.id} onClick={() => open(r)} style={itemS(sel === r.id)}>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--c-fg-3)' }}>
                      {r.is_global
                        ? 'Shown under every label'
                        : `${counts[r.id] ?? 0} client${(counts[r.id] ?? 0) === 1 ? '' : 's'}`}
                    </div>
                  </button>
                ))}
              </div>
            )
          })}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {!draft ? (
            <div style={{ color: 'var(--c-fg-3)', fontSize: 12.5, padding: '10px 0' }}>
              Pick a procedure to edit, or add one. Clients are linked to a procedure
              on the client profile, not here.
            </div>
          ) : (
            <>
              {/* Editing a shared procedure changes it for every division that
                  inherits it — say so before they type, not after. */}
              {sel !== 'new' && (counts[sel!] ?? 0) > 1 && (
                <div style={{
                  padding: '9px 11px', borderRadius: 9, marginBottom: 12,
                  background: 'rgba(255,169,77,.14)', fontSize: 12,
                }}>
                  ⚠︎ {counts[sel!]} clients share this procedure. Changes apply to all of them.
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>{field('Name', (
                  <input style={inp} value={draft.name ?? ''} onChange={e => set('name', e.target.value)} />
                ))}</div>
                <div style={{ flex: '0 0 120px' }}>{field('Family', (
                  <select style={inp} value={draft.family ?? 'Other'} onChange={e => set('family', e.target.value)}>
                    {FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
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

              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!draft.po_required}
                    onChange={e => set('po_required', e.target.checked)} />
                  PO required before sending
                </label>
              </div>
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
              {/* Stated in the UI, not only in a migration comment: the person
                  most likely to paste a password here is the one reading this. */}
              <div style={{ fontSize: 11, color: 'var(--c-fg-3)', marginTop: -4, marginBottom: 12 }}>
                Never put an actual password in this field. These portals can redirect our
                payments, and every table is copied to the Drive backup each night.
              </div>

              {field('Watch out', (
                <textarea style={{ ...inp, minHeight: 54, resize: 'vertical' }}
                  value={draft.tips ?? ''} onChange={e => set('tips', e.target.value)} />
              ))}

              {/* ── Steps ─────────────────────────────────────────────────── */}
              <div style={{ ...lbl, marginTop: 14 }}>Steps</div>
              {(draft.steps ?? []).map((s, i) => (
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
                    <button onClick={() => moveStep(i, -1)} title="Move up"
                      style={{ background: 'none', border: 'none', color: 'var(--c-fg-3)', cursor: 'pointer' }}>▲</button>
                    <button onClick={() => moveStep(i, 1)} title="Move down"
                      style={{ background: 'none', border: 'none', color: 'var(--c-fg-3)', cursor: 'pointer' }}>▼</button>
                    <button
                      onClick={() => setDraft(d => d ? { ...d, steps: (d.steps ?? []).filter((_, j) => j !== i) } : d)}
                      title="Remove step"
                      style={{ background: 'none', border: 'none', color: 'var(--c-st-hot)', cursor: 'pointer' }}>×</button>
                  </div>
                </div>
              ))}
              <button
                onClick={() => setDraft(d => d ? { ...d, steps: [...(d.steps ?? []), { title: '', detail: '' }] } : d)}
                className="c-btn" style={{ fontSize: 11.5, marginTop: 2 }}
              >+ Add step</button>

              <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                <button onClick={save} disabled={saving} className="c-btn"
                  style={{ background: 'var(--c-fg)', color: 'var(--c-bg)', fontWeight: 800 }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => { setSel(null); setDraft(null) }} className="c-btn">Cancel</button>
              </div>

              {/* ── WHICH CLIENTS USE THIS ────────────────────────────────────
                  Linking used to be one client at a time on the client profile,
                  which meant 25 page visits — or a 50-line SQL statement, which
                  is what actually happened (Eli, 2026-09-08: "this will help
                  immensely"). Both panes are here so the answer to "did I get
                  them all" is on screen, not in a query.
                  Only for a SAVED procedure: a new one has no id to link to. */}
              {sel !== 'new' && (
                <div style={{ marginTop: 22, borderTop: '1px solid var(--c-wash2)', paddingTop: 16 }}>
                  <div style={lbl}>Clients using this procedure</div>

                  {linkedHere.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--c-fg-3)', marginBottom: 10 }}>
                      None yet — add them from the list below. Until a client is linked,
                      its invoices show no AP button.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                      {linkedHere.map(c => (
                        <span key={c.id} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
                          background: 'var(--c-wash2)', borderRadius: 99, padding: '4px 6px 4px 11px',
                        }}>
                          {c.name}
                          <button
                            onClick={() => setClientLink(c.id, null)}
                            disabled={linking === c.id}
                            title="Unlink"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-fg-3)', fontSize: 13, lineHeight: 1, padding: '0 2px' }}
                          >×</button>
                        </span>
                      ))}
                    </div>
                  )}

                  <input
                    value={clientQuery}
                    onChange={e => setClientQuery(e.target.value)}
                    placeholder="Search label clients to add…"
                    style={{ ...inp, marginBottom: 8 }}
                  />
                  <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {addable.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--c-fg-3)' }}>
                        {clientQuery ? 'No label client matches that.' : 'Every label client is already linked.'}
                      </div>
                    )}
                    {addable.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setClientLink(c.id, sel!)}
                        disabled={linking === c.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                          background: 'var(--c-wash)', border: 'none', borderRadius: 8,
                          padding: '7px 10px', cursor: 'pointer', color: 'var(--c-fg)',
                          font: 'inherit', fontSize: 12.5,
                        }}
                      >
                        <span style={{ color: 'var(--c-st-booked)', fontWeight: 900 }}>+</span>
                        <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
                        {/* A client already pointing somewhere else is the one
                            you must not reassign by accident — say where. */}
                        {c.ap_profile_id && (
                          <span style={{ fontSize: 10.5, color: 'var(--c-st-warm)' }}>
                            moves from {rows.find(r => r.id === c.ap_profile_id)?.name ?? 'another'}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
