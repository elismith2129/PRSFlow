'use client'
// Staffing picker for a lead: Eng / Asst / No Staff, plus an optional person.
//
// Replaces the original "Engineer Needed" on/off button, which recorded a bare
// boolean that nothing outside the CRM ever read — staffing then had to be typed
// onto every studio-time row in the Work Order by hand. What's chosen here rides
// onto the booking (`staff_mode`) and seeds every WO row.
//
// Design notes:
//  • Three states, because sessions have three. Assistant is the default and the
//    normal case; an engineer is the exception; unstaffed happens occasionally.
//  • The NAME IS OPTIONAL. "Engineer, TBD" is a real and common state — a session
//    is often booked before staffing is settled.
//  • The list is filtered to the relevant pool (`engineers.role` is
//    Engineer | Assistant | Both, so Both shows in either), but typing a name
//    that isn't on it is allowed — a new hire or one-off freelancer shouldn't
//    force an Admin detour mid-call.
import React, { useEffect, useState } from 'react'
import { supabase, StaffMode } from '@/lib/supabase'

type Pools = { engineer: string[]; assistant: string[] }

// Module-level cache: the roster is small, unchanging reference data, and this
// renders in both the lead detail and the new-lead modal.
let cachedPools: Pools | null = null

export function useStaffPools(): Pools {
  const [pools, setPools] = useState<Pools>(cachedPools ?? { engineer: [], assistant: [] })

  useEffect(() => {
    if (cachedPools) return
    let cancelled = false
    supabase
      .from('engineers')
      .select('first_name,last_name,role')
      .eq('active', true)
      .order('first_name')
      .then(({ data }) => {
        if (cancelled) return
        const next: Pools = { engineer: [], assistant: [] }
        for (const e of data || []) {
          const name = [e.first_name, e.last_name].filter(Boolean).join(' ').trim()
          if (!name) continue
          // 'Both' belongs to each pool.
          if (e.role === 'Engineer' || e.role === 'Both') next.engineer.push(name)
          if (e.role === 'Assistant' || e.role === 'Both') next.assistant.push(name)
        }
        cachedPools = next
        setPools(next)
      })
    return () => { cancelled = true }
  }, [])

  return pools
}

const MODES: { key: StaffMode; label: string }[] = [
  { key: 'engineer', label: 'Eng' },
  { key: 'assistant', label: 'Asst' },
  { key: 'none', label: 'No Staff' },
]

export function StaffPicker({ role, name, onChange, disabled, listId = 'staff-roster' }: {
  role: StaffMode | null
  name: string | null
  // Emits both values together — switching role clears a name that belonged to
  // the other pool, so the caller must never persist them independently.
  onChange: (next: { role: StaffMode; name: string }) => void
  disabled?: boolean
  // Unique per mount point; two <datalist> elements must not share an id.
  listId?: string
}) {
  const pools = useStaffPools()
  const active: StaffMode = role || 'assistant'
  const options = active === 'engineer' ? pools.engineer : active === 'assistant' ? pools.assistant : []

  function pickRole(next: StaffMode) {
    if (disabled || next === active) return
    // Dropping the name on a role change is deliberate: the previous person came
    // from the other pool, and silently keeping them would staff the session with
    // someone who isn't in that role.
    onChange({ role: next, name: next === 'none' ? '' : '' })
  }

  const modeBtn = (on: boolean, isNone: boolean): React.CSSProperties => ({
    padding: '5px 12px',
    background: on ? (isNone ? 'var(--surface2)' : 'rgba(var(--accent-rgb),0.12)') : 'var(--surface2)',
    color: on ? (isNone ? 'var(--text2)' : 'var(--accent)') : 'var(--text3)',
    border: `1px solid ${on ? (isNone ? 'var(--border)' : 'rgba(var(--accent-rgb),0.35)') : 'var(--border)'}`,
    borderRadius: 5,
    fontSize: 10,
    fontFamily: 'Syne',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    cursor: disabled ? 'default' : 'pointer',
    whiteSpace: 'nowrap' as const,
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {MODES.map(m => (
          <button
            key={m.key}
            type="button"
            disabled={disabled}
            onClick={() => pickRole(m.key)}
            // Light mode overrides the accent tint to solid blue — see globals.css.
            // "No Staff" is deliberately neutral even when active; it's the absence
            // of a choice, not an accent-worthy one.
            data-staff-mode-on={active === m.key && m.key !== 'none' ? '' : undefined}
            style={modeBtn(active === m.key, m.key === 'none')}
          >
            {m.label}
          </button>
        ))}
      </div>

      {active !== 'none' && (
        <>
          <input
            list={listId}
            value={name || ''}
            disabled={disabled}
            onChange={e => onChange({ role: active, name: e.target.value })}
            placeholder={active === 'engineer' ? 'Engineer (optional)' : 'Assistant (optional)'}
            style={{
              flex: 1, minWidth: 140, background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 4, color: 'var(--text)', fontFamily: 'Inter', fontSize: 11,
              padding: '5px 9px', outline: 'none',
            }}
          />
          <datalist id={listId}>
            {options.map(n => <option key={n} value={n} />)}
          </datalist>
        </>
      )}
    </div>
  )
}
