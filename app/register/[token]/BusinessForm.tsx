'use client'

// BUSINESS REGISTRATION (v1.56.0, 2026-11-16). The second form behind
// /register/<token>, shown when the token's kind is 'business'. Eli's brief:
// "it's mostly geared toward COD individuals, but I need one focused for
// businesses and indie labels. what's important is to gain contact info for
// reps for payment, admin personnel and the most important acknowledging our
// terms and conditions and email/text campaign opt in." Ruling after the mock:
// "combine admin/billing person into one. there's never two."
//
// So: company → ONE billing/admin contact → A&R contact(s) → T&Cs signed for
// the company (printed name + title + "I'm authorised") → email + SMS opt-in
// for the signer. No photo ID, no Instagram, no "how did you hear".
//
// Submit creates a `label` client with its contacts attached and an AP
// profile carrying the PO / invoicing answers — see /api/register
// action 'submit_business'.

import { useState } from 'react'
import type { Client } from '@/lib/supabase'
import { SMS_CONSENT_TEXT, EMAIL_CONSENT_TEXT } from '@/lib/terms'
import PhoneInput from '@/components/shared/PhoneInput'
import {
  Header, SectionLabel, OptionalTag, FieldError, Spacer, Input, Segmented, CheckRow, TermsScroller,
  validateEmail, validatePhone,
} from './ui'

export type BusinessKind = 'label' | 'management' | 'publisher' | 'brand' | 'other'
export type PoRequired = 'yes' | 'no' | 'sometimes'
export type InvoiceMethod = 'email' | 'portal' | 'both'

interface Anr { fname: string; lname: string; title: string; email: string; phone: string }

interface BizForm {
  company: string
  business_kind: BusinessKind | ''
  website: string
  address_street: string
  address_street2: string
  address_city: string
  address_state: string
  address_zip: string
  // The one billing / admin person. "there's never two."
  billing_fname: string
  billing_lname: string
  billing_email: string
  billing_phone: string
  invoice_email: string          // optional: AP inbox if different from the person
  po_required: PoRequired | ''
  invoice_method: InvoiceMethod | ''
  anr: Anr[]
  terms_accepted: boolean
  authorised: boolean
  signer_name: string
  signer_title: string
  email_opt_in: boolean
  sms_opt_in: boolean
}

const EMPTY_ANR: Anr = { fname: '', lname: '', title: '', email: '', phone: '' }

const EMPTY: BizForm = {
  company: '', business_kind: '', website: '',
  address_street: '', address_street2: '', address_city: '', address_state: '', address_zip: '',
  billing_fname: '', billing_lname: '', billing_email: '', billing_phone: '', invoice_email: '',
  po_required: '', invoice_method: '',
  anr: [{ ...EMPTY_ANR }],
  terms_accepted: false, authorised: false, signer_name: '', signer_title: '',
  email_opt_in: false, sms_opt_in: false,
}

type Stage = 'form' | 'submitting' | 'conflict' | 'success'

