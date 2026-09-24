'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Collection notes — the billing row's scratchpad (Eli, 2026-09-24).
//
// "A small click to add notes; on the row just an indication that a note
// exists — not the note, not a truncated version; view them in the pop-up: a
// big text box with log entries and initials auto-made."
//
// Operations notes about COLLECTING the money: called Tuesday, PO comes from
// Maria not the A&R, card declined twice, use Zelle. Internal only. Its own
// table (wo_collection_notes, migration 20260924170000) so nothing that
// renders the work order, the package/PDF, the activity log or the runner app
// can ever render this. Append-only — a collections note is a trail.
//
// Two exports:
//   useCollectNoteCounts()  — one shared channel, a map work_order_id → count,
//                             for the dot on every row (no per-row fetch).
//   CollectNotesModal       — the pop-up: entries newest-first, composer.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { useUserProfile } from '@/hooks/useUserProfile'
import { profileInitials } from '@/lib/format'

export type CollectNote = {
  id: string
  work_order_id: string
  author_name: string | null
  initials: string | null
  body: string
  created_at: string
}

/** work_order_id → how many notes. Realtime — the dot appears the moment
 *  someone else posts. One channel for the whole page (standing rule). */
export function useCollectNoteCounts(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('wo_collection_notes').select('work_order_id')
    if (!dbResult('Loading collection notes', error)) return
    const m: Record<string, number> = {}
    for (const r of (data ?? []) as { work_order_id: string }[]) m[r.work_order_id] = (m[r.work_order_id] ?? 0) + 1
    setCounts(m)
  }, [])
  useEffect(() => {
    load()
    const ch = supabase
      .channel('billing-collect-notes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wo_collection_notes' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])
  return counts
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function CollectNotesModal({ workOrderId, title, onClose }: {
  workOrderId: string
  title: string
  onClose: () => void
}) {
  const { profile } = useUserProfile()
  const [notes, setNotes] = useState<CollectNote[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('wo_collection_notes')
      .select('*')
      .eq('work_order_id', workOrderId)
      .order('created_at', { ascending: false })
    if (!dbResult('Loading collection notes', error)) { setLoading(false); return }
    setNotes((data ?? []) as CollectNote[])
    setLoading(false)
  }, [workOrderId])

  useEffect(() => {
    load()
    const ch = supabase
      .channel(`collect-notes-${workOrderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wo_collection_notes', filter: `work_order_id=eq.${workOrderId}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load, workOrderId])

  async function post() {
    const text = body.trim()
    if (!text || posting) return
    setPosting(true)
    const { error } = await supabase.from('wo_collection_notes').insert({
      work_order_id: workOrderId,
      author_name: profile?.display_name ?? null,
      // Stored initials are the source of truth (CLAUDE.md); derived otherwise.
      initials: profile?.initials || profileInitials(profile?.display_name) || null,
      body: text,
    })
    setPosting(false)
    if (!dbResult('Posting collection note', error)) return
    setBody('')
    load()
  }

  return (
    <div className="c-bmodal-wrap" onClick={onClose}>
      <div className="c-bmodal" style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '86vh' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span className="c-label">Collection notes</span>
          <b style={{ fontSize: 12.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</b>
          <button type="button" className="c-x" onClick={onClose} style={{ marginLeft: 'auto', fontSize: 15 }} aria-label="Close">×</button>
        </div>

        {/* THE BIG TEXT BOX — composer first, it's what you came to do. */}
        <textarea
          className="c-textarea"
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="What happened on collecting this one — who you spoke to, what they said, what's next…"
          rows={4}
          autoFocus
          style={{ minHeight: 96 }}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') post() }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10.5, color: 'var(--c-fg-3)' }}>
            Posts as <b style={{ color: 'var(--c-fg-2)' }}>{profile?.initials || profileInitials(profile?.display_name) || '—'}</b> · internal, never on the work order or the package
          </span>
          <button type="button" className="c-btn" onClick={post} disabled={!body.trim() || posting} style={{ marginLeft: 'auto', opacity: body.trim() && !posting ? 1 : 0.45 }}>
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>

        {/* THE LOG — newest first, initials + time stamped. */}
        <div style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 4 }}>
          {loading ? (
            <div className="c-sub" style={{ padding: '10px 2px' }}>Loading…</div>
          ) : notes.length === 0 ? (
            <div className="c-sub" style={{ padding: '10px 2px' }}>No notes yet.</div>
          ) : notes.map(n => (
            <div key={n.id} className="c-inset2" style={{ borderRadius: 10, padding: '7px 10px' }}>
              <div style={{ display: 'flex', gap: 8, fontSize: 9.5, color: 'var(--c-fg-3)', marginBottom: 2 }}>
                <b className="c-mono" style={{ fontSize: 10, color: 'var(--c-fg-2)' }}>{n.initials || n.author_name || 'Staff'}</b>
                <span className="c-mono" style={{ fontSize: 10 }}>{fmtWhen(n.created_at)}</span>
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
