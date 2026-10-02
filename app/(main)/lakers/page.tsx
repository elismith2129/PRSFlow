'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /lakers — the Lakers ticket log (Eli, 2026-10-01; mock
// docs/design-refs/lakers-topclients-options.html). Replaces the spreadsheet.
//
// Season list, one row per game grouped by month, no summary cards ("dont need
// the cards at the top"). Tap a game to give it: recipient (suggests everyone
// who's had tickets, with this season's count, so nobody gets repeated by
// accident), company, who was offered and passed. The two ticks are Eli's two
// checkboxes — claimed on his account, claimed by the recipient — and toggle
// right on the row. Paste schedule turns the home-game list he copies off the
// web each year into rows.
//
// Owners only (RLS on lakers_games; rail item under Admin, owner + Eli). Model
// in lib/lakers.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { getLocalToday } from '@/lib/time'
import { toast } from '@/components/ui/Toaster'
import {
  fetchSeasons, fetchGames, fetchRecipientCounts, saveGame, setTick, deleteGame,
  parseSchedule, insertSchedule, seasonFor, type LakersGame,
} from '@/lib/lakers'

const lbl: CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.5, display: 'block', margin: '10px 0 3px' }
const tick = (on: boolean): CSSProperties => ({
  fontSize: 9, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', padding: '5px 9px', borderRadius: 99,
  border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
  background: on ? 'var(--c-st-booked)' : 'var(--c-wash2)', color: on ? 'var(--c-chip-ink)' : 'var(--c-fg)', opacity: on ? 1 : 0.6,
})

type Draft = Partial<LakersGame> & { season: string }
type Recip = { name: string; company: string | null; total: number; bySeason: Record<string, number> }

