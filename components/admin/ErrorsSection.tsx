'use client'
// DEV → Errors (Phase 0/1 audit follow-up). Surfaces the app_errors sink so
// logged failures are actually visible — crashes, unhandled rejections, and
// failed saves reported by lib/errlog + lib/db. RLS limits SELECT to
// owner/manager; the DEV page also hides the tab from everyone but Eli.
//
// RECARVED 2026-09-23: carved tokens, and the three-column row (time · source ·
// message) stacks on a phone — a 130px+110px grid left the message ten
// characters wide.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { fmtTimestamp } from '@/lib/format'
import { useIsMobile } from '@/hooks/useIsMobile'

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
  const isMobile = useIsMobile()
  const [rows, setRows] = useState<AppError[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_errors')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (!dbResult('Loading errors', error)) { setLoading(false); return }
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

  // Copy the loaded errors as plain text, ready to paste to Claude.
  //
  // Without this the loop is broken: errors are captured here but Claude has no
  // database access, so diagnosing meant Eli retyping or screenshotting a stack
  // trace — which is exactly where the useful detail (the URL, the meta.source,
  // the actual message) gets dropped. Same idea as "Copy failures" on the test
  // batches: make the report portable.
  function copyErrors() {
    const lines = rows.flatMap(e => [
      `[${fmtTimestamp(e.created_at)}] ${e.message}`,
      `  source: ${sourceOf(e)}`,
      `  url: ${e.url ?? '—'}`,
      e.stack ? `  stack: ${e.stack.split('\n').slice(0, 6).join('\n         ')}` : '  stack: —',
      '',
    ])
    const text = rows.length === 0
      ? 'No errors logged.'
      : [`${rows.length} error${rows.length === 1 ? '' : 's'} (newest first)`, '', ...lines].join('\n')
    navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="c-label">App errors{rows.length > 0 ? ` · ${rows.length}` : ''}</div>
        {rows.length > 0 && (
          <button type="button" className={`c-soft${copied ? ' c-on' : ''}`} onClick={copyErrors} style={{ marginLeft: 'auto' }}>
            {copied ? '✓ Copied' : 'Copy for Claude'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="c-sub" style={{ padding: '18px 4px' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="c-sub" style={{ padding: '28px 4px', textAlign: 'center' }}>No errors logged. Quiet is good.</div>
      ) : (
        <div className="c-panel" style={{ padding: 6 }}>
          {rows.map(e => {
            const open = expanded === e.id
            return (
              <div key={e.id} className={open ? 'c-inset2' : undefined} style={{ borderRadius: 12, marginBottom: 2 }}>
                <div
                  onClick={() => setExpanded(open ? null : e.id)}
                  style={isMobile
                    ? { display: 'flex', flexDirection: 'column', gap: 3, padding: '9px 10px', cursor: 'pointer' }
                    : { display: 'grid', gridTemplateColumns: '130px 110px minmax(0, 1fr)', gap: 10, padding: '8px 10px', cursor: 'pointer', alignItems: 'baseline' }}
                >
                  <span style={{ display: 'flex', gap: 8, minWidth: 0 }}>
                    <span className="c-mono" style={{ fontSize: 10, color: 'var(--c-fg-3)', whiteSpace: 'nowrap' }}>{fmtTimestamp(e.created_at)}</span>
                    {isMobile && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-st-warm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sourceOf(e)}</span>}
                  </span>
                  {!isMobile && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-st-warm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sourceOf(e)}</span>}
                  <span style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: open ? 'normal' : 'nowrap', wordBreak: 'break-word' }}>{e.message}</span>
                </div>
                {open && (
                  <div style={{ padding: '2px 10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {e.url && <div className="c-mono" style={{ fontSize: 10, color: 'var(--c-fg-2)', wordBreak: 'break-all' }}>page: {e.url}</div>}
                    {e.user_agent && <div style={{ fontSize: 10, color: 'var(--c-fg-3)', wordBreak: 'break-word' }}>{e.user_agent}</div>}
                    {e.stack && (
                      <pre className="c-mono" style={{ margin: 0, padding: 10, background: 'var(--c-bg)', borderRadius: 10, fontSize: 10, color: 'var(--c-fg-2)', overflowX: 'auto', whiteSpace: 'pre', maxHeight: 260 }}>
                        {e.stack}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {rows.length >= limit && (
            <button type="button" className="c-soft" onClick={() => setLimit(l => l + PAGE_SIZE)} style={{ margin: '6px auto 2px', display: 'flex' }}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  )
}
