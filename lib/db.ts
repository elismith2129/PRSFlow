// ─────────────────────────────────────────────────────────────────────────────
// dbResult — the shared "did my save actually work?" check (Phase 0 audit fix).
//
// The audit found ~80% of the app's 291 Supabase calls never check `error`:
// failed saves vanish silently. Wrap any write (or important read) with this:
//
//   const { error } = await supabase.from('leads').update(...).eq('id', id)
//   if (!dbResult('Saving lead', error)) return   // toast shown + error logged
//
// On failure it (1) shows the user a visible red toast and (2) reports to the
// app_errors sink. Returns true when the call succeeded.
// ─────────────────────────────────────────────────────────────────────────────
import { logAppError } from '@/lib/errlog'
import { toast } from '@/components/ui/Toaster'

type SupaError = { message?: string; details?: string; code?: string } | null | undefined

export function dbResult(label: string, error: SupaError): boolean {
  if (!error) return true
  const detail = [error.message, error.details].filter(Boolean).join(' — ')
  toast(`${label} failed${detail ? `: ${detail}` : ''} — your change was NOT saved.`, 'error')
  logAppError(new Error(`[db] ${label}: ${detail || 'unknown error'}`), { source: 'db', code: error.code })
  return false
}
