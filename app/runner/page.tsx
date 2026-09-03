'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /runner — the runner HOME (2026-09-02 rework, Eli's ruling).
//
// TWO CHANGES, one reason: runners float between studios.
//
//   1. THE ONE-LANDING REDIRECT IS DEAD. The 2026-08-14 version remembered
//      the last-opened studio ('prsflo-runner-studio') and bounced straight
//      into its hub. Eli: "runners move a bunch and I don't want them making
//      assumptions about which WO or checklist they are on." A remembered
//      studio IS an assumption — the app asserting where you are tonight —
//      and every screen past that point (sessions, WOs, checklists, notes)
//      inherits it silently. The app now ALWAYS lands here; picking the
//      studio is a deliberate act, every launch. The stale localStorage key
//      is actively removed so long-installed PWAs converge.
//
//   2. THE QUIET REGISTER MOVED HERE from the per-studio hub: Missed a punch,
//      App guide, Runners manual, Report a bug — none of them belong to a
//      studio, so parking them behind a studio pick made runners route
//      through a page whose context they didn't need. Runner notes joined
//      them with EXPLICIT studio tabs and no default tab — reading or posting
//      to a channel means naming the studio first, same no-assumptions rule.
//      (The hub keeps its own inline channel — there it IS the studio's page.)
//
// The queries, counts and bookings channel are untouched from the 08-14 port.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { Wordmark } from '@/components/layout/Wordmark'
import { opsToday, dayPartLabel } from '@/lib/time'
import { useUserProfile } from '@/hooks/useUserProfile'
import { RunnerNotesChannel } from '@/components/runner/RunnerNotesChannel'
import { Hint } from '@/components/ui/Hint'
import { dbResult } from '@/lib/db'
import { draftKey, readDraft, writeDraft, clearDraft } from '@/lib/draft'

// Retired 2026-09-02 (the one-landing redirect) — removed on sight so
// installed PWAs that still carry it converge on always-ask.
const RUNNER_STUDIO_KEY = 'prsflo-runner-studio'

const STUDIOS = [
  { key: 'paramount', label: 'Paramount', abbr: 'PRS' },
  { key: 'ameraycan', label: 'Ameraycan', abbr: 'ARS' },
  { key: 'encore', label: 'Encore', abbr: 'ERS' },
  { key: 'track', label: 'Track', abbr: 'TRS' },
]

// A card surface (§7c) — flat + soft shadow, matching the hub's register.
const surface: React.CSSProperties = {
  background: 'var(--c-srf, var(--c-bg))',
  boxShadow: 'var(--c-softsh)',
  borderRadius: 18,
  padding: '13px 15px',
}

