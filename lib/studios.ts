export const STUDIO_LOCATIONS = [
  { name: 'Paramount', rooms: ['Studio A', 'Studio B', 'Studio C', 'Studio E', 'Studio X'] },
  { name: 'Ameraycan', rooms: ['Studio A', 'Studio B'] },
  { name: 'Encore', rooms: ['Studio A', 'Studio B'] },
  { name: 'Track', rooms: ['North', 'South'] },
]

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
