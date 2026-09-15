// ─────────────────────────────────────────────────────────────────────────────
// lib/runnerChannel — the notes room's data (Eli, 2026-09-15; mock
// docs/design-refs/runner-channel-options.html, option A; migration
// 20260915120000).
//
//   · CHANNELS: the four studios + 'general'. A studio hub shows its own
//     channel and General; Daily Ops shows all five.
//   · MENTIONS resolve against the roster (mention_roster RPC — names only,
//     so runners can tag office and vice versa without reading profiles).
//     Parsed at send from the plain text: "@Hunter" matches a first name,
//     "@Hunter K" a first name + last initial, case-insensitive.
//   · MENTION + TIME = TASK. Exactly one mention and a time token in the
//     same message ("3pm", "3:30", "15:00", "3 pm") makes a studio task for
//     that person with the time on it. Only in a studio channel — a task
//     needs a hub to land on.
//   · READS: runner_note_reads via channel_read(); unread = posts after my
//     last read that aren't mine. "For you" = unread posts that mention me.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, type UserProfile } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { noteText } from '@/components/shared/RichNote'

export type ChannelKey = 'paramount' | 'ameraycan' | 'encore' | 'track' | 'general'
export const STUDIO_CHANNELS: ChannelKey[] = ['paramount', 'ameraycan', 'encore', 'track']
export const CHANNEL_SHORT: Record<ChannelKey, string> = {
  paramount: 'PRS', ameraycan: 'ARS', encore: 'ERS', track: 'TRK', general: 'General',
}
export const isChannel = (s: string): s is ChannelKey => s in CHANNEL_SHORT

export type RosterPerson = { id: string; display_name: string; initials: string | null; role: UserProfile['role'] }

export type ChannelPost = {
  id: string
  channel: ChannelKey
  studio: string | null
  author_id: string | null
  author_name: string
  role: 'opener' | 'floater' | 'closer' | null
  source: 'runner' | 'office'
  text: string
  photo_urls: string[] | null
  mentions: string[]
  task_id: string | null
  created_at: string
  updated_at: string
}

// ── Roster ────────────────────────────────────────────────────────────────────

let rosterCache: { at: number; rows: RosterPerson[] } | null = null

/** Everyone taggable. Cached a minute — the roster changes by the month. */
export async function fetchRoster(): Promise<RosterPerson[]> {
  if (rosterCache && Date.now() - rosterCache.at < 60_000) return rosterCache.rows
  const { data, error } = await supabase.rpc('mention_roster')
  if (!dbResult('Loading who can be tagged', error, { silent: true })) return rosterCache?.rows ?? []
  const rows = ((data ?? []) as RosterPerson[]).filter(r => (r.display_name ?? '').trim() !== '')
  rosterCache = { at: Date.now(), rows }
  return rows
}

export function firstName(p: Pick<RosterPerson, 'display_name'>): string {
  return (p.display_name ?? '').trim().split(/\s+/)[0] ?? ''
}
export function avatarInitials(p: Pick<RosterPerson, 'display_name' | 'initials'>): string {
  if (p.initials && p.initials.trim()) return p.initials.trim().slice(0, 3).toUpperCase()
  return (p.display_name ?? '').trim().split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()
}
export const isOfficeRole = (role: UserProfile['role'] | string) => role !== 'runner'

/**
 * The canonical handle the composer inserts: the first name when it's unique
 * on the roster, else first name + last initial ("Tom S"). The parser accepts
 * both forms, so a hand-typed "@Tom" still resolves when it's unambiguous.
 */
export function handleFor(p: RosterPerson, roster: RosterPerson[]): string {
  const fn = firstName(p)
  const clash = roster.some(o => o.id !== p.id && firstName(o).toLowerCase() === fn.toLowerCase())
  if (!clash) return fn
  const last = (p.display_name ?? '').trim().split(/\s+/)[1]
  return last ? `${fn} ${last[0].toUpperCase()}` : fn
}

