'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Engineer, EngineerRole } from '@/lib/supabase'

const ROLE_OPTIONS: EngineerRole[] = ['Engineer', 'Assistant', 'Both']

const ROLE_COLORS: Record<EngineerRole, string> = {
  Engineer: '#f0a24e',
  Assistant: '#f04e7a',
  Both: '#c8f04e',
}

const inp: React.CSSProperties = {
  background: '#1a1d27', border: '1px solid #2a2e3d', color: '#e8eaf2',
  fontFamily: 'DM Mono', fontSize: 11, padding: '6px 10px', borderRadius: 4,
  width: '100%', outline: 'none',
}

const labelS: React.CSSProperties = {
  fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: '#4a4f64', display: 'block', marginBottom: 4,
}

function autoInitials(first: string, last: string): string {
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase()
}

type FormState = {
  first_name: string
  last_name: string
  role: EngineerRole
  email: string
  phone: string
}

function emptyForm(): FormState {
  return { first_name: '', last_name: '', role: 'Engineer', email: '', phone: '' }
}

function EngModal({
  eng, onClose, onSave,
}: {
  eng: Engineer | null
  onClose: () => void
  onSave: () => void
}) {
  const [form, setForm] = useState<FormState>(
    eng ? { first_name: eng.first_name, last_name: eng.last_name, role: eng.role, email: eng.email ?? '', phone: eng.phone ?? '' } : emptyForm()
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleSave() {
    if (!form.first_name.trim() || !form.last_name.trim()) { setError('First and last name required'); return }
    setSaving(true)
    setError(null)
    const payload = {
      ...form,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      initials: autoInitials(form.first_name.trim(), form.last_name.trim()),
    }
    const { error: err } = eng
      ? await supabase.from('engineers').update(payload).eq('id', eng.id)
      : await supabase.from('engineers').insert({ ...payload, active: true })
    if (err) { setError(err.message); setSaving(false); return }
    onSave()
    onClose()
  }

  const initials = autoInitials(form.first_name, form.last_name)
  const roleColor = ROLE_COLORS[form.role]

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#13161e', border: '1px solid #2a2e3d', borderRadius: 8, width: '100%', maxWidth: 400, overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #2a2e3d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: '#e8eaf2' }}>
            {eng ? 'Edit Engineer' : 'Add Engineer'}
          </div>
          {initials && (
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: roleColor + '22', border: `1px solid ${roleColor}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Syne', fontWeight: 800, fontSize: 12, color: roleColor }}>
              {initials}
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelS}>First Name</label>
              <input value={form.first_name} onChange={e => set('first_name', e.target.value)} style={inp} autoFocus />
            </div>
            <div>
              <label style={labelS}>Last Name</label>
              <input value={form.last_name} onChange={e => set('last_name', e.target.value)} style={inp} />
            </div>
          </div>

          <div>
            <label style={labelS}>Role</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {ROLE_OPTIONS.map(r => (
                <button key={r} type="button" onClick={() => set('role', r)} style={{
                  flex: 1, padding: '6px 8px', borderRadius: 5, fontSize: 10, fontFamily: 'Syne',
                  fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer',
                  background: form.role === r ? ROLE_COLORS[r] + '22' : '#1a1d27',
                  color: form.role === r ? ROLE_COLORS[r] : '#8b90a8',
                  border: `1px solid ${form.role === r ? ROLE_COLORS[r] + '55' : '#2a2e3d'}`,
                }}>{r}</button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelS}>Email</label>
              <input value={form.email} onChange={e => set('email', e.target.value)} placeholder="—" style={inp} />
            </div>
            <div>
              <label style={labelS}>Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="—" style={inp} />
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 10, color: '#f04e7a', fontFamily: 'DM Mono', padding: '4px 8px', background: 'rgba(240,78,122,0.1)', borderRadius: 4, border: '1px solid rgba(240,78,122,0.3)' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #2a2e3d', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', background: '#1a1d27', border: '1px solid #2a2e3d', color: '#8b90a8', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '6px 20px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', background: '#1e40af', border: 'none', color: '#fff', fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

type AdminSection = 'engineers'

const ADMIN_NAV: { key: AdminSection; label: string }[] = [
  { key: 'engineers', label: 'Engineers' },
]

export default function AdminPage() {
  const [section, setSection] = useState<AdminSection>('engineers')
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editEng, setEditEng] = useState<Engineer | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState<'All' | EngineerRole>('All')
  const [showInactive, setShowInactive] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('engineers').select('*').order('first_name')
    setEngineers((data ?? []) as Engineer[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleActive(eng: Engineer) {
    await supabase.from('engineers').update({ active: !eng.active }).eq('id', eng.id)
    setConfirmDeactivate(null)
    load()
  }

  function openAdd() { setEditEng(null); setModalOpen(true) }
  function openEdit(eng: Engineer) { setEditEng(eng); setModalOpen(true) }

  const filtered = engineers.filter(e => {
    if (!showInactive && !e.active) return false
    if (roleFilter !== 'All' && e.role !== roleFilter && !(roleFilter === 'Engineer' && e.role === 'Both') && !(roleFilter === 'Assistant' && e.role === 'Both')) return false
    return true
  })

  const sectionHead: React.CSSProperties = {
    fontSize: 9, fontFamily: 'Syne', fontWeight: 700, color: '#4a4f64',
    letterSpacing: '0.08em', textTransform: 'uppercase',
    borderBottom: '1px solid #2a2e3d', paddingBottom: 7, marginBottom: 16,
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* ─── Sidebar ──────────────────────────────────────────────── */}
      <div style={{
        width: 200, flexShrink: 0, borderRight: '1px solid #2a2e3d',
        padding: '28px 0', display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4a4f64', padding: '0 20px 12px' }}>
          Admin
        </div>
        {ADMIN_NAV.map(({ key, label }) => {
          const active = section === key
          return (
            <button
              key={key}
              onClick={() => setSection(key)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 20px', border: 'none', cursor: 'pointer',
                fontFamily: 'DM Mono', fontSize: 12,
                background: active ? '#1a1d27' : 'transparent',
                color: active ? '#e8eaf2' : '#8b90a8',
                borderLeft: active ? '2px solid #c8f04e' : '2px solid transparent',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* ─── Main content ─────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: '28px 32px', minWidth: 0 }}>

      {section === 'engineers' && <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#e8eaf2' }}>Engineers & Assistants</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => setShowInactive(v => !v)}
              style={{ padding: '4px 12px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', background: showInactive ? '#1a1d27' : 'transparent', border: `1px solid ${showInactive ? '#2a2e3d' : 'transparent'}`, color: '#8b90a8' }}
            >
              {showInactive ? 'Hide inactive' : 'Show inactive'}
            </button>
            <button
              onClick={openAdd}
              style={{ padding: '6px 16px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer', background: '#1e40af', border: 'none', color: '#fff' }}
            >
              + Add
            </button>
          </div>
        </div>

        {/* Role filter tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {(['All', ...ROLE_OPTIONS] as const).map(r => (
            <button key={r} onClick={() => setRoleFilter(r)} style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 10, fontFamily: 'Syne',
              fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer',
              background: roleFilter === r ? (r === 'All' ? '#1a1d27' : ROLE_COLORS[r] + '22') : 'transparent',
              color: roleFilter === r ? (r === 'All' ? '#e8eaf2' : ROLE_COLORS[r]) : '#8b90a8',
              border: roleFilter === r ? `1px solid ${r === 'All' ? '#2a2e3d' : ROLE_COLORS[r] + '55'}` : '1px solid transparent',
            }}>{r}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ fontSize: 11, color: '#4a4f64', fontFamily: 'DM Mono' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ fontSize: 11, color: '#4a4f64', fontFamily: 'DM Mono', padding: '24px 0' }}>No engineers found.</div>
        ) : (
          <div style={{ border: '1px solid #2a2e3d', borderRadius: 6, overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 100px 140px 140px 80px 80px', background: '#1a1d27', borderBottom: '1px solid #2a2e3d', padding: '6px 16px', gap: 12 }}>
              {['', 'Name', 'Role', 'Email', 'Phone', 'Status', ''].map((h, i) => (
                <div key={i} style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4a4f64' }}>{h}</div>
              ))}
            </div>

            {/* Rows */}
            {filtered.map((eng, idx) => {
              const roleColor = ROLE_COLORS[eng.role]
              return (
                <div
                  key={eng.id}
                  style={{
                    display: 'grid', gridTemplateColumns: '44px 1fr 100px 140px 140px 80px 80px',
                    padding: '10px 16px', gap: 12, alignItems: 'center',
                    borderBottom: idx < filtered.length - 1 ? '1px solid #2a2e3d' : 'none',
                    background: eng.active ? 'transparent' : 'rgba(0,0,0,0.15)',
                    opacity: eng.active ? 1 : 0.5,
                  }}
                >
                  {/* Initials avatar */}
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: roleColor + '22', border: `1px solid ${roleColor}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Syne', fontWeight: 800, fontSize: 11, color: roleColor }}>
                    {eng.initials ?? autoInitials(eng.first_name, eng.last_name)}
                  </div>

                  {/* Name */}
                  <div>
                    <div style={{ fontSize: 12, fontFamily: 'DM Mono', color: '#e8eaf2', fontWeight: 500 }}>{eng.first_name} {eng.last_name}</div>
                  </div>

                  {/* Role */}
                  <div>
                    <span style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: roleColor, padding: '2px 7px', background: roleColor + '18', borderRadius: 3, border: `1px solid ${roleColor}33` }}>
                      {eng.role}
                    </span>
                  </div>

                  {/* Email */}
                  <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8b90a8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {eng.email || <span style={{ color: '#4a4f64' }}>—</span>}
                  </div>

                  {/* Phone */}
                  <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8b90a8' }}>
                    {eng.phone || <span style={{ color: '#4a4f64' }}>—</span>}
                  </div>

                  {/* Status */}
                  <div>
                    <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: eng.active ? '#4ef0a2' : '#4a4f64', background: eng.active ? 'rgba(78,240,162,0.1)' : 'rgba(74,79,100,0.15)', padding: '2px 7px', borderRadius: 3, border: `1px solid ${eng.active ? 'rgba(78,240,162,0.25)' : '#2a2e3d'}` }}>
                      {eng.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => openEdit(eng)} style={{ padding: '3px 10px', borderRadius: 3, fontSize: 10, fontFamily: 'DM Mono', background: '#1a1d27', border: '1px solid #2a2e3d', color: '#8b90a8', cursor: 'pointer' }}>
                      Edit
                    </button>
                    {confirmDeactivate === eng.id ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => toggleActive(eng)} style={{ padding: '3px 8px', borderRadius: 3, fontSize: 10, fontFamily: 'DM Mono', background: eng.active ? '#f04e7a' : '#4ef0a2', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                          {eng.active ? 'Yes' : 'Yes'}
                        </button>
                        <button onClick={() => setConfirmDeactivate(null)} style={{ padding: '3px 8px', borderRadius: 3, fontSize: 10, fontFamily: 'DM Mono', background: '#1a1d27', border: '1px solid #2a2e3d', color: '#8b90a8', cursor: 'pointer' }}>
                          No
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeactivate(eng.id)} style={{ padding: '3px 10px', borderRadius: 3, fontSize: 10, fontFamily: 'DM Mono', background: 'transparent', border: `1px solid ${eng.active ? 'rgba(240,78,122,0.3)' : 'rgba(78,240,162,0.3)'}`, color: eng.active ? '#f04e7a' : '#4ef0a2', cursor: 'pointer' }}>
                        {eng.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Summary */}
        {!loading && engineers.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 10, color: '#4a4f64', fontFamily: 'DM Mono' }}>
            {engineers.filter(e => e.active).length} active · {engineers.filter(e => !e.active).length} inactive
          </div>
        )}
      </div>}

      {/* Modal */}
      {modalOpen && (
        <EngModal
          eng={editEng}
          onClose={() => setModalOpen(false)}
          onSave={load}
        />
      )}
      </div>{/* end main content */}
    </div>
  )
}
