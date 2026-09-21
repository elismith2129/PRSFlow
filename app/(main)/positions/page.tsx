'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /positions — the job titles and what each one carries (2026-09-21).
// Rail: ADMIN → Positions, beside Rates. Owner + manager.
//
// Eli: "billing coordinator is not supervisory. but i think we should be able
// to set things like that in the app." So: one row per title — supervisory
// or not, vacation days a year, usual hours a week, who it reports to, which
// PRSFlo role it maps to, and the job description text. The hiring case
// reads all of it: the checklist adds the supervisory rows only when the
// position supervises, the offer letter fills vacation and hours from here,
// and the JD it sends is this text. Edited rarely, read every time.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { dbResult } from '@/lib/db'
import { toast } from '@/components/ui/Toaster'
import { SectionHeader } from '@/components/ui/SectionHeader'
import type { HrPosition } from '@/lib/hrCases'

const ROLES: NonNullable<HrPosition['prsflo_role']>[] = ['manager', 'billing', 'asst_manager', 'tech', 'runner', 'owner']
const ROLE_LABEL: Record<NonNullable<HrPosition['prsflo_role']>, string> = {
  owner: 'Owner', manager: 'Manager', billing: 'Billing', asst_manager: 'Asst. manager', tech: 'Tech', runner: 'Runner',
}

