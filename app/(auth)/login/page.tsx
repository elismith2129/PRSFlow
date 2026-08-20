'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { Wordmark } from '@/components/layout/Wordmark'
import { Eye, EyeOff } from 'lucide-react'
import { StatusPill } from '@/components/carved'

type Mode = 'pin' | 'email'
type PinMsg = { text: string; color: string } | null

const LOCKOUT_KEY = 'pin_lockout'
const MAX_FAILS = 5
// ─── PIN login kill switch ───────────────────────────────────────────────────
// FALSE while every staff PIN is revoked, following the distributed brute-force
// attempt on 29 July 2026 (see docs/PROJECT_LOG.md). With zero rows in
// staff_pins the numpad cannot succeed for anyone, so showing it would only
// hand staff a screen that silently fails and looks like a broken app.
//
// This hides the pad and defaults the screen to email + password. It does NOT
// disable /api/auth/pin — the server still enforces its own lockout, which is
// what actually matters if someone hits the endpoint directly.
//
// FLIP BACK TO TRUE when 6-digit PINs are re-issued. Nothing else needs
// changing; the PIN code paths are untouched.
const PIN_LOGIN_ENABLED = false

const LOCKOUT_MS = 30_000

// These are carved STATUS SLOTS, not CSS colours (they were `var(--hot)` /
// `var(--accent)` / `var(--warm)` and were painted straight onto the message
// text). The carved system never tints body copy — the palette only appears as a
// solid fill — so the PIN message renders as a StatusPill and these feed its
// `status` prop. They're still used as equality sentinels, so the values only
// have to be distinct; the names are kept so that comparison code reads the same.
const COLOR_ERROR = 'hot'
const COLOR_SUCCESS = 'booked'
const COLOR_LOCK = 'warm'

type LockoutStore = { attempts: number; lockedUntil: number | null }

function readLockout(): LockoutStore {
  if (typeof window === 'undefined') return { attempts: 0, lockedUntil: null }
  try {
    const raw = localStorage.getItem(LOCKOUT_KEY)
    if (!raw) return { attempts: 0, lockedUntil: null }
    const parsed = JSON.parse(raw)
    return { attempts: Number(parsed.attempts) || 0, lockedUntil: parsed.lockedUntil ?? null }
  } catch {
    return { attempts: 0, lockedUntil: null }
  }
}

function writeLockout(store: LockoutStore) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LOCKOUT_KEY, JSON.stringify(store))
  } catch {
    /* ignore */
  }
}

