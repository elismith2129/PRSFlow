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
    // Find hot leads past their keep_hot_until deadline
    const { data: hotLeads, error: hotFetchError } = await supabase
      .from('leads')
      .select('id, fname, lname')
      .eq('status', 'hot')
      .lt('keep_hot_until', now)
      .not('keep_hot_until', 'is', null)

    if (hotFetchError) throw hotFetchError

    // Demote hot → warm, give 3 more days
    if (hotLeads && hotLeads.length > 0) {
      const newKeepWarmUntil = new Date()
      newKeepWarmUntil.setDate(newKeepWarmUntil.getDate() + 3)

      const { error } = await supabase
        .from('leads')
        .update({ status: 'warm', keep_hot_until: newKeepWarmUntil.toISOString() })
        .in('id', hotLeads.map(l => l.id))

      if (error) throw error
    }

    // Find warm leads past their keep_hot_until deadline
    const { data: warmLeads, error: warmFetchError } = await supabase
      .from('leads')
      .select('id, fname, lname')
      .eq('status', 'warm')
      .lt('keep_hot_until', now)
      .not('keep_hot_until', 'is', null)

    if (warmFetchError) throw warmFetchError

    // Demote warm → cold, clear timer
    if (warmLeads && warmLeads.length > 0) {
      const { error } = await supabase
        .from('leads')
        .update({ status: 'cold', keep_hot_until: null })
        .in('id', warmLeads.map(l => l.id))

      if (error) throw error
    }

    return NextResponse.json({
      success: true,
      timestamp: now,
      demoted_hot_to_warm: hotLeads?.length ?? 0,
      demoted_warm_to_cold: warmLeads?.length ?? 0,
    })
  } catch (error: any) {
    console.error('Auto-demote cron error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