export default function LakersPage() {
  const { profile } = useUserProfile()
  const isMobile = useIsMobile()
  const isEli = profile?.email === 'eli@paramountrecording.com'
  const allowed = profile?.role === 'owner' || isEli

  const current = seasonFor(getLocalToday())
  const [seasons, setSeasons] = useState<string[]>([])
  const [season, setSeason] = useState<string | null>(null)
  const [games, setGames] = useState<LakersGame[]>([])
  const [recips, setRecips] = useState<Recip[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Draft | null>(null)
  const [pasting, setPasting] = useState(false)

  const loadSeasons = useCallback(async () => {
    const s = await fetchSeasons()
    const all = Array.from(new Set([current, ...s])).sort().reverse()
    setSeasons(all)
    setSeason(prev => prev ?? (s.includes(current) ? current : (s[0] ?? current)))
  }, [current])

  const loadGames = useCallback(async () => {
    if (!season) return
    const [g, r] = await Promise.all([fetchGames(season), fetchRecipientCounts()])
    setGames(g); setRecips(r); setLoading(false)
  }, [season])

  useEffect(() => { if (allowed) loadSeasons() }, [allowed, loadSeasons])
  useEffect(() => { loadGames() }, [loadGames])

  const byMonth = useMemo(() => {
    const m: { key: string; label: string; games: LakersGame[] }[] = []
    for (const g of games) {
      const key = g.game_date.slice(0, 7)
      let b = m.find(x => x.key === key)
      if (!b) {
        b = { key, label: new Date(g.game_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), games: [] }
        m.push(b)
      }
      b.games.push(g)
    }
    return m
  }, [games])

  if (profile && !allowed) return <div className="c-bempty">Lakers tickets are for owners.</div>

  async function flip(g: LakersGame, f: 'claimed_mine' | 'claimed_theirs') {
    setGames(prev => prev.map(x => x.id === g.id ? { ...x, [f]: !g[f] } : x))
    if (!(await setTick(g.id, f, !g[f]))) loadGames()
  }

  const today = getLocalToday()

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 className="c-arch" style={{ fontSize: 22, letterSpacing: '-0.01em', margin: '2px 0' }}>Lakers {season ?? ''}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="c-seg">
            {seasons.map(s => (
              <button key={s} type="button" className={s === season ? 'c-on' : ''} onClick={() => { setSeason(s); setLoading(true) }} style={{ padding: '4px 12px' }}>{s}</button>
            ))}
          </div>
          <button className="c-bact" onClick={() => season && setEdit({ season, game_date: today, arena: 'Crypto.com Arena', passed: [] })}>+ Game</button>
          <button className="c-bact" onClick={() => setPasting(true)}>Paste schedule</button>
        </div>
      </div>

      {loading && <div className="c-bempty">Loading…</div>}
      {!loading && games.length === 0 && (
        <div className="c-bempty">No games in {season} yet. When the schedule drops, copy the home games off the web and use <b>Paste schedule</b>.</div>
      )}

      {!loading && byMonth.map(b => (
        <div key={b.key}>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.4, margin: '16px 2px 4px' }}>{b.label}</div>
          {b.games.map(g => {
            const dt = new Date(g.game_date + 'T12:00:00')
            const past = g.game_date < today
            return (
              <div key={g.id} className="c-panel" style={{
                display: 'grid', gridTemplateColumns: isMobile ? '58px 1fr' : '70px 170px 1fr auto', gap: 12, alignItems: 'center',
                padding: '9px 12px', marginTop: 5, fontSize: 12.5, cursor: 'pointer',
                ...(g.recipient || past ? {} : { outline: '1.5px dashed var(--c-st-warm)', outlineOffset: -1.5 }),
              }} onClick={() => setEdit({ ...g })}>
                <span className="c-mono" style={{ fontSize: 11, opacity: 0.65, lineHeight: 1.3 }}>
                  {dt.toLocaleDateString('en-US', { weekday: 'short' })} {dt.getDate()}
                  <span style={{ display: 'block', opacity: 0.7 }}>{g.game_time ?? ''}</span>
                </span>
                <span style={{ fontWeight: 700 }}>
                  {g.opponent}
                  {(g.note || (g.arena && g.arena !== 'Crypto.com Arena')) && (
                    <span style={{ display: 'block', fontSize: 10.5, fontWeight: 400, opacity: 0.5 }}>{[g.note, g.arena !== 'Crypto.com Arena' ? g.arena : null].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
                <span style={isMobile ? { gridColumn: '1 / -1' } : undefined}>
                  {g.recipient
                    ? <><b style={{ fontWeight: 700 }}>{g.recipient}</b>{g.company && <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 6 }}>{g.company}</span>}</>
                    : <span style={{ opacity: 0.4 }}>— not given yet</span>}
                  {g.passed.length > 0 && (
                    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.4, marginRight: 2 }}>Passed</span>
                      {g.passed.map(p => (
                        <span key={p} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'var(--c-wash2)', opacity: 0.8, textDecoration: 'line-through', textDecorationColor: 'var(--c-st-hot)' }}>{p}</span>
                      ))}
                    </span>
                  )}
                </span>
                <span style={{ display: 'flex', gap: 5, ...(isMobile ? { gridColumn: '1 / -1' } : {}) }} onClick={e => e.stopPropagation()}>
                  <button style={tick(g.claimed_mine)} title="Claimed on Eli's account" onClick={() => flip(g, 'claimed_mine')}>Mine {g.claimed_mine ? '✓' : '—'}</button>
                  <button style={tick(g.claimed_theirs)} title="Claimed by the recipient" onClick={() => flip(g, 'claimed_theirs')}>Theirs {g.claimed_theirs ? '✓' : '—'}</button>
                </span>
              </div>
            )
          })}
        </div>
      ))}

      {edit && (
        <GameModal draft={edit} recips={recips} onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); loadGames(); loadSeasons() }} />
      )}
      {pasting && season && (
        <PasteModal season={season} onClose={() => setPasting(false)}
          onDone={() => { setPasting(false); loadGames(); loadSeasons() }} />
      )}
    </div>
  )
}

