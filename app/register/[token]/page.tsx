'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import type { Client } from '@/lib/supabase'
import { TERMS_SECTIONS } from '@/lib/terms'
import PhoneInput from '@/components/shared/PhoneInput'

type PageState = 'loading' | 'invalid' | 'expired' | 'used' | 'form' | 'submitting' | 'conflict' | 'success'

interface FormData {
  fname: string
  lname: string
  phone: string
  email: string
  instagram: string
  how_heard: string
  address_street: string
  address_street2: string
  address_city: string
  address_state: string
  address_zip: string
  id_file: File | null
  terms_accepted: boolean
  signature: string
}

const EMPTY_FORM: FormData = {
  fname: '',
  lname: '',
  phone: '',
  email: '',
  instagram: '',
  how_heard: '',
  address_street: '',
  address_street2: '',
  address_city: '',
  address_state: '',
  address_zip: '',
  id_file: null,
  terms_accepted: false,
  signature: '',
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validatePhone(phone: string): boolean {
  if (phone.startsWith('+')) return phone.length >= 8
  return /^\d{10}$/.test(phone)
}

function displayPhone(normalized: string): string {
  if (normalized.startsWith('+')) return normalized
  const d = normalized.replace(/\D/g, '')
  if (d.length !== 10) return normalized
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
const MAX_FILE_BYTES = 25 * 1024 * 1024

export default function RegisterPage() {
  const params = useParams()
  const tokenParam = params.token as string

  const [pageState, setPageState] = useState<PageState>('loading')
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submittedName, setSubmittedName] = useState('')
  const [matchedClient, setMatchedClient] = useState<Client | null>(null)
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false)

  const validateToken = useCallback(async () => {
    try {
      const res = await fetch(`/api/register?token=${encodeURIComponent(tokenParam)}`)
      const data = await res.json()

      if (data.state === 'invalid') { setPageState('invalid'); return }
      if (data.state === 'used') { setPageState('used'); return }
      if (data.state === 'expired') { setPageState('expired'); return }

      const nameParts = (data.prefill?.name || '').trim().split(/\s+/)
      setForm(prev => ({
        ...prev,
        email: data.prefill?.email || '',
        fname: nameParts[0] || '',
        lname: nameParts.slice(1).join(' ') || '',
      }))

      setPageState('form')
    } catch {
      setPageState('invalid')
    }
  }, [tokenParam])

  useEffect(() => {
    validateToken()
  }, [validateToken])

  function set(field: keyof FormData, value: string | boolean | File | null) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }))
  }

  function validate(): boolean {
    const e: Record<string, string> = {}

    if (!form.fname.trim()) e.fname = 'First name is required'
    if (!form.lname.trim()) e.lname = 'Last name is required'
    if (!form.phone.trim()) {
      e.phone = 'Phone number is required'
    } else if (!validatePhone(form.phone)) {
      e.phone = 'Enter a valid phone number: (000) 000-0000'
    }
    if (!form.email.trim()) {
      e.email = 'Email is required'
    } else if (!validateEmail(form.email)) {
      e.email = 'Enter a valid email address'
    }
    if (!form.instagram.trim()) e.instagram = 'Instagram handle is required'
    if (!form.address_street.trim()) e.address_street = 'Street address is required'
    if (!form.address_city.trim()) e.address_city = 'City is required'
    if (!form.address_state.trim()) e.address_state = 'State is required'
    if (!form.address_zip.trim()) e.address_zip = 'ZIP code is required'
    if (!form.id_file) {
      e.id_file = 'ID upload is required'
    } else {
      if (form.id_file.size > MAX_FILE_BYTES) {
        e.id_file = 'File must be under 25MB'
      } else if (!ACCEPTED_MIME.includes(form.id_file.type)) {
        e.id_file = 'Accepted formats: JPEG, PNG, HEIC, WebP, PDF'
      }
    }
    if (!form.terms_accepted) e.terms_accepted = 'You must accept the terms to continue'
    if (!form.signature.trim()) e.signature = 'Signature is required'

    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleUseExisting() {
    if (!matchedClient) return
    setPageState('submitting')
    try {
      const fd = new FormData()
      fd.append('token', tokenParam)
      fd.append('action', 'use_existing')
      fd.append('matched_client_id', String(matchedClient.id))
      fd.append('fname', form.fname.trim())

      const res = await fetch('/api/register', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok || data.error) {
        setSubmitError(data.error || 'Something went wrong.')
        setPageState('conflict')
        return
      }

      setSubmittedName(data.name || form.fname.trim())
      setPageState('success')
    } catch {
      setSubmitError('Something went wrong.')
      setPageState('conflict')
    }
  }

  async function doSubmit(acknowledge = conflictAcknowledged) {
    setSubmitError(null)
    setPageState('submitting')

    try {
      const fd = new FormData()
      fd.append('token', tokenParam)
      fd.append('action', 'submit')
      fd.append('acknowledge_conflict', acknowledge ? 'true' : 'false')
      fd.append('fname', form.fname.trim())
      fd.append('lname', form.lname.trim())
      fd.append('phone', form.phone.trim())
      fd.append('email', form.email.trim())
      fd.append('instagram', form.instagram.trim())
      fd.append('how_heard', form.how_heard.trim())
      fd.append('address_street', form.address_street.trim())
      fd.append('address_street2', form.address_street2.trim())
      fd.append('address_city', form.address_city.trim())
      fd.append('address_state', form.address_state.trim())
      fd.append('address_zip', form.address_zip.trim())
      fd.append('signature', form.signature.trim())
      if (form.id_file) fd.append('id_file', form.id_file)

      const res = await fetch('/api/register', { method: 'POST', body: fd })
      const data = await res.json()

      if (data.conflict) {
        setMatchedClient(data.matchedClient as Client)
        setPageState('conflict')
        return
      }

      if (!res.ok || data.error) {
        setSubmitError(data.error || 'Something went wrong. Please try again.')
        setPageState('form')
        return
      }

      setSubmittedName(data.name || form.fname.trim())
      setPageState('success')
    } catch {
      setSubmitError('Something went wrong. Please try again.')
      setPageState('form')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    await doSubmit()
  }

  function handleCreateNew() {
    setConflictAcknowledged(true)
    setMatchedClient(null)
    setSubmitError(null)
    // Re-run submit bypassing the conflict check (server handles the write).
    doSubmit(true)
  }

  // ── Layout shell (no nav — public page) ──────────────────────────────────

  const shell = (content: React.ReactNode) => (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        {content}
      </div>
    </div>
  )

  // ── Loading ───────────────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return shell(
      <p style={{ color: 'var(--text3)', fontFamily: 'DM Mono', fontSize: 13, textAlign: 'center' }}>
        Verifying link…
      </p>
    )
  }

  // ── Error states ──────────────────────────────────────────────────────────

  if (pageState === 'invalid' || pageState === 'expired' || pageState === 'used') {
    const messages: Record<string, { headline: string; body: string }> = {
      invalid: {
        headline: 'Link not found',
        body: 'This registration link is invalid. Please contact Paramount Recording Studios if you need a new one.',
      },
      expired: {
        headline: 'Link expired',
        body: 'This registration link has expired (links are valid for 7 days). Please contact us to request a new one.',
      },
      used: {
        headline: 'Already registered',
        body: 'This registration link has already been used. If you think this is a mistake, please contact us.',
      },
    }
    const { headline, body } = messages[pageState]
    return shell(
      <>
        <Header />
        <div style={{
          marginTop: 40,
          padding: '32px 28px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          textAlign: 'center',
        }}>
          <p style={{ fontFamily: 'Syne', fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
            {headline}
          </p>
          <p style={{ fontFamily: 'DM Mono', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
            {body}
          </p>
          <p style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--text3)', marginTop: 20 }}>
            (310) 555-0000 · studio@paramountrecording.com
          </p>
        </div>
      </>
    )
  }

  // ── Conflict verify ───────────────────────────────────────────────────────

  if (pageState === 'conflict' && matchedClient) {
    const cName = matchedClient.name || `${matchedClient.fname || ''} ${matchedClient.lname || ''}`.trim()
    return shell(
      <>
        <Header />
        <div style={{ marginTop: 40, padding: '28px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <p style={{ fontFamily: 'Syne', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            Account already exists
          </p>
          <p style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 16 }}>
            An account registered with <strong style={{ color: 'var(--text)' }}>{form.email}</strong> already exists.
          </p>
          <div style={{ padding: '14px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>{cName}</div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--text3)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {matchedClient.email && <span>{matchedClient.email}</span>}
              {matchedClient.phone && <span>{displayPhone(matchedClient.phone)}</span>}
              {matchedClient.registered_at && (
                <span>Registered {new Date(matchedClient.registered_at).toLocaleDateString()}</span>
              )}
            </div>
          </div>
          {submitError && (
            <p style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--hot)', marginBottom: 12 }}>{submitError}</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={handleUseExisting}
              style={{ width: '100%', padding: '12px 0', background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 6, fontFamily: 'Syne', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}
            >
              Use &amp; Link this Profile
            </button>
            <button
              onClick={handleCreateNew}
              style={{ width: '100%', padding: '12px 0', background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'DM Mono', fontSize: 12, cursor: 'pointer' }}
            >
              Create new account anyway
            </button>
          </div>
        </div>
      </>
    )
  }

  // ── Success ───────────────────────────────────────────────────────────────

  if (pageState === 'success') {
    return shell(
      <>
        <Header />
        <div style={{
          marginTop: 40,
          padding: '40px 28px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          textAlign: 'center',
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'rgba(200, 240, 78, 0.12)',
            border: '1px solid var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            fontSize: 20,
          }}>
            ✓
          </div>
          <p style={{
            fontFamily: 'DM Serif Display',
            fontSize: 22,
            color: 'var(--text)',
            marginBottom: 12,
          }}>
            You&apos;re all set{submittedName ? `, ${submittedName}` : ''}.
          </p>
          <p style={{
            fontFamily: 'DM Mono',
            fontSize: 13,
            color: 'var(--text2)',
            lineHeight: 1.7,
            marginBottom: 24,
          }}>
            Thanks for completing your registration.<br />
            We&apos;ll be in touch about your session shortly.
          </p>
          <p style={{
            fontFamily: 'Syne',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text3)',
          }}>
            — Paramount Recording Studios
          </p>
        </div>
      </>
    )
  }

  // ── Form ──────────────────────────────────────────────────────────────────

  const isSubmitting = pageState === 'submitting'

  return shell(
    <>
      <Header />

      <p style={{
        fontFamily: 'DM Mono',
        fontSize: 13,
        color: 'var(--text2)',
        lineHeight: 1.7,
        marginTop: 24,
        marginBottom: 32,
      }}>
        Welcome to Paramount Recording Studios. Please complete this form to verify your account.
      </p>

      {submitError && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(240, 78, 122, 0.1)',
          border: '1px solid rgba(240, 78, 122, 0.35)',
          borderRadius: 6,
          marginBottom: 24,
          fontFamily: 'DM Mono',
          fontSize: 12,
          color: 'var(--hot)',
          lineHeight: 1.5,
        }}>
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>

        {/* Full Name */}
        <SectionLabel>Full Name</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
          <div>
            <Input
              placeholder="First"
              value={form.fname}
              onChange={v => set('fname', v)}
              disabled={isSubmitting}
              error={!!errors.fname}
            />
            {errors.fname && <FieldError>{errors.fname}</FieldError>}
          </div>
          <div>
            <Input
              placeholder="Last"
              value={form.lname}
              onChange={v => set('lname', v)}
              disabled={isSubmitting}
              error={!!errors.lname}
            />
            {errors.lname && <FieldError>{errors.lname}</FieldError>}
          </div>
        </div>

        <Spacer />

        {/* Phone */}
        <SectionLabel>Phone Number</SectionLabel>
        <div style={{ opacity: isSubmitting ? 0.5 : 1, pointerEvents: isSubmitting ? 'none' : 'auto' }}>
          <PhoneInput
            value={form.phone}
            onChange={v => { set('phone', v); if (errors.phone) setErrors(prev => ({ ...prev, phone: '' })) }}
            variant="bordered"
            placeholder="(000) 000-0000"
            style={errors.phone ? { borderColor: 'var(--hot)' } : undefined}
          />
        </div>
        {errors.phone && <FieldError>{errors.phone}</FieldError>}

        <Spacer />

        {/* Email */}
        <SectionLabel>Email</SectionLabel>
        <Input
          placeholder="you@example.com"
          value={form.email}
          onChange={v => set('email', v)}
          disabled={isSubmitting}
          error={!!errors.email}
          type="email"
        />
        {errors.email && <FieldError>{errors.email}</FieldError>}

        <Spacer />

        {/* Instagram */}
        <SectionLabel>Instagram</SectionLabel>
        <Input
          placeholder="@handle"
          value={form.instagram}
          onChange={v => set('instagram', v)}
          disabled={isSubmitting}
          error={!!errors.instagram}
        />
        {errors.instagram && <FieldError>{errors.instagram}</FieldError>}

        <Spacer />

        {/* How heard */}
        <SectionLabel>How did you hear about us? <OptionalTag /></SectionLabel>
        <Input
          placeholder="Referral, Instagram, Google…"
          value={form.how_heard}
          onChange={v => set('how_heard', v)}
          disabled={isSubmitting}
        />

        <Spacer />

        {/* Billing Address */}
        <SectionLabel>Billing Address</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <Input
              placeholder="Street address"
              value={form.address_street}
              onChange={v => set('address_street', v)}
              disabled={isSubmitting}
              error={!!errors.address_street}
            />
            {errors.address_street && <FieldError>{errors.address_street}</FieldError>}
          </div>
          <Input
            placeholder="Apt, suite, unit (optional)"
            value={form.address_street2}
            onChange={v => set('address_street2', v)}
            disabled={isSubmitting}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px', gap: 8 }}>
            <div>
              <Input
                placeholder="City"
                value={form.address_city}
                onChange={v => set('address_city', v)}
                disabled={isSubmitting}
                error={!!errors.address_city}
              />
              {errors.address_city && <FieldError>{errors.address_city}</FieldError>}
            </div>
            <div>
              <Input
                placeholder="ST"
                value={form.address_state}
                onChange={v => set('address_state', v.toUpperCase().slice(0, 2))}
                disabled={isSubmitting}
                error={!!errors.address_state}
                style={{ textTransform: 'uppercase' }}
              />
              {errors.address_state && <FieldError>{errors.address_state}</FieldError>}
            </div>
            <div>
              <Input
                placeholder="ZIP"
                value={form.address_zip}
                onChange={v => set('address_zip', v.replace(/\D/g, '').slice(0, 5))}
                disabled={isSubmitting}
                error={!!errors.address_zip}
                inputMode="numeric"
              />
              {errors.address_zip && <FieldError>{errors.address_zip}</FieldError>}
            </div>
          </div>
        </div>

        <Spacer />

        {/* ID Upload */}
        <SectionLabel>Government-Issued ID</SectionLabel>
        <p style={{
          fontFamily: 'DM Mono',
          fontSize: 11,
          color: 'var(--text3)',
          marginBottom: 10,
        }}>
          Upload a photo or scan of your driver&apos;s license or passport.
          Accepted: JPEG, PNG, HEIC, WebP, PDF · Max 25MB
        </p>
        <FileUpload
          file={form.id_file}
          onChange={f => set('id_file', f)}
          disabled={isSubmitting}
          error={errors.id_file}
        />

        <Spacer />

        {/* Terms & Conditions */}
        <SectionLabel>Terms &amp; Conditions</SectionLabel>
        <TermsScroller />

        <div style={{
          padding: '14px 16px',
          background: 'var(--surface2)',
          border: `1px solid ${errors.terms_accepted ? 'var(--hot)' : 'var(--border)'}`,
          borderRadius: 6,
          marginTop: 10,
          marginBottom: 4,
        }}>
          <label style={{ display: 'flex', gap: 12, cursor: 'pointer', alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={form.terms_accepted}
              onChange={e => set('terms_accepted', e.target.checked)}
              disabled={isSubmitting}
              style={{
                marginTop: 2,
                accentColor: 'var(--accent)',
                width: 14,
                height: 14,
                flexShrink: 0,
              }}
            />
            <span style={{
              fontFamily: 'DM Mono',
              fontSize: 12,
              color: 'var(--text2)',
              lineHeight: 1.6,
            }}>
              By signing below, I acknowledge the information above is accurate and that I have read and
              agreed to Paramount Recording Studios&apos; Terms and Conditions and Cancellation Policy.
            </span>
          </label>
        </div>
        {errors.terms_accepted && <FieldError>{errors.terms_accepted}</FieldError>}

        <Spacer />

        {/* Signature */}
        <SectionLabel>Signature</SectionLabel>
        <p style={{
          fontFamily: 'DM Mono',
          fontSize: 11,
          color: 'var(--text3)',
          marginBottom: 10,
        }}>
          Type your full legal name as your electronic signature.
        </p>
        <Input
          placeholder="Full legal name"
          value={form.signature}
          onChange={v => set('signature', v)}
          disabled={isSubmitting}
          error={!!errors.signature}
          style={{ fontFamily: 'DM Serif Display', fontSize: 16, letterSpacing: '0.02em' }}
        />
        {errors.signature && <FieldError>{errors.signature}</FieldError>}

        <div style={{ marginTop: 36 }}>
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              width: '100%',
              padding: '14px 0',
              background: isSubmitting ? 'var(--border)' : 'var(--accent)',
              color: isSubmitting ? 'var(--text3)' : 'var(--bg)',
              border: 'none',
              borderRadius: 6,
              fontFamily: 'Syne',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.15s',
            }}
          >
            {isSubmitting ? 'Submitting…' : 'Complete Registration'}
          </button>
        </div>

        <p style={{
          fontFamily: 'DM Mono',
          fontSize: 11,
          color: 'var(--text3)',
          textAlign: 'center',
          marginTop: 20,
          lineHeight: 1.6,
        }}>
          Your information is stored securely and used only for studio account purposes.
        </p>

      </form>
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Header() {
  return (
    <div style={{ textAlign: 'center' }}>
      <p style={{
        fontFamily: 'Syne',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--accent)',
        marginBottom: 8,
      }}>
        Paramount Recording Studios
      </p>
      <h1 style={{
        fontFamily: 'DM Serif Display',
        fontSize: 28,
        fontWeight: 400,
        color: 'var(--text)',
        lineHeight: 1.2,
      }}>
        Client <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Registration</em>
      </h1>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: 'Syne',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'var(--text3)',
      marginBottom: 8,
    }}>
      {children}
    </p>
  )
}

function OptionalTag() {
  return (
    <span style={{
      fontFamily: 'DM Mono',
      fontSize: 10,
      fontWeight: 400,
      letterSpacing: '0.04em',
      textTransform: 'none',
      color: 'var(--text3)',
      marginLeft: 6,
    }}>
      optional
    </span>
  )
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: 'DM Mono',
      fontSize: 11,
      color: 'var(--hot)',
      marginTop: 4,
    }}>
      {children}
    </p>
  )
}

