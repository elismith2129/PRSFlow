'use client'
// /engineers — the staff roster, moved out of the retired Admin page (Eli,
// 2026-08-17). Admin held five tabs; this was the only one still used, so it
// gets a real home under Operations, in the current skin. The Admin page
// itself stays reachable by URL until its rebuild (a later phase) — do not
// delete it, but nothing links to it any more.
//
// Rebuilt rather than extracted: the Admin version wore the old skin (Syne,
// borders, legacy --surface tokens) and fetched with no realtime pairing.
// This page follows the standing rules: soft skin (flat --c-srf + --c-softsh,
// no borders), every write checked via dbResult, and the fetch paired with a
// realtime channel ('engineers-page').
//
// Scope: the ROSTER (list, add, edit, deactivate). The old per-engineer
// session history stayed in Admin and joins the Phase-B rebuild.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Engineer, EngineerRole } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { Hint } from '@/components/ui/Hint'

const ROLE_OPTIONS: EngineerRole[] = ['Engineer', 'Assistant', 'Both']

/** Role shorthand, matching the work order's 1ST/2ND language. */
function roleTag(role: EngineerRole): string {
  return role === 'Engineer' ? '1ST' : role === 'Assistant' ? '2ND' : '1ST/2ND'
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

const EMPTY: FormState = { first_name: '', last_name: '', role: 'Engineer', email: '', phone: '' }

export default function EngineersPage() {
  const [engineers, setEngineers] = useState<Engineer[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Engineer | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('engineers').select('*').order('first_name')
    if (!dbResult('Loading engineers', error)) return
    setEngineers((data ?? []) as Engineer[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Realtime pairing (standing rule) — the roster is edited from the WO's
  // staff pickers too, so this page must never need a refresh.
  useEffect(() => {
    const channel = supabase
      .channel('engineers-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'engineers' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  async function toggleActive(eng: Engineer) {
    const { error } = await supabase.from('engineers').update({ active: !eng.active }).eq('id', eng.id)
    if (!dbResult(eng.active ? 'Deactivating engineer' : 'Reactivating engineer', error)) return
    load()
  }

  const q = query.trim().toLowerCase()
  const visible = engineers.filter(e => {
    if (!showInactive && !e.active) return false
    if (!q) return true
    return `${e.first_name} ${e.last_name} ${e.email ?? ''} ${e.phone ?? ''}`.toLowerCase().includes(q)
  })
  const activeCount = engineers.filter(e => e.active).length

  const card: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)',
    borderRadius: 18, padding: '14px 16px',
  }
  const wash: React.CSSProperties = {
    background: 'var(--c-wash)', border: 'none', borderRadius: 10,
    padding: '8px 12px', color: 'var(--c-fg)', font: 'inherit', fontSize: 12.5, outline: 'none',
  }

  return (
    <div style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', padding: '2px 4px' }}>
        <div>
          <span className="c-label" style={{ display: 'block', marginBottom: 3 }}>Operations</span>
          <span className="c-arch" style={{ fontSize: 24, letterSpacing: '-0.02em' }}>Engineers</span>
          <Hint tip="The roster the work order's staff fields suggest from. 1ST = engineer, 2ND = assistant; 'Both' appears in either pool. Deactivating hides someone from suggestions without losing their history." />
        </div>
        <span style={{ fontSize: 12, opacity: 0.5 }}>
          {activeCount} active · {engineers.length - activeCount} inactive
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setAdding(true)} style={{ ...wash, background: 'var(--c-wash2)', fontWeight: 700, cursor: 'pointer' }}>
            + Add
          </button>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name, email, phone…"
            style={{ ...wash, flex: 1 }}
          />
          <button
            onClick={() => setShowInactive(s => !s)}
            style={{ ...wash, fontWeight: 700, cursor: 'pointer', opacity: showInactive ? 1 : 0.55, background: showInactive ? 'var(--c-wash2)' : 'var(--c-wash)' }}
          >
            {showInactive ? 'Hiding none' : 'Show inactive'}
          </button>
        </div>

        {loading ? (
          <div style={{ opacity: 0.5, fontSize: 13, padding: '14px 4px' }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div style={{ opacity: 0.5, fontSize: 13, padding: '14px 4px' }}>No one found.</div>
        ) : visible.map((e, i) => (
          <div
            key={e.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '9px 2px',
              boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined,
              opacity: e.active ? 1 : 0.45,
            }}
          >
            <span className="c-mono" style={{
              width: 34, height: 34, borderRadius: 99, background: 'var(--c-wash2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, flexShrink: 0,
            }}>
              {autoInitials(e.first_name, e.last_name)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {e.first_name} {e.last_name}
                <span style={{
                  marginLeft: 8, fontSize: 8.5, fontWeight: 800, letterSpacing: '0.06em',
                  padding: '2px 7px', borderRadius: 99, background: 'var(--c-wash2)',
                  color: e.role === 'Assistant' ? 'var(--c-st-warm)' : 'var(--c-fg)',
                  verticalAlign: 'middle',
                }}>
                  {roleTag(e.role)}
                </span>
                {!e.active && (
                  <span style={{ marginLeft: 6, fontSize: 8.5, fontWeight: 800, letterSpacing: '0.06em', padding: '2px 7px', borderRadius: 99, background: 'var(--c-wash)', verticalAlign: 'middle', opacity: 0.7 }}>
                    INACTIVE
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10.5, opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[e.email, e.phone].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <button onClick={() => setEditing(e)} style={{ ...wash, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
              Edit
            </button>
            <button onClick={() => toggleActive(e)} style={{ ...wash, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0, opacity: 0.7 }}>
              {e.active ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>
        ))}
      </div>

      {(editing || adding) && (
        <EngineerSheet
          eng={editing}
          onClose={() => { setEditing(null); setAdding(false) }}
          onSaved={load}
        />
      )}
    </div>
  )
}

function EngineerSheet({ eng, onClose, onSaved }: {
  eng: Engineer | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(
    eng
      ? { first_name: eng.first_name, last_name: eng.last_name, role: eng.role, email: eng.email ?? '', phone: eng.phone ?? '' }
      : EMPTY,
  )
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState(false)

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleSave() {
    if (!form.first_name.trim() || !form.last_name.trim()) { setNameError(true); return }
    setSaving(true)
    const payload = { ...form, first_name: form.first_name.trim(), last_name: form.last_name.trim() }
    const { error } = eng
      ? await supabase.from('engineers').update(payload).eq('id', eng.id)
      : await supabase.from('engineers').insert({ ...payload, active: true })
    if (!dbResult('Saving engineer', error)) { setSaving(false); return }
    onSaved()
    onClose()
  }

  const wash: React.CSSProperties = {
    background: 'var(--c-wash)', border: 'none', borderRadius: 10,
    padding: '8px 12px', color: 'var(--c-fg)', font: 'inherit', fontSize: 12.5, outline: 'none', width: '100%',
  }
  const lbl: React.CSSProperties = {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
    opacity: 0.45, display: 'block', marginBottom: 5,
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        width: 'min(420px, 94vw)', background: 'var(--c-srf, var(--c-bg))', color: 'var(--c-fg)',
        borderRadius: 20, boxShadow: 'var(--c-softsh)', padding: '18px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span className="c-arch" style={{ fontSize: 16 }}>{eng ? 'Edit engineer' : 'Add engineer'}</span>
          <span className="c-mono" style={{
            width: 34, height: 34, borderRadius: 99, background: 'var(--c-wash2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
          }}>
            {autoInitials(form.first_name, form.last_name) || '—'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <span style={lbl}>First name</span>
            <input value={form.first_name} onChange={e => { set('first_name', e.target.value); setNameError(false) }} style={wash} autoFocus />
          </div>
          <div>
            <span style={lbl}>Last name</span>
            <input value={form.last_name} onChange={e => { set('last_name', e.target.value); setNameError(false) }} style={wash} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <span style={lbl}>Role</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {ROLE_OPTIONS.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => set('role', r)}
                style={{
                  flex: 1, padding: '7px 8px', borderRadius: 99, fontSize: 10.5, fontWeight: 700,
                  cursor: 'pointer', border: 'none', font: 'inherit',
                  background: form.role === r ? 'var(--c-fg)' : 'var(--c-wash)',
                  color: form.role === r ? 'var(--c-bg)' : 'var(--c-fg)',
                  opacity: form.role === r ? 1 : 0.65,
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <span style={lbl}>Email</span>
            <input value={form.email} onChange={e => set('email', e.target.value)} placeholder="—" style={wash} />
          </div>
          <div>
            <span style={lbl}>Phone</span>
            <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="—" style={wash} />
          </div>
        </div>

        {nameError && (
          <div style={{ fontSize: 11, color: 'var(--c-st-hot)', marginBottom: 10 }}>
            First and last name are required.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ background: 'var(--c-wash)', border: 'none', font: 'inherit', borderRadius: 99, padding: '8px 16px', fontSize: 12, fontWeight: 700, color: 'var(--c-fg)', cursor: 'pointer', opacity: 0.7 }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: 'var(--c-fg)', color: 'var(--c-bg)', border: 'none', font: 'inherit',
              borderRadius: 99, padding: '8px 18px', fontSize: 12, fontWeight: 700,
              cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
