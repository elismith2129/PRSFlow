'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /lakers — the Lakers ticket log (Eli, 2026-10-01; mock
// docs/design-refs/lakers-topclients-options.html). Replaces the spreadsheet.
//
// Season list, one row per game grouped by month, no summary cards ("dont need
// the cards at the top"). The two ticks toggle right on the row: CLAIMED (on
// Eli's account) and TRANSFERRED (to the recipient) — renamed from Mine /
// Theirs on 2026-10-19; the columns are still claimed_mine / claimed_theirs.
//
// THE GAME POP-UP IS "SHEET" (2026-10-19, option A of
// docs/design-refs/lakers-game-popup-options.html). Eli: "all i need is basic
// game info at the top header. then a place to put who i offered to and a
// place to put who i gave them too. very simple." And, on the app at large:
// "a lot of bubbles in rounded sections… I want to take this opportunity to
// work on how information is displayed." So this card tests a rule that may go
// site-wide: A FILL MEANS PRESSABLE OR OPENABLE. Information sits straight on
// the surface — a small label on the left, the fact on the right — and a field
// is plain text at rest; the wash well appears only under the field you are
// in, then leaves. The header (date · time · opponent) is read-only text; tap
// it the once a year it needs correcting. "Offered" is a list, one name per
// line, no strike-through ("just a section where we can list"). Names
// autofill from client profiles exactly like the work order's client box
// (clients, A&R, artists) plus past recipients; a typed name that matches
// nothing is just a name — nothing here ever creates a client.
//
// Owners + Eli (RLS, migration 20261019120000; rail item under CRM). Model in
// lib/lakers.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { getLocalToday } from '@/lib/time'
import { toast } from '@/components/ui/Toaster'
import { PageTop } from '@/components/layout/PageTop'
import {
  fetchSeasons, fetchGames, fetchRecipientCounts, saveGame, setTick, deleteGame,
  parseSchedule, insertSchedule, seasonFor, searchNames, type LakersGame, type NameHit,
} from '@/lib/lakers'

