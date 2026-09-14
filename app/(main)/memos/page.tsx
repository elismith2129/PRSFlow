'use client'

// ─────────────────────────────────────────────────────────────────────────────
// /memos — the memo board (mock docs/design-refs/memos-options.html §1, §3).
//
// Everyone: the archive of what was sent to them, with their own status on
// each; open one to read it (and sign it, if it still needs signing).
// Owners + managers (the senders): + New memo, every memo with done/total,
// and per memo the scoreboard — signed · put it off · seen · hasn't opened
// the app since — and Archive. A sent memo is never edited (the DB trigger
// refuses); a correction is a new memo.
//
// Two kinds at compose: a typed NOTE (RichNoteEditor, same as every note) or
// a designed PAGE (drop / paste HTML — it renders inline, sandboxed; Eli:
// "not extra clicks to view attachment").
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { RichNoteEditor, noteIsEmpty } from '@/components/shared/RichNote'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useMemosVersion, useMyMemos } from '@/hooks/useMyMemos'
import {
  canSendMemos, sendMemo, archiveMemo, fetchAllMemos, fetchScoreboard, ackMemo, markSeen,
  isDone, isHard, hardAt, AUDIENCE_LABEL,
  type Memo, type MemoAudience, type MemoKind, type MyMemo, type Scoreboard,
} from '@/lib/memos'
import { MemoView } from '@/components/memos/MemoView'
import { toast } from '@/components/ui/Toaster'

function fmt(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return withTime
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function initialsOf(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/).filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 3)
}

const kLabel: React.CSSProperties = { fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)' }
const pill = (bg: string, fg = 'var(--c-fg-2)'): React.CSSProperties => ({ fontSize: 8.5, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 99, background: bg, color: fg, whiteSpace: 'nowrap' })