function Spacer() {
  return <div style={{ height: 24 }} />
}

interface InputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  error?: boolean
  type?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  style?: React.CSSProperties
}

function Input({ value, onChange, placeholder, disabled, error, type = 'text', inputMode, style }: InputProps) {
  return (
    <input
      type={type}
      inputMode={inputMode}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '10px 12px',
        background: 'var(--surface)',
        border: `1px solid ${error ? 'var(--hot)' : 'var(--border)'}`,
        borderRadius: 6,
        fontFamily: 'DM Mono',
        fontSize: 13,
        color: 'var(--text)',
        outline: 'none',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'text',
        ...style,
      }}
    />
  )
}

function TermsScroller() {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 6,
      background: 'var(--surface)',
      position: 'relative',
      display: 'block',
    }}>
      <div style={{
        height: 280,
        maxHeight: 280,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '14px 16px',
      }}>
        {TERMS_SECTIONS.map((section, i) => (
          <div key={section.heading} style={{ marginTop: i === 0 ? 0 : 12 }}>
            <p style={{
              fontFamily: 'DM Mono',
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text2)',
              margin: '0 0 4px',
            }}>
              {section.heading}
            </p>
            <p style={{
              fontFamily: 'DM Mono',
              fontSize: 13,
              color: 'var(--text3)',
              lineHeight: 1.65,
              margin: 0,
              whiteSpace: 'pre-wrap',
            }}>
              {section.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

interface FileUploadProps {
  file: File | null
  onChange: (f: File | null) => void
  disabled?: boolean
  error?: string
}

function FileUpload({ file, onChange, disabled, error }: FileUploadProps) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.files?.[0] ?? null)
  }

  return (
    <div>
      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: 'var(--surface)',
        border: `1px dashed ${error ? 'var(--hot)' : 'var(--border)'}`,
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}>
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.heic,.webp,.pdf,image/jpeg,image/png,image/heic,image/webp,application/pdf"
          capture="environment"
          onChange={handleChange}
          disabled={disabled}
          style={{ display: 'none' }}
        />
        <span style={{
          padding: '5px 10px',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          fontFamily: 'Syne',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text2)',
          whiteSpace: 'nowrap',
        }}>
          Choose file
        </span>
        <span style={{
          fontFamily: 'DM Mono',
          fontSize: 12,
          color: file ? 'var(--text)' : 'var(--text3)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {file ? file.name : 'No file selected'}
        </span>
      </label>
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}
