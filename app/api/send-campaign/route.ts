import { NextRequest, NextResponse } from 'next/server'
import { MAIL_FROM_DEFAULT as FROM_ADDRESS } from '@/lib/sendMail'
import { createClient } from '@supabase/supabase-js'



interface Recipient {
  email: string
  name: string
}

interface SendCampaignBody {
  subject: string
  body: string
  recipients: Recipient[]
  segment_tags: string[]
  segment_statuses: string[]
  segment_billing: string | null
  sent_by: string
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Resend API key not configured — add RESEND_API_KEY to environment variables.' }, { status: 503 })
  }

  let body: SendCampaignBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { subject, body: emailBody, recipients, segment_tags, segment_statuses, segment_billing, sent_by } = body

  if (!subject?.trim() || !emailBody?.trim() || !recipients?.length) {
    return NextResponse.json({ error: 'Missing subject, body, or recipients' }, { status: 400 })
  }

  // Send emails via Resend (one at a time to allow per-recipient personalization)
  const results: { email: string; name: string; status: 'sent' | 'failed'; error?: string }[] = []
  let sent = 0
  let failed = 0

  for (const recipient of recipients) {
    const personalizedBody = emailBody.replace(/\[First Name\]/gi, recipient.name.split(' ')[0] || 'there')

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: recipient.email,
          subject,
          text: personalizedBody,
        }),
      })

      if (res.ok) {
        results.push({ email: recipient.email, name: recipient.name, status: 'sent' })
        sent++
      } else {
        const err = await res.json().catch(() => ({}))
        results.push({ email: recipient.email, name: recipient.name, status: 'failed', error: err?.message || `HTTP ${res.status}` })
        failed++
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      results.push({ email: recipient.email, name: recipient.name, status: 'failed', error: msg })
      failed++
    }
  }

  // Log to email_campaigns table (service role so RLS doesn't block the insert)
  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  await serviceSupabase.from('email_campaigns').insert({
    subject,
    body: emailBody,
    segment_tags: segment_tags || [],
    segment_statuses: segment_statuses || [],
    segment_billing: segment_billing || null,
    recipient_count: sent,
    sent_by,
    results,
  })

  return NextResponse.json({ sent, failed, results })
}