export default function RunnerPage() {
  const router = useRouter()
  // With per-person PINs (2026-08-20) every session has a real name — greet
  // with it, so whoever picked up the tablet can SEE who it's signed in as.
  const { profile } = useUserProfile()
  const firstName = (profile?.display_name || '').split(' ')[0]
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  // Runner notes on home: NO default tab, on purpose — naming the studio is
  // part of writing into the right channel.
  const [notesStudio, setNotesStudio] = useState<string | null>(null)

  // Operational day (8:50 AM roll, 2026-08-28) — matches the per-studio hub
  // so the landing's session counts don't zero out at midnight mid-shift.
  const today = opsToday()

  // Kill the retired remembered-studio key wherever it survives.
  useEffect(() => {
    try { localStorage.removeItem(RUNNER_STUDIO_KEY) } catch {}
  }, [])

  // ── Report something (moved from the hub, 2026-09-02) ─────────────────────
  // Writes to app_feedback with source='runner' and NO studio — the report is
  // about the app, not a room. Draft-netted like every runner input: mirrored
  // to localStorage on each keystroke, cleared only after the insert succeeds.
  const fbKey = draftKey('feedback', 'home', today)
  const [fbOpen, setFbOpen] = useState(false)
  const [fbType, setFbType] = useState<'bug' | 'suggestion'>('bug')
  const [fbText, setFbText] = useState('')
  const [fbPhoto, setFbPhoto] = useState<string | null>(null)
  const [fbBusy, setFbBusy] = useState(false)
  const [fbSent, setFbSent] = useState(false)

  // Restore an unfinished report; a live draft opens the card on its own.
  useEffect(() => {
    const d = readDraft<{ type: 'bug' | 'suggestion'; text: string; photo: string | null }>(fbKey)
    if (!d) return
    setFbType(d.type ?? 'bug')
    setFbText(d.text ?? '')
    setFbPhoto(d.photo ?? null)
    if ((d.text ?? '').trim()) setFbOpen(true)
  }, [fbKey])

  const saveFbDraft = useCallback((next: Partial<{ type: 'bug' | 'suggestion'; text: string; photo: string | null }>) => {
    const merged = { type: fbType, text: fbText, photo: fbPhoto, ...next }
    writeDraft(fbKey, merged)
  }, [fbKey, fbType, fbText, fbPhoto])

  async function pickFbPhoto(file: File | undefined) {
    if (!file) return
    setFbBusy(true)
    const path = `runner-feedback/home/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
    const { data, error } = await supabase.storage
      .from('checklist-photos').upload(path, file, { upsert: true })
    setFbBusy(false)
    if (error || !data) { dbResult('Uploading photo', error as any); return }
    // Store the PATH — the bucket is private and reads sign on demand.
    setFbPhoto(data.path)
    saveFbDraft({ photo: data.path })
  }

  async function submitFeedback() {
    if (!fbText.trim() || fbBusy) return
    setFbBusy(true)
    const { error } = await supabase.from('app_feedback').insert({
      source: 'runner',
      studio: null,
      type: fbType,
      note: fbText.trim(),
      photo_url: fbPhoto,
      author_name: profile?.display_name || profile?.initials || 'Runner',
    })
    setFbBusy(false)
    if (!dbResult('Sending your report', error)) return
    clearDraft(fbKey)
    setFbText(''); setFbPhoto(null); setFbType('bug'); setFbOpen(false)
    setFbSent(true)
    setTimeout(() => setFbSent(false), 6000)
  }

  // ── Session counts (untouched from the 08-14 port) ─────────────────────────

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('bookings')
      .select('location, status')
      .lte('start_date', today)
      .gte('end_date', today)
      .eq('status', 'confirmed')

    const c: Record<string, number> = {}
    for (const s of STUDIOS) c[s.key] = 0
    for (const b of data ?? []) {
      const loc = (b.location ?? '').toLowerCase()
      for (const s of STUDIOS) {
        if (loc.includes(s.key) || loc.includes(s.abbr.toLowerCase())) {
          c[s.key] = (c[s.key] ?? 0) + 1
        }
      }
    }
    setCounts(c)
    setLoading(false)
  }, [today])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase
      .channel(`runner-hub-${today}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
      }, () => { load() })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [today, load])

  return (
    <div style={{
      minHeight: '100dvh',
      maxWidth: '100vw',
      overflowX: 'hidden',
      background: 'var(--c-bg)',
      color: 'var(--c-fg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '30px 16px 44px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 26 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginBottom: 22 }}>
          <PRSFloIcon size={32} />
          <Wordmark size={18} />
        </div>
        <div className="c-label" style={{ marginBottom: 8 }}>Paramount Recording Group</div>
        <div className="c-arch" style={{ fontSize: 23, letterSpacing: '-0.02em' }}>
          Where are you {dayPartLabel().toLowerCase()}{firstName ? `, ${firstName}` : ''}?
        </div>
        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          {profile?.display_name ? ` · signed in as ${profile.display_name}` : ''}
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        width: '100%',
        maxWidth: 380,
      }}>
        {STUDIOS.map(s => (
          <button
            key={s.key}
            onClick={() => router.push(`/runner/${s.key}`)}
            className="c-control"
            style={{
              background: 'var(--c-srf, var(--c-bg))',
              boxShadow: 'var(--c-softsh)',
              border: 'none',
              font: 'inherit',
              color: 'var(--c-fg)',
              borderRadius: 18,
              padding: '24px 14px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 9,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div className="c-arch" style={{
              width: 52, height: 52, borderRadius: 14,
              background: 'var(--c-wash)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, letterSpacing: '0.02em',
            }}>
              {s.abbr}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{s.label}</div>
            {!loading && (
              // Status colour only (§5): sessions-tonight is booked-green,
              // an empty night is just quiet text.
              <div style={{
                fontSize: 11,
                color: counts[s.key] > 0 ? 'var(--c-st-booked)' : 'var(--c-fg)',
                opacity: counts[s.key] > 0 ? 1 : 0.45,
                fontWeight: counts[s.key] > 0 ? 700 : 400,
              }}>
                {counts[s.key] > 0
                  ? `${counts[s.key]} session${counts[s.key] !== 1 ? 's' : ''} today`
                  : 'no sessions today'}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* ── Runner notes — explicit studio tabs, no default (2026-09-02).
          The channel component is the same one the studio hub renders; here
          it self-subscribes (no other runner_note_posts channel on this
          page — WATCH-OUT #7). Picking the tab IS picking the channel. */}
      <div style={{ width: '100%', maxWidth: 380, marginTop: 26 }}>
        <div className="c-label" style={{ marginBottom: 9 }}>
          Runner notes
          <Hint tip="Each studio has one running channel — pick the studio to read or post. Your typing and photos are kept even if the app closes before you send." />
        </div>
        <div style={{ display: 'flex', gap: 7, marginBottom: 9 }}>
          {STUDIOS.map(s => (
            <button
              key={s.key}
              onClick={() => setNotesStudio(notesStudio === s.key ? null : s.key)}
              style={{
                flex: 1, minHeight: 38, borderRadius: 10, border: 'none', font: 'inherit',
                fontSize: 12, fontWeight: notesStudio === s.key ? 700 : 400, cursor: 'pointer',
                background: notesStudio === s.key ? 'var(--c-fg)' : 'var(--c-wash)',
                color: notesStudio === s.key ? 'var(--c-bg)' : 'var(--c-fg)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >{s.abbr}</button>
          ))}
        </div>
        {notesStudio ? (
          <RunnerNotesChannel studio={notesStudio} />
        ) : (
          <div style={{ ...surface, fontSize: 12, opacity: 0.5, textAlign: 'center', padding: '18px 15px' }}>
            Pick a studio to read or post its notes.
          </div>
        )}
      </div>

      {/* ── Quiet register (§15b) — moved here from the studio hub because
          none of it belongs to a studio. Manual is the future slot the AI
          surface later joins. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: '100%', maxWidth: 380, marginTop: 26 }}>
        <button
          onClick={() => router.push('/runner/punch')}
          style={{
            ...surface, display: 'flex', alignItems: 'center', gap: 11, minHeight: 52,
            border: 'none', font: 'inherit', color: 'var(--c-fg)', textAlign: 'left',
            cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>Missed a punch?</div>
            <div style={{ fontSize: 10.5, opacity: 0.6 }}>Report it — takes 30 seconds</div>
          </div>
          <span style={{ opacity: 0.35, fontSize: 16 }}>›</span>
        </button>
        {/* App guide = how to use THIS APP (public/runner-sop.html). The
            runners MANUAL below stays its own slot — that's the JOB (Eli's
            existing paper doc; digital version is a later project). */}
        <button
          onClick={() => router.push('/runner/sop')}
          style={{
            ...surface, display: 'flex', alignItems: 'center', gap: 11, minHeight: 52,
            border: 'none', font: 'inherit', color: 'var(--c-fg)', textAlign: 'left',
            cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>App guide</div>
            <div style={{ fontSize: 10.5, opacity: 0.6 }}>How to use PRSFlo — two minutes</div>
          </div>
          <span style={{ opacity: 0.35, fontSize: 16 }}>›</span>
        </button>
        <div style={{ ...surface, display: 'flex', alignItems: 'center', gap: 11, minHeight: 52, opacity: 0.55 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>Runners manual</div>
            <div style={{ fontSize: 10.5, opacity: 0.6 }}>Coming soon</div>
          </div>
          <span style={{ opacity: 0.35, fontSize: 16 }}>›</span>
        </div>

        {/* ── Report something — collapsed by default so the register stays
            quiet; an unfinished draft opens it by itself. */}
        {!fbOpen ? (
          <button
            onClick={() => setFbOpen(true)}
            style={{
              ...surface, display: 'flex', alignItems: 'center', gap: 11, minHeight: 52,
              border: 'none', font: 'inherit', color: 'var(--c-fg)', textAlign: 'left',
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>Report a bug or an idea</div>
              <div style={{ fontSize: 10.5, opacity: 0.6 }}>
                {fbSent ? 'Sent — thank you' : 'Goes straight to the office'}
              </div>
            </div>
            <span style={{ opacity: 0.35, fontSize: 16 }}>›</span>
          </button>
        ) : (
          <div style={{ ...surface, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>Report a bug or an idea</div>
              <button
                onClick={() => setFbOpen(false)}
                style={{ background: 'none', border: 'none', font: 'inherit', color: 'var(--c-fg)', opacity: 0.4, fontSize: 15, cursor: 'pointer' }}
              >×</button>
            </div>

            {/* Two types only. A runner reporting a broken thing shouldn't have
                to categorise it three ways on a phone. */}
            <div style={{ display: 'flex', gap: 7 }}>
              {(['bug', 'suggestion'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => { setFbType(t); saveFbDraft({ type: t }) }}
                  style={{
                    flex: 1, minHeight: 38, borderRadius: 10, border: 'none', font: 'inherit',
                    fontSize: 12, fontWeight: fbType === t ? 700 : 400, cursor: 'pointer',
                    background: fbType === t ? 'var(--c-fg)' : 'var(--c-wash)',
                    color: fbType === t ? 'var(--c-bg)' : 'var(--c-fg)',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >{t === 'bug' ? 'Something broken' : 'An idea'}</button>
              ))}
            </div>

            <textarea
              value={fbText}
              onChange={e => { setFbText(e.target.value); saveFbDraft({ text: e.target.value }) }}
              placeholder={fbType === 'bug'
                ? 'What happened, and what were you doing when it happened?'
                : 'What would make the app easier tonight?'}
              style={{
                width: '100%', boxSizing: 'border-box', minHeight: 96, resize: 'vertical',
                background: 'var(--c-wash)', border: 'none', borderRadius: 12,
                padding: '11px 12px', color: 'var(--c-fg)', font: 'inherit',
                fontSize: 13.5, lineHeight: 1.6, outline: 'none',
              }}
            />

            {fbPhoto && (
              <div style={{ fontSize: 10.5, opacity: 0.6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1 }}>Photo attached</span>
                <button
                  onClick={() => { setFbPhoto(null); saveFbDraft({ photo: null }) }}
                  style={{ background: 'none', border: 'none', font: 'inherit', color: 'var(--c-fg)', opacity: 0.5, cursor: 'pointer' }}
                >remove</button>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label
                style={{
                  minHeight: 38, display: 'flex', alignItems: 'center', padding: '0 13px',
                  background: 'var(--c-wash)', borderRadius: 10, fontSize: 12, cursor: 'pointer',
                }}
              >
                {fbPhoto ? 'Replace photo' : 'Add photo'}
                <input
                  type="file" accept="image/*" capture="environment" hidden
                  onChange={e => pickFbPhoto(e.target.files?.[0])}
                />
              </label>
              <span style={{ flex: 1, fontSize: 10, opacity: 0.4 }}>Saved as you type</span>
              <button
                onClick={submitFeedback}
                disabled={fbBusy || !fbText.trim()}
                style={{
                  minHeight: 38, padding: '0 16px', borderRadius: 10, border: 'none', font: 'inherit',
                  fontSize: 12, fontWeight: 700, cursor: fbText.trim() ? 'pointer' : 'default',
                  background: 'var(--c-fg)', color: 'var(--c-bg)',
                  opacity: fbBusy || !fbText.trim() ? 0.4 : 1,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >{fbBusy ? 'Sending…' : 'Submit'}</button>
            </div>
          </div>
        )}
      </div>

      {/* SIGN OUT. The PIN login mints a real Supabase session, but the runner
          subtree has no nav — so a runner (or anyone who borrowed the phone)
          was signed in permanently with no way back to the login screen. This
          is the only exit; it has to live where every runner lands. */}
      <button
        onClick={async () => {
          await supabase.auth.signOut()
          router.replace('/login')
        }}
        style={{
          // MERGE RESOLUTION (2026-08-20): both branches added this button —
          // main via the standalone runner-sign-out commit, carved as part of
          // the redesign. Kept the carved styling (design tokens, not legacy
          // vars); behaviour was identical on both sides.
          marginTop: 30,
          background: 'transparent',
          border: 'none',
          font: 'inherit',
          color: 'var(--c-fg)',
          opacity: 0.5,
          fontSize: 12,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          padding: '14px 22px',
          minHeight: 44,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        Sign out
      </button>
    </div>
  )
}
