import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
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
