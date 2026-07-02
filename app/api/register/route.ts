import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// This route runs on the Node.js runtime (needs Buffer + the service-role client).
export const runtime = 'nodejs'
// Never cache — every call re-validates the token against the live DB.
export const dynamic = 'force-dynamic'

// Service-role client. SERVER-ONLY: it bypasses RLS, so it must never be
// imported into a 'use client' file. The service-role key is a server env var.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
const MAX_FILE_BYTES = 25 * 1024 * 1024

// ─── GET /api/register?token=XXX ───────────────────────────────────────────
// Validates a registration token. Returns only the prefill fields the public
// form needs — never the full token row.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim()
  if (!token) {
    return NextResponse.json({ state: 'invalid' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('registration_tokens')
    .select('*')
    .eq('token', token)
    .single()

  if (error || !data) {
    return NextResponse.json({ state: 'invalid' })
  }
  if (data.used_at) {
    return NextResponse.json({ state: 'used' })
  }
  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ state: 'expired' })
  }

  return NextResponse.json({
    state: 'ok',
    prefill: {
      email: data.prefill_email || '',
      name: data.prefill_name || '',
    },
  })
}

// ─── POST /api/register ─────────────────────────────────────────────────────
// multipart/form-data body:
//   token                (required)
//   action               'submit' | 'use_existing'   (default 'submit')
//   acknowledge_conflict 'true' | 'false'            (submit only)
//   matched_client_id                                (use_existing only)
//   fname, lname, phone, email, instagram, how_heard,
//   address_street, address_street2, address_city, address_state,
//   address_zip, signature
//   id_file              (File; submit only)
export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const token = (form.get('token') as string | null)?.trim()
  const action = ((form.get('action') as string | null) || 'submit').trim()

  if (!token) {
    return NextResponse.json({ error: 'Missing token.' }, { status: 400 })
  }

  // Re-validate the token server-side on EVERY write — the browser is untrusted.
  const { data: tokenRow, error: tokenErr } = await supabaseAdmin
    .from('registration_tokens')
    .select('*')
    .eq('token', token)
    .single()

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: 'This registration link is invalid.' }, { status: 404 })
  }
  if (tokenRow.used_at) {
    return NextResponse.json({ error: 'This registration link has already been used.' }, { status: 409 })
  }
  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This registration link has expired.' }, { status: 410 })
  }

  // ── Action: link an existing matched client (the "Use & Link" button) ──
  if (action === 'use_existing') {
    const matchedClientId = ((form.get('matched_client_id') as string | null) || tokenRow.client_id) as string | null
    const fname = ((form.get('fname') as string | null) || '').trim()
    try {
      if (tokenRow.lead_id && matchedClientId) {
        const { error } = await supabaseAdmin
          .from('leads')
          .update({ client_id: matchedClientId })
          .eq('id', tokenRow.lead_id)
        if (error) throw new Error(error.message)
      }
      const { error: tokenUpdErr } = await supabaseAdmin
        .from('registration_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('token', token)
      if (tokenUpdErr) throw new Error(tokenUpdErr.message)

      return NextResponse.json({ success: true, name: fname })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  // ── Action: submit (create new client or update a migrated existing one) ──
  const fields = {
    fname: ((form.get('fname') as string | null) || '').trim(),
    lname: ((form.get('lname') as string | null) || '').trim(),
    phone: ((form.get('phone') as string | null) || '').trim(),
    email: ((form.get('email') as string | null) || '').trim(),
    instagram: ((form.get('instagram') as string | null) || '').trim(),
    how_heard: ((form.get('how_heard') as string | null) || '').trim(),
    address_street: ((form.get('address_street') as string | null) || '').trim(),
    address_street2: ((form.get('address_street2') as string | null) || '').trim(),
    address_city: ((form.get('address_city') as string | null) || '').trim(),
    address_state: ((form.get('address_state') as string | null) || '').trim().toUpperCase(),
    address_zip: ((form.get('address_zip') as string | null) || '').trim(),
    signature: ((form.get('signature') as string | null) || '').trim(),
  }
  const acknowledgeConflict = (form.get('acknowledge_conflict') as string | null) === 'true'
  const idFile = form.get('id_file') as File | null

  // Server-side validation (defense in depth; the browser validates too).
  if (!fields.fname || !fields.lname || !fields.phone || !fields.email) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const isExistingClient = !!tokenRow.client_id

  // Email conflict check — only for brand-new registrations, skipped when acknowledged.
  if (!isExistingClient && !acknowledgeConflict && fields.email) {
    const { data: existing } = await supabaseAdmin
      .from('clients')
      .select('id, type, name, fname, lname, email, phone, registered_at')
      .eq('email', fields.email.toLowerCase())
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ conflict: true, matchedClient: existing })
    }
  }

  const clientId = isExistingClient ? (tokenRow.client_id as string) : crypto.randomUUID()
  const fullName = `${fields.fname} ${fields.lname}`.trim()

  // Upload the ID file to the private client-ids bucket (service role).
  let idFileUrl: string | null = null
  if (idFile && typeof idFile.arrayBuffer === 'function' && idFile.size > 0) {
    if (idFile.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File must be under 25MB.' }, { status: 413 })
    }
    if (!ACCEPTED_MIME.includes(idFile.type)) {
      return NextResponse.json({ error: 'Accepted formats: JPEG, PNG, HEIC, WebP, PDF.' }, { status: 415 })
    }
    const timestamp = Date.now()
    const sanitizedName = idFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = `${clientId}/${timestamp}_${sanitizedName}`
    const arrayBuffer = await idFile.arrayBuffer()
    const { error: uploadError } = await supabaseAdmin.storage
      .from('client-ids')
      .upload(filePath, Buffer.from(arrayBuffer), { contentType: idFile.type, upsert: false })
    if (uploadError) {
      return NextResponse.json({ error: `ID upload failed: ${uploadError.message}` }, { status: 500 })
    }
    idFileUrl = filePath
  }

  try {
    if (isExistingClient) {
      const updateFields: Record<string, unknown> = {
        fname: fields.fname,
        lname: fields.lname,
        name: fullName,
        email: fields.email,
        phone: fields.phone,
        instagram: fields.instagram,
        how_heard: fields.how_heard || null,
        address_street: fields.address_street,
        address_street2: fields.address_street2 || null,
        address_city: fields.address_city,
        address_state: fields.address_state,
        signature_url: fields.signature,
        terms_accepted: true,
        terms_accepted_at: new Date().toISOString(),
        registered_at: new Date().toISOString(),
      }
      if (idFileUrl) updateFields.id_file_url = idFileUrl

      const { error: clientError } = await supabaseAdmin
        .from('clients')
        .update(updateFields)
        .eq('id', clientId)

      if (clientError) throw new Error(`Registration failed: ${clientError.message}`)
    } else {
      const { error: clientError } = await supabaseAdmin
        .from('clients')
        .insert({
          id: clientId,
          type: 'individual',
          name: fullName,
          fname: fields.fname,
          lname: fields.lname,
          email: fields.email,
          phone: fields.phone,
          instagram: fields.instagram,
          how_heard: fields.how_heard || null,
          address_street: fields.address_street,
          address_street2: fields.address_street2 || null,
          address_city: fields.address_city,
          address_state: fields.address_state,
          address_zip: fields.address_zip,
          id_file_url: idFileUrl,
          signature_url: fields.signature,
          terms_accepted: true,
          terms_accepted_at: new Date().toISOString(),
          registered_at: new Date().toISOString(),
          source_lead_id: tokenRow.lead_id || null,
          artists: [],
        })

      if (clientError) throw new Error(`Registration failed: ${clientError.message}`)

      if (tokenRow.lead_id) {
        const { error: leadError } = await supabaseAdmin
          .from('leads')
          .update({ client_id: clientId })
          .eq('id', tokenRow.lead_id)

        if (leadError) throw new Error(`Lead link failed: ${leadError.message}`)
      }
    }

    const { error: tokenUpdErr } = await supabaseAdmin
      .from('registration_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token)

    if (tokenUpdErr) throw new Error(`Token update failed: ${tokenUpdErr.message}`)

    return NextResponse.json({ success: true, name: fields.fname })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