const lbl: CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: '.11em', textTransform: 'uppercase', opacity: 0.45 }
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
  // The page top's search (2026-10-13) — finds a game by opponent, who got
  // the tickets, their company, who was offered, or the note.
  const [query, setQuery] = useState('')

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

  // Realtime (2026-10-19). The page loaded once and never subscribed, against
  // the house rule — a tick flipped on the tablet never reached the desktop
  // until a reload. One channel on the table; any change reloads the season
  // (and the seasons, in case a paste created one).
  useEffect(() => {
    if (!allowed) return
    const ch = supabase.channel('lakers-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lakers_games' }, () => { loadGames(); loadSeasons() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [allowed, loadGames, loadSeasons])

  const byMonth = useMemo(() => {
    const m: { key: string; label: string; games: LakersGame[] }[] = []
    const q = query.trim().toLowerCase()
    const shown = q ? games.filter(g => [g.opponent, g.recipient, g.company, g.note, ...(g.passed || [])].filter(Boolean).join(' ').toLowerCase().includes(q)) : games
    for (const g of shown) {
      const key = g.game_date.slice(0, 7)
      let b = m.find(x => x.key === key)
      if (!b) {
        b = { key, label: new Date(g.game_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), games: [] }
        m.push(b)
      }
      b.games.push(g)
    }
    return m
  }, [games, query])

  if (profile && !allowed) return <div className="c-bempty">Lakers tickets are for owners.</div>

  async function flip(g: LakersGame, f: 'claimed_mine' | 'claimed_theirs') {
    setGames(prev => prev.map(x => x.id === g.id ? { ...x, [f]: !g[f] } : x))
    if (!(await setTick(g.id, f, !g[f]))) loadGames()
  }

  const today = getLocalToday()

  return (
    <div style={{ maxWidth: 980 }}>
      {/* THE SHARED PAGE TOP (2026-10-13, components/layout/PageTop): the
          seasons are the view tabs, the two buttons sit on the right. Under
          CRM since the rail rework (it was under Admin). */}
      <PageTop
        crumb="CRM"
        title="Lakers"
        search={{ value: query, onChange: setQuery, placeholder: 'Search games — opponent, who got them, who was offered…' }}
        actions={<>
          <button className="c-soft c-control c-raised" onClick={() => setPasting(true)}>Paste schedule</button>
          <button className="c-btn c-control c-raised-primary" onClick={() => season && setEdit({ season, game_date: today, arena: 'Crypto.com Arena', passed: [] })}>+ Game</button>
        </>}
        views={seasons.map(s => ({ key: s, label: s }))}
        view={season ?? undefined}
        onView={s => { setSeason(s); setLoading(true) }}
      />

      {loading && <div className="c-bempty">Loading…</div>}
      {!loading && games.length === 0 && (
        <div className="c-bempty">No games in {season} yet. When the schedule drops, copy the home games off the web and use <b>Paste schedule</b>.</div>
      )}
      {!loading && games.length > 0 && byMonth.length === 0 && (
        <div className="c-bempty">No game matches that.</div>
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
                    // Offered names: muted text on one line, no chips, no strike
                    // (2026-10-19). "Offered" is the whole meaning.
                    <span style={{ display: 'block', fontSize: 11, opacity: 0.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', marginRight: 6 }}>Offered</span>
                      {g.passed.join(' · ')}
                    </span>
                  )}
                </span>
                <span style={{ display: 'flex', gap: 5, ...(isMobile ? { gridColumn: '1 / -1' } : {}) }} onClick={e => e.stopPropagation()}>
                  <button style={tick(g.claimed_mine)} title="Claimed on Eli's account" onClick={() => flip(g, 'claimed_mine')}>Claimed {g.claimed_mine ? '✓' : '—'}</button>
                  <button style={tick(g.claimed_theirs)} title="Transferred to the recipient" onClick={() => flip(g, 'claimed_theirs')}>Transferred {g.claimed_theirs ? '✓' : '—'}</button>
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

// ─── A field that is text at rest ────────────────────────────────────────────
// No well. The wash2 fill appears on focus and leaves on blur — one bubble at a
// time, and it's the one you're typing in. Optional name suggestions underneath
// (past recipients first, then client profiles); Enter / click picks one,
// Escape closes, and a name that matches nothing is simply kept as typed.

function NameField({ value, onChange, onPick, placeholder, recips, season, strong, autoFocus, onEnter }: {
  value: string
  onChange: (v: string) => void
  onPick?: (hit: NameHit) => void
  placeholder?: string
  recips: Recip[]
  season: string
  strong?: boolean
  autoFocus?: boolean
  onEnter?: () => void
}) {
  const [focus, setFocus] = useState(false)
  const [hits, setHits] = useState<NameHit[]>([])
  const [hi, setHi] = useState(-1)
  const q = value.trim().toLowerCase()
  const reqRef = useRef(0)

  useEffect(() => {
    if (!focus || q.length < 2) { setHits([]); return }
    const n = ++reqRef.current
    const t = setTimeout(async () => {
      const r = await searchNames(q)
      if (n === reqRef.current) setHits(r)
    }, 160)
    return () => clearTimeout(t)
  }, [q, focus])

  // Past recipients ranked first — the point of the sheet is not repeating
  // someone, so "had tickets before" is the first thing to see.
  const past = useMemo(() => q.length < 2 ? [] : recips
    .filter(r => r.name.toLowerCase().includes(q) || (r.company ?? '').toLowerCase().includes(q))
    .sort((a, b) => b.total - a.total).slice(0, 4), [recips, q])
  const fromFile = hits.filter(h => !past.some(p => p.name.toLowerCase() === h.name.toLowerCase()))
  const rows: { hit: NameHit; cnt?: string }[] = [
    ...past.map(r => ({ hit: { name: r.name, what: 'had tickets', company: r.company }, cnt: `${r.bySeason[season] ?? 0} this season · ${r.total} all` })),
    ...fromFile.map(h => ({ hit: h })),
  ]
  const exact = rows.some(r => r.hit.name.toLowerCase() === q)
  const open = focus && q.length >= 2 && (rows.length > 0 || !exact)

  const pick = (h: NameHit) => { onChange(h.name); onPick?.(h); setHits([]); setHi(-1) }

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={e => { onChange(e.target.value); setHi(-1) }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 120)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, rows.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, -1)) }
          else if (e.key === 'Escape') { setHits([]); setHi(-1) }
          else if (e.key === 'Enter') { e.preventDefault(); if (hi >= 0 && rows[hi]) pick(rows[hi].hit); else { setHits([]); onEnter?.() } }
        }}
        style={{
          display: 'block', width: '100%', border: 'none', outline: 'none', fontFamily: 'inherit',
          fontSize: strong ? 15 : 14, fontWeight: strong ? 700 : 500, color: 'var(--c-fg)',
          background: focus ? 'var(--c-wash2)' : 'transparent', borderRadius: 8, padding: '3px 8px', margin: '-3px -8px',
          transition: 'background .12s',
        }}
      />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: -8, right: -8, zIndex: 20, marginTop: 6, padding: '6px 0', borderRadius: 12,
          background: 'var(--c-srf)', boxShadow: 'var(--c-softsh), 0 10px 30px rgba(0,0,0,.35)', fontSize: 13 }}>
          {past.length > 0 && <div style={{ ...lbl, padding: '2px 12px' }}>Had tickets before</div>}
          {rows.map((r, i) => (
            <div key={r.hit.name + i}
              onMouseDown={e => { e.preventDefault(); pick(r.hit) }}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '5px 12px', alignItems: 'baseline', cursor: 'pointer',
                background: i === hi ? 'var(--c-wash2)' : 'transparent' }}>
              {i === past.length && fromFile.length > 0 && <div style={{ ...lbl, gridColumn: '1 / -1', marginTop: past.length ? 4 : 0, marginBottom: 2 }}>On file</div>}
              <span style={{ fontWeight: 600 }}>{r.hit.name}<span style={{ fontWeight: 400, opacity: 0.5, marginLeft: 7, fontSize: 12 }}>{[r.hit.what !== 'had tickets' ? r.hit.what : null, r.hit.company].filter(Boolean).join(' · ')}</span></span>
              <span style={{ fontSize: 10.5, opacity: 0.45, whiteSpace: 'nowrap' }}>{r.cnt ?? ''}</span>
            </div>
          ))}
          {!exact && (
            <div onMouseDown={e => { e.preventDefault(); setHits([]); setHi(-1); onEnter?.() }}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '5px 12px', opacity: 0.55, cursor: 'pointer' }}>
              <span>Use “{value.trim()}” as typed</span><span style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>no client made</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── The game sheet ───────────────────────────────────────────────────────────