export default function BusinessForm({ token, prefill }: {
  token: string
  prefill: { email: string; name: string }
}) {
  const [form, setForm] = useState<BizForm>(() => ({
    ...EMPTY,
    // The lead's name is usually the A&R we've been talking to; the email too.
    anr: [{ ...EMPTY_ANR, fname: prefill.name.split(/\s+/)[0] || '', lname: prefill.name.split(/\s+/).slice(1).join(' '), email: prefill.email }],
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [stage, setStage] = useState<Stage>('form')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [matched, setMatched] = useState<Client | null>(null)

  const busy = stage === 'submitting'

  function set<K extends keyof BizForm>(k: K, v: BizForm[K]) {
    setForm(p => ({ ...p, [k]: v }))
    if (errors[k]) setErrors(p => ({ ...p, [k]: '' }))
  }
  function setAnr(i: number, k: keyof Anr, v: string) {
    setForm(p => ({ ...p, anr: p.anr.map((a, j) => j === i ? { ...a, [k]: v } : a) }))
    const key = `anr_${i}_${k}`
    if (errors[key]) setErrors(p => ({ ...p, [key]: '' }))
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!form.company.trim()) e.company = 'Company name is required'
    if (!form.business_kind) e.business_kind = 'Pick the closest fit'
    if (!form.address_street.trim()) e.address_street = 'Street address is required'
    if (!form.address_city.trim()) e.address_city = 'City is required'
    if (!form.address_state.trim()) e.address_state = 'State is required'
    if (!form.address_zip.trim()) e.address_zip = 'ZIP code is required'

    if (!form.billing_fname.trim()) e.billing_fname = 'First name is required'
    if (!form.billing_lname.trim()) e.billing_lname = 'Last name is required'
    if (!form.billing_email.trim()) e.billing_email = 'Email is required'
    else if (!validateEmail(form.billing_email)) e.billing_email = 'Enter a valid email address'
    if (!form.billing_phone.trim()) e.billing_phone = 'Phone number is required'
    else if (!validatePhone(form.billing_phone)) e.billing_phone = 'Enter a valid phone number: (000) 000-0000'
    if (form.invoice_email.trim() && !validateEmail(form.invoice_email)) e.invoice_email = 'Enter a valid email address'
    if (!form.po_required) e.po_required = 'Let us know — it is the most common reason an invoice bounces'
    if (!form.invoice_method) e.invoice_method = 'Pick one'

    // First A&R is required; extra rows only need to be complete if started.
    form.anr.forEach((a, i) => {
      const started = i === 0 || [a.fname, a.lname, a.email, a.phone, a.title].some(s => s.trim())
      if (!started) return
      if (!a.fname.trim()) e[`anr_${i}_fname`] = 'First name is required'
      if (!a.lname.trim()) e[`anr_${i}_lname`] = 'Last name is required'
      if (!a.email.trim()) e[`anr_${i}_email`] = 'Email is required'
      else if (!validateEmail(a.email)) e[`anr_${i}_email`] = 'Enter a valid email address'
      if (a.phone.trim() && !validatePhone(a.phone)) e[`anr_${i}_phone`] = 'Enter a valid phone number'
    })

    if (!form.terms_accepted) e.terms_accepted = 'You must accept the terms to continue'
    if (!form.authorised) e.authorised = 'Confirm you are authorised to sign for the company'
    if (!form.signer_name.trim()) e.signer_name = 'Printed name is required'
    if (!form.signer_title.trim()) e.signer_title = 'Title is required'

    setErrors(e)
    if (Object.keys(e).length) {
      // Jump to the first problem — this form is long.
      setTimeout(() => document.querySelector('[data-err="1"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
    }
    return Object.keys(e).length === 0
  }

  function payload(acknowledge: boolean): FormData {
    const fd = new FormData()
    fd.append('token', token)
    fd.append('action', 'submit_business')
    fd.append('acknowledge_conflict', acknowledge ? 'true' : 'false')
    const anr = form.anr
      .filter(a => a.fname.trim() || a.lname.trim() || a.email.trim())
      .map(a => ({ fname: a.fname.trim(), lname: a.lname.trim(), title: a.title.trim(), email: a.email.trim(), phone: a.phone.trim() }))
    const body = {
      company: form.company.trim(),
      business_kind: form.business_kind,
      website: form.website.trim(),
      address_street: form.address_street.trim(),
      address_street2: form.address_street2.trim(),
      address_city: form.address_city.trim(),
      address_state: form.address_state.trim(),
      address_zip: form.address_zip.trim(),
      billing_fname: form.billing_fname.trim(),
      billing_lname: form.billing_lname.trim(),
      billing_email: form.billing_email.trim(),
      billing_phone: form.billing_phone.trim(),
      invoice_email: form.invoice_email.trim(),
      po_required: form.po_required,
      invoice_method: form.invoice_method,
      anr,
      signer_name: form.signer_name.trim(),
      signer_title: form.signer_title.trim(),
      email_opt_in: form.email_opt_in,
      sms_opt_in: form.sms_opt_in,
    }
    fd.append('business', JSON.stringify(body))
    return fd
  }

  async function submit(acknowledge = false) {
    setSubmitError(null)
    setStage('submitting')
    try {
      const res = await fetch('/api/register', { method: 'POST', body: payload(acknowledge) })
      const data = await res.json()
      if (data.conflict) { setMatched(data.matchedClient as Client); setStage('conflict'); return }
      if (!res.ok || data.error) { setSubmitError(data.error || 'Something went wrong. Please try again.'); setStage('form'); return }
      setStage('success')
    } catch {
      setSubmitError('Something went wrong. Please try again.')
      setStage('form')
    }
  }

  async function useExisting() {
    if (!matched) return
    setStage('submitting')
    try {
      const fd = new FormData()
      fd.append('token', token)
      fd.append('action', 'use_existing')
      fd.append('matched_client_id', String(matched.id))
      fd.append('fname', form.company.trim())
      const res = await fetch('/api/register', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) { setSubmitError(data.error || 'Something went wrong.'); setStage('conflict'); return }
      setStage('success')
    } catch {
      setSubmitError('Something went wrong.')
      setStage('conflict')
    }
  }

  // ── Conflict: the billing email already belongs to a client ──
  if (stage === 'conflict' && matched) {
    const cName = matched.name || `${matched.fname || ''} ${matched.lname || ''}`.trim()
    return (
      <>
        <Header kind="Business" />
        <div style={{ marginTop: 40, padding: 28, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <p style={{ fontFamily: 'Syne', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Account already exists</p>
          <p style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 16 }}>
            An account using <strong style={{ color: 'var(--text)' }}>{form.billing_email}</strong> already exists.
          </p>
          <div style={{ padding: '14px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 16 }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>{cName}</div>
            <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text3)' }}>{matched.email}</div>
          </div>
          {submitError && <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--hot)', marginBottom: 12 }}>{submitError}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" onClick={useExisting} style={btnPrimary}>Use &amp; Link this Account</button>
            <button type="button" onClick={() => { setMatched(null); submit(true) }} style={btnGhost}>Create new account anyway</button>
          </div>
        </div>
      </>
    )
  }

  // ── Success ──
  if (stage === 'success') {
    return (
      <>
        <Header kind="Business" />
        <div style={{ marginTop: 40, padding: '40px 28px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(var(--accent-rgb), 0.12)', border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 20 }}>✓</div>
          <p style={{ fontFamily: 'DM Serif Display', fontSize: 22, color: 'var(--text)', marginBottom: 12 }}>
            {form.company.trim() ? `${form.company.trim()} is all set.` : 'You’re all set.'}
          </p>
          <p style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 24 }}>
            Thanks for completing your registration.<br />Our billing team has what they need, and we&apos;ll be in touch about your sessions.
          </p>
          <p style={{ fontFamily: 'Syne', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text3)' }}>— Paramount Recording Studios</p>
        </div>
      </>
    )
  }

  // ── Form ──
  const err = (k: string) => errors[k] ? <FieldError>{errors[k]}</FieldError> : null
  const wrap = (k: string, el: React.ReactNode) => <div data-err={errors[k] ? '1' : undefined}>{el}{err(k)}</div>

  return (
    <>
      <Header kind="Business" />
      <p style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginTop: 24, marginBottom: 32, textAlign: 'center' }}>
        For labels, management, publishers and brands. Takes about five minutes.<br />
        We&apos;ll use this to set up billing and keep in touch.
      </p>

      {submitError && (
        <div style={{ padding: '12px 16px', background: 'rgba(240, 78, 122, 0.1)', border: '1px solid rgba(240, 78, 122, 0.35)', borderRadius: 6, marginBottom: 24, fontFamily: 'Inter', fontSize: 12, color: 'var(--hot)', lineHeight: 1.5 }}>
          {submitError}
        </div>
      )}

      <form onSubmit={e => { e.preventDefault(); if (validate()) submit() }} noValidate>

        {/* ── Company ── */}
        <SectionLabel>Your company</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {wrap('company', <Input placeholder="Company name" value={form.company} onChange={v => set('company', v)} disabled={busy} error={!!errors.company} />)}
          {wrap('business_kind',
            <Segmented<BusinessKind>
              value={form.business_kind}
              onChange={v => set('business_kind', v)}
              disabled={busy}
              options={[
                { value: 'label', label: 'Label' },
                { value: 'management', label: 'Management' },
                { value: 'publisher', label: 'Publisher' },
                { value: 'brand', label: 'Brand / agency' },
                { value: 'other', label: 'Other' },
              ]}
            />
          )}
          {wrap('website', <Input placeholder="Website (optional)" value={form.website} onChange={v => set('website', v)} disabled={busy} error={!!errors.website} />)}
          {wrap('address_street', <Input placeholder="Street address" value={form.address_street} onChange={v => set('address_street', v)} disabled={busy} error={!!errors.address_street} />)}
          <Input placeholder="Suite, floor (optional)" value={form.address_street2} onChange={v => set('address_street2', v)} disabled={busy} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px', gap: 8 }}>
            {wrap('address_city', <Input placeholder="City" value={form.address_city} onChange={v => set('address_city', v)} disabled={busy} error={!!errors.address_city} />)}
            {wrap('address_state', <Input placeholder="ST" value={form.address_state} onChange={v => set('address_state', v.toUpperCase().slice(0, 2))} disabled={busy} error={!!errors.address_state} style={{ textTransform: 'uppercase' }} />)}
            {wrap('address_zip', <Input placeholder="ZIP" value={form.address_zip} onChange={v => set('address_zip', v.replace(/\D/g, '').slice(0, 5))} disabled={busy} error={!!errors.address_zip} inputMode="numeric" />)}
          </div>
        </div>

        <Spacer />

        {/* ── Billing / admin — ONE person ── */}
        <SectionLabel sub="Who receives and pays our invoices, books sessions and takes the day-of calls.">Billing &amp; admin contact</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {wrap('billing_fname', <Input placeholder="First name" value={form.billing_fname} onChange={v => set('billing_fname', v)} disabled={busy} error={!!errors.billing_fname} />)}
            {wrap('billing_lname', <Input placeholder="Last name" value={form.billing_lname} onChange={v => set('billing_lname', v)} disabled={busy} error={!!errors.billing_lname} />)}
          </div>
          {wrap('billing_email', <Input placeholder="Email" type="email" value={form.billing_email} onChange={v => set('billing_email', v)} disabled={busy} error={!!errors.billing_email} />)}
          {wrap('billing_phone',
            <div style={{ opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
              <PhoneInput
                value={form.billing_phone}
                onChange={v => set('billing_phone', v)}
                variant="bordered"
                placeholder="(000) 000-0000"
                style={errors.billing_phone ? { borderColor: 'var(--hot)' } : undefined}
              />
            </div>
          )}
          {wrap('invoice_email', <Input placeholder="Invoices should go to (optional · if different, e.g. ap@label.com)" type="email" value={form.invoice_email} onChange={v => set('invoice_email', v)} disabled={busy} error={!!errors.invoice_email} />)}
        </div>

        <div style={{ height: 16 }} />
        <SectionLabel>Do your invoices need a PO number?</SectionLabel>
        {wrap('po_required',
          <Segmented<PoRequired>
            value={form.po_required}
            onChange={v => set('po_required', v)}
            disabled={busy}
            options={[{ value: 'yes', label: 'Yes, always' }, { value: 'no', label: 'No' }, { value: 'sometimes', label: 'Sometimes' }]}
          />
        )}

        <div style={{ height: 16 }} />
        <SectionLabel>How should we send invoices?</SectionLabel>
        {wrap('invoice_method',
          <Segmented<InvoiceMethod>
            value={form.invoice_method}
            onChange={v => set('invoice_method', v)}
            disabled={busy}
            options={[{ value: 'email', label: 'Email' }, { value: 'portal', label: 'Vendor portal' }, { value: 'both', label: 'Both' }]}
          />
        )}

        <Spacer />

        {/* ── A&R ── */}
        <SectionLabel sub="Who we work with on sessions.">A&amp;R / primary contact</SectionLabel>
        {form.anr.map((a, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: i < form.anr.length - 1 ? 14 : 0 }}>
            {i > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text3)' }}>Contact {i + 1}</span>
                <button type="button" disabled={busy} onClick={() => setForm(p => ({ ...p, anr: p.anr.filter((_, j) => j !== i) }))}
                  style={{ background: 'none', border: 'none', color: 'var(--text3)', fontFamily: 'Inter', fontSize: 11, cursor: 'pointer' }}>
                  Remove
                </button>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {wrap(`anr_${i}_fname`, <Input placeholder="First name" value={a.fname} onChange={v => setAnr(i, 'fname', v)} disabled={busy} error={!!errors[`anr_${i}_fname`]} />)}
              {wrap(`anr_${i}_lname`, <Input placeholder="Last name" value={a.lname} onChange={v => setAnr(i, 'lname', v)} disabled={busy} error={!!errors[`anr_${i}_lname`]} />)}
            </div>
            <Input placeholder="Title (A&R Director, Manager…)" value={a.title} onChange={v => setAnr(i, 'title', v)} disabled={busy} />
            {wrap(`anr_${i}_email`, <Input placeholder="Email" type="email" value={a.email} onChange={v => setAnr(i, 'email', v)} disabled={busy} error={!!errors[`anr_${i}_email`]} />)}
            {wrap(`anr_${i}_phone`,
              <div style={{ opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
                <PhoneInput value={a.phone} onChange={v => setAnr(i, 'phone', v)} variant="bordered" placeholder="Phone (optional)"
                  style={errors[`anr_${i}_phone`] ? { borderColor: 'var(--hot)' } : undefined} />
              </div>
            )}
          </div>
        ))}
        {form.anr.length < 4 && (
          <button type="button" disabled={busy} onClick={() => setForm(p => ({ ...p, anr: [...p.anr, { ...EMPTY_ANR }] }))}
            style={{ background: 'none', border: 'none', padding: 0, marginTop: 10, color: 'var(--accent)', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            + Add another A&amp;R
          </button>
        )}

        <Spacer />

        {/* ── Terms, signed for the company ── */}
        <SectionLabel>Terms &amp; Conditions</SectionLabel>
        <TermsScroller />
        <div data-err={errors.terms_accepted || errors.authorised ? '1' : undefined}>
          <CheckRow checked={form.terms_accepted} onChange={v => set('terms_accepted', v)} disabled={busy} error={!!errors.terms_accepted}>
            I have read and agree to Paramount Recording Studios&apos; Terms and Conditions and Cancellation Policy on behalf of the company named above.
          </CheckRow>
          {err('terms_accepted')}
          <CheckRow checked={form.authorised} onChange={v => set('authorised', v)} disabled={busy} error={!!errors.authorised}>
            I am authorised to sign for the company.
          </CheckRow>
          {err('authorised')}
        </div>

        <Spacer />

        <SectionLabel sub="Type your full name and title as your electronic signature.">Signature</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {wrap('signer_name', <Input placeholder="Full legal name" value={form.signer_name} onChange={v => set('signer_name', v)} disabled={busy} error={!!errors.signer_name}
            style={{ fontFamily: 'DM Serif Display', fontSize: 16, letterSpacing: '0.02em' }} />)}
          {wrap('signer_title', <Input placeholder="Title (Finance Manager, Owner…)" value={form.signer_title} onChange={v => set('signer_title', v)} disabled={busy} error={!!errors.signer_title} />)}
        </div>

        <Spacer />

        {/* ── Opt-ins — for the signer. Each its own box, unticked, never bundled
               into the T&C "I agree". Wording stored verbatim with the record. ── */}
        <SectionLabel sub="For the person signing. You can opt out any time.">Keeping in touch</SectionLabel>
        <CheckRow checked={form.email_opt_in} onChange={v => set('email_opt_in', v)} disabled={busy}>{EMAIL_CONSENT_TEXT}</CheckRow>
        <CheckRow checked={form.sms_opt_in} onChange={v => set('sms_opt_in', v)} disabled={busy}>{SMS_CONSENT_TEXT}</CheckRow>
        <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text3)', marginTop: 8, lineHeight: 1.5 }}>
          Texts go to the billing &amp; admin phone number above.
        </p>

        <div style={{ marginTop: 36 }}>
          <button type="submit" disabled={busy} style={{ ...btnPrimary, background: busy ? 'var(--border)' : 'var(--accent)', color: busy ? 'var(--text3)' : 'var(--bg)', cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Submitting…' : 'Complete Registration'}
          </button>
        </div>

        <p style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text3)', textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
          Your information is stored securely and used only for studio account purposes.
        </p>
      </form>
    </>
  )
}

const btnPrimary: React.CSSProperties = {
  width: '100%', padding: '14px 0', background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 6,
  fontFamily: 'Syne', fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  width: '100%', padding: '12px 0', background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 6,
  fontFamily: 'Syne', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
}
