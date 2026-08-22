// Room slugs for the wall-display calendars (/display/[room]).
//
// Derived from STUDIO_LOCATIONS rather than hand-listed so a room added to the
// app cannot silently fail to have a display URL. The slug is what gets typed
// into a Sharp PN-B401 with a remote control, so it is short and lowercase:
//   Encore  · Studio B -> ers-b
//   Track   · North    -> trk-north
import { STUDIO_LOCATIONS } from './studios'

// Matches LOCATION_CODES in the calendar page. 'trs' is accepted as an alias
// for Track because that grid uses TRS while the rest of the shop says TRK —
// a wall display should not care which one someone remembered.
const VENUE_CODES: Record<string, string> = {
  Paramount: 'prs',
  Ameraycan: 'ars',
  Encore: 'ers',
  Track: 'trk',
}
const VENUE_ALIASES: Record<string, string> = { trs: 'trk' }

export type DisplayRoom = {
  slug: string
  location: string
  studio: string
  /** Short header label, e.g. "ERS · Studio B" */
  label: string
}

function roomCode(room: string): string {
  const m = room.match(/^Studio\s+(\w)$/i)
  if (m) return m[1].toLowerCase()
  return room.toLowerCase().replace(/\s+/g, '-')
}

export const DISPLAY_ROOMS: DisplayRoom[] = STUDIO_LOCATIONS.flatMap(loc => {
  const code = VENUE_CODES[loc.name]
  if (!code) return []
  return loc.rooms.map(room => ({
    slug: `${code}-${roomCode(room)}`,
    location: loc.name,
    studio: room,
    label: `${code.toUpperCase()} · ${room}`,
  }))
})

export function findDisplayRoom(slug: string): DisplayRoom | null {
  const s = (slug || '').trim().toLowerCase()
  if (!s) return null
  const direct = DISPLAY_ROOMS.find(r => r.slug === s)
  if (direct) return direct
  const dash = s.indexOf('-')
  if (dash > 0) {
    const alias = VENUE_ALIASES[s.slice(0, dash)]
    if (alias) return DISPLAY_ROOMS.find(r => r.slug === alias + s.slice(dash)) ?? null
  }
  return null
}
