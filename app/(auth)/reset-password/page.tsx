'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { Wordmark } from '@/components/layout/Wordmark'

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
        background: 'var(--bg)',
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
            fontFamily: 'Inter',
            fontSize: 11,
            letterSpacing: '0.2em',
            color: 'var(--cold)',
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          Paramount Recording Group
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginTop: 26 }}>
          <PRSFloIcon size={72} />
          <Wordmark size={48} />
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
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm Password"
            autoComplete="new-password"
            style={authInputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
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
                fontFamily: 'Inter',
                fontSize: 11,
                color: 'var(--hot)',
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
  background: 'var(--surface)',
  border: '1px solid rgba(255,255,255,0.1)',
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
  background: 'var(--accent)',
  color: 'var(--bg)',
  fontFamily: 'Inter',
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
