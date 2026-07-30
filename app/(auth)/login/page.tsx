'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { Eye, EyeOff } from 'lucide-react'

type Mode = 'pin' | 'email'
type PinMsg = { text: string; color: string } | null

const LOCKOUT_KEY = 'pin_lockout'
const MAX_FAILS = 5
const LOCKOUT_MS = 30_000

const COLOR_ERROR = 'var(--hot)'
const COLOR_SUCCESS = 'var(--accent)'
const COLOR_LOCK = 'var(--warm)'

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
  const [mode, setMode] = useState<Mode>('pin')

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
      setError('Invalid email or password')
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
  const displayMsg: PinMsg = isLocked
    ? { text: `too many attempts — try again in ${lockRemaining}s`, color: COLOR_LOCK }
    : pinMsg

  const numpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
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
        {/* Header — byte-for-byte the locked PRSFlo wordmark (source: Nav.tsx). */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginTop: 26 }}>
          <div style={fadeUpStyle(0.1, 0.4)}>
            <PRSFloIcon size={72} />
          </div>
          <div
            style={{
              fontFamily: 'Syne',
              fontWeight: 800,
              fontSize: 48,
              letterSpacing: -0.5,
              lineHeight: 1,
              ...fadeUpStyle(0.25, 0.4),
            }}
          >
            <span style={{ color: 'var(--accent)' }}>PRS</span>
            <span style={{ color: 'var(--text)', opacity: 0.45, fontWeight: 500 }}>Flo</span>
          </div>
          <div
            style={{
              fontFamily: 'Inter',
              fontSize: 11,
              letterSpacing: '0.2em',
              color: 'var(--cold)',
              textTransform: 'uppercase',
              textAlign: 'center',
              marginTop: 6,
              ...fadeUpStyle(0.38, 0.4),
            }}
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
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: i < pin.length ? COLOR_SUCCESS : 'transparent',
                    border: `2px solid ${i < pin.length ? COLOR_SUCCESS : 'var(--border)'}`,
                    transition: 'background 0.12s ease, border-color 0.12s ease',
                  }}
                />
              ))}
            </div>

            {/* Message line (fixed height so the numpad doesn't jump) */}
            <div
              style={{
                minHeight: 18,
                marginBottom: 18,
                fontFamily: 'Inter',
                fontSize: 12,
                textAlign: 'center',
                color: displayMsg?.color ?? 'transparent',
              }}
            >
              {displayMsg?.text ?? ' '}
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
                  <button
                    key={key}
                    data-login-key=""
                    type="button"
                    onClick={() => (isBack ? pressBack() : pressDigit(key))}
                    style={numKeyStyle}
                    onMouseDown={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                    onMouseUp={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                  >
                    {key}
                  </button>
                )
              })}
            </div>

            {/* Toggle to email login */}
            <div
              onClick={() => { setMode('email'); setPin(''); setPinMsg(null) }}
              style={{
                marginTop: 28,
                fontFamily: 'Inter',
                fontSize: 11,
                color: 'var(--cold)',
                cursor: 'pointer',
                textAlign: 'center',
              }}
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
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              className="auth-input"
              style={authInputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                className="auth-input"
                style={{ ...authInputStyle, paddingRight: 44 }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  padding: 6,
                  cursor: 'pointer',
                  color: 'var(--cold)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <button
              type="submit"
              data-login-submit=""
              disabled={loading}
              style={authButtonStyle}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              {loading ? 'Signing In…' : 'Sign In'}
            </button>

            <div
              onClick={handleForgotPassword}
              style={{
                fontFamily: 'Inter',
                fontSize: 11,
                color: 'var(--cold)',
                cursor: 'pointer',
                textAlign: 'center',
                textDecoration: 'none',
                marginTop: 2,
              }}
            >
              Forgot password?
            </div>

            {error && (
              <div
                style={{
                  fontFamily: 'Inter',
                  fontSize: 11,
                  color: 'var(--hot)',
                  textAlign: 'center',
                }}
              >
                {error}
              </div>
            )}

            {success && (
              <div
                style={{
                  fontFamily: 'Inter',
                  fontSize: 11,
                  color: 'var(--accent)',
                  textAlign: 'center',
                }}
              >
                {success}
              </div>
            )}

            <div
              onClick={() => { setMode('pin'); setError(''); setSuccess('') }}
              style={{
                fontFamily: 'Inter',
                fontSize: 11,
                color: 'var(--cold)',
                cursor: 'pointer',
                textAlign: 'center',
                marginTop: 6,
              }}
            >
              use PIN instead
            </div>
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

const numKeyStyle: React.CSSProperties = {
  height: 68,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  color: 'var(--text)',
  fontFamily: "'DM Mono', monospace",
  fontSize: 24,
  fontWeight: 500,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  userSelect: 'none',
  transition: 'background 0.1s ease',
}

const authInputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '12px 14px',
  color: 'var(--text)',
  fontFamily: 'Inter',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

const authButtonStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  background: 'transparent',
  color: 'var(--text)',
  fontFamily: 'Inter',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '13px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  boxSizing: 'border-box',
}
