'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /runner — studio picker, SOFT SKIN PORT + one-landing merge (2026-08-14).
//
// The queries, counts and realtime channel are UNTOUCHED. Two things changed:
//   1. Old skin retired (legacy --bg/--surface/--border tokens, 1px borders,
//      Syne) → soft skin: --c- tokens, flat surfaces + soft shadow, Archivo.
//   2. ONE LANDING: the app remembers the last-opened studio
//      (localStorage 'prsflo-runner-studio') and bounces straight into its
//      hub, so a runner never re-picks on a normal night. The picker still
//      renders on first-ever launch, or when arriving with ?choose=1 (the
//      hub's ← button), which also clears the saved studio.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { Wordmark } from '@/components/layout/Wordmark'
import { getLocalToday, dayPartLabel } from '@/lib/time'

// Shared with the hub page by literal value — both use 'prsflo-runner-studio'.
// (Not exported: Next.js App Router restricts page-file exports.)
const RUNNER_STUDIO_KEY = 'prsflo-runner-studio'

const STUDIOS = [
  { key: 'paramount', label: 'Paramount', abbr: 'PRS' },
  { key: 'ameraycan', label: 'Ameraycan', abbr: 'ARS' },
  { key: 'encore', label: 'Encore', abbr: 'ERS' },
  { key: 'track', label: 'Track', abbr: 'TRS' },
]

export default function RunnerPage() {
  const router = useRouter()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  // Hold rendering until the remembered-studio check resolves, so the picker
  // never flashes before a redirect.
  const [showPicker, setShowPicker] = useState(false)

  const today = getLocalToday()

  // ── One-landing redirect ───────────────────────────────────────────────────
  // window.location.search, not useSearchParams — matches the CRM's ?lead=
  // pattern and avoids a Suspense restructure.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('choose')) {
      // Explicitly returning to the picker un-remembers the studio, so the
      // next launch asks again (a floating runner's "I'm moving" gesture).
      try { localStorage.removeItem(RUNNER_STUDIO_KEY) } catch {}
      setShowPicker(true)
      return
    }
    let saved: string | null = null
    try { saved = localStorage.getItem(RUNNER_STUDIO_KEY) } catch {}
    if (saved && STUDIOS.some(s => s.key === saved)) {
      router.replace(`/runner/${saved}`)
    } else {
      setShowPicker(true)
    }
  }, [router])

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

  function pickStudio(key: string) {
    try { localStorage.setItem(RUNNER_STUDIO_KEY, key) } catch {}
    router.push(`/runner/${key}`)
  }

  if (!showPicker) return null

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
      justifyContent: 'center',
      padding: '24px 16px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 34 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginBottom: 22 }}>
          <PRSFloIcon size={32} />
          <Wordmark size={18} />
        </div>
        <div className="c-label" style={{ marginBottom: 8 }}>Paramount Recording Group</div>
        <div className="c-arch" style={{ fontSize: 23, letterSpacing: '-0.02em' }}>
          Where are you {dayPartLabel().toLowerCase()}?
        </div>
        <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
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
            onClick={() => pickStudio(s.key)}
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
