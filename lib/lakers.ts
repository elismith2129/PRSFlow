// ─────────────────────────────────────────────────────────────────────────────
// Lakers tickets (Eli, 2026-10-01; mock docs/design-refs/lakers-topclients-options.html).
// Replaces the "Lakers Tickets Log" spreadsheet. One row per game: who got the
// pair, who was offered and passed, and Eli's two ticks — claimed on his
// account, claimed by the recipient. Owners only (RLS). A season is "25-26";
// the first season shown is the newest one that exists.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'

export type LakersGame = {
  id: string
  season: string
  game_date: string
  game_time: string | null
  opponent: string
  arena: string | null
  recipient: string | null
  company: string | null
  passed: string[]
  claimed_mine: boolean
  claimed_theirs: boolean
  note: string | null
}

const COLS = 'id, season, game_date, game_time, opponent, arena, recipient, company, passed, claimed_mine, claimed_theirs, note'

/** The season a date falls in: Oct–Jun. Jul–Sep counts toward the season ahead. */
export function seasonFor(isoDate: string): string {
  const y = parseInt(isoDate.slice(0, 4), 10)
  const m = parseInt(isoDate.slice(5, 7), 10)
  const start = m >= 7 ? y : y - 1
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`
}

export async function fetchSeasons(): Promise<string[]> {
  const { data, error } = await supabase.from('lakers_games').select('season')
  if (!dbResult('Loading Lakers seasons', error)) return []
  return Array.from(new Set((data ?? []).map(r => r.season as string))).sort().reverse()
}

export async function fetchGames(season: string): Promise<LakersGame[]> {
  const { data, error } = await supabase.from('lakers_games').select(COLS)
    .eq('season', season).order('game_date', { ascending: true })
  if (!dbResult('Loading Lakers games', error)) return []
  return (data ?? []).map(r => ({ ...r, passed: (r.passed as string[] | null) ?? [] })) as LakersGame[]
}

/** Every recipient across all seasons, with how many games they've had — for
 *  the name suggestions (so it's easy not to repeat someone). */
export async function fetchRecipientCounts(): Promise<{ name: string; company: string | null; total: number; bySeason: Record<string, number> }[]> {
  const { data, error } = await supabase.from('lakers_games').select('season, recipient, company').not('recipient', 'is', null)
  if (!dbResult('Loading Lakers recipients', error)) return []
  const m = new Map<string, { name: string; company: string | null; total: number; bySeason: Record<string, number> }>()
  for (const r of data ?? []) {
    const name = String(r.recipient).trim()
    const k = name.toLowerCase()
    if (!m.has(k)) m.set(k, { name, company: (r.company as string | null) ?? null, total: 0, bySeason: {} })
    const e = m.get(k)!
    e.total++
    e.bySeason[r.season as string] = (e.bySeason[r.season as string] ?? 0) + 1
    if (!e.company && r.company) e.company = r.company as string
  }
  return Array.from(m.values())
}

export async function saveGame(g: Partial<LakersGame> & { season: string; game_date: string; opponent: string }): Promise<boolean> {
  const payload = {
    season: g.season, game_date: g.game_date, game_time: g.game_time || null, opponent: g.opponent.trim(),
    arena: g.arena || null, recipient: g.recipient?.trim() || null, company: g.company?.trim() || null,
    passed: (g.passed ?? []).map(p => p.trim()).filter(Boolean),
    claimed_mine: !!g.claimed_mine, claimed_theirs: !!g.claimed_theirs, note: g.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  const { error } = g.id
    ? await supabase.from('lakers_games').update(payload).eq('id', g.id)
    : await supabase.from('lakers_games').insert(payload)
  return dbResult('Saving Lakers game', error)
}

export async function setTick(id: string, field: 'claimed_mine' | 'claimed_theirs', on: boolean): Promise<boolean> {
  const { error } = await supabase.from('lakers_games').update({ [field]: on, updated_at: new Date().toISOString() }).eq('id', id)
  return dbResult('Saving Lakers tick', error)
}

export async function deleteGame(id: string): Promise<boolean> {
  const { error } = await supabase.from('lakers_games').delete().eq('id', id)
  return dbResult('Deleting Lakers game', error)
}

/**
 * "Paste schedule": the home-game list Eli copies off the web each year. One
 * game per line; a date anywhere in the line (10/21/2025, 2025-10-21, or
 * "Oct 21" / "Tue, Oct 21" with the season's year inferred), an optional time
 * ("7:00 PM", "7:30p"), and the rest is the opponent ("vs" / "@" stripped).
 * Lines without a date are skipped and reported.
 */
export function parseSchedule(text: string, season: string): { games: { game_date: string; game_time: string | null; opponent: string }[]; skipped: string[] } {
  const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
  const startYear = 2000 + parseInt(season.slice(0, 2), 10)
  const games: { game_date: string; game_time: string | null; opponent: string }[] = []
  const skipped: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\t/g, ' ').trim()
    if (!line) continue
    let y = 0, mo = 0, d = 0
    let m = line.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3] }
    else if ((m = line.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) {
      mo = +m[1]; d = +m[2]; y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : (mo >= 7 ? startYear : startYear + 1)
    } else if ((m = line.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i))) {
      mo = MONTHS[m[1].toLowerCase()]; d = +m[2]; y = m[3] ? +m[3] : (mo >= 7 ? startYear : startYear + 1)
    }
    if (!y || !mo || !d) { skipped.push(raw); continue }
    line = line.replace(m![0], ' ')
    const tm = line.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?\b/i)
    let time: string | null = null
    if (tm) { time = `${+tm[1]}:${tm[2] ?? '00'} ${tm[3].toUpperCase()}M`; line = line.replace(tm[0], ' ') }
    const opponent = line
      .replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?/gi, ' ')
      .replace(/\b(vs\.?|v\.|@|at)\s+/gi, ' ')
      .replace(/\b(PT|PDT|PST|ET)\b/g, ' ')
      .replace(/[,|·-]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!opponent) { skipped.push(raw); continue }
    games.push({ game_date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, game_time: time, opponent })
  }
  return { games, skipped }
}

export async function insertSchedule(season: string, games: { game_date: string; game_time: string | null; opponent: string }[]): Promise<boolean> {
  if (games.length === 0) return true
  const { error } = await supabase.from('lakers_games').upsert(
    games.map(g => ({ season, ...g, arena: 'Crypto.com Arena' })),
    { onConflict: 'season,game_date,opponent', ignoreDuplicates: true },
  )
  return dbResult('Adding the schedule', error)
}