function GameModal({ draft, recips, onClose, onSaved }: { draft: Draft; recips: Recip[]; onClose: () => void; onSaved: () => void }) {
  const [g, setG] = useState<Draft>({ ...draft, passed: draft.passed ?? [] })
  const [offerIn, setOfferIn] = useState('')
  const [editHead, setEditHead] = useState(!draft.id) // a new game has nothing to show yet
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Draft>) => setG(p => ({ ...p, ...patch }))
  const today = getLocalToday()

  // Takes the name explicitly when a suggestion is picked (2026-10-27: picking
  // "Will Cramer · Atlantic" added just "will"). The old onPick deferred to
  // addOffered with a setTimeout, but addOffered read `offerIn` from the
  // render it was made in — still the typed "will", not the picked name.
  const addOffered = (picked?: string) => {
    const v = (picked ?? offerIn).trim(); if (!v) return
    setG(p => (p.passed ?? []).some(x => x.toLowerCase() === v.toLowerCase()) ? p : { ...p, passed: [...(p.passed ?? []), v] })
    setOfferIn('')
  }
  const ok = !!g.game_date && !!(g.opponent ?? '').trim()

  const dt = g.game_date ? new Date(g.game_date + 'T12:00:00') : null
  const rel = !g.game_date ? '' : g.game_date === today ? 'today' : g.game_date < today ? 'played' : (() => {
    const d = Math.round((new Date(g.game_date + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000)
    return d === 1 ? 'tomorrow' : `in ${d} days`
  })()

  const row: CSSProperties = { display: 'grid', gridTemplateColumns: '92px 1fr', gap: 14, alignItems: 'baseline', padding: '7px 0' }
  const dot = (on: boolean): CSSProperties => ({ width: 8, height: 8, borderRadius: '50%', background: on ? 'var(--c-st-booked)' : 'var(--c-wash2)', display: 'inline-block' })
  const plain: CSSProperties = { display: 'block', width: '100%', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--c-fg)', background: 'transparent', borderRadius: 8, padding: '3px 8px', margin: '-3px -8px' }

  return (
    <div className="c-modal-backdrop" onClick={onClose}>
      <div className="c-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, padding: '22px 24px 20px' }}>

        {/* HEADER — fixed text. Tap to correct the once a year it's wrong. */}
        {!editHead ? (
          <div onClick={() => setEditHead(true)} title="Tap to edit the date, time or opponent"
            style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14, alignItems: 'baseline', marginBottom: 14, cursor: 'text' }}>
            <div className="c-mono" style={{ fontSize: 12, lineHeight: 1.25, opacity: 0.7 }}>
              {dt?.toLocaleDateString('en-US', { weekday: 'short' })}<br />
              {dt?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}<br />
              {g.game_time || <span style={{ opacity: 0.4 }}>time</span>}
            </div>
            <div>
              <div className="c-arch" style={{ fontSize: 20, letterSpacing: '-.02em', lineHeight: 1.1 }}>{g.opponent}</div>
              <div style={{ fontSize: 11.5, opacity: 0.5, marginTop: 3 }}>{[g.arena, `${g.season} season`, rel].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><span style={{ ...lbl, display: 'block', margin: '0 0 3px' }}>Date</span><input className="c-input" type="date" value={g.game_date ?? ''} onChange={e => set({ game_date: e.target.value })} /></div>
              <div><span style={{ ...lbl, display: 'block', margin: '0 0 3px' }}>Time</span><input className="c-input" value={g.game_time ?? ''} placeholder="7:30 PM" onChange={e => set({ game_time: e.target.value })} /></div>
            </div>
            <span style={{ ...lbl, display: 'block', margin: '10px 0 3px' }}>Opponent</span>
            <input className="c-input" value={g.opponent ?? ''} autoFocus={!g.id} placeholder="Golden State Warriors" onChange={e => set({ opponent: e.target.value })} />
            {g.id && <button type="button" className="c-bact" style={{ marginTop: 8 }} onClick={() => setEditHead(false)}>Done</button>}
          </div>
        )}

        {/* WENT TO — one field. The company rides along from a client match and
            can be typed over; a typed name just stands alone. */}
        <div style={row}>
          <span style={lbl}>Went to</span>
          <div>
            <NameField value={g.recipient ?? ''} onChange={v => set({ recipient: v })} onPick={h => set({ company: g.company || h.company || '' })}
              placeholder="Type a name" recips={recips} season={g.season} strong autoFocus={!!g.id} />
            {(g.recipient ?? '').trim() !== '' && (
              <input value={g.company ?? ''} placeholder="company" onChange={e => set({ company: e.target.value })}
                onFocus={e => (e.currentTarget.style.background = 'var(--c-wash2)')} onBlur={e => (e.currentTarget.style.background = 'transparent')}
                style={{ ...plain, fontSize: 12.5, fontWeight: 400, opacity: 0.7, marginTop: 0 }} />
            )}
          </div>
        </div>

        {/* OFFERED — a list. One name per line; every name here is someone it
            was offered to. No strike, no chips (Eli, 2026-10-19). */}
        <div style={row}>
          <span style={lbl}>Offered</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14 }}>
            {(g.passed ?? []).map((p, i) => (
              <div key={p + i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <span>{p}</span>
                <button type="button" className="c-x" title="Remove" onClick={() => set({ passed: (g.passed ?? []).filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <NameField value={offerIn} onChange={setOfferIn} onPick={h => addOffered(h.name)} onEnter={() => addOffered()}
              placeholder="+ name" recips={recips} season={g.season} />
          </div>
        </div>

        {/* CLAIMED — two dots. Green is on. */}
        <div style={row}>
          <span style={lbl}>Claimed</span>
          <div style={{ display: 'flex', gap: 22, fontSize: 13, fontWeight: 600 }}>
            <span role="button" onClick={() => set({ claimed_mine: !g.claimed_mine })} title="Claimed on Eli's account"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', opacity: g.claimed_mine ? 1 : 0.45 }}>
              <span style={dot(!!g.claimed_mine)} />Claimed</span>
            <span role="button" onClick={() => set({ claimed_theirs: !g.claimed_theirs })} title="Transferred to the recipient"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', opacity: g.claimed_theirs ? 1 : 0.45 }}>
              <span style={dot(!!g.claimed_theirs)} />Transferred</span>
          </div>
        </div>

        <div style={row}>
          <span style={lbl}>Note</span>
          <input value={g.note ?? ''} placeholder="—" onChange={e => set({ note: e.target.value })}
            onFocus={e => (e.currentTarget.style.background = 'var(--c-wash2)')} onBlur={e => (e.currentTarget.style.background = 'transparent')}
            style={{ ...plain, fontWeight: 400 }} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          {g.id && (
            <button className="c-bact" style={{ marginRight: 'auto', color: 'var(--c-st-hot)' }} disabled={busy}
              onClick={async () => { if (!confirm(`Delete ${g.opponent} on ${g.game_date}?`)) return; setBusy(true); if (await deleteGame(g.id!)) onSaved(); else setBusy(false) }}>Delete</button>
          )}
          <button className="c-bact" onClick={onClose}>Cancel</button>
          <button className="c-bact" disabled={!ok || busy}
            onClick={async () => {
              // A name still sitting in the Offered box counts — nobody should
              // lose one for not pressing Enter.
              const passed = [...(g.passed ?? [])]
              const v = offerIn.trim(); if (v && !passed.some(p => p.toLowerCase() === v.toLowerCase())) passed.push(v)
              setBusy(true); if (await saveGame({ ...g, passed } as any)) onSaved(); else setBusy(false)
            }}>Save</button>
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
