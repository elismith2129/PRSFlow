import { SupabaseClient } from '@supabase/supabase-js'

// Fixed-window, per-IP request limiter backed by the api_rate_limits table.
// One window per (bucket, ip): the first request in a window stamps window_start
// and sets count=1; subsequent requests within windowMs increment count until it
// reaches `limit`, after which requests are denied until the window rolls over.
//
// Returns { allowed, retryAfter } where retryAfter is the whole seconds until the
// current window resets (0 when allowed). MUST be called with a service-role
// client — api_rate_limits has RLS on with no policies, so only the service role
// can read/write it.
//
// Note: this is a best-effort limiter. Two truly-simultaneous requests could both
// read the same count before either writes, so the effective ceiling can briefly
// exceed `limit` by the number of concurrent requests. That is acceptable for
// abuse throttling at this scale (it stops loops/scripts, not microsecond races).
export async function checkRateLimit(
  admin: SupabaseClient,
  bucket: string,
  ip: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const now = Date.now()

  const { data } = await admin
    .from('api_rate_limits')
    .select('window_start, count')
    .eq('bucket', bucket)
    .eq('ip', ip)
    .maybeSingle()

  const windowStart = data ? new Date(data.window_start).getTime() : 0
  const withinWindow = now - windowStart < windowMs

  if (withinWindow) {
    const count = data?.count ?? 0
    if (count >= limit) {
      return { allowed: false, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) }
    }
    await admin
      .from('api_rate_limits')
      .update({ count: count + 1 })
      .eq('bucket', bucket)
      .eq('ip', ip)
    return { allowed: true, retryAfter: 0 }
  }

  // No row yet, or the previous window has expired — start a fresh window.
  await admin
    .from('api_rate_limits')
    .upsert(
      { bucket, ip, window_start: new Date(now).toISOString(), count: 1 },
      { onConflict: 'bucket,ip' },
    )
  return { allowed: true, retryAfter: 0 }
}
