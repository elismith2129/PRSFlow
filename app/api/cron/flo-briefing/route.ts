import { NextResponse } from 'next/server'
import { generateFloBriefing } from '@/lib/server/floBriefing'

// FLO'S 8:50 BRIEFING — the Vercel cron entry point. The generator (data
// gathering, Flo's voice, the write) lives in lib/server/floBriefing.ts,
// shared with /api/flo-briefing-now (the dashboard button). Two UTC schedules
// (15:50 + 16:50) cover PDT/PST — the off-season run computes the previous
// ops-day or finds today's row and skips.

export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const force = new URL(request.url).searchParams.get('force') === '1'
  const result = await generateFloBriefing({ force, source: 'cron' })
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
