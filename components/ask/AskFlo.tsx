'use client'
// ─────────────────────────────────────────────────────────────────────────────
// ASK FLO — the help bubble (docs/ASK-FLO-BRIEF.md; mock A of
// docs/design-refs/ask-flo-options.html, Eli 2026-10-22: "I like A").
//
// A 44px ribbon button in the bottom-right of every admin page. Tap it and a
// sheet opens above it: ask how to do something in PRSFlo, get an answer FROM
// THE STAFF GUIDES ONLY, with chips that open the guide at the chapter. Not
// in the guides? It says so. Can't see live data? It says so and names the
// screen that can. It never writes anything (POST /api/ask logs the question
// for Admin → Ask log; that is the only row).
//
// It wears the Flo ring — glow means AI, the one sanctioned glow (spec §14c)
// — and it IS Flo: same voice as the morning briefing, different job.
//
// Who sees it: owner, manager, billing, asst_manager (the route gates again).
// The thread lives in component state only: leave the page, it's gone.
// Phone: the sheet is full-screen. z-index: above modals (1000), below the
// nav (99999) and the welcome splash.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { PRSFloIcon } from '@/components/PRSFloIcon'

const ALLOWED_ADMIN = ['owner', 'manager', 'billing', 'asst_manager']
const Z = 1200
// RUNNER SURFACE (2026-10-22): the same bubble on the runner landing and the
// studio hub only. The checklist, stock, petty cash and work order pages all
// carry a fixed Save / Submit bar across the bottom, and a bubble over
// Submit is worse than no bubble. Any signed-in role may use it there (a
// manager testing on a phone included); the route picks the runner corpus by
// the asker's role, not by the surface.
const RUNNER_PATHS = /^\/runner(\/[^/]+)?\/?$/

type Cite = { id: string; label: string; href: string }
type Msg = { role: 'user' | 'assistant'; content: string; cites?: Cite[]; failed?: boolean }

