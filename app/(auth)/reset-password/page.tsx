'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PRSFloIcon } from '@/components/PRSFloIcon'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!newPassword) {
      setError('Enter a new password')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    router.replace('/')
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

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginTop: 26 }}>
          <PRSFloIcon size={72} />
          <div
            style={{
              fontFamily: 'Syne',
              fontWeight: 800,
              fontSize: 48,
              letterSpacing: -0.5,
              lineHeight: 1,
            }}
          >
            <span style={{ color: 'var(--accent)' }}>PRS</span>
            <span style={{ color: 'var(--text)', opacity: 0.45, fontWeight: 500 }}>Flo</span>
          </div>
        </div>

        <form
          onSubmit={handleUpdatePassword}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            width: '100%',
            marginTop: 48,
          }}
        >
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New Password"
            autoComplete="new-password"
            style={authInputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#c8f04e')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm Password"
            autoComplete="new-password"
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
            {loading ? 'Updating…' : 'Update Password'}
          </button>

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
