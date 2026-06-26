'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

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
    router.replace('/')
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
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          maxWidth: 380,
        }}
      >
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.2em',
            color: '#6B7280',
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          Paramount Recording Group
        </div>

        <div
          style={{
            fontFamily: "'Syne', sans-serif",
            fontWeight: 800,
            fontSize: 48,
            color: '#c8f04e',
            marginTop: 12,
            lineHeight: 1,
          }}
        >
          PRSFlow
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
            style={authInputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#c8f04e')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            style={authInputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#c8f04e')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
          />

          <button
            type="submit"
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
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: '#6B7280',
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

const authInputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  background: '#161920',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '12px 14px',
  color: '#e8eaf0',
  fontFamily: "'DM Mono', monospace",
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

const authButtonStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  background: '#c8f04e',
  color: '#0d0f14',
  fontFamily: "'DM Mono', monospace",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '13px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  boxSizing: 'border-box',
}
