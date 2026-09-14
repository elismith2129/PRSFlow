'use client'

// ─────────────────────────────────────────────────────────────────────────────
// /rates (rail → Admin → Rates) — the rack day rate per room (lib/roomRates, table room_rates).
//
// One table, grouped by venue, the day rate editable in place. Hourly is shown
// (day ÷ 10) and never typed — house law. min_hours is display-only for the
// client rate sheet. Edits are live: the table is in the realtime publication,
// so an open work order's Add-dates prompt reads the new number.
//
// Who edits: owner / manager / billing (RLS). Everyone else sees it read-only —
// a runner asked "how much is X" can read it here rather than a stale PDF.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { useUserProfile } from '@/hooks/useUserProfile'
import { fetchRoomRates, saveRoomRate, hourlyFromDay, type RoomRate } from '@/lib/roomRates'
import { STUDIO_LOCATIONS, STUDIO_SHORT, roomCode } from '@/lib/studios'
import { formatCurrency, stripCurrency } from '@/lib/format'

export function RoomRatesSection() {
  const { profile } = useUserProfile()
  const canEdit = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'billing'
  const [rates, setRates] = useState<RoomRate[]>([])
  const [loading, setLoading] = useState(true)
  // Per-row draft while typing; committed on blur so a half-typed "17" never
  // becomes a $17 day rate mid-keystroke.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRates(await fetchRoomRates())
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = supabase
      .channel('admin-room-rates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_rates' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  async function commit(r: RoomRate) {
    const raw = draft[r.id]
    if (raw === undefined) return
    const n = stripCurrency(raw)
    setDraft(d => { const x = { ...d }; delete x[r.id]; return x })
    if (n === null || n === undefined || !(n >= 0) || n === r.day_rate) return
    setSavingId(r.id)
    const ok = await saveRoomRate(r.id, { day_rate: n })
    if (ok) setRates(prev => prev.map(x => x.id === r.id ? { ...x, day_rate: n } : x))
    setSavingId(null)
  }

  if (loading) return <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>Loading…</div>

  const thS: React.CSSProperties = { fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--c-fg-3)', padding: '0 10px 6px 0', textAlign: 'left' }
  const thR: React.CSSProperties = { ...thS, textAlign: 'right' }
  const td: React.CSSProperties = { padding: '7px 10px 7px 0', borderTop: '1px solid var(--c-wash)', fontSize: 12, fontFamily: 'Inter', color: 'var(--c-fg)' }
  const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: "'DM Mono', ui-monospace, monospace" }

  return (
    <div>
      <SectionHeader title="Room rates" />
      <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-2)', maxWidth: 560, lineHeight: 1.55, marginBottom: 14 }}>
        The rack day rate per room. It fills the rate when a room is added to a work order
        (Add dates, Seed, a blank row) and never changes a rate already on a row. Hourly is
        the day rate ÷ 10.{canEdit ? ' Click a day rate to change it.' : ''}
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 560 }}>
        <thead>
          <tr>
            <th style={thS}>Room</th>
            <th style={thR}>Day</th>
            <th style={thR}>Hourly</th>
            <th style={thR}>Min</th>
          </tr>
        </thead>
        <tbody>
          {STUDIO_LOCATIONS.map(loc => {
            const rows = rates.filter(r => r.venue === loc.name)
            if (!rows.length) return null
            return [
              <tr key={`${loc.name}-h`}>
                <td colSpan={4} style={{ ...thS, paddingTop: 14, borderTop: 'none' }}>
                  {loc.name} · {STUDIO_SHORT[loc.name] ?? ''}
                </td>
              </tr>,
              ...rows.map(r => (
                <tr key={r.id}>
                  <td style={td}>{roomCode(r.room, r.venue)}</td>
                  <td style={tdNum}>
                    {canEdit ? (
                      <input
                        value={draft[r.id] ?? formatCurrency(String(r.day_rate))}
                        onChange={e => setDraft(d => ({ ...d, [r.id]: e.target.value }))}
                        onFocus={e => e.currentTarget.select()}
                        onBlur={() => commit(r)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
                        className="c-tin c-tin-mono c-tin-show"
                        style={{ width: 90, textAlign: 'right', opacity: savingId === r.id ? 0.5 : 1 }}
                      />
                    ) : formatCurrency(String(r.day_rate))}
                  </td>
                  <td style={{ ...tdNum, color: 'var(--c-fg-2)' }}>{formatCurrency(String(hourlyFromDay(r.day_rate)))}</td>
                  <td style={{ ...tdNum, color: 'var(--c-fg-3)' }}>{r.min_hours ? `${r.min_hours} hr` : '—'}</td>
                </tr>
              )),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
