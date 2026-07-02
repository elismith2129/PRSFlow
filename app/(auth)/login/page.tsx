'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PRSFloIcon } from '@/components/PRSFloIcon'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [fadingOut, setFadingOut] = useState(false)

  // Already-authenticated users hitting /login get redirected to /
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/')
    })
  }, [router])

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
    // Flag a fresh login so the dashboard shows the one-time welcome splash.
    // Cleared by the dashboard on mount, so refresh/navigation never re-triggers it.
    sessionStorage.setItem('showWelcome', 'true')
    // Fade the login page out (400ms), then navigate — the dashboard splash fades
    // in on mount, producing a smooth crossfade instead of an abrupt route swap.
    setFadingOut(true)
    setTimeout(() => router.replace('/'), 400)
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

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0d0f14',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        opacity: fadingOut ? 0 : 1,
        transition: 'opacity 0.4s ease',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: '@keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }' }} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          maxWidth: 380,
        }}
      >
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
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.2em',
              color: '#6B7280',
              textTransform: 'uppercase',
              textAlign: 'center',
              marginTop: 6,
              ...fadeUpStyle(0.38, 0.4),
            }}
          >
            Paramount Recording Group
          </div>
        </div>

        <form
          onSubmit={handleSignIn}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            width: '100%',
            marginTop: 48,
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            className="auth-input"
            style={{ ...authInputStyle, ...fadeUpStyle(0.52, 0.35) }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#c8f04e')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="auth-input"
            style={{ ...authInputStyle, ...fadeUpStyle(0.64, 0.35) }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#c8f04e')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          />

          <button
            type="submit"
            disabled={loading}
            style={{ ...authButtonStyle, ...fadeUpStyle(0.76, 0.35) }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            {loading ? 'Signing In…' : 'Sign In'}
          </button>

          <div
            onClick={handleForgotPassword}
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: '#6B7280',
              cursor: 'pointer',
              textAlign: 'center',
              textDecoration: 'none',
              marginTop: 2,
              ...fadeUpStyle(0.88, 0.35),
            }}
          >
            Forgot password?
          </div>

          {error && (
            <div
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: '#ef4444',
                textAlign: 'center',
              }}
            >
              {error}
            </div>
          )}

          {success && (
            <div
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: '#c8f04e',
                textAlign: 'center',
              }}
            >
              {success}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

// Staggered fade-up entrance for login elements. Each starts at opacity 0 and
// animates in via the `fadeUp` keyframe injected in the page; `forwards` keeps
// the end state after the animation completes.
function fadeUpStyle(delay: number, duration: number): React.CSSProperties {
  return { opacity: 0, animation: `fadeUp ${duration}s ease ${delay}s forwards` }
}

const authInputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '12px 14px',
  color: 'var(--text)',
  fontFamily: "'DM Mono', monospace",
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

const authButtonStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  background: 'transparent',
  color: '#e8eaf0',
  fontFamily: "'DM Mono', monospace",
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
