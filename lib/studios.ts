export const STUDIO_LOCATIONS = [
  { name: 'Paramount', rooms: ['Studio A', 'Studio B', 'Studio C', 'Studio E', 'Studio X'] },
  { name: 'Ameraycan', rooms: ['Studio A', 'Studio B'] },
  { name: 'Encore', rooms: ['Studio A', 'Studio B'] },
  { name: 'Track', rooms: ['North', 'South'] },
]

/**
 * Venue short codes. THE single source — WorkOrderPopup kept a private copy and
 * lib/woPdf needed the same map (2026-08-13), which is two copies too many for
 * something that prints on client paperwork.
 */
export const STUDIO_SHORT: Record<string, string> = {
  // Track is TRS, not TRK (Eli, 2026-08-13). Older code used TRK in three
  // separate private copies of this map; they now all import this one.
  Paramount: 'PRS', Ameraycan: 'ARS', Encore: 'ERS', Track: 'TRS',
}

/**
 * "A" + "Paramount" → "PRS A" (RULING 2026-08-13). A bare room letter is
 * ambiguous on paper — every venue has a Studio A — so the printed work order
 * always names the venue with it. Track's rooms are North/South, not letters,
 * so this yields "TRS North".
 *
 * Falls back to the bare room when the venue is unknown, never to a wrong code.
 */
export function roomCode(room: string | null | undefined, venue: string | null | undefined): string {
  const r = String(room ?? '').trim()
  if (!r) return ''
  const short = STUDIO_SHORT[String(venue ?? '').trim()]
  return short ? `${short} ${r}` : r
}

export function parseLocation(combined: string): { venue: string; studio: string } {
  const idx = combined.indexOf(' · ')
  if (idx === -1) return { venue: combined, studio: '' }
  return { venue: combined.slice(0, idx), studio: combined.slice(idx + 3) }
}

export function combineLocation(venue: string, studio: string): string {
  if (!venue) return ''
  if (!studio) return venue
  return `${venue} · ${studio}`
}
