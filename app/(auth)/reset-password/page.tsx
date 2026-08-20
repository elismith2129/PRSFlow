'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PRSFloIcon } from '@/components/PRSFloIcon'
import { Wordmark } from '@/components/layout/Wordmark'
import { StatusPill } from '@/components/carved'

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
      className="c-root"
      style={{
        minHeight: '100vh',
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
        <div className="c-label" style={{ letterSpacing: '0.2em', textAlign: 'center' }}>
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
            className="c-input c-inset2"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm Password"
            autoComplete="new-password"
            className="c-input c-inset2"
          />

          <button
            type="submit"
            disabled={loading}
            className="c-btn c-control c-raised-primary c-block"
            style={{ padding: '13px', justifyContent: 'center' }}
          >
            {loading ? 'Updating…' : 'Update Password'}
          </button>

          {error && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <StatusPill status="hot" label={error} />
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