function GameModal({ draft, recips, onClose, onSaved }: { draft: Draft; recips: Recip[]; onClose: () => void; onSaved: () => void }) {
  const [g, setG] = useState<Draft>({ ...draft, passed: draft.passed ?? [] })
  const [passIn, setPassIn] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Draft>) => setG(p => ({ ...p, ...patch }))
  const q = (g.recipient ?? '').trim().toLowerCase()
  const sugg = recips
    .filter(r => !q || r.name.toLowerCase().includes(q) || (r.company ?? '').toLowerCase().includes(q))
    .filter(r => r.name.toLowerCase() !== q)
    .sort((a, b) => b.total - a.total).slice(0, 8)
  const addPassed = () => {
    const v = passIn.trim(); if (!v) return
    set({ passed: [...(g.passed ?? []), ...v.split(',').map(s => s.trim()).filter(Boolean)] }); setPassIn('')
  }
  const ok = !!g.game_date && !!(g.opponent ?? '').trim()
  return (
    <div className="c-modal-backdrop" onClick={onClose}>
      <div className="c-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="c-arch" style={{ fontSize: 15, marginBottom: 2 }}>{g.id ? `${g.opponent}` : 'New game'}</div>
        <div style={{ fontSize: 11.5, opacity: 0.55 }}>Season {g.season}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><span style={lbl}>Date</span><input className="c-input" type="date" value={g.game_date ?? ''} onChange={e => set({ game_date: e.target.value })} style={{ width: '100%' }} /></div>
          <div><span style={lbl}>Time</span><input className="c-input" value={g.game_time ?? ''} placeholder="7:30 PM" onChange={e => set({ game_time: e.target.value })} style={{ width: '100%' }} /></div>
        </div>
        <span style={lbl}>Opponent</span>
        <input className="c-input" value={g.opponent ?? ''} onChange={e => set({ opponent: e.target.value })} style={{ width: '100%' }} />

        <span style={lbl}>Tickets go to</span>
        <input className="c-input" value={g.recipient ?? ''} placeholder="Type a name" autoFocus={!!g.id}
          onChange={e => set({ recipient: e.target.value })} style={{ width: '100%', fontSize: 14, fontWeight: 700 }} />
        {sugg.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {sugg.map(r => (
              <button key={r.name} type="button" onClick={() => set({ recipient: r.name, company: g.company || r.company })}
                style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 99, background: 'var(--c-wash2)', border: 'none', cursor: 'pointer', color: 'var(--c-fg)', fontFamily: 'inherit' }}>
                {r.name}<span style={{ opacity: 0.5, marginLeft: 4 }}>{[r.company, `${r.bySeason[g.season] ?? 0} this season · ${r.total} all`].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        )}
        <span style={lbl}>Company</span>
        <input className="c-input" value={g.company ?? ''} placeholder="Label / company" onChange={e => set({ company: e.target.value })} style={{ width: '100%' }} />

        <span style={lbl}>Offered — passed</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
          {(g.passed ?? []).map((p, i) => (
            <button key={p + i} type="button" title="Remove" onClick={() => set({ passed: (g.passed ?? []).filter((_, j) => j !== i) })}
              style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 99, background: 'var(--c-wash2)', border: 'none', cursor: 'pointer', color: 'var(--c-fg)', fontFamily: 'inherit' }}>{p} ×</button>
          ))}
        </div>
        <input className="c-input" value={passIn} placeholder="Type a name, Enter to add" onChange={e => setPassIn(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPassed() } }} onBlur={addPassed} style={{ width: '100%' }} />

        <span style={lbl}>Note</span>
        <input className="c-input" value={g.note ?? ''} placeholder="Playoffs, postponed, didn't go…" onChange={e => set({ note: e.target.value })} style={{ width: '100%' }} />

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {g.id && (
            <button className="c-bact" style={{ marginRight: 'auto', color: 'var(--c-st-hot)' }} disabled={busy}
              onClick={async () => { if (!confirm(`Delete ${g.opponent} on ${g.game_date}?`)) return; setBusy(true); if (await deleteGame(g.id!)) onSaved(); else setBusy(false) }}>Delete</button>
          )}
          <button className="c-bact" onClick={onClose}>Cancel</button>
          <button className="c-bact" disabled={!ok || busy}
            onClick={async () => { setBusy(true); if (await saveGame(g as any)) onSaved(); else setBusy(false) }}>Save</button>
        </div>
      </div>
    </div>
  )
}

function PasteModal({ season, onClose, onDone }: { season: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const parsed = useMemo(() => parseSchedule(text, season), [text, season])
  return (
    <div className="c-modal-backdrop" onClick={onClose}>
      <div className="c-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="c-arch" style={{ fontSize: 15, marginBottom: 2 }}>Paste the {season} schedule</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 10 }}>
          Home games only, one per line — date, time, opponent, in any order. e.g. <span className="c-mono">Tue, Oct 21 · 7:00 PM · vs Golden State Warriors</span>. Games already on the list are skipped.
        </div>
        <textarea className="c-input" value={text} onChange={e => setText(e.target.value)} rows={10} autoFocus
          style={{ width: '100%', fontFamily: "'DM Mono', monospace", fontSize: 12 }} />
        {text.trim() && (
          <div style={{ fontSize: 11.5, marginTop: 8 }}>
            <b>{parsed.games.length}</b> game{parsed.games.length === 1 ? '' : 's'} read
            {parsed.games.length > 0 && <> — first: {parsed.games[0].game_date} {parsed.games[0].game_time ?? ''} {parsed.games[0].opponent}</>}
            {parsed.skipped.length > 0 && <div style={{ color: 'var(--c-st-warm)', marginTop: 4 }}>{parsed.skipped.length} line{parsed.skipped.length === 1 ? '' : 's'} had no date and will be skipped: {parsed.skipped.slice(0, 3).join(' / ')}{parsed.skipped.length > 3 ? '…' : ''}</div>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="c-bact" onClick={onClose}>Cancel</button>
          <button className="c-bact" disabled={busy || parsed.games.length === 0}
            onClick={async () => {
              setBusy(true)
              if (await insertSchedule(season, parsed.games)) { toast(`${parsed.games.length} games added to ${season}.`); onDone() }
              else setBusy(false)
            }}>Add {parsed.games.length || ''} games</button>
        </div>
      </div>
    </div>
  )
}
