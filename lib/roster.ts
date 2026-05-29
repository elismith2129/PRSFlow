import { supabase } from './supabase'

export async function getArtistsForLabel(clientId: string): Promise<string[]> {
  const { data } = await supabase
    .from('clients').select('artists').eq('id', clientId).single()
  return (data?.artists as string[]) || []
}

export async function addArtistToLabel(
  clientId: string,
  name: string,
  current?: string[],
): Promise<string[]> {
  const trimmed = name.trim()
  if (!trimmed) return current ?? []
  const existing = current ?? await getArtistsForLabel(clientId)
  if (existing.some(a => a.toLowerCase() === trimmed.toLowerCase())) return existing
  const updated = [...existing, trimmed]
  await supabase.from('clients').update({ artists: updated }).eq('id', clientId)
  return updated
}

export async function removeArtistFromLabel(
  clientId: string,
  name: string,
  current?: string[],
): Promise<string[]> {
  const existing = current ?? await getArtistsForLabel(clientId)
  const updated = existing.filter(a => a.toLowerCase() !== name.toLowerCase())
  await supabase.from('clients').update({ artists: updated }).eq('id', clientId)
  return updated
}
