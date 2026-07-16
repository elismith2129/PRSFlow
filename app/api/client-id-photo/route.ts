import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Runs on the Node.js runtime (service-role client) and is never cached — each
// call mints a fresh short-lived signed URL.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Service-role client. SERVER-ONLY: it bypasses RLS, so it must never be
// imported into a 'use client' file. The service-role key is a server env var.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

const BUCKET = 'client-ids'
const TTL_SECONDS = 60 * 60 // 60 minutes

// Rows written while the bucket was public stored a full public URL; new rows
// store a bare storage path. Normalize either form to a storage path.
function toStoragePath(value: string): string {
  const marker = `/${BUCKET}/`
  const idx = value.indexOf(marker)
  if (idx !== -1) return value.slice(idx + marker.length)
  return value
}

// ─── GET /api/client-id-photo?storagePath=XXX ──────────────────────────────
// Signs a path in the private `client-ids` bucket and returns a temporary URL.
export async function GET(req: NextRequest) {
  const storagePath = req.nextUrl.searchParams.get('storagePath')
  if (!storagePath) {
    return NextResponse.json({ error: 'Missing storagePath.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(toStoragePath(storagePath), TTL_SECONDS)

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Could not sign the ID photo.' }, { status: 404 })
  }

  return NextResponse.json({ signedUrl: data.signedUrl })
}
