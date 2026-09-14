'use client'
// /runner/[studio]/memos — the runner's memo board (mock memos-options.html
// §3: "a runner's archive is the same list with only their memos and their
// own status on each"). Reached from the Memos tile on the hub, which is
// where "I'll read it later" leaves the memo: one tap back to it, any time.
// Opening a memo here reads/signs it exactly like the pop-up.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useMyMemos } from '@/hooks/useMyMemos'
import { ackMemo, markSeen, isDone, isHard, hardAt, type MyMemo } from '@/lib/memos'
import { MemoView } from '@/components/memos/MemoView'

function fmt(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function initialsOf(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/).filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 3)
}

export default function RunnerMemosPage() {
  const router = useRouter()
  const { studio } = useParams<{ studio: string }>()
  const { profile } = useUserProfile()
  const { memos, loading, reload } = useMyMemos(profile)
  const [open, setOpen] = useState<MyMemo | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open && !open.receipt) markSeen(open.id) }, [open])
  useEffect(() => { if (open) setOpen(memos.find(m => m.id === open.id) ?? null) }, [memos]) // eslint-disable-line react-hooks/exhaustive-deps

  async function sign(initials: string) {
    if (!open) return
    setBusy(true)
    const ok = await ackMemo(open.id, initials)
    setBusy(false)
    if (ok) { await reload(); setOpen(null) }
  }

  return (
    <div style={{ minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden', background: 'var(--c-bg)', color: 'var(--c-fg)', paddingBottom: 'calc(28px + env(safe-area-inset-bottom))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px 10px', position: 'sticky', top: 0, zIndex: 10, background: 'var(--c-bg)' }}>
        <button type="button" onClick={() => router.push(`/runner/${studio}`)} className="c-control c-soft c-raised-chip" style={{ padding: '6px 12px' }}>‹ Hub</button>
        <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 16, letterSpacing: '-0.02em' }}>Memos</div>
      </div>
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ fontSize: 11, color: 'var(--c-fg-3)' }}>Loading…</div>
        ) : memos.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--c-fg-3)', padding: '12px 2px' }}>No memos yet.</div>
        ) : memos.map(m => {
          const done = isDone(m)
          const hard = !done && isHard(m)
          const status = done
            ? (m.requires_ack ? `Signed ${m.receipt?.initials || ''}`.trim() : 'Read')
            : hard ? 'Needs your signature'
            : m.receipt?.deferred_at ? `Sign by ${hardAt(m)?.toLocaleDateString('en-US', { weekday: 'short' })}`
            : 'Unread'
          return (
            <button key={m.id} type="button" onClick={() => setOpen(m)} style={{ background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 16, padding: '12px 14px', textAlign: 'left', border: 'none', font: 'inherit', color: 'var(--c-fg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 13, fontWeight: done ? 500 : 700, lineHeight: 1.25 }}>{m.title}</span>
              <span style={{ display: 'flex', gap: 8, fontSize: 10.5, color: 'var(--c-fg-3)' }}>
                <span>{fmt(m.sent_at)}{m.sent_by_name ? ` · ${m.sent_by_name}` : ''}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, color: done ? 'var(--c-fg-3)' : hard ? 'var(--c-st-hot)' : 'var(--c-st-warm)' }}>{status}</span>
              </span>
            </button>
          )
        })}
      </div>

      {open && (
        <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 10030, background: 'var(--c-bg)', display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: 'calc(12px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px))' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', display: 'flex', flexDirection: 'column', background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 20, padding: '18px 16px 14px', minHeight: 0, overflow: 'hidden' }}>
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
          </div>
        </div>
      )}
    </div>
  )
}
