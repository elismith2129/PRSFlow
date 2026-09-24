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
// can ever render this. No delete — a collections note is a trail. Posts are
// EDITABLE (20260924180000): the row keeps who edited and when, the card says
// "edited".
//
// UNSENT TEXT SURVIVES CLOSING (Eli): the composer's draft is kept per work
// order in localStorage and restored when the pop-up reopens on this device.
// (CLAUDE.md says office drafts are a table; this is seconds of typing on a
// scratchpad, not a shift note — a row per WO per author for a half sentence
// is more machinery than the thing it protects. Revisit if it bites.)
//
// Two exports:
//   useCollectNoteCounts()  — one shared channel, a map work_order_id → count,
//                             for the dot on every row (no per-row fetch).
//   CollectNotesModal       — the pop-up: composer, log newest-first, edit.
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
  updated_at: string | null
  edited_initials: string | null
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

const draftKey = (woId: string) => `prsflo-collect-draft-${woId}`
function readDraft(woId: string): string {
  try { return localStorage.getItem(draftKey(woId)) ?? '' } catch { return '' }
}
function writeDraft(woId: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(draftKey(woId), text)
    else localStorage.removeItem(draftKey(woId))
  } catch { /* private mode — the draft just doesn't survive */ }
}

/** The initials chip — the same mark on the composer and every card. */
function Initials({ v }: { v: string }) {
  return (
    <span className="c-mono" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      width: 26, height: 26, borderRadius: 99, fontSize: 10, fontWeight: 600, letterSpacing: '0.02em',
      background: 'var(--c-wash2)', color: 'var(--c-fg)',
    }}>{v || '—'}</span>
  )
}

export function CollectNotesModal({ workOrderId, title, onClose }: {
  workOrderId: string
  title: string
  onClose: () => void
}) {
  const { profile } = useUserProfile()
  const me = profile?.initials || profileInitials(profile?.display_name) || ''
  const [notes, setNotes] = useState<CollectNote[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState(() => readDraft(workOrderId))
  const [posting, setPosting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // The draft is written on every keystroke — it's a few bytes, and a
  // debounce is exactly the window in which "I closed it and lost it" lives.
  useEffect(() => { writeDraft(workOrderId, body) }, [workOrderId, body])

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
      initials: me || null,
      body: text,
    })
    setPosting(false)
    if (!dbResult('Posting collection note', error)) return
    setBody('')
    load()
  }

  function startEdit(n: CollectNote) {
    setEditingId(n.id)
    setEditText(n.body)
  }
  async function saveEdit() {
    if (!editingId || savingEdit) return
    const text = editText.trim()
    const orig = notes.find(n => n.id === editingId)
    if (!text || !orig) { setEditingId(null); return }
    if (text === orig.body) { setEditingId(null); return }
    setSavingEdit(true)
    const { error } = await supabase.from('wo_collection_notes')
      .update({ body: text, updated_at: new Date().toISOString(), edited_initials: me || null })
      .eq('id', editingId)
    setSavingEdit(false)
    if (!dbResult('Saving collection note', error)) return
    setEditingId(null)
    load()
  }

  const wellStyle: React.CSSProperties = {
    borderRadius: 14, padding: '10px 12px',
    background: 'var(--c-bg)',
    boxShadow: 'inset 3px 3px 9px rgba(0, 0, 0, .34), inset -3px -3px 9px rgba(255, 255, 255, .03)',
  }

  return (
    <div className="c-bmodal-wrap" onClick={onClose}>
      <div className="c-bmodal" style={{ maxWidth: 540, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '86vh' }} onClick={e => e.stopPropagation()}>
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="c-label" style={{ marginBottom: 2 }}>Collection notes</div>
            <div className="c-arch" style={{ fontSize: 15, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
            <div style={{ fontSize: 10.5, color: 'var(--c-fg-3)', marginTop: 2 }}>Internal — never on the work order, the package, or the runner app.</div>
          </div>
          <button type="button" className="c-x" onClick={onClose} style={{ marginLeft: 'auto', fontSize: 16, flexShrink: 0 }} aria-label="Close">×</button>
        </div>

        {/* ── Composer ───────────────────────────────────────────────── */}
        <div style={{ ...wellStyle, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Initials v={me} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Who you spoke to, what they said, what's next…"
              rows={3}
              autoFocus
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') post() }}
              style={{
                display: 'block', width: '100%', minHeight: 72, resize: 'vertical', boxSizing: 'border-box',
                background: 'transparent', border: 'none', outline: 'none', padding: '4px 0',
                fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5, color: 'var(--c-fg)',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--c-fg-3)' }}>
                {body.trim() ? 'Kept until you post it · ⌘↵ posts' : '⌘↵ posts'}
              </span>
              <button type="button" className="c-btn" onClick={post} disabled={!body.trim() || posting} style={{ marginLeft: 'auto', opacity: body.trim() && !posting ? 1 : 0.4 }}>
                {posting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Log ────────────────────────────────────────────────────── */}
        <div style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading ? (
            <div className="c-sub" style={{ padding: '8px 2px' }}>Loading…</div>
          ) : notes.length === 0 ? (
            <div className="c-sub" style={{ padding: '8px 2px' }}>No notes yet.</div>
          ) : notes.map(n => {
            const editing = editingId === n.id
            return (
              <div key={n.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 12, background: editing ? 'var(--c-wash2)' : 'var(--c-wash)' }}>
                <Initials v={n.initials || profileInitials(n.author_name)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 11.5 }}>{n.author_name || n.initials || 'Staff'}</b>
                    <span className="c-mono" style={{ fontSize: 10, color: 'var(--c-fg-3)' }}>{fmtWhen(n.created_at)}</span>
                    {n.updated_at && !editing && (
                      <span style={{ fontSize: 9.5, color: 'var(--c-fg-3)' }} title={`Edited ${fmtWhen(n.updated_at)}${n.edited_initials ? ` by ${n.edited_initials}` : ''}`}>
                        · edited{n.edited_initials && n.edited_initials !== (n.initials || '') ? ` by ${n.edited_initials}` : ''}
                      </span>
                    )}
                    {!editing && (
                      <button type="button" onClick={() => startEdit(n)} title="Edit this note" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-fg-3)', fontSize: 11, padding: '0 2px' }}>✎</button>
                    )}
                  </div>
                  {editing ? (
                    <>
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        rows={3}
                        autoFocus
                        onKeyDown={e => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveEdit()
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        style={{
                          display: 'block', width: '100%', minHeight: 60, resize: 'vertical', boxSizing: 'border-box',
                          ...wellStyle, padding: '8px 10px', border: 'none', outline: 'none',
                          fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.45, color: 'var(--c-fg)',
                        }}
                      />
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                        <button type="button" className="c-soft" onClick={() => setEditingId(null)}>Cancel</button>
                        <button type="button" className="c-btn" onClick={saveEdit} disabled={savingEdit || !editText.trim()} style={{ opacity: editText.trim() && !savingEdit ? 1 : 0.4 }}>{savingEdit ? 'Saving…' : 'Save'}</button>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.body}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
