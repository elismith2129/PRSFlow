import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { SMS_CONSENT_TEXT } from '@/lib/terms'

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
    // Which form to show (v1.56.0). Old tokens have the column default.
    kind: data.kind === 'business' ? 'business' : 'individual',
    prefill: {
      email: data.prefill_email || '',
      name: data.prefill_name || '',
    },
  })
}

// ─── POST /api/register ─────────────────────────────────────────────────────
// multipart/form-data body:
//   token                (required)
//   action               'submit' | 'use_existing' | 'submit_business'   (default 'submit')
//   business             JSON (submit_business only) — see submitBusiness() below
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

  // ── Action: submit_business — the business / label form (v1.56.0) ──
  if (action === 'submit_business') {
    return submitBusiness(req, form, tokenRow as Record<string, unknown>, token)
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
    sms_opt_in: (form.get('sms_opt_in') as string | null) === 'true',
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
      // SMS: the box only ever turns consent ON here. A migrated client who
      // leaves it unticked keeps whatever they had — an unticked box on a
      // form is not a STOP.
      if (fields.sms_opt_in) {
        updateFields.sms_opt_in = true
        updateFields.sms_opt_in_at = new Date().toISOString()
        updateFields.sms_opt_in_phone = fields.phone
        updateFields.sms_opt_out_at = null
      }

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
          sms_opt_in: fields.sms_opt_in,
          sms_opt_in_at: fields.sms_opt_in ? new Date().toISOString() : null,
          sms_opt_in_phone: fields.sms_opt_in ? fields.phone : null,
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

    // The consent record — the exact words, the number, where it came from.
    // Append-only; this is the thing you produce if a carrier or a court asks.
    if (fields.sms_opt_in) {
      const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || null
      const { error: logErr } = await supabaseAdmin.from('sms_consent_log').insert({
        client_id: clientId,
        phone: fields.phone,
        action: 'opt_in',
        source: 'registration',
        consent_text: SMS_CONSENT_TEXT,
        ip,
        user_agent: req.headers.get('user-agent'),
      })
      if (logErr) throw new Error(`Consent log failed: ${logErr.message}`)
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

// ─── Business registration (v1.56.0) ─────────────────────────────────────────
// action 'submit_business'. The browser sends one JSON field, `business`, with
// the company, ONE billing/admin contact, the A&R contact(s), the invoicing
// answers, the signer and the two opt-ins. Creates (or, for a token minted
// from an existing label's profile, updates) a `label` client, attaches the
// contacts, and gives the client an AP profile carrying the PO / invoicing
// answers so the invoice's AP card has something to say from day one.
interface BusinessBody {
  company: string
  business_kind: string
  website: string
  address_street: string
  address_street2: string
  address_city: string
  address_state: string
  address_zip: string
  billing_fname: string
  billing_lname: string
  billing_email: string
  billing_phone: string
  invoice_email: string
  po_required: 'yes' | 'no' | 'sometimes'
  invoice_method: 'email' | 'portal' | 'both'
  anr: { fname: string; lname: string; title: string; email: string; phone: string }[]
  signer_name: string
  signer_title: string
  email_opt_in: boolean
  sms_opt_in: boolean
}

const BUSINESS_KINDS = ['label', 'management', 'publisher', 'brand', 'other']

async function submitBusiness(req: NextRequest, form: FormData, tokenRow: Record<string, unknown>, token: string) {
  let b: BusinessBody
  try {
    b = JSON.parse((form.get('business') as string | null) || '')
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const company = s(b.company)
  const billingEmail = s(b.billing_email).toLowerCase()
  const billingPhone = s(b.billing_phone)
  const signerName = s(b.signer_name)
  const signerTitle = s(b.signer_title)
  const anr = Array.isArray(b.anr)
    ? b.anr.map(a => ({ fname: s(a?.fname), lname: s(a?.lname), title: s(a?.title), email: s(a?.email).toLowerCase(), phone: s(a?.phone) }))
        .filter(a => a.fname || a.lname || a.email)
        .slice(0, 4)
    : []

  // Server-side validation (defense in depth; the browser validates too).
  if (!company || !s(b.billing_fname) || !s(b.billing_lname) || !billingEmail || !billingPhone || !signerName || !signerTitle) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }
  if (!['yes', 'no', 'sometimes'].includes(b.po_required) || !['email', 'portal', 'both'].includes(b.invoice_method)) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }
  const businessKind = BUSINESS_KINDS.includes(s(b.business_kind)) ? s(b.business_kind) : 'other'
  const acknowledgeConflict = (form.get('acknowledge_conflict') as string | null) === 'true'
  const isExistingClient = !!tokenRow.client_id

  // Email conflict check against the billing email — same rule as the
  // individual form: only for brand-new registrations, skipped once acknowledged.
  if (!isExistingClient && !acknowledgeConflict) {
    const { data: existing } = await supabaseAdmin
      .from('clients')
      .select('id, type, name, fname, lname, email, phone, registered_at')
      .eq('email', billingEmail)
      .order('registered_at', { ascending: false, nullsFirst: false })
      .limit(1)
    if (existing?.[0]) {
      return NextResponse.json({ conflict: true, matchedClient: existing[0] })
    }
  }

  const clientId = isExistingClient ? (tokenRow.client_id as string) : crypto.randomUUID()
  const now = new Date().toISOString()
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || null

  try {
    // 1. AP profile — the invoicing answers, where the invoice's AP card reads
    //    them. Named after the company; if a procedure with that name already
    //    exists (billing set it up by hand) we link to it rather than clobber.
    const submitTo = s(b.invoice_email) || billingEmail
    const submissionMethod = b.invoice_method === 'both' ? 'mixed' : b.invoice_method
    const poNotes = b.po_required === 'sometimes'
      ? 'Sometimes — ask the billing contact before invoicing. (Answered on the registration form.)'
      : b.po_required === 'yes' ? 'PO required on every invoice. (Answered on the registration form.)' : null
    let apProfileId: string | null = null
    const { data: existingProfile } = await supabaseAdmin.from('ap_profiles').select('id').eq('name', company).limit(1)
    if (existingProfile?.[0]) {
      apProfileId = existingProfile[0].id
    } else {
      const { data: prof, error: profErr } = await supabaseAdmin
        .from('ap_profiles')
        .insert({
          name: company,
          family: 'Other',
          submission_method: submissionMethod,
          po_required: b.po_required === 'yes',
          po_notes: poNotes,
          submit_to: submitTo,
          cc_to: s(b.invoice_email) ? billingEmail : null,
          tips: `Registered online ${new Date().toLocaleDateString('en-US')}. Billing contact: ${s(b.billing_fname)} ${s(b.billing_lname)} · ${billingEmail} · ${billingPhone}.`,
        })
        .select('id')
        .single()
      if (profErr) throw new Error(`AP profile failed: ${profErr.message}`)
      apProfileId = prof.id
    }

    // 2. The client. Billing contact's email/phone double as the client's own
    //    (that is what "Billing email" / "Billing phone" show on a label's
    //    profile today).
    const clientFields: Record<string, unknown> = {
      type: 'label',
      name: company,
      business_kind: businessKind,
      website: s(b.website) || null,
      email: billingEmail,
      phone: billingPhone,
      address_street: s(b.address_street),
      address_street2: s(b.address_street2) || null,
      address_city: s(b.address_city),
      address_state: s(b.address_state).toUpperCase(),
      address_zip: s(b.address_zip),
      signature_url: signerName,
      terms_signer_title: signerTitle,
      terms_accepted: true,
      terms_accepted_at: now,
      registered_at: now,
      ap_profile_id: apProfileId,
    }
    // Opt-ins only ever turn ON here — an unticked box is not a STOP.
    if (b.email_opt_in) { clientFields.email_opt_in = true; clientFields.email_opt_in_at = now; clientFields.email_opt_out = false }
    if (b.sms_opt_in) { clientFields.sms_opt_in = true; clientFields.sms_opt_in_at = now; clientFields.sms_opt_in_phone = billingPhone; clientFields.sms_opt_out_at = null }

    if (isExistingClient) {
      const { error } = await supabaseAdmin.from('clients').update(clientFields).eq('id', clientId)
      if (error) throw new Error(`Registration failed: ${error.message}`)
    } else {
      const { error } = await supabaseAdmin.from('clients').insert({
        id: clientId,
        ...clientFields,
        source_lead_id: tokenRow.lead_id || null,
        artists: [],
        email_opt_in: !!b.email_opt_in,
        email_opt_in_at: b.email_opt_in ? now : null,
        sms_opt_in: !!b.sms_opt_in,
        sms_opt_in_at: b.sms_opt_in ? now : null,
        sms_opt_in_phone: b.sms_opt_in ? billingPhone : null,
      })
      if (error) throw new Error(`Registration failed: ${error.message}`)
      if (tokenRow.lead_id) {
        const { error: leadError } = await supabaseAdmin.from('leads').update({ client_id: clientId }).eq('id', tokenRow.lead_id)
        if (leadError) throw new Error(`Lead link failed: ${leadError.message}`)
      }
    }

    // 3. Contacts. Billing/admin is ONE person (Eli: "there's never two") —
    //    contact_type 'admin' with role 'Billing / AP' so the work order's
    //    admin picker and the billing hub both find them. A&R → 'anr'.
    //    On an existing client we skip anyone whose email is already on it.
    const { data: already } = await supabaseAdmin.from('client_contacts').select('email').eq('client_id', clientId)
    const have = new Set((already || []).map(c => (c.email || '').toLowerCase()).filter(Boolean))
    const rows: Record<string, unknown>[] = []
    if (!have.has(billingEmail)) {
      rows.push({ client_id: clientId, fname: s(b.billing_fname), lname: s(b.billing_lname), email: billingEmail, phone: billingPhone, contact_type: 'admin', role: 'Billing / AP', artists: [] })
    }
    for (const a of anr) {
      if (a.email && have.has(a.email)) continue
      rows.push({ client_id: clientId, fname: a.fname, lname: a.lname, email: a.email || null, phone: a.phone || null, contact_type: 'anr', role: a.title || 'A&R', artists: [] })
    }
    if (rows.length) {
      const { error } = await supabaseAdmin.from('client_contacts').insert(rows)
      if (error) throw new Error(`Contacts failed: ${error.message}`)
    }

    // 4. Consent trail — same log, same wording rules as the individual form.
    if (b.sms_opt_in) {
      const { error } = await supabaseAdmin.from('sms_consent_log').insert({
        client_id: clientId, phone: billingPhone, action: 'opt_in', source: 'registration',
        consent_text: SMS_CONSENT_TEXT, ip, user_agent: req.headers.get('user-agent'),
      })
      if (error) throw new Error(`Consent log failed: ${error.message}`)
    }

    const { error: tokenUpdErr } = await supabaseAdmin.from('registration_tokens').update({ used_at: now }).eq('token', token)
    if (tokenUpdErr) throw new Error(`Token update failed: ${tokenUpdErr.message}`)

    return NextResponse.json({ success: true, name: company })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
