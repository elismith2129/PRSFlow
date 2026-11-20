'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /rooms — ROOM LOCK (Eli, 2026-11-19; mock docs/design-refs/room-lock-options.html,
// option A "one card per room").
//
// "an issue we have with some of our COD clients is they book six hours and
//  then they wanna go overtime. It's three in the morning ... they won't pay,
//  and they'll continue to go, and then leave."
//
// Each room's Mac runs a small agent (scripts/room-lock/main.swift) that asks
// PRSFlo every three seconds what state its room is in:
//   unlocked · warning (a countdown banner, then it locks itself) · locked
// This page is the office's switch. Three acts per room — 30-min warning,
// Lock now, Unlock — each through the room_lock_set() database function, which
// writes the change and its log line together. Nothing here writes a table
// directly.
//
// LOCK NOW IS ONE CLICK (Eli, 2026-11-19: "lets make the lock room button one
// click. no warning popup."). The mock's "Lock Studio A?" confirm was built
// and then removed. A mis-tap is undone with one click on Unlock.
//
// THE STAFF PIN IS NOT ON THE LOCK SCREEN (Eli, 2026-11-19: "if it exists on
// the screen, clients will bully my staff into just clearing it"). The lock
// screen shows no box. Typing the six digits blind and pressing Return clears
// it. The PIN is changed live from the panel at the top of this page.
//
// EVERY CARD IS ONE FIXED SIZE (house rule, 2026-10-05).
//
// ENCORE AND TRACK ARE HIDDEN BY DEFAULT (Eli, 2026-11-19: "dont need track or
// encore ... we dont operate those now. maybe make it hideable"). A line under
// the cards says they are hidden and shows them again; the choice is
// remembered on this browser. A hidden studio with a room that is locked or in
// its warning is shown anyway — nothing locked is ever out of sight.
//
// THE PAGE FITS ONE SCREEN on an office computer (same message: "all rooms
// sized so you can see them without scrolling"): Paramount's five on one row,
// Ameraycan's two under it, a slim PIN bar, a short log that scrolls inside.
// Owners + managers (RLS and the functions say the same; migration
// 20261119150000). Rail item under Admin.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { dbResult } from '@/lib/db'
import { toast } from '@/components/ui/Toaster'
import { PageTop } from '@/components/layout/PageTop'
import { STUDIO_LOCATIONS } from '@/lib/studios'

type RoomLock = {
  room_slug: string
  location: string
  studio: string
  state: 'unlocked' | 'warning' | 'locked'
  lock_at: string | null
  changed_by: string | null
  changed_at: string | null
  agent_key: string
  agent_seen_at: string | null
}
type LogLine = { id: string; room_slug: string | null; action: string; by_name: string | null; created_at: string }

const lbl: CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: '.11em', textTransform: 'uppercase', opacity: 0.45 }
const CARD_W = 210
const CARD_H = 184
/** Studios not operating right now — hidden unless shown (see header). */
const HIDDEN_BY_DEFAULT = ['Encore', 'Track']
const SHOW_ALL_KEY = 'prsflo.rooms.showAll'
/** A Mac that has not checked in for this long is shown as offline. It checks
 *  in every 3s and the stamp moves every 20s, so 90s is several misses. */
const OFFLINE_AFTER_MS = 90_000