const panel: React.CSSProperties = { background: 'var(--c-srf)', boxShadow: 'var(--c-softsh)', borderRadius: 16, padding: '14px 18px' }
const fL: React.CSSProperties = { display: 'block', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.11em', textTransform: 'uppercase', opacity: 0.45, marginBottom: 4 }
const muted: React.CSSProperties = { fontSize: 11.5, color: 'var(--c-fg-3)', lineHeight: 1.5 }

type Draft = Omit<HrPosition, 'id' | 'sort_order'> & { id?: string }

const EMPTY: Draft = {
  title: '', is_supervisory: false, vacation_days: 0, default_hours_week: null, reports_to: 'Studio Manager',
  prsflo_role: null, jd_body: '', jd_is_draft: true, is_active: true,
}

export default function PositionsPage() {
  const { profile } = useUserProfile()
  const [rows, setRows] = useState<HrPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const canManage = profile?.role === 'owner' || profile?.role === 'manager'

  const load = useCallback(async () => {
    const { data } = await supabase.from('hr_positions').select('*').order('sort_order').order('title')
    setRows((data ?? []) as HrPosition[])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = supabase.channel('positions-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hr_positions' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  async function save() {
    if (!editing) return
    if (!editing.title.trim()) { toast('The position needs a title.', 'error'); return }
    setSaving(true)
    const payload = {
      title: editing.title.trim(),
      is_supervisory: editing.is_supervisory,
      vacation_days: Number(editing.vacation_days) || 0,
      default_hours_week: editing.default_hours_week ? Number(editing.default_hours_week) : null,
      reports_to: editing.reports_to?.trim() || null,
      prsflo_role: editing.prsflo_role,
      jd_body: editing.jd_body?.trim() || null,
      jd_is_draft: editing.jd_is_draft,
      is_active: editing.is_active,
    }
    const q = editing.id
      ? supabase.from('hr_positions').update(payload).eq('id', editing.id)
      : supabase.from('hr_positions').insert({ ...payload, sort_order: (rows[rows.length - 1]?.sort_order ?? 90) + 10 })
    const { error } = await q
    setSaving(false)
    if (!dbResult('Saving the position', error)) return
    toast(`${payload.title} saved.`)
    setEditing(null)
    load()
  }

  if (!canManage) return <div style={{ opacity: 0.55, fontSize: 13, padding: 20 }}>Positions are manager territory.</div>

  const e = editing
  const set = (patch: Partial<Draft>) => setEditing(d => (d ? { ...d, ...patch } : d))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 820 }}>
      <div className="c-panel" style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
          <SectionHeader title="Positions" />
          {!e && <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" onClick={() => setEditing({ ...EMPTY })} style={{ fontSize: 11 }}>+ Add position</button>}
        </div>
        <div style={{ ...muted, marginBottom: 10 }}>
          What each job title carries. Hiring reads this: a <b>supervisory</b> position adds the 2-hour harassment course and the ADP Manager flag to the checklist; vacation and hours go straight onto the offer letter; the job description is what gets sent for signature.
        </div>

        {loading ? <div style={muted}>Loading…</div> : rows.map((r, i) => (
          <div key={r.id} role="button" tabIndex={0} onClick={() => setEditing({ ...r })} style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '2px 14px', padding: '9px 0', cursor: 'pointer', alignItems: 'center',
            boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined, opacity: r.is_active ? 1 : 0.45,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13.5 }}>{r.title}</b>
                {r.is_supervisory && <span className="c-pill c-fill-warm">Supervisory</span>}
                {r.prsflo_role && <span style={{ fontSize: 10.5, opacity: 0.55 }}>PRSFlo: {ROLE_LABEL[r.prsflo_role]}</span>}
                {!r.is_active && <span className="c-pill" style={{ background: 'var(--c-wash2)', color: 'var(--c-fg)' }}>Retired</span>}
              </div>
              <div style={{ ...muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.vacation_days > 0 ? `${r.vacation_days} vacation days / yr` : 'No vacation allotment'}
                {r.default_hours_week ? ` · usually ${r.default_hours_week} hrs / wk` : ''}
                {r.reports_to ? ` · reports to ${r.reports_to}` : ''}
                {r.jd_body ? (r.jd_is_draft ? ' · JD is a draft' : ' · JD on file') : ' · no JD yet'}
              </div>
            </div>
            <span style={{ ...muted, fontSize: 10.5 }}>Edit</span>
          </div>
        ))}
      </div>

      {e && (
        <div className="c-panel" style={panel}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <SectionHeader title={e.id ? `Edit · ${e.title}` : 'New position'} />
            <button type="button" className="c-control c-soft c-raised-chip" onClick={() => setEditing(null)} style={{ fontSize: 10 }}>Cancel</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px 12px' }}>
            <div style={{ gridColumn: '1 / -1' }}><label style={fL}>Title</label>
              <input className="c-input c-inset2" value={e.title} onChange={ev => set({ title: ev.target.value })} placeholder="Studio Manager" autoFocus /></div>
            <div>
              <label style={fL}>Does this position supervise anyone?</label>
              <div className="c-seg">
                <button type="button" className={!e.is_supervisory ? 'c-on' : ''} onClick={() => set({ is_supervisory: false })}>No</button>
                <button type="button" className={e.is_supervisory ? 'c-on c-fill-warm' : ''} onClick={() => set({ is_supervisory: true })}>Yes</button>
              </div>
              <div style={{ ...muted, fontSize: 10.5, marginTop: 4 }}>Yes = 2-hour harassment course within 6 months and the ADP Manager flag. No = the 1-hour course.</div>
            </div>
            <div><label style={fL}>Vacation days per year</label>
              <input className="c-input c-inset2" type="number" step="0.5" min="0" value={e.vacation_days} onChange={ev => set({ vacation_days: Number(ev.target.value) })} />
              <div style={{ ...muted, fontSize: 10.5, marginTop: 4 }}>Front-loaded Jan 1; prorated on promotion or hire. A day is 8 hours.</div></div>
            <div><label style={fL}>Usual hours per week</label>
              <input className="c-input c-inset2" type="number" min="0" value={e.default_hours_week ?? ''} onChange={ev => set({ default_hours_week: ev.target.value ? Number(ev.target.value) : null })} placeholder="40" /></div>
            <div><label style={fL}>Reports to</label>
              <input className="c-input c-inset2" value={e.reports_to ?? ''} onChange={ev => set({ reports_to: ev.target.value })} placeholder="Studio Manager" /></div>
            <div><label style={fL}>PRSFlo role</label>
              <select className="c-input c-inset2" value={e.prsflo_role ?? ''} onChange={ev => set({ prsflo_role: (ev.target.value || null) as HrPosition['prsflo_role'] })}>
                <option value="">—</option>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <div style={{ ...muted, fontSize: 10.5, marginTop: 4 }}>What their login can see once they're in this position.</div></div>
            <div>
              <label style={fL}>Still in use?</label>
              <div className="c-seg">
                <button type="button" className={e.is_active ? 'c-on' : ''} onClick={() => set({ is_active: true })}>Yes</button>
                <button type="button" className={!e.is_active ? 'c-on' : ''} onClick={() => set({ is_active: false })}>Retired</button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <label style={{ ...fL, marginBottom: 0 }}>Job description</label>
              <div className="c-seg c-seg-tiny" style={{ marginLeft: 'auto' }}>
                <button type="button" className={e.jd_is_draft ? 'c-on c-fill-warm' : ''} onClick={() => set({ jd_is_draft: true })}>Draft</button>
                <button type="button" className={!e.jd_is_draft ? 'c-on' : ''} onClick={() => set({ jd_is_draft: false })}>Final</button>
              </div>
            </div>
            <textarea className="c-area" value={e.jd_body ?? ''} onChange={ev => set({ jd_body: ev.target.value })} rows={14}
              placeholder={'Position Title: …\nReports to: …\n\nPosition Overview\n…\n\nKey Responsibilities\n• …'}
              style={{ width: '100%', fontSize: 12, lineHeight: 1.55, minHeight: 220 }} />
            <div style={{ ...muted, fontSize: 10.5, marginTop: 4 }}>This is the text that goes out for signature from a hiring case. Plain text — a line starting with • is a bullet. Mark it Final once you've read it through; a Draft still sends, but the case will say so.</div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" disabled={saving} onClick={save} style={{ fontSize: 11.5, minHeight: 36 }}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="c-control c-soft c-raised-chip" onClick={() => setEditing(null)} style={{ fontSize: 10 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