export default function MemosPage() {
  const { profile } = useUserProfile()
  const sender = canSendMemos(profile?.role)
  const { memos: mine, reload: reloadMine } = useMyMemos(profile)
  const version = useMemosVersion()

  // ── Reading (everyone) ─────────────────────────────────────────────────────
  const [open, setOpen] = useState<MyMemo | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open && !open.receipt) markSeen(open.id) }, [open])
  // Keep the open memo in step with live receipts.
  useEffect(() => { if (open) setOpen(mine.find(m => m.id === open.id) ?? null) }, [mine]) // eslint-disable-line react-hooks/exhaustive-deps

  async function sign(initials: string) {
    if (!open) return
    setBusy(true)
    const ok = await ackMemo(open.id, initials)
    setBusy(false)
    if (ok) await reloadMine()
  }

  // ── Sending (owner / manager) ──────────────────────────────────────────────
  const [all, setAll] = useState<(Memo & { done: number; total: number })[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const loadAll = useCallback(async () => {
    if (!sender) return
    setAll(await fetchAllMemos({ includeArchived: showArchived }))
  }, [sender, showArchived])
  useEffect(() => { loadAll() }, [loadAll, version])

  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<MemoKind>('note')
  const [audience, setAudience] = useState<MemoAudience>('everyone')
  const [requiresAck, setRequiresAck] = useState(true)
  const [noteHtml, setNoteHtml] = useState('')
  const [pageHtml, setPageHtml] = useState('')
  const [pageName, setPageName] = useState('')
  const [sending, setSending] = useState(false)
  const [preview, setPreview] = useState(false)

  const reach = (a: MemoAudience) => {
    // Recipient counts come from the sender's list (same roster the
    // scoreboard uses); before any memo exists we simply don't say a number.
    const sample = all.find(m => m.audience === a)
    return sample ? sample.total : null
  }
  const bodyReady = kind === 'note' ? !noteIsEmpty(noteHtml) : pageHtml.trim().length > 0
  const canSend = !!profile && title.trim().length > 0 && bodyReady && !sending

  async function onPageFile(f: File | null) {
    if (!f) return
    const text = await f.text()
    setPageHtml(text)
    setPageName(f.name)
  }
  function resetCompose() {
    setTitle(''); setKind('note'); setAudience('everyone'); setRequiresAck(true)
    setNoteHtml(''); setPageHtml(''); setPageName(''); setPreview(false)
  }
  async function send() {
    if (!canSend || !profile) return
    setSending(true)
    const m = await sendMemo({
      title, kind, audience, requires_ack: requiresAck,
      body_html: kind === 'note' ? noteHtml : pageHtml,
      sender: profile,
    })
    setSending(false)
    if (m) {
      toast(`Sent to ${AUDIENCE_LABEL[audience].toLowerCase()}`)
      resetCompose(); setComposing(false)
      await loadAll()
    }
  }

  // ── Scoreboard ─────────────────────────────────────────────────────────────
  const [scoreFor, setScoreFor] = useState<Memo | null>(null)
  const [score, setScore] = useState<Scoreboard | null>(null)
  useEffect(() => {
    let live = true
    if (!scoreFor) { setScore(null); return }
    fetchScoreboard(scoreFor).then(s => { if (live) setScore(s) })
    return () => { live = false }
  }, [scoreFor, version])

  async function archive(m: Memo) {
    if (!confirm(`Archive "${m.title}"? It leaves everyone's board; the signatures are kept.`)) return
    if (await archiveMemo(m.id)) { setScoreFor(null); await loadAll() }
  }

  const previewMemo: Memo | null = preview ? {
    id: 'preview', title: title || 'Untitled memo', kind, body_html: kind === 'note' ? noteHtml : pageHtml,
    audience, requires_ack: requiresAck, sent_by: profile?.id ?? null, sent_by_name: profile?.display_name ?? null,
    sent_at: new Date().toISOString(), archived_at: null,
  } : null

  return (
    <div style={{ maxWidth: 880, display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── SENDER VIEW ────────────────────────────────────────────────────── */}
      {sender && (
        <div className="c-panel" style={{ background: 'var(--c-srf)', boxShadow: 'var(--c-softsh)', borderRadius: 16, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <SectionHeader title="Memos · sent" />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <label style={{ fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg-3)', display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" id="memos-show-archived" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> show archived
              </label>
              {!composing && <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" onClick={() => setComposing(true)} style={{ fontSize: 11 }}>+ New memo</button>}
            </div>
          </div>

          {composing && (
            <div style={{ background: 'var(--c-wash)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={kLabel}>Title</span>
                <input id="memo-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="What this is about, in one line" className="c-input c-inset2" style={{ fontSize: 13, fontWeight: 600 }} />
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={kLabel}>To</span>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {(['admin', 'runners', 'everyone'] as MemoAudience[]).map(a => (
                      <button key={a} type="button" onClick={() => setAudience(a)} style={{ padding: '5px 11px', borderRadius: 99, fontSize: 10.5, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer', background: audience === a ? 'var(--c-fg)' : 'var(--c-wash2)', color: audience === a ? 'var(--c-bg)' : 'var(--c-fg-2)' }}>
                        {AUDIENCE_LABEL[a]}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={kLabel}>Signature</span>
                  <span style={{ display: 'inline-flex', borderRadius: 99, overflow: 'hidden', background: 'var(--c-wash2)' }}>
                    {([true, false] as const).map(v => (
                      <button key={String(v)} type="button" onClick={() => setRequiresAck(v)} style={{ padding: '5px 11px', fontSize: 10.5, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer', background: requiresAck === v ? 'var(--c-fg)' : 'transparent', color: requiresAck === v ? 'var(--c-bg)' : 'var(--c-fg-2)', border: 'none' }}>
                        {v ? 'Must acknowledge' : 'Just read'}
                      </button>
                    ))}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={kLabel}>Kind</span>
                  <span style={{ display: 'inline-flex', borderRadius: 99, overflow: 'hidden', background: 'var(--c-wash2)' }}>
                    {(['note', 'page'] as MemoKind[]).map(k => (
                      <button key={k} type="button" onClick={() => setKind(k)} style={{ padding: '5px 11px', fontSize: 10.5, fontFamily: 'Inter', fontWeight: 700, cursor: 'pointer', background: kind === k ? 'var(--c-fg)' : 'transparent', color: kind === k ? 'var(--c-bg)' : 'var(--c-fg-2)', border: 'none' }}>
                        {k === 'note' ? 'Typed note' : 'Designed page'}
                      </button>
                    ))}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={kLabel}>Memo</span>
                {kind === 'note' ? (
                  <RichNoteEditor value={noteHtml} onChange={setNoteHtml} placeholder="Say it plainly. Bold the one line they must remember." minHeight={160} />
                ) : (
                  <div style={{ background: 'var(--c-bg)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label className="c-control c-soft c-raised-chip" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
                      {pageName ? `Replace ${pageName}` : 'Choose the HTML file'}
                      <input id="memo-page-file" type="file" accept=".html,text/html" style={{ display: 'none' }} onChange={e => onPageFile(e.target.files?.[0] ?? null)} />
                    </label>
                    <textarea
                      id="memo-page-html"
                      value={pageHtml}
                      onChange={e => { setPageHtml(e.target.value); if (!pageName) setPageName('pasted') }}
                      placeholder="…or paste the page's HTML here. Readers see the page itself inside the memo — no link, no attachment."
                      className="c-area"
                      style={{ minHeight: 90, fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: 10.5, lineHeight: 1.45 }}
                    />
                    {pageHtml && <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-st-booked)', fontWeight: 700 }}>Renders inline · {Math.round(pageHtml.length / 1024)} KB · scripts are stripped when shown</div>}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="c-control c-pill c-fill-booked c-raised-chip" disabled={!canSend} onClick={send} style={{ fontSize: 12, minHeight: 38, opacity: canSend ? 1 : 0.45 }}>
                  {sending ? 'Sending…' : `Send to ${AUDIENCE_LABEL[audience].toLowerCase()}${reach(audience) ? ` · ${reach(audience)}` : ''}`}
                </button>
                <button type="button" className="c-control c-soft c-raised-chip" disabled={!bodyReady} onClick={() => setPreview(true)}>Preview</button>
                <button type="button" onClick={() => { resetCompose(); setComposing(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-3)', textDecoration: 'underline' }}>Cancel</button>
                <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)', marginLeft: 'auto' }}>Sends now. Shows on each person's next open. Can't be edited after — archive and resend instead.</span>
              </div>
            </div>
          )}

          {all.length === 0 ? (
            <div style={{ fontSize: 11.5, fontFamily: 'Inter', color: 'var(--c-fg-3)', padding: '6px 0' }}>Nothing sent yet.</div>
          ) : all.map(m => (
            <div key={m.id} onClick={() => setScoreFor(scoreFor?.id === m.id ? null : m)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 6px', borderTop: '1px solid var(--c-wash)', cursor: 'pointer', opacity: m.archived_at ? 0.55 : 1, background: scoreFor?.id === m.id ? 'var(--c-wash)' : 'transparent', borderRadius: 8 }}>
              <span style={pill(m.audience === 'runners' ? 'var(--c-st-warm)' : 'var(--c-wash2)', m.audience === 'runners' ? 'var(--c-chip-ink, #1c2626)' : 'var(--c-fg-2)')}>{AUDIENCE_LABEL[m.audience]}</span>
              <span style={{ fontSize: 12.5, fontFamily: 'Inter', fontWeight: 700, color: 'var(--c-fg)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
              <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)', whiteSpace: 'nowrap' }}>{fmt(m.sent_at, false)}{m.kind === 'page' ? ' · page' : ''}{!m.requires_ack ? ' · just read' : ''}{m.archived_at ? ' · archived' : ''}</span>
              <span className="c-tnum" style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: m.done >= m.total && m.total > 0 ? 'var(--c-st-booked)' : 'var(--c-fg)', whiteSpace: 'nowrap' }}>
                {m.done} / {m.total}{m.done >= m.total && m.total > 0 ? ' ✓' : ''}
              </span>
            </div>
          ))}

          {scoreFor && score && (
            <div style={{ marginTop: 10, background: 'var(--c-wash)', borderRadius: 14, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 14, color: 'var(--c-fg)' }}>{scoreFor.title}</div>
                  <div style={{ fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg-2)' }}>Sent {fmt(scoreFor.sent_at)} · to {score.total} {AUDIENCE_LABEL[scoreFor.audience].toLowerCase()} · {scoreFor.requires_ack ? 'must acknowledge' : 'just read'}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="c-control c-soft c-raised-chip" onClick={() => { const mm = mine.find(x => x.id === scoreFor.id); setOpen(mm ?? { ...scoreFor, receipt: null }) }}>Read it</button>
                  {!scoreFor.archived_at && <button type="button" className="c-control c-soft c-raised-chip" onClick={() => archive(scoreFor)}>Archive</button>}
                </div>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--c-wash2)', overflow: 'hidden', margin: '10px 0 4px' }}>
                <div style={{ width: `${score.total ? (score.done / score.total) * 100 : 0}%`, height: '100%', background: 'var(--c-st-booked)' }} />
              </div>
              <div style={{ fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg-3)', marginBottom: 8 }}>
                {score.done} {scoreFor.requires_ack ? 'signed' : 'read'} · {score.deferred} put it off · {score.rows.filter(r => r.state === 'seen').length} opened, not signed · {score.unopened} haven't opened the app
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr', gap: '4px 10px', fontSize: 11.5, fontFamily: 'Inter' }}>
                <span style={kLabel}>Person</span><span style={kLabel}>Status</span><span style={{ ...kLabel, textAlign: 'right' }}>When</span>
                {score.rows.map(r => {
                  const dot = { signed: 'var(--c-st-booked)', read: 'var(--c-st-booked)', deferred: 'var(--c-st-warm)', seen: 'var(--c-st-warm)', unopened: 'var(--c-fg-3)' }[r.state]
                  const label = r.state === 'signed' ? `Signed ${r.receipt?.initials || ''}`.trim()
                    : r.state === 'read' ? 'Read'
                    : r.state === 'deferred' ? `Put it off · ${isHard({ ...scoreFor, receipt: r.receipt } as MyMemo) ? 'now blocking' : `blocks ${fmt(hardAt(r.receipt)?.toISOString())}`}`
                    : r.state === 'seen' ? 'Opened, not signed'
                    : `Hasn't opened the app`
                  const when = r.state === 'signed' ? fmt(r.receipt?.acknowledged_at)
                    : r.state === 'read' ? fmt(r.receipt?.first_seen_at)
                    : r.state === 'deferred' ? fmt(r.receipt?.deferred_at)
                    : r.state === 'seen' ? fmt(r.receipt?.first_seen_at)
                    : r.user.last_seen_at ? `last open ${fmt(r.user.last_seen_at, false)}` : 'never'
                  return [
                    <span key={r.user.id + 'a'} style={{ color: 'var(--c-fg)', padding: '4px 0', borderTop: '1px solid var(--c-wash2)' }}>{r.user.display_name}</span>,
                    <span key={r.user.id + 'b'} style={{ color: 'var(--c-fg-2)', padding: '4px 0', borderTop: '1px solid var(--c-wash2)' }}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: dot, marginRight: 6 }} />{label}</span>,
                    <span key={r.user.id + 'c'} className="c-tnum" style={{ color: 'var(--c-fg-3)', textAlign: 'right', padding: '4px 0', borderTop: '1px solid var(--c-wash2)', fontSize: 10.5 }}>{when}</span>,
                  ]
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MY BOARD (everyone) ────────────────────────────────────────────── */}
      <div className="c-panel" style={{ background: 'var(--c-srf)', boxShadow: 'var(--c-softsh)', borderRadius: 16, padding: '16px 18px' }}>
        <SectionHeader title={sender ? 'Memos · my board' : 'Memos'} />
        {mine.length === 0 ? (
          <div style={{ fontSize: 11.5, fontFamily: 'Inter', color: 'var(--c-fg-3)', padding: '6px 0' }}>No memos for you yet.</div>
        ) : mine.map(m => {
          const done = isDone(m)
          const status = done
            ? (m.requires_ack ? `Signed ${m.receipt?.initials || ''}`.trim() : 'Read')
            : m.receipt?.deferred_at ? (isHard(m) ? 'Needs your signature' : `Put off · needs signing by ${fmt(hardAt(m)?.toISOString())}`)
            : 'Unread'
          return (
            <div key={m.id} onClick={() => setOpen(m)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 6px', borderTop: '1px solid var(--c-wash)', cursor: 'pointer' }}>
              <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, flexShrink: 0, background: done ? 'var(--c-st-booked)' : (m.receipt?.deferred_at && isHard(m)) ? 'var(--c-st-hot)' : 'var(--c-st-warm)' }} />
              <span style={{ fontSize: 12.5, fontFamily: 'Inter', fontWeight: done ? 500 : 700, color: 'var(--c-fg)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
              <span style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)', whiteSpace: 'nowrap' }}>{fmt(m.sent_at, false)}{m.sent_by_name ? ` · ${m.sent_by_name}` : ''}</span>
              <span style={{ marginLeft: 'auto', fontSize: 10.5, fontFamily: 'Inter', fontWeight: 700, color: done ? 'var(--c-fg-3)' : 'var(--c-st-warm)', whiteSpace: 'nowrap' }}>{status}</span>
            </div>
          )
        })}
      </div>

      {/* ── READER (archive open / preview) ────────────────────────────────── */}
      {(open || previewMemo) && (
        <div onClick={() => { setOpen(null); setPreview(false) }} style={{ position: 'fixed', inset: 0, zIndex: 10030, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="c-panel" onClick={e => e.stopPropagation()} style={{ width: 'min(720px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 20, padding: '18px 18px 16px', minHeight: 0, overflow: 'hidden' }}>
            {previewMemo ? (
              <MemoView memo={previewMemo} receipt={null} initials={initialsOf(profile?.display_name)} mode="read" onClose={() => setPreview(false)} />
            ) : open && (
              <MemoView
                memo={open}
                receipt={open.receipt}
                initials={profile?.initials || initialsOf(profile?.display_name)}
                mode={isDone(open) ? 'read' : (isHard(open) ? 'hard' : 'soft')}
                busy={busy}
                onSign={sign}
                onLater={() => setOpen(null)}
                onClose={() => setOpen(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
