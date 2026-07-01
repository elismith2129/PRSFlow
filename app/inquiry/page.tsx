'use client'

// Public, unauthenticated inquiry form. Lives OUTSIDE the (main) route group, so it
// gets no AuthGuard — anyone can reach /inquiry without logging in. It talks to
// Supabase with the browser anon key only (NEXT_PUBLIC_SUPABASE_ANON_KEY); no service
// role key or private env var is referenced here or in its imports. On submit it
// creates a leads row with status 'uncontacted' + source 'Web Inquiry'.
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { PRSFloIcon } from '@/components/PRSFloIcon'

export default function InquiryPage() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) {
      setError('Please fill in all required fields.')
      return
    }

    setLoading(true)
    const { error: insertError } = await supabase.from('leads').insert({
      fname: firstName.trim(),
      lname: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      notes: notes.trim() || null,
      status: 'uncontacted',
      source: 'Web Inquiry',
      created_at: new Date().toISOString(),
    })
    setLoading(false)

    if (insertError) {
      setError('Something went wrong. Please try again.')
      return
    }
    setSubmitted(true)
  }

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      {/* Layer 1 — full-bleed studio photo background. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          backgroundImage: 'url(/inquiry-bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      {/* Layer 2 — dark gradient overlay so the content reads clearly over the photo. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.60) 60%, rgba(0,0,0,0.80) 100%)',
          pointerEvents: 'none',
        }}
      />
      {submitted ? (
        // Thank-you screen replaces the form in place; no redirect.
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            width: '100%',
            maxWidth: 380,
          }}
        >
          <PRSFloIcon size={48} />
          <div
            style={{
              fontFamily: 'Syne',
              fontWeight: 700,
              fontSize: 22,
              color: 'var(--text)',
              marginTop: 22,
            }}
          >
            Thanks! We&rsquo;ll be in touch shortly.
          </div>
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.2em',
              color: '#6B7280',
              textTransform: 'uppercase',
              marginTop: 18,
            }}
          >
            Paramount Recording Group
          </div>
        </div>
      ) : (
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
            maxWidth: 380,
          }}
        >
          {/* Paramount white logo, centered above the frosted form card. */}
          <img
            src="/paramount-logo.png"
            alt="Paramount Recording Studios"
            style={{ width: 220, display: 'block', margin: '0 auto 32px' }}
          />

          <form
            onSubmit={handleSubmit}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              width: '100%',
              marginTop: 30,
              padding: 28,
              borderRadius: 12,
              background: 'rgba(13,15,20,0.85)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxSizing: 'border-box',
            }}
          >
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First Name"
              autoComplete="given-name"
              required
              style={inquiryInputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#c8f04e')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last Name"
              autoComplete="family-name"
              required
              style={inquiryInputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#c8f04e')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              required
              style={inquiryInputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#c8f04e')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              autoComplete="tel"
              required
              style={inquiryInputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#c8f04e')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Tell us about your session"
              rows={4}
              style={{ ...inquiryInputStyle, resize: 'vertical', minHeight: 96 }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#c8f04e')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />

            <button
              type="submit"
              disabled={loading}
              style={inquiryButtonStyle}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              {loading ? 'Sending…' : 'Submit'}
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
      )}
    </div>
  )
}

const inquiryInputStyle: React.CSSProperties = {
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

const inquiryButtonStyle: React.CSSProperties = {
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
