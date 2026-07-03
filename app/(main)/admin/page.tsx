'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Engineer, EngineerRole, Booking } from '@/lib/supabase'
import { DailyOpsLogSection } from '@/components/admin/DailyOpsLogSection'
import { FlagsLogSection } from '@/components/admin/FlagsLogSection'
import { MicInventorySection } from '@/components/admin/MicInventorySection'
import { useUserProfile } from '@/hooks/useUserProfile'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SectionHeader } from '@/components/ui/SectionHeader'

const ROLE_OPTIONS: EngineerRole[] = ['Engineer', 'Assistant', 'Both']

const ROLE_COLORS: Record<EngineerRole, string> = {
  Engineer: '#F97316',
  Assistant: '#EF4444',
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
            <div style={{ fontSize: 10, color: '#EF4444', fontFamily: 'DM Mono', padding: '4px 8px', background: 'rgba(239,68,68,0.1)', borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #2a2e3d', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', background: '#1a1d27', border: '1px solid #2a2e3d', color: '#8b90a8', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '6px 20px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', background: 'var(--accent)', border: 'none', color: '#0d0f14', fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

type AdminSection = 'engineers' | 'srs_log' | 'daily_ops_log' | 'flags_log' | 'mic_inventory'

const ADMIN_NAV: { key: AdminSection; label: string }[] = [
  { key: 'engineers', label: 'Engineers' },
  { key: 'srs_log', label: 'SRS Log' },
  { key: 'daily_ops_log', label: 'Ops Log' },
  { key: 'flags_log', label: 'Flags' },
  { key: 'mic_inventory', label: 'Mic Inventory' },
]

type SrsEntry = {
  id: string
  booking_id: number
  paid: boolean
  paid_at: string | null
  created_at: string
  booking: {
    id: number
    start_date: string
    client_name: string | null
    client_id: string | null
    srs_fee_amount: number | null
  } | null
}

export default function AdminPage() {
  const [section, setSection] = useState<AdminSection>('engineers')
  const { profile } = useUserProfile()
  const isTech = profile?.role === 'tech'
  // Tech sees only Ops Log / Flags / Mic Inventory (no Engineers / SRS Log).
  const visibleNav = isTech
    ? ADMIN_NAV.filter(n => n.key === 'daily_ops_log' || n.key === 'flags_log' || n.key === 'mic_inventory')
    : ADMIN_NAV
  // Open a specific sidebar tab when deep-linked via ?section= (e.g. the dashboard
  // Flags panel's "View all flags →" → ?section=flags_log).
  useEffect(() => {
    try {
      const s = new URLSearchParams(window.location.search).get('section') as AdminSection | null
      if (s && ADMIN_NAV.some(n => n.key === s)) setSection(s)
    } catch {}
  }, [])
  // Tech can't see Engineers/SRS — bounce them to a visible tab.
  useEffect(() => {
    if (isTech && (section === 'engineers' || section === 'srs_log')) {
      setSection('flags_log')
    }
  }, [isTech, section])
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editEng, setEditEng] = useState<Engineer | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState<'All' | EngineerRole>('All')
  const [showInactive, setShowInactive] = useState(false)

  // Engineer sessions drill-down
  const [selectedEng, setSelectedEng] = useState<Engineer | null>(null)
  const [engSessions, setEngSessions] = useState<Booking[]>([])
  const [engSessionsLoading, setEngSessionsLoading] = useState(false)
  const [engSessionsPage, setEngSessionsPage] = useState(0)
  const ENG_PAGE_SIZE = 10

  // SRS Log state
  const [srsEntries, setSrsEntries] = useState<SrsEntry[]>([])
  const [srsLoading, setSrsLoading] = useState(false)
  const [srsMonthFilter, setSrsMonthFilter] = useState<string>('all')
  const [confirmMarkAll, setConfirmMarkAll] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('engineers').select('*').order('first_name')
    setEngineers((data ?? []) as Engineer[])
    setLoading(false)
  }, [])

  const loadSrs = useCallback(async () => {
    setSrsLoading(true)
    const { data } = await supabase
      .from('srs_log')
      .select('id,booking_id,paid,paid_at,created_at,bookings(id,start_date,client_name,client_id,srs_fee_amount)')
      .order('created_at', { ascending: false })
    setSrsEntries(((data ?? []) as any[]).map(r => ({ ...r, booking: r.bookings ?? null })))
    setSrsLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (section === 'srs_log') loadSrs() }, [section, loadSrs])

  async function toggleSrsPaid(entry: SrsEntry) {
    const newPaid = !entry.paid
    setSrsEntries(prev => prev.map(e => e.id === entry.id ? { ...e, paid: newPaid, paid_at: newPaid ? new Date().toISOString() : null } : e))
    await supabase.from('srs_log').update({ paid: newPaid, paid_at: newPaid ? new Date().toISOString() : null }).eq('id', entry.id)
  }

  async function markAllPaid(monthKey: string) {
    const targets = filteredSrs.filter(e => !e.paid)
    setSrsEntries(prev => prev.map(e => {
      const bk = e.booking
      if (!bk) return e
      const mk = bk.start_date.slice(0, 7)
      return mk === monthKey && !e.paid ? { ...e, paid: true, paid_at: new Date().toISOString() } : e
    }))
    await Promise.all(targets.map(e => supabase.from('srs_log').update({ paid: true, paid_at: new Date().toISOString() }).eq('id', e.id)))
    setConfirmMarkAll(false)
  }

  async function openEngSessions(eng: Engineer) {
    setSelectedEng(eng)
    setEngSessionsPage(0)
    setEngSessionsLoading(true)
    const fullName = `${eng.first_name} ${eng.last_name}`
    const { data } = await supabase
      .from('bookings')
      .select('*')
      .or(`engineer_name.eq.${fullName},assistant_name.eq.${fullName}`)
      .order('start_date', { ascending: false })
    setEngSessions((data ?? []) as Booking[])
    setEngSessionsLoading(false)
  }

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

  // SRS derived data
  const srsMonths = Array.from(new Set(
    srsEntries.map(e => e.booking?.start_date.slice(0, 7)).filter(Boolean) as string[]
  )).sort((a, b) => b.localeCompare(a))

  const filteredSrs = srsMonthFilter === 'all'
    ? srsEntries
    : srsEntries.filter(e => e.booking?.start_date.slice(0, 7) === srsMonthFilter)

  const srsUnpaidCount = filteredSrs.filter(e => !e.paid).length
  const srsTotalFee = filteredSrs.reduce((sum, e) => sum + (e.booking?.srs_fee_amount ?? 0), 0)

  function fmtMonthKey(key: string): string {
    const [y, m] = key.split('-')
    const d = new Date(parseInt(y), parseInt(m) - 1, 1)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  function fmtDate(d: string): string {
    const dt = new Date(d + 'T12:00:00')
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

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
        {visibleNav.map(({ key, label }) => {
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

      {section === 'engineers' && !selectedEng && <div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <SectionHeader title="Engineers & Assistants" />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => setShowInactive(v => !v)}
              style={{ padding: '4px 12px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', background: showInactive ? '#1a1d27' : 'transparent', border: `1px solid ${showInactive ? '#2a2e3d' : 'transparent'}`, color: '#8b90a8' }}
            >
              {showInactive ? 'Hide inactive' : 'Show inactive'}
            </button>
            <button
              onClick={openAdd}
              style={{ padding: '6px 16px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', border: 'none', color: '#0d0f14' }}
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
            <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 100px 140px 140px 80px 180px', background: '#1a1d27', borderBottom: '1px solid #2a2e3d', padding: '6px 16px', gap: 12 }}>
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
                  onClick={() => openEngSessions(eng)}
                  style={{
                    display: 'grid', gridTemplateColumns: '44px 1fr 100px 140px 140px 80px 180px',
                    padding: '10px 16px', gap: 12, alignItems: 'center',
                    borderBottom: idx < filtered.length - 1 ? '1px solid #2a2e3d' : 'none',
                    background: eng.active ? 'transparent' : 'rgba(0,0,0,0.15)',
                    opacity: eng.active ? 1 : 0.5,
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1a1d27')}
                  onMouseLeave={e => (e.currentTarget.style.background = eng.active ? 'transparent' : 'rgba(0,0,0,0.15)')}
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
                    <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: eng.active ? '#14B8A6' : '#4a4f64', background: eng.active ? 'rgba(20,184,166,0.1)' : 'rgba(74,79,100,0.15)', padding: '2px 7px', borderRadius: 3, border: `1px solid ${eng.active ? 'rgba(20,184,166,0.25)' : '#2a2e3d'}` }}>
                      {eng.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => openEdit(eng)} style={{ padding: '3px 10px', borderRadius: 3, fontSize: 10, fontFamily: 'DM Mono', background: '#1a1d27', border: '1px solid #2a2e3d', color: '#8b90a8', cursor: 'pointer' }}>
                      Edit
                    </button>
                    {confirmDeactivate === eng.id ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => toggleActive(eng)} style={{ padding: '3px 8px', borderRadius: 3, fontSize: 10, fontFamily: 'DM Mono', background: eng.active ? '#EF4444' : '#14B8A6', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                          {eng.active ? 'Yes' : 'Yes'}
                        </button>
                        <button onClick={() => setConfirmDeactivate(null)} style={{ padding: '3px 8px', borderRadius: 3, fontSize: 10, fontFamily: 'DM Mono', background: '#1a1d27', border: '1px solid #2a2e3d', color: '#8b90a8', cursor: 'pointer' }}>
                          No
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeactivate(eng.id)} style={{ padding: '3px 10px', borderRadius: 3, fontSize: 10, fontFamily: 'DM Mono', background: 'transparent', border: `1px solid ${eng.active ? 'rgba(239,68,68,0.3)' : 'rgba(20,184,166,0.3)'}`, color: eng.active ? '#EF4444' : '#14B8A6', cursor: 'pointer' }}>
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

      {/* ─── Engineer sessions drill-down ─────────────────────────── */}
      {section === 'engineers' && selectedEng && (() => {
        const fullName = `${selectedEng.first_name} ${selectedEng.last_name}`
        const roleColor = ROLE_COLORS[selectedEng.role]
        const totalPages = Math.ceil(engSessions.length / ENG_PAGE_SIZE)
        const pageSlice = engSessions.slice(engSessionsPage * ENG_PAGE_SIZE, (engSessionsPage + 1) * ENG_PAGE_SIZE)

        function fmtSessionDate(d: string) {
          return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        }

        return (
          <div>
            {/* Back + header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
              <button
                onClick={() => { setSelectedEng(null); setEngSessions([]) }}
                style={{ padding: '5px 12px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', background: 'transparent', border: '1px solid #2a2e3d', color: '#8b90a8' }}
              >
                ← Back
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: roleColor + '22', border: `1px solid ${roleColor}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Syne', fontWeight: 800, fontSize: 12, color: roleColor }}>
                  {selectedEng.initials ?? autoInitials(selectedEng.first_name, selectedEng.last_name)}
                </div>
                <div>
                  <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#e8eaf2' }}>{fullName}</div>
                  <div style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#4a4f64', marginTop: 1 }}>
                    {engSessions.length} session{engSessions.length !== 1 ? 's' : ''} total
                  </div>
                </div>
              </div>
            </div>

            {engSessionsLoading ? (
              <div style={{ fontSize: 11, color: '#4a4f64', fontFamily: 'DM Mono' }}>Loading…</div>
            ) : engSessions.length === 0 ? (
              <div style={{ fontSize: 11, color: '#4a4f64', fontFamily: 'DM Mono', padding: '24px 0' }}>No sessions found for {fullName}.</div>
            ) : (
              <>
                <div style={{ border: '1px solid #2a2e3d', borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
                  {/* Table header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 90px 160px 1fr 90px 70px', background: '#1a1d27', borderBottom: '1px solid #2a2e3d', padding: '6px 16px', gap: 12 }}>
                    {['Date', 'Time', 'Studio', 'Client / Artist', 'Status', 'Role'].map(h => (
                      <div key={h} style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4a4f64' }}>{h}</div>
                    ))}
                  </div>

                  {pageSlice.map((bk, idx) => {
                    const isEng = bk.engineer_name === fullName
                    const timeStr = bk.from_time && bk.to_time ? `${bk.from_time}–${bk.to_time}` : bk.from_time ?? '—'
                    return (
                      <div
                        key={bk.id}
                        style={{
                          display: 'grid', gridTemplateColumns: '120px 90px 160px 1fr 90px 70px',
                          padding: '10px 16px', gap: 12, alignItems: 'center',
                          borderBottom: idx < pageSlice.length - 1 ? '1px solid #2a2e3d' : 'none',
                        }}
                      >
                        <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#8b90a8' }}>{fmtSessionDate(bk.start_date)}</div>
                        <div style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{timeStr}</div>
                        <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#e8eaf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {bk.location} {bk.studio ? `· ${bk.studio}` : ''}
                        </div>
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#e8eaf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bk.client_name || <span style={{ color: '#4a4f64' }}>—</span>}</div>
                          {bk.artist && <div style={{ fontSize: 9, fontFamily: 'DM Mono', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bk.artist}</div>}
                        </div>
                        <div>
                          <StatusBadge status={bk.status} />
                        </div>
                        <div>
                          <span style={{ fontSize: 9, fontFamily: 'DM Mono', color: isEng ? '#F97316' : '#EF4444', background: isEng ? 'rgba(249,115,22,0.12)' : 'rgba(239,68,68,0.12)', padding: '2px 7px', borderRadius: 3, border: `1px solid ${isEng ? 'rgba(249,115,22,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                            {isEng ? '1st' : '2nd'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => setEngSessionsPage(p => Math.max(0, p - 1))}
                      disabled={engSessionsPage === 0}
                      style={{ padding: '4px 12px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', cursor: engSessionsPage === 0 ? 'default' : 'pointer', background: '#1a1d27', border: '1px solid #2a2e3d', color: engSessionsPage === 0 ? '#4a4f64' : '#8b90a8' }}
                    >
                      ← Prev
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setEngSessionsPage(i)}
                        style={{ padding: '4px 10px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', background: engSessionsPage === i ? '#c8f04e' : '#1a1d27', border: `1px solid ${engSessionsPage === i ? '#c8f04e' : '#2a2e3d'}`, color: engSessionsPage === i ? '#0d0f14' : '#8b90a8', fontWeight: engSessionsPage === i ? 700 : 400 }}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button
                      onClick={() => setEngSessionsPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={engSessionsPage === totalPages - 1}
                      style={{ padding: '4px 12px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', cursor: engSessionsPage === totalPages - 1 ? 'default' : 'pointer', background: '#1a1d27', border: '1px solid #2a2e3d', color: engSessionsPage === totalPages - 1 ? '#4a4f64' : '#8b90a8' }}
                    >
                      Next →
                    </button>
                    <span style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#4a4f64', marginLeft: 4 }}>
                      {engSessionsPage * ENG_PAGE_SIZE + 1}–{Math.min((engSessionsPage + 1) * ENG_PAGE_SIZE, engSessions.length)} of {engSessions.length}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* ─── SRS Log ──────────────────────────────────────────────── */}
      {section === 'srs_log' && (
        <div>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <SectionHeader title="SRS Log" />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Month filter */}
              <select
                value={srsMonthFilter}
                onChange={e => { setSrsMonthFilter(e.target.value); setConfirmMarkAll(false) }}
                style={{ ...inp, width: 'auto', padding: '5px 10px' }}
              >
                <option value="all">All months</option>
                {srsMonths.map(m => (
                  <option key={m} value={m}>{fmtMonthKey(m)}</option>
                ))}
              </select>
              {/* Mark all paid button */}
              {srsMonthFilter !== 'all' && srsUnpaidCount > 0 && (
                confirmMarkAll ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontFamily: 'DM Mono', color: '#8b90a8' }}>
                      Mark {srsUnpaidCount} as paid?
                    </span>
                    <button
                      onClick={() => markAllPaid(srsMonthFilter)}
                      style={{ padding: '5px 12px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', fontWeight: 700, cursor: 'pointer', background: '#c8f04e', border: 'none', color: '#0d0f14' }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmMarkAll(false)}
                      style={{ padding: '5px 12px', borderRadius: 4, fontSize: 10, fontFamily: 'DM Mono', cursor: 'pointer', background: 'transparent', border: '1px solid #2a2e3d', color: '#8b90a8' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmMarkAll(true)}
                    style={{ padding: '6px 14px', borderRadius: 4, fontSize: 11, fontFamily: 'DM Mono', cursor: 'pointer', background: '#1a1d27', border: '1px solid #2a2e3d', color: '#8b90a8' }}
                  >
                    Mark all paid
                  </button>
                )
              )}
            </div>
          </div>

          {/* Summary bar — shown when month is selected */}
          {srsMonthFilter !== 'all' && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Total SRS fee owed', value: srsTotalFee > 0 ? `$${srsTotalFee.toFixed(2)}` : '—' },
                { label: 'Unpaid entries', value: String(srsUnpaidCount) },
              ].map(card => (
                <div key={card.label} style={{ flex: 1, background: '#1a1d27', border: '1px solid #2a2e3d', borderRadius: 6, padding: '14px 18px' }}>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4a4f64', marginBottom: 6 }}>{card.label}</div>
                  <div style={{ fontSize: 18, fontFamily: 'DM Mono', color: '#e8eaf2', fontWeight: 700 }}>{card.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Table */}
          {srsLoading ? (
            <div style={{ fontSize: 11, color: '#4a4f64', fontFamily: 'DM Mono' }}>Loading…</div>
          ) : filteredSrs.length === 0 ? (
            <div style={{ fontSize: 11, color: '#4a4f64', fontFamily: 'DM Mono', padding: '24px 0' }}>No SRS bookings found.</div>
          ) : (
            <div style={{ border: '1px solid #2a2e3d', borderRadius: 6, overflow: 'hidden' }}>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 120px 120px 90px', background: '#1a1d27', borderBottom: '1px solid #2a2e3d', padding: '6px 16px', gap: 12 }}>
                {['Date', 'Client', 'Room fees', 'SRS fee (10%)', 'Status'].map(h => (
                  <div key={h} style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4a4f64' }}>{h}</div>
                ))}
              </div>
              {filteredSrs.map((entry, idx) => {
                const bk = entry.booking
                return (
                  <div
                    key={entry.id}
                    style={{
                      display: 'grid', gridTemplateColumns: '140px 1fr 120px 120px 90px',
                      padding: '10px 16px', gap: 12, alignItems: 'center',
                      borderBottom: idx < filteredSrs.length - 1 ? '1px solid #2a2e3d' : 'none',
                    }}
                  >
                    {/* Date */}
                    <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#8b90a8' }}>
                      {bk ? fmtDate(bk.start_date) : '—'}
                    </div>
                    {/* Client */}
                    <div style={{ fontSize: 12, fontFamily: 'DM Mono', color: '#e8eaf2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {bk?.client_name || <span style={{ color: '#4a4f64' }}>—</span>}
                    </div>
                    {/* Room fees — TODO: populate from studio_time table once WO digitization is complete */}
                    <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: '#4a4f64' }}>—</div>
                    {/* SRS fee */}
                    <div style={{ fontSize: 11, fontFamily: 'DM Mono', color: bk?.srs_fee_amount != null ? '#e8eaf2' : '#4a4f64' }}>
                      {bk?.srs_fee_amount != null ? `$${Number(bk.srs_fee_amount).toFixed(2)}` : '—'}
                    </div>
                    {/* Status toggle */}
                    <div>
                      <button
                        onClick={() => toggleSrsPaid(entry)}
                        style={{
                          padding: '3px 10px', borderRadius: 12, border: 'none', cursor: 'pointer',
                          fontFamily: 'DM Mono', fontSize: 10, fontWeight: 700,
                          background: entry.paid ? 'rgba(20,184,166,0.12)' : 'rgba(239,68,68,0.12)',
                          color: entry.paid ? '#14B8A6' : '#EF4444',
                        }}
                      >
                        {entry.paid ? 'Paid' : 'Unpaid'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {section === 'daily_ops_log' && <DailyOpsLogSection />}
      {section === 'flags_log' && <FlagsLogSection />}
      {section === 'mic_inventory' && <MicInventorySection />}

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
