import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// SERVER-ONLY service-role client — validates the caller's Supabase session
// token and backs the per-IP rate limiter. Never reaches the browser.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// Best-effort client IP. On Vercel, x-forwarded-for's first entry is the client.
function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function POST(req: NextRequest) {
  // ── Auth: require a valid Supabase session (Bearer access token). ──
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !userData?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Rate limit: 10 requests per minute per IP. ──
  const ip = clientIp(req)
  const { allowed } = await checkRateLimit(supabaseAdmin, 'ocr', ip, 10, 60_000)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429 })
  }

  try {
    const { image_base64, media_type } = await req.json()
    if (!image_base64) return NextResponse.json({ error: 'No image' }, { status: 400 })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: media_type ?? 'image/jpeg',
                data: image_base64,
              },
            },
            {
              type: 'text',
              text: 'This is a receipt or invoice. Extract the vendor name, total amount, and a brief item description. Respond ONLY with valid JSON in this exact format: {"vendor":"...","amount":"...","item":"..."}. Amount should be just a number without $ symbol. If you cannot determine a field, use an empty string.',
            },
          ],
        },
      ],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const match = text.match(/\{[^}]+\}/)
    if (!match) return NextResponse.json({ vendor: '', amount: '', item: '' })

    const parsed = JSON.parse(match[0])
    return NextResponse.json(parsed)
  } catch (err) {
    console.error('OCR error:', err)
    return NextResponse.json({ vendor: '', amount: '', item: '' })
  }
}