const fmtWhen = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  : ''
const fmtLeft = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function RoomsPage() {
  const { profile } = useUserProfile()
  const allowed = profile?.role === 'owner' || profile?.role === 'manager'

  const [rooms, setRooms] = useState<RoomLock[]>([])
  const [log, setLog] = useState<LogLine[]>([])
  const [pin, setPin] = useState<string | null>(null)
  const [pinShown, setPinShown] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [setupFor, setSetupFor] = useState<RoomLock | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { try { setShowAll(localStorage.getItem(SHOW_ALL_KEY) === '1') } catch { /* private mode */ } }, [])
  const toggleShowAll = () => setShowAll(v => {
    try { localStorage.setItem(SHOW_ALL_KEY, v ? '0' : '1') } catch { /* private mode */ }
    return !v
  })

  const load = useCallback(async () => {
    const [r, s, l] = await Promise.all([
      supabase.from('room_locks').select('*'),
      supabase.from('room_lock_settings').select('staff_pin').eq('id', 1).limit(1),
      supabase.from('room_lock_log').select('*').order('created_at', { ascending: false }).limit(40),
    ])
    if (dbResult('Loading rooms', r.error)) setRooms((r.data ?? []) as RoomLock[])
    if (dbResult('Loading the staff PIN', s.error)) setPin(s.data?.[0]?.staff_pin ?? null)
    if (dbResult('Loading the lock log', l.error)) setLog((l.data ?? []) as LogLine[])
    setLoading(false)
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  // Realtime — one channel for the page, one listener per table.
  useEffect(() => {
    if (!allowed) return
    const ch = supabase.channel('rooms-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_locks' }, () => { load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_lock_settings' }, () => { load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_lock_log' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [allowed, load])

  // The countdown and the online dot both depend on the clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const act = async (room: RoomLock, action: 'lock' | 'unlock' | 'warn') => {
    setBusy(room.room_slug)
    const { error } = await supabase.rpc('room_lock_set', { p_room: room.room_slug, p_action: action })
    setBusy(null)
    const what = action === 'lock' ? 'Locking' : action === 'warn' ? 'Starting the warning for' : 'Unlocking'
    if (!dbResult(`${what} ${room.location} ${room.studio}`, error)) return
    toast(action === 'lock' ? `${room.location} · ${room.studio} locked`
      : action === 'warn' ? `${room.location} · ${room.studio} — 30-minute warning started`
      : `${room.location} · ${room.studio} unlocked`)
    load()
  }

  const savePin = async () => {
    if (!/^[0-9]{6}$/.test(newPin)) { toast('The PIN must be exactly six digits.', 'error'); return }
    const { error } = await supabase.rpc('room_lock_set_pin', { p_pin: newPin })
    if (!dbResult('Changing the staff PIN', error)) return
    toast('Staff PIN changed — every room has it within a few seconds')
    setNewPin('')
    load()
  }

  if (!profile) return null
  if (!allowed) return <div style={{ padding: 24, opacity: 0.6 }}>Room lock is for owners and managers.</div>

  const roomLabel = (slug: string | null) => {
    const r = rooms.find(x => x.room_slug === slug)
    return r ? `${r.location} · ${r.studio}` : 'All rooms'
  }

  return (
    <div style={{ maxWidth: 1120 }}>
      <PageTop crumb="Admin" title="Room lock" />

      {/* THE STAFF PIN — typed blind on a locked room's keyboard, then Return. */}
      <div className="c-panel" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, padding: '8px 16px', marginBottom: 12 }}>
        <div style={{ minWidth: 150 }}>
          <div style={lbl}>Staff PIN</div>
          <div className="c-mono" style={{ fontSize: 20, letterSpacing: '.18em', marginTop: 2 }}>
            {pin ? (pinShown ? pin : '••••••') : '—'}
          </div>
        </div>
        <button className="c-soft c-control c-raised" onClick={() => setPinShown(v => !v)}>{pinShown ? 'Hide' : 'Show'}</button>
        <div style={{ flex: 1, minWidth: 180, fontSize: 11.5, opacity: 0.5, lineHeight: 1.4 }}>
          Not shown on the lock screen. On a locked room, type the six digits on that room&apos;s keyboard and press Return.
        </div>
        <input
          className="c-input c-mono"
          inputMode="numeric" maxLength={6} placeholder="New six digits"
          value={newPin}
          onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={e => { if (e.key === 'Enter') savePin() }}
          style={{ width: 150, textAlign: 'center', letterSpacing: '.14em' }}
        />
        <button className="c-btn c-control c-raised-primary" disabled={newPin.length !== 6} style={{ opacity: newPin.length === 6 ? 1 : 0.4 }} onClick={savePin}>Change PIN</button>
      </div>

      {loading && <div style={{ opacity: 0.5 }}>Loading…</div>}

      {STUDIO_LOCATIONS.map(loc => {
        const list = loc.rooms
          .map(studio => rooms.find(r => r.location === loc.name && r.studio === studio))
          .filter((r): r is RoomLock => !!r)
        if (!list.length) return null
        // Hidden studios stay hidden only while every room in them is plainly unlocked.
        const quiet = list.every(r => r.state === 'unlocked')
        if (!showAll && HIDDEN_BY_DEFAULT.includes(loc.name) && quiet) return null
        return (
          <div key={loc.name} style={{ marginBottom: 12 }}>
            <div style={{ ...lbl, marginBottom: 6 }}>{loc.name}</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${CARD_W}px)`, gap: 12 }}>
              {list.map(r => {
                const setUp = !!r.agent_seen_at
                const online = setUp && now - new Date(r.agent_seen_at!).getTime() < OFFLINE_AFTER_MS
                const left = r.state === 'warning' && r.lock_at ? new Date(r.lock_at).getTime() - now : 0
                // A warning that has run out IS a lock, even if the Mac has
                // not checked in yet to make it official.
                const locked = r.state === 'locked' || (r.state === 'warning' && left <= 0)
                const warning = r.state === 'warning' && !locked
                const isBusy = busy === r.room_slug
                return (
                  <div key={r.room_slug} style={{
                    width: CARD_W, height: CARD_H, borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column',
                    background: 'var(--c-srf, var(--c-bg))',
                    boxShadow: locked ? 'inset 0 0 0 2px var(--c-st-hot), 0 8px 22px rgba(0,0,0,.22)'
                      : warning ? 'inset 0 0 0 2px var(--c-st-warm), 0 8px 22px rgba(0,0,0,.22)'
                      : '0 2px 5px rgba(0,0,0,.25), 0 8px 22px rgba(0,0,0,.22)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 800, fontSize: 15 }}>
                      {r.studio}
                      {/* The setup line stays reachable after a room is set up
                          (2026-11-19: once the dot went green the only way to
                          it was gone, and a rebuild needs it). */}
                      {setUp && (
                        <button title="Setup line for this room’s Mac" onClick={() => setSetupFor(r)}
                          style={{ marginLeft: 'auto', marginRight: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.4 }}>Setup</button>
                      )}
                      <span title={!setUp ? 'No Mac connected yet' : online ? 'This room’s Mac is listening' : 'This room’s Mac is offline'}
                        style={{ width: 8, height: 8, borderRadius: 99, background: online ? 'var(--c-st-booked)' : 'var(--c-fg)', opacity: online ? 1 : 0.3 }} />
                    </div>
                    <div style={{ ...lbl, opacity: 1, marginTop: 6, color: locked ? 'var(--c-st-hot)' : warning ? 'var(--c-st-warm)' : undefined }}>
                      <span style={{ opacity: locked || warning ? 1 : 0.45 }}>
                        {!setUp ? 'Not set up' : locked ? 'Locked' : warning ? `Locks in ${fmtLeft(left)}` : 'Unlocked'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.5, marginTop: 3, height: 31, overflow: 'hidden', lineHeight: 1.4 }}>
                      {!setUp ? 'No Mac connected yet'
                        : !online ? 'Mac offline — it will catch up when it is back'
                        : r.changed_by ? `${r.changed_by} · ${fmtWhen(r.changed_at)}` : ''}
                    </div>
                    <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {!setUp ? (
                        <button className="c-soft c-control c-raised" onClick={() => setSetupFor(r)}>Set up this room</button>
                      ) : locked ? (
                        <button className="c-control" disabled={isBusy} onClick={() => act(r, 'unlock')}
                          style={bigBtn('var(--c-st-booked)', 'var(--c-chip-ink)')}>Unlock room</button>
                      ) : warning ? (<>
                        <button className="c-control" disabled={isBusy} onClick={() => act(r, 'lock')} style={bigBtn('var(--c-st-hot)', '#1a0b09')}>Lock now</button>
                        <button className="c-soft c-control c-raised" disabled={isBusy} onClick={() => act(r, 'unlock')}>Cancel warning</button>
                      </>) : (<>
                        <button className="c-control" disabled={isBusy} onClick={() => act(r, 'warn')} style={bigBtn('var(--c-st-warm)', '#1f1408')}>30-min warning</button>
                        <button className="c-soft c-control c-raised" disabled={isBusy} onClick={() => act(r, 'lock')}>Lock now</button>
                      </>)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Nothing is hidden silently: this line says what is, and undoes it. */}
      {!loading && (
        <div style={{ fontSize: 11.5, opacity: 0.55, marginBottom: 10 }}>
          {showAll ? 'Showing every studio.' : `${HIDDEN_BY_DEFAULT.join(' and ')} are hidden (not operating).`}{' '}
          <button onClick={toggleShowAll} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>
            {showAll ? `Hide ${HIDDEN_BY_DEFAULT.join(' and ')}` : 'Show them'}
          </button>
        </div>
      )}

      {/* THE LOG — fixed height, scrolls inside. */}
      <div style={{ ...lbl, margin: '4px 0 6px' }}>Log</div>
      <div className="c-panel" style={{ height: 132, overflowY: 'auto', padding: '8px 14px', fontSize: 12.5 }}>
        {log.length === 0 && <div style={{ opacity: 0.45, padding: '8px 0' }}>Nothing yet.</div>}
        {log.map(l => (
          <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '130px 190px 1fr', gap: 10, padding: '5px 0' }}>
            <span className="c-mono" style={{ fontSize: 11, opacity: 0.55 }}>{fmtWhen(l.created_at)}</span>
            <span style={{ fontWeight: 700 }}>{roomLabel(l.room_slug)}</span>
            <span><span style={{ opacity: 0.9 }}>{l.action}</span> <span style={{ opacity: 0.5 }}>· {l.by_name ?? '—'}</span></span>
          </div>
        ))}
      </div>

      {setupFor && (
        <Overlay onClose={() => setSetupFor(null)} width={560}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>Set up {setupFor.location} · {setupFor.studio}</div>
          <div style={{ fontSize: 12.5, opacity: 0.7, lineHeight: 1.6 }}>
            1. On Eli&apos;s Mac, paste this in Terminal. It makes a folder on the Desktop.<br />
            2. AirDrop that folder to the room&apos;s Mac and follow the README inside it.
          </div>
          <SetupCmd cmd={`cd ~/dev/prsflow && ./scripts/room-lock/build.sh ${setupFor.room_slug} ${setupFor.agent_key}`} />
          <div style={{ fontSize: 11.5, opacity: 0.5 }}>The long code is this room&apos;s key. Anyone holding it can unlock this room, so don&apos;t share it.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="c-soft c-control c-raised" onClick={() => setSetupFor(null)}>Done</button>
          </div>
        </Overlay>
      )}
    </div>
  )
}

const bigBtn = (bg: string, ink: string): CSSProperties => ({
  border: 'none', borderRadius: 99, padding: '9px 0', width: '100%', cursor: 'pointer', fontFamily: 'inherit',
  fontWeight: 800, fontSize: 12.5, background: bg, color: ink,
})

function Overlay({ children, onClose, width = 360 }: { children: React.ReactNode; onClose: () => void; width?: number }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10010, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width, maxWidth: '100%', background: 'var(--c-srf, var(--c-bg))', borderRadius: 14, padding: 18, boxShadow: '0 8px 48px rgba(0,0,0,.6)' }}>
        {children}
      </div>
    </div>
  )
}

function SetupCmd({ cmd }: { cmd: string }) {
  return (
    <div className="c-panel" style={{ margin: '12px 0 8px', display: 'flex', gap: 10, alignItems: 'center' }}>
      <code className="c-mono" style={{ fontSize: 11, flex: 1, wordBreak: 'break-all', userSelect: 'all' }}>{cmd}</code>
      <button className="c-btn c-control c-raised-primary" onClick={async () => {
        try { await navigator.clipboard.writeText(cmd); toast('Copied') } catch { toast('Could not copy — select the text and copy it by hand.', 'error') }
      }}>Copy</button>
    </div>
  )
}