export default function LoginPage() {
  const router = useRouter()

  // ── Mode: PIN numpad is the primary view; email is the fallback. ──
  const [mode, setMode] = useState<Mode>(PIN_LOGIN_ENABLED ? 'pin' : 'email')

  // ── PIN state ──
  const [pin, setPin] = useState('')
  const [pinMsg, setPinMsg] = useState<PinMsg>(null)
  const [shake, setShake] = useState(false)
  const [submittingPin, setSubmittingPin] = useState(false)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const [lockRemaining, setLockRemaining] = useState(0)

  // ── Email/password state (existing flow, unchanged logic) ──
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [fadingOut, setFadingOut] = useState(false)

  // Where a signed-in user belongs: runners on the runner hub, everyone else on
  // the dashboard. Resolved from user_profiles rather than the PIN response so
  // the already-authenticated path below can use it too. Runners can read their
  // own profile row under RLS, which is all this needs.
  const landingForSession = useCallback(async (): Promise<string> => {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth?.user?.id
    if (!uid) return '/'
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('auth_user_id', uid)
      .maybeSingle()
    return profile?.role === 'runner' ? '/runner' : '/'
  }, [])

  // Already-authenticated users hitting /login get sent to their landing page.
  // This is the runner's normal daily path — reopening the installed app with a
  // live session — so it must not dump them on the dashboard.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return
      router.replace(await landingForSession())
    })
  }, [router, landingForSession])

  // Hydrate any existing lockout from a previous session.
  useEffect(() => {
    const store = readLockout()
    if (store.lockedUntil && store.lockedUntil > Date.now()) {
      setLockedUntil(store.lockedUntil)
    }
  }, [])

  // Lockout countdown — ticks the remaining seconds and clears on expiry.
  useEffect(() => {
    if (!lockedUntil) return
    const tick = () => {
      const rem = Math.ceil((lockedUntil - Date.now()) / 1000)
      if (rem <= 0) {
        setLockedUntil(null)
        setLockRemaining(0)
        setPinMsg(null)
        writeLockout({ attempts: 0, lockedUntil: null })
      } else {
        setLockRemaining(rem)
      }
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [lockedUntil])

  const isLocked = lockedUntil !== null && lockedUntil > Date.now()

  function triggerShake() {
    setShake(true)
    setTimeout(() => setShake(false), 400)
  }

  // Record a client-side failed attempt; lock the numpad after MAX_FAILS.
  function registerFail() {
    const store = readLockout()
    const attempts = (store.attempts || 0) + 1
    if (attempts >= MAX_FAILS) {
      const until = Date.now() + LOCKOUT_MS
      writeLockout({ attempts: 0, lockedUntil: until })
      setLockedUntil(until)
    } else {
      writeLockout({ attempts, lockedUntil: null })
      setPinMsg({ text: 'incorrect pin', color: COLOR_ERROR })
    }
  }

  // Apply a server-enforced lockout (429) using its retry_after.
  function applyServerLock(retryAfter?: number) {
    const until = Date.now() + (retryAfter && retryAfter > 0 ? retryAfter : 30) * 1000
    writeLockout({ attempts: 0, lockedUntil: until })
    setLockedUntil(until)
  }

  async function submitPin(fullPin: string) {
    setSubmittingPin(true)
    try {
      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: fullPin }),
      })
      const data = await res.json().catch(() => ({} as Record<string, unknown>))

      // ── Success: adopt the server-minted session directly. One setSession
      //    call (no OTP exchange) — far faster than the old verifyOtp round trip. ──
      if (res.ok && data.access_token && data.refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token as string,
          refresh_token: data.refresh_token as string,
        })
        if (sessionError) {
          triggerShake()
          setPin('')
          setPinMsg({ text: 'could not sign in — try again', color: COLOR_ERROR })
          setSubmittingPin(false)
          return
        }
        try { localStorage.removeItem(LOCKOUT_KEY) } catch { /* ignore */ }
        // One PIN pad for the whole team — the role decides the destination.
        // Runners share a single PIN and go straight to the runner hub; the
        // dashboard would be an empty, confusing landing for them.
        const isRunner = data.role === 'runner'
        setPinMsg({ text: isRunner ? '✓ runner' : '✓ welcome', color: COLOR_SUCCESS })
        // The welcome splash lives on the dashboard, so only arm it for staff.
        if (!isRunner) sessionStorage.setItem('showWelcome', 'true')
        setFadingOut(true)
        setTimeout(() => router.replace(isRunner ? '/runner' : '/'), 600)
        return
      }

      // ── Server lockout ──
      if (res.status === 429 || data.error === 'locked') {
        setPin('')
        applyServerLock(data.retry_after as number | undefined)
        setSubmittingPin(false)
        return
      }

      // ── Valid PIN but no auth account yet (e.g. the runner) ──
      if (data.error === 'no_account') {
        triggerShake()
        setPin('')
        setPinMsg({ text: "this account isn't set up yet", color: COLOR_ERROR })
        setSubmittingPin(false)
        return
      }

      // ── Incorrect PIN (401) or any other failure ──
      triggerShake()
      setPin('')
      if (res.status === 401 || data.error === 'incorrect') {
        registerFail()
      } else {
        setPinMsg({ text: 'something went wrong', color: COLOR_ERROR })
      }
      setSubmittingPin(false)
    } catch {
      triggerShake()
      setPin('')
      setPinMsg({ text: 'network error — try again', color: COLOR_ERROR })
      setSubmittingPin(false)
    }
  }

  function pressDigit(d: string) {
    if (isLocked || submittingPin || pin.length >= 4) return
    if (pinMsg && pinMsg.color !== COLOR_SUCCESS) setPinMsg(null)
    const next = pin + d
    setPin(next)
    if (next.length === 4) submitPin(next)
  }

  function pressBack() {
    if (isLocked || submittingPin) return
    if (pinMsg && pinMsg.color !== COLOR_SUCCESS) setPinMsg(null)
    setPin(prev => prev.slice(0, -1))
  }

  // Physical-keyboard input for the PIN numpad (desktop) — purely additive; the
  // on-screen buttons still work. Active only in PIN mode so the email/password
  // fields aren't intercepted. Reuses pressDigit/pressBack so every guard
  // (lockout, submitting, 4-digit cap, error-clear) applies identically.
  useEffect(() => {
    if (mode !== 'pin') return
    function onKeyDown(e: KeyboardEvent) {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        pressDigit(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        pressBack()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, pin, isLocked, submittingPin, pinMsg])

  // ── Email/password sign-in (unchanged from the original login logic) ──
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (signInError) {
      // TELL THE TRUTH ABOUT WHICH KIND OF FAILURE (2026-08-20). This was a
      // catch-all "Invalid email or password" for ANY error — including the
      // auth server being unreachable. During the env-var incident the whole
      // staff saw "invalid password" and reasonably concluded their passwords
      // had broken, when the app was knocking on the wrong door entirely. A
      // wrong password is the ONLY case that message is allowed to claim now;
      // everything else names itself a system problem and carries the raw
      // error so a screenshot from staff is diagnosable.
      const msg = (signInError.message || '').toLowerCase()
      if (msg.includes('invalid login credentials')) {
        setError('Invalid email or password')
      } else if (msg.includes('email not confirmed')) {
        setError('This account has not been activated yet — tell the office.')
      } else {
        setError(`Can't reach the login server — this is a system problem, not your password. Try again in a minute; if it keeps up, tell the office. (${signInError.message || 'no response'})`)
      }
      return
    }
    // Same role-aware landing as the PIN path (email/password is the fallback
    // login, but it shouldn't behave differently).
    const dest = await landingForSession()
    // Flag a fresh login so the dashboard shows the one-time welcome splash.
    // Cleared by the dashboard on mount, so refresh/navigation never re-triggers
    // it. The splash lives on the dashboard, so skip it for runners.
    if (dest === '/') sessionStorage.setItem('showWelcome', 'true')
    // Fade the login page out (400ms), then navigate — the dashboard splash fades
    // in on mount, producing a smooth crossfade instead of an abrupt route swap.
    setFadingOut(true)
    setTimeout(() => router.replace(dest), 400)
  }

  async function handleForgotPassword() {
    setError('')
    setSuccess('')
    if (!email.trim()) {
      setError('Enter your email address first')
      return
    }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://prsflow.paramountrecording.com/reset-password',
    })
    if (resetError) {
      setError(resetError.message)
      return
    }
    setSuccess('Password reset email sent')
  }

  // Lockout message overrides the transient pinMsg while a lockout is active.
  //
  // Server lockouts now escalate (30s → 2m → 10m → 60m), so this can no longer
  // assume seconds — "try again in 3600s" is not something a runner standing in
  // a live session should have to convert in their head.
  const lockLabel =
    lockRemaining >= 60
      ? `${Math.ceil(lockRemaining / 60)}m`
      : `${lockRemaining}s`

  const displayMsg: PinMsg = isLocked
    ? { text: `too many attempts — try again in ${lockLabel}`, color: COLOR_LOCK }
    : pinMsg

  const numpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

  return (
    <div
      className="c-root"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        opacity: fadingOut ? 0 : 1,
        transition: 'opacity 0.4s ease',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: '@keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } @keyframes pinShake { 0%,100% { transform: translateX(0); } 20%,60% { transform: translateX(-8px); } 40%,80% { transform: translateX(8px); } }' }} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          maxWidth: 380,
        }}
      >
        {/* Header — renders the shared <Wordmark/>, which IS the locked convention. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginTop: 26 }}>
          <div style={fadeUpStyle(0.1, 0.4)}>
            <PRSFloIcon size={72} />
          </div>
          <div style={fadeUpStyle(0.25, 0.4)}>
            <Wordmark size={48} />
          </div>
          <div
            className="c-label"
            style={{ letterSpacing: '0.2em', textAlign: 'center', marginTop: 8, ...fadeUpStyle(0.38, 0.4) }}
          >
            Paramount Recording Group
          </div>
        </div>

        {mode === 'pin' ? (
          // ── PIN NUMPAD (primary) ──────────────────────────────────────────
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', marginTop: 40 }}>
            {/* Dot progress indicators */}
            <div
              style={{
                display: 'flex',
                gap: 16,
                marginBottom: 18,
                animation: shake ? 'pinShake 0.4s ease' : undefined,
              }}
            >
              {/* Filled = ink resting on the surface; empty = a carved hole.
                  The old 2px ring is gone (Law 1) — depth marks the empty slot. */}
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className={i < pin.length ? 'c-anchor' : 'c-inset2'}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: i < pin.length ? 'var(--c-fg)' : 'var(--c-bg)',
                    transition: 'background 0.12s ease',
                  }}
                />
              ))}
            </div>

            {/* Message line (fixed height so the numpad doesn't jump) */}
            <div style={{ minHeight: 22, marginBottom: 18, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              {displayMsg ? <StatusPill status={displayMsg.color} label={displayMsg.text} /> : null}
            </div>

            {/* 3x4 numpad */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 12,
                width: '100%',
                maxWidth: 300,
                opacity: isLocked ? 0.4 : 1,
                pointerEvents: isLocked || submittingPin ? 'none' : 'auto',
                transition: 'opacity 0.2s ease',
              }}
            >
              {numpadKeys.map((key, i) => {
                if (key === '') return <div key={`empty-${i}`} />
                const isBack = key === '⌫'
                return (
                  // Raised control that presses into the material on :active —
                  // the manual mouseDown/Up background swap is now .c-control's job.
                  <button
                    key={key}
                    type="button"
                    onClick={() => (isBack ? pressBack() : pressDigit(key))}
                    className="c-control c-raised"
                    style={numKeyStyle}
                  >
                    {key}
                  </button>
                )
              })}
            </div>

            {/* Toggle to email login */}
            <div
              onClick={() => { setMode('email'); setPin(''); setPinMsg(null) }}
              className="c-sub"
              style={{ marginTop: 28, fontSize: 11.5, cursor: 'pointer', textAlign: 'center' }}
            >
              sign in with email instead
            </div>
          </div>
        ) : (
          // ── EMAIL / PASSWORD (fallback) ───────────────────────────────────
          <form
            onSubmit={handleSignIn}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              width: '100%',
              marginTop: 40,
            }}
          >
            {/* Carved inputs: no border, and focus is a depth change rather than
                an accent ring — so the focus/blur borderColor handlers are gone. */}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              className="c-input c-inset2"
            />
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                className="c-input c-inset2"
                style={{ paddingRight: 48 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="c-x"
                style={{
                  position: 'absolute',
                  right: 14,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="c-btn c-control c-raised-primary c-block"
              style={{ padding: '13px', justifyContent: 'center' }}
            >
              {loading ? 'Signing In…' : 'Sign In'}
            </button>

            <div
              onClick={handleForgotPassword}
              className="c-sub"
              style={{ fontSize: 11.5, cursor: 'pointer', textAlign: 'center', marginTop: 2 }}
            >
              Forgot password?
            </div>

            {/* Errors and confirmations render as status chips rather than tinted
                text: §5 says the palette only ever appears as a solid fill, and
                coloured body copy is exactly what Law 3 rules out. */}
            {error && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <StatusPill status="hot" label={error} />
              </div>
            )}

            {success && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <StatusPill status="booked" label={success} />
              </div>
            )}

            {PIN_LOGIN_ENABLED && (
              <div
                onClick={() => { setMode('pin'); setError(''); setSuccess('') }}
                className="c-sub"
                style={{ fontSize: 11.5, cursor: 'pointer', textAlign: 'center', marginTop: 6 }}
              >
                use PIN instead
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  )
}

// Staggered fade-up entrance for the header elements.
function fadeUpStyle(delay: number, duration: number): React.CSSProperties {
  return { opacity: 0, animation: `fadeUp ${duration}s ease ${delay}s forwards` }
}

// Layout only — depth, colour and radius come from .c-control/.c-raised.
const numKeyStyle: React.CSSProperties = {
  height: 68,
  borderRadius: 99,
  background: 'var(--c-bg)',
  color: 'var(--c-fg)',
  fontFamily: "'DM Mono', monospace",
  fontSize: 24,
  fontWeight: 500,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  userSelect: 'none',
}
