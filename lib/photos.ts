import { supabase } from '@/lib/supabase'

// checklist-photos is a PRIVATE bucket (see the RLS security migration). It has
// no permanent public URL, so we store the storage PATH in the DB and mint a
// short-lived signed URL at read time.

const BUCKET = 'checklist-photos'
const TTL_SECONDS = 3600 // 1 hour

// Rows written while the bucket was public stored a full public URL; new rows
// store a bare storage path. Normalize either form to a storage path.
export function toStoragePath(value: string): string {
  if (!value) return value
  const marker = `/${BUCKET}/`
  const idx = value.indexOf(marker)
  if (idx !== -1) return value.slice(idx + marker.length)
  return value
}

// Sign a single path (or legacy URL). Returns null on failure.
export async function signedPhotoUrl(pathOrUrl: string): Promise<string | null> {
  if (!pathOrUrl) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(toStoragePath(pathOrUrl), TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

// Sign an array of paths (or legacy URLs) in one call. Preserves order; drops
// any that fail to sign.
export async function signedPhotoUrls(pathsOrUrls: string[]): Promise<string[]> {
  if (!pathsOrUrls || pathsOrUrls.length === 0) return []
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(pathsOrUrls.map(toStoragePath), TTL_SECONDS)
  if (error || !data) return []
  return data.map(d => d.signedUrl).filter(Boolean) as string[]
}