/** "@Hunter", "@Tom S" → roster ids. Unresolvable handles are ignored. */
export function parseMentions(html: string, roster: RosterPerson[]): RosterPerson[] {
  const text = noteText(html)
  const out = new Map<string, RosterPerson>()
  const re = /@([A-Za-z][A-Za-z'\-]*)(?:\s([A-Za-z]))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const fn = m[1].toLowerCase()
    const li = (m[2] ?? '').toLowerCase()
    const cands = roster.filter(p => firstName(p).toLowerCase() === fn)
    let hit: RosterPerson | undefined
    if (cands.length === 1) hit = cands[0]
    else if (cands.length > 1 && li) {
      hit = cands.find(p => ((p.display_name ?? '').trim().split(/\s+/)[1] ?? '')[0]?.toLowerCase() === li)
    }
    if (hit) out.set(hit.id, hit)
  }
  return [...out.values()]
}

/** The first time in the message, normalized to "3:00 PM"; null if none. */
export function parseTime(html: string): string | null {
  const text = noteText(html)
  // "3pm" "3 pm" "3:30pm" "3:30" "15:00" "@ 3" is too loose — a bare number
  // is not a time; it needs a colon or an am/pm.
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b|\b(\d{1,2}):(\d{2})\b/i
  const m = re.exec(text)
  if (!m) return null
  let h: number, min: number
  if (m[1]) {
    h = parseInt(m[1], 10); min = m[2] ? parseInt(m[2], 10) : 0
    const pm = /p/i.test(m[3])
    if (h === 12) h = pm ? 12 : 0
    else if (pm) h += 12
  } else {
    h = parseInt(m[4], 10); min = parseInt(m[5], 10)
  }
  if (h > 23 || min > 59) return null
  const disp = h % 12 === 0 ? 12 : h % 12
  return `${disp}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** The task's text: the message minus the handle and the time token. */
export function taskTextFrom(html: string, handle: string): string {
  let t = noteText(html)
  t = t.replace(new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), '')
  t = t.replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b|\b\d{1,2}:\d{2}\b/i, '')
  return t.replace(/\s{2,}/g, ' ').replace(/^[\s,:\-–—]+|[\s,:\-–—]+$/g, '').trim()
}

/** Bold every @handle in the stored HTML — <b> survives sanitizeNote; a chip span would not. */
export function markMentions(html: string): string {
  // Not preceded by a word char or "." (emails), not already bold.
  return html.replace(/(?<![\w.>])@[A-Za-z][A-Za-z'\-]*(?:\s[A-Z](?![A-Za-z]))?/g, s => `<b>${s}</b>`)
}

// ── Reads / unread ────────────────────────────────────────────────────────────

export async function markChannelRead(channel: ChannelKey): Promise<void> {
  const { error } = await supabase.rpc('channel_read', { p_channel: channel })
  dbResult('Recording notes read', error, { silent: true })
}

export type ChannelUnread = { channel: ChannelKey; unread: number; forMe: number; lastReadAt: string | null; latest: ChannelPost | null }

/**
 * Unread + "for you" per channel, and the latest post — the hub doorway and
 * the room's tabs. One query per channel over a 30-day window: a runner who
 * hasn't opened the app in a month is told "30+" by the cap, not a number.
 */
export async function fetchChannelUnread(me: Pick<UserProfile, 'id'>, channels: ChannelKey[]): Promise<ChannelUnread[]> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()
  const [{ data: reads }, { data: posts, error }] = await Promise.all([
    supabase.from('runner_note_reads').select('channel, last_read_at').eq('user_id', me.id),
    supabase.from('runner_note_posts').select('*').in('channel', channels).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(600),
  ])
  if (!dbResult('Loading notes', error, { silent: true })) return channels.map((c): ChannelUnread => ({ channel: c, unread: 0, forMe: 0, lastReadAt: null, latest: null }))
  const readAt = new Map((reads ?? []).map((r: any) => [r.channel as ChannelKey, r.last_read_at as string]))
  return channels.map(c => {
    const rows = ((posts ?? []) as ChannelPost[]).filter(p => p.channel === c)
    const lr = readAt.get(c) ?? null
    const fresh = rows.filter(p => p.author_id !== me.id && (!lr || p.created_at > lr))
    return {
      channel: c,
      unread: fresh.length,
      forMe: fresh.filter(p => (p.mentions ?? []).includes(me.id)).length,
      lastReadAt: lr,
      latest: rows[0] ?? null,
    }
  })
}
