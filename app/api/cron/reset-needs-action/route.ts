import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now = new Date().toISOString()

  try {
    const { data, error } = await supabase
      .from('leads')
      .update({ needs_contact: true })
      .in('status', ['hot', 'warm'])
      .eq('needs_contact', false)
      .select('id')

    if (error) throw error

    return NextResponse.json({
      success: true,
      timestamp: now,
      reset_count: data?.length ?? 0,
    })
  } catch (error: any) {
    console.error('Reset needs-action cron error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
