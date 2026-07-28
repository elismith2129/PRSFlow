'use client'
// Admin → Errors tab (Phase 0/1 audit follow-up). Surfaces the app_errors sink
// so logged failures are actually visible — crashes, unhandled rejections, and
// failed saves reported by lib/errlog + lib/db. RLS limits SELECT to
// owner/manager; the tab is also hidden from other roles in the Admin nav.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { fmtTimestamp } from '@/lib/format'

type AppError = {
  id: string
  created_at: string
  message: string
  stack: string | null
  url: string | null
  meta: Record<string, unknown> | null
  user_agent: string | null
}

const PAGE_SIZE = 50

export function ErrorsSection() {
  const [rows, setRows] = useState<AppError[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE_SIZE)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('app_errors')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    setRows((data as AppError[]) ?? [])
    setLoading(false)
  }, [limit])

  useEffect(() => { load() }, [load])

  // Realtime: new errors appear without a refresh (project standing rule).
  useEffect(() => {
    const channel = supabase
      .channel('admin-app-errors')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'app_errors' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const sourceOf = (e: AppError) => String(e.meta?.source ?? '—')

  return (
    <div>
      <SectionHeader title="App Errors" count={rows.length > 0 ? rows.length : undefined} countColor="orange" />
      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'Inter', marginBottom: 12 }}>
        Crashes, unhandled rejections, and failed saves reported from the app. Newest first.
      </div>

      {loading ? (
        <div style={{ color: 'var(--text2)', fontFamily: 'Inter', fontSize: 12 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text3)', fontFamily: 'Inter', fontSize: 12 }}>
          No errors logged. Quiet is good.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {rows.map(e => (
            <div key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                style={{ display: 'grid', gridTemplateColumns: '130px 110px 1fr', gap: 10, padding: '9px 12px', cursor: 'pointer', alignItems: 'baseline', background: expanded === e.id ? 'var(--surface2)' : 'transparent' }}
              >
                <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtTimestamp(e.created_at)}</span>
                <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--warm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sourceOf(e)}</span>
                <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded === e.id ? 'normal' : 'nowrap' }}>{e.message}</span>
              </div>
              {expanded === e.id && (
                <div style={{ padding: '10px 12px 14px', background: 'var(--surface2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {e.url && <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--text2)' }}>page: {e.url}</div>}
                  {e.user_agent && <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--text3)' }}>{e.user_agent}</div>}
                  {e.stack && (
                    <pre style={{ margin: 0, padding: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 10, color: 'var(--text2)', overflowX: 'auto', whiteSpace: 'pre-wrap', maxHeight: 260 }}>
                      {e.stack}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))}
          {rows.length >= limit && (
            <button
              onClick={() => setLimit(l => l + PAGE_SIZE)}
              style={{ width: '100%', padding: '9px 0', background: 'transparent', border: 'none', borderTop: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'Inter', fontSize: 11, cursor: 'pointer' }}
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  )
}
