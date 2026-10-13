'use client'
import React, { useState } from 'react'
import { supabase, Lead, LeadStatus, UserProfile, EmailCampaign } from '@/lib/supabase'

/**
 * CAMPAIGNS — pick a segment of leads, write one email, send it, see what was
 * sent. Moved out of app/(main)/crm/page.tsx UNCHANGED on 2026-10-12 (the rail
 * rework): Texting and Campaigns left the CRM's tab strip for their own page,
 * /texting, which is Eli-only. The page that mounts this owns the gate; the
 * send itself is gated again by /api/send-campaign (session + role).
 */
export function CampaignsPanel({ leads, allTags, profile }: {
  leads: Lead[]
  allTags: string[]
  profile: UserProfile
}) {
  // Segment filters
  const [segTags, setSegTags] = useState<string[]>([])
  const [segStatuses, setSegStatuses] = useState<LeadStatus[]>([])
  const [segBilling, setSegBilling] = useState<'COD' | 'Billing' | ''>('')

  // Compose
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  // UI state
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [history, setHistory] = useState<EmailCampaign[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Compute recipient list from current leads
  const recipients = leads.filter(l => {
    if (l.email_opt_out) return false
    if (!l.email) return false
    if (segStatuses.length > 0 && !segStatuses.includes(l.status)) return false
    // exclude dead/DNB unless explicitly selected
    if (segStatuses.length === 0 && l.status === 'dead') return false
    if (segBilling && l.billing !== segBilling) return false
    if (segTags.length > 0 && !segTags.every(t => (l.tags || []).includes(t))) return false
    return true
  })

  // Dedupe by email
  const seen = new Set<string>()
  const uniqueRecipients = recipients.filter(l => {
    const key = l.email.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key); return true
  })

  async function loadHistory() {
    setHistoryLoading(true)
    const { data } = await supabase.from('email_campaigns').select('*').order('sent_at', { ascending: false }).limit(20)
    setHistory((data || []) as EmailCampaign[])
    setHistoryLoading(false)
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim() || uniqueRecipients.length === 0 || sending) return
    setSending(true)
    setSendResult(null)
    try {
      // Gated since 2026-09-15: the route verifies the session and the role.
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/send-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session?.access_token ?? ''}` },
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          recipients: uniqueRecipients.map(l => ({ email: l.email, name: `${l.fname} ${l.lname}`.trim() })),
          segment_tags: segTags,
          segment_statuses: segStatuses,
          segment_billing: segBilling || null,
          sent_by: profile.display_name,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setSendResult({ ok: true, message: `Sent to ${json.sent} recipient${json.sent !== 1 ? 's' : ''}${json.failed > 0 ? ` · ${json.failed} failed` : ''}` })
        setSubject('')
        setBody('')
        if (historyOpen) loadHistory()
      } else {
        setSendResult({ ok: false, message: json.error || 'Send failed' })
      }
    } catch (e) {
      setSendResult({ ok: false, message: 'Network error — try again' })
    }
    setSending(false)
  }

  const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
    { value: 'hot', label: 'Hot' },
    { value: 'warm', label: 'Warm' },
    { value: 'cold', label: 'Cold' },
    { value: 'uncontacted', label: 'Uncontacted' },
    { value: 'leasing', label: 'Leasing' },
    { value: 'booked', label: 'Booked' },
    { value: 'dead', label: 'DNB' },
  ]

  const sectionLabel: React.CSSProperties = { fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 8, display: 'block' }
  const chipBase: React.CSSProperties = { borderRadius: 20, padding: '3px 10px', fontSize: 10, fontFamily: 'Inter', cursor: 'pointer', background: 'transparent', color: 'var(--c-fg-3)', transition: 'all 0.12s' }
  const chipActive: React.CSSProperties = { ...chipBase, background: 'var(--c-wash2)', color: 'var(--c-fg)' }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 40 }}>

      {/* ── Segment picker ── */}
      <div style={{ background: 'var(--c-bg)', borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 13, marginBottom: 16 }}>Segment</div>

        {/* Status */}
        <div style={{ marginBottom: 14 }}>
          <span style={sectionLabel}>Lead Status</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {STATUS_OPTIONS.map(s => {
              const active = segStatuses.includes(s.value)
              return (
                <button key={s.value} onClick={() => setSegStatuses(prev => active ? prev.filter(x => x !== s.value) : [...prev, s.value])} style={active ? chipActive : chipBase}>
                  {s.label}
                </button>
              )
            })}
          </div>
          {segStatuses.length === 0 && <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 5 }}>All statuses (except Dead)</div>}
        </div>

        {/* Billing */}
        <div style={{ marginBottom: 14 }}>
          <span style={sectionLabel}>Billing Type</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['', 'COD', 'Billing'] as const).map(b => {
              const active = segBilling === b
              return (
                <button key={b} onClick={() => setSegBilling(b)} style={active ? chipActive : chipBase}>
                  {b === '' ? 'All' : b}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tags */}
        <div>
          <span style={sectionLabel}>Tags</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allTags.map(tag => {
              const active = segTags.includes(tag)
              return (
                <button key={tag} onClick={() => setSegTags(prev => active ? prev.filter(t => t !== tag) : [...prev, tag])} style={active ? chipActive : chipBase}>
                  {tag}
                </button>
              )
            })}
          </div>
          {segTags.length === 0 && <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 5 }}>All tags</div>}
        </div>
      </div>

      {/* ── Recipient preview ── */}
      <div style={{ background: 'var(--c-bg)', borderRadius: 10, padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 30, letterSpacing: '-0.025em', color: uniqueRecipients.length === 0 ? 'var(--c-fg-3)' : 'var(--c-fg)' }}>{uniqueRecipients.length}</span>
            <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--c-fg-3)', marginLeft: 8 }}>recipient{uniqueRecipients.length !== 1 ? 's' : ''} match this segment</span>
          </div>
          {uniqueRecipients.length > 0 && (
            <button onClick={() => setPreviewOpen(o => !o)} style={{ background: 'none', color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 10, cursor: 'pointer', padding: 0 }}>
              {previewOpen ? 'Hide list ▲' : 'Preview list ▼'}
            </button>
          )}
        </div>
        {previewOpen && (
          <div style={{ marginTop: 12, maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {uniqueRecipients.map(l => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 11, fontFamily: 'Inter' }}>
                <span style={{ color: 'var(--c-fg)', minWidth: 140 }}>{l.fname} {l.lname}</span>
                <span style={{ color: 'var(--c-fg-3)' }}>{l.email}</span>
                {(l.tags || []).length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(l.tags || []).map(t => <span key={t} style={{ fontSize: 9, background: 'var(--c-wash)', borderRadius: 10, padding: '1px 6px', color: 'var(--c-fg-3)' }}>{t}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Compose ── */}
      <div style={{ background: 'var(--c-bg)', borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 13, marginBottom: 16 }}>Compose</div>
        <div style={{ marginBottom: 10 }}>
          <span style={sectionLabel}>Subject</span>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="e.g. Studio availability this month at Paramount"
            className="c-input c-inset2" style={{ fontSize: 12 }}
          />
        </div>
        <div>
          <span style={sectionLabel}>Body</span>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={`Hi [First Name],\n\nJust wanted to reach out…`}
            rows={10}
            className="c-textarea c-inset2" style={{ fontSize: 12, resize: 'vertical' }}
          />
          <div style={{ fontSize: 9, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 4 }}>Use [First Name] to personalize — it will be replaced per recipient.</div>
        </div>
      </div>

      {/* ── Send ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sendResult && (
          <div style={{ padding: '10px 14px', borderRadius: 6, background: sendResult.ok ? 'rgba(20,184,166,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${sendResult.ok ? 'rgba(20,184,166,0.3)' : 'rgba(239,68,68,0.3)'}`, fontSize: 11, fontFamily: 'Inter', color: sendResult.ok ? 'var(--c-st-booked)' : 'var(--c-st-hot)' }}>
            {sendResult.message}
          </div>
        )}
        <button
          onClick={handleSend}
          disabled={sending || !subject.trim() || !body.trim() || uniqueRecipients.length === 0}
          style={{ padding: '11px 0', background: 'var(--c-fg)', color: 'var(--c-bg)', borderRadius: 8, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: (sending || !subject.trim() || !body.trim() || uniqueRecipients.length === 0) ? 'not-allowed' : 'pointer', opacity: (sending || !subject.trim() || !body.trim() || uniqueRecipients.length === 0) ? 0.5 : 1, transition: 'opacity 0.15s' }}
        >
          {sending ? 'Sending…' : `Send to ${uniqueRecipients.length} Recipient${uniqueRecipients.length !== 1 ? 's' : ''}`}
        </button>
      </div>

      {/* ── History ── */}
      <div>
        <button
          onClick={() => { setHistoryOpen(o => !o); if (!historyOpen) loadHistory() }}
          style={{ background: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--c-fg-3)', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          <span style={{ fontSize: 9, transform: historyOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
          Campaign History
        </button>
        {historyOpen && (
          <div style={{ marginTop: 12 }}>
            {historyLoading ? (
              <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>Loading…</div>
            ) : history.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>No campaigns sent yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map(c => (
                  <div key={c.id} style={{ background: 'var(--c-bg)', borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                      <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 12, color: 'var(--c-fg)' }}>{c.subject}</div>
                      <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'DM Mono', whiteSpace: 'nowrap' }}>{new Date(c.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>
                      {c.recipient_count} recipient{c.recipient_count !== 1 ? 's' : ''} · sent by {c.sent_by}
                      {c.segment_tags.length > 0 && <> · tags: {c.segment_tags.join(', ')}</>}
                      {c.segment_billing && <> · {c.segment_billing}</>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