export function AskFlo({ surface = 'admin' }: { surface?: 'admin' | 'runner' }) {
  const { profile } = useUserProfile()
  const isMobile = useIsMobile()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [thread, setThread] = useState<Msg[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const allowed = !!profile && (surface === 'runner'
    ? RUNNER_PATHS.test(pathname || '')
    : ALLOWED_ADMIN.includes(profile.role))
  const isRunnerAsk = surface === 'runner'

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }, [open])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [thread, busy])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!allowed) return null

  async function ask() {
    const question = q.trim()
    if (!question || busy) return
    setQ('')
    const history = thread.filter(m => !m.failed).map(m => ({ role: m.role, content: m.content }))
    setThread(t => [...t, { role: 'user', content: question }])
    setBusy(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session?.access_token ?? ''}` },
        body: JSON.stringify({ question, history }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setThread(t => [...t, { role: 'assistant', content: json.error || "Flo couldn't answer just now. Try again.", failed: true }])
      } else {
        setThread(t => [...t, { role: 'assistant', content: json.answer, cites: json.cites ?? [] }])
      }
    } catch {
      setThread(t => [...t, { role: 'assistant', content: "Can't reach Flo right now — check the connection and try again.", failed: true }])
    } finally {
      setBusy(false)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }

  const bubble: CSSProperties = {
    position: 'fixed', right: 18, bottom: isRunnerAsk ? 'calc(18px + env(safe-area-inset-bottom))' : 18, zIndex: Z,
    width: isMobile ? 52 : 44, height: isMobile ? 52 : 44, borderRadius: 999, padding: 1.5, cursor: 'pointer', border: 'none', background: 'transparent',
  }
  const sheet: CSSProperties = isMobile
    ? { position: 'fixed', inset: 0, zIndex: Z + 1, borderRadius: 0, padding: 0, width: '100vw', maxWidth: '100vw', overflow: 'hidden' }
    : { position: 'fixed', right: 18, bottom: 74, zIndex: Z + 1, width: 360, height: 'min(480px, calc(100vh - 100px))' }

  return (
    <>
      {open && (
        <div className="c-ringwrap" style={sheet} role="dialog" aria-label="Ask Flo">
          <div className="c-flo-inner" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 0, borderRadius: isMobile ? 0 : undefined }}>
            {/* BIGGER ON A PHONE (Eli, 2026-10-22: "the ribbon and the flo are
                really small at the top"). The dashboard Flo box's 13px head
                is right beside a mouse; a thumb needs more. */}
            <div className="c-flohead" style={{ padding: isMobile ? 'calc(14px + env(safe-area-inset-top)) 16px 8px' : '12px 14px 6px', marginBottom: 0, gap: isMobile ? 10 : 8 }}>
              <PRSFloIcon size={isMobile ? 28 : 18} />
              <span className="c-fname" style={isMobile ? { fontSize: 20 } : undefined}>Flo</span>
              <span className="c-ftag" style={isMobile ? { fontSize: 10 } : undefined}>Ask · from the guides</span>
              <button type="button" className="c-x" aria-label="Close" onClick={() => setOpen(false)} style={{ marginLeft: 'auto', border: 'none', fontSize: isMobile ? 22 : 15, padding: isMobile ? '4px 6px' : undefined }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '6px 14px 10px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: isMobile ? 15 : 13, lineHeight: 1.5, minWidth: 0 }}>
              {thread.length === 0 && (
                <div style={{ color: 'var(--c-fg-3)', fontSize: isMobile ? 15 : 12.5, marginTop: 6 }}>
                  {isRunnerAsk
                    ? <>Ask how to do something in the app — “how do I submit the work order”, “what if the client never showed up”. Answers come from the Runner guide; if it isn't in there, Flo says so.</>
                    : <>Ask how to do something in PRSFlo — “how do I take one day off a hold”, “what does the Reopened tag mean”. Answers come from the staff guides; if it isn't in them, Flo says so.</>}
                </div>
              )}
              {thread.map((m, i) => m.role === 'user' ? (
                <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%', background: 'var(--c-wash2)', borderRadius: 12, padding: '7px 11px', overflowWrap: 'anywhere' }}>{m.content}</div>
              ) : (
                <div key={i} style={{ maxWidth: '94%', minWidth: 0, color: m.failed ? 'var(--c-st-hot)' : undefined }}>
                  {m.content.split('\n').filter(Boolean).map((p, j) => <p key={j} style={{ margin: '0 0 6px' }}>{p}</p>)}
                  {m.cites && m.cites.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {m.cites.map(c => (
                        <button key={c.id} type="button" className="c-soft c-raised"
                          onClick={() => { setOpen(false); router.push(c.href) }}
                          style={{ fontSize: isMobile ? 11 : 9.5, padding: '6px 11px', borderRadius: 99, whiteSpace: 'normal', textAlign: 'left', maxWidth: '100%', cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}>
                          {c.label} →
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {busy && <div style={{ color: 'var(--c-fg-3)', fontSize: 12.5 }}>Flo is looking…</div>}
              <div ref={endRef} />
            </div>

            <form onSubmit={e => { e.preventDefault(); ask() }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 4px' }}>
              {/* PHONE SIZES (Eli, 2026-10-22: "the text bar at the bottom is
                  too small"). 16px text so iOS does not zoom the page on
                  focus; 44px tall, the thumb's minimum. */}
              <input ref={inputRef} className="c-input" value={q} onChange={e => setQ(e.target.value)} disabled={busy}
                placeholder={isRunnerAsk ? 'Ask how to do something…' : 'Ask how to do something in PRSFlo…'} maxLength={600}
                style={{ flex: 1, minWidth: 0, ...(isMobile ? { height: 44, fontSize: 16, borderRadius: 14 } : {}) }} />
              {/* GREEN ASK (Eli, 2026-10-22: "ask should be green"). A named
                  exception to Law 3 (colour is status only), like the ribbon:
                  sea green is Flo's colour on the brand mark, and this is
                  Flo's one button. Nothing else may borrow it. */}
              <button type="submit" className="c-btn c-control c-raised-primary" disabled={busy || !q.trim()}
                style={{ opacity: busy || !q.trim() ? 0.5 : 1, background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)', ...(isMobile ? { height: 44, padding: '0 18px', fontSize: 12 } : {}) }}>Ask</button>
            </form>
            <div style={{ fontSize: isMobile ? 11.5 : 10, color: 'var(--c-fg-3)', padding: isMobile ? '0 14px calc(10px + env(safe-area-inset-bottom))' : '0 14px 10px' }}>
              {isRunnerAsk ? "Answers come only from the Runner guide. Flo can't see tonight's sessions." : "Answers come only from the staff guides. Flo can't see work orders or clients."}
            </div>
          </div>
        </div>
      )}

      {!open && (
        <button type="button" className="c-ringwrap" style={bubble} onClick={() => setOpen(true)} title="Ask Flo how to do something" aria-label="Ask Flo">
          <span className="c-flo-inner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRadius: 999, padding: 0 }}>
            <PRSFloIcon size={isMobile ? 30 : 24} />
          </span>
        </button>
      )}
    </>
  )
}
