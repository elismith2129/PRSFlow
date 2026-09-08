'use client'
// ─────────────────────────────────────────────────────────────────────────────
// ApCard — "the invoice is approved, now what?"
//
// A right-side reference panel showing how ONE label wants its invoice
// submitted: the steps, the PO discipline, the portal or AP email, the package.
// Ported from docs/design-refs/ap-card-mock.html.
//
// ⚠ THIS PANEL IS REFERENCE, NOT PROCESS (Eli, 2026-09-08: "no logic or stops,
// just a ref and checklist to help while learning"). It gates nothing. The
// ticks are cosmetic — see work_orders.ap_ticks, migration 20260908140000.
// If a future session is tempted to make Mark-sent depend on a tick, or to warn
// when the package is unticked, that is a different feature and needs Eli's
// say-so: the value here is that a new coordinator can read it without the app
// arguing with them.
//
// WHERE IT OPENS FROM: the `AP` chip beside the client name on a Billing Hub
// row, the ⋯ menu, and the client profile. Deliberately NOT the row's action
// column — that column is "only ever the next real act" (billing/page.tsx), and
// opening a reference is navigation, not an action.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'

export type ApStep = { title: string; detail?: string | null }

export type ApProfile = {
  id: string
  name: string
  family: string
  is_global: boolean
  submission_method: string
  po_required: boolean
  po_notes: string | null
  portal_name: string | null
  portal_url: string | null
  login_email: string | null
  credential_hint: string | null
  submit_to: string | null
  cc_to: string | null
  payment_method: string | null
  steps: ApStep[]
  tips: string | null
}

/** The package is the same four things for every label — the sheet and the
 *  coordinator procedures agree. Session info is last because it is the one
 *  that gets skipped and the one Aaron's doc names as a reason labels refuse
 *  to remit. */
const PACKAGE_ITEMS = [
  'Invoice PDF from QuickBooks',
  'Work order',
  'Receipts, if there were rentals or a food budget',
  'Session info filled in — some labels will not pay without it',
]

const isPortal = (m: string) => m === 'portal' || m === 'form' || m === 'mixed'

export function ApCard({
  profile, clientName, clientNotes, woNumber, workOrderId, ticks, onClose,
}: {
  profile: ApProfile | null
  /** The client whose invoice this is — may differ from the profile name when
      a division inherits (Atlantic → "Warner Records (SAP Ariba)"). */
  clientName: string
  /** clients.ap_notes — the per-client addendum under the shared procedure. */
  clientNotes?: string | null
  woNumber?: string | null
  /** Omit on the client profile: with no invoice there is nothing to tick. */
  workOrderId?: string | null
  ticks?: Record<string, boolean>
  onClose: () => void
}) {
  const [global, setGlobal] = useState<ApProfile | null>(null)
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [local, setLocal] = useState<Record<string, boolean>>(ticks ?? {})
  useEffect(() => { setLocal(ticks ?? {}) }, [ticks])

  // The one global reference row, appended to every card. Fetched here rather
  // than passed in so both entry points get it without threading a prop.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('ap_profiles').select('*').eq('is_global', true).limit(1)
      if (alive && data?.[0]) setGlobal(data[0] as ApProfile)
    })()
    return () => { alive = false }
  }, [])

  // Escape closes — a reference panel must never trap someone mid-invoice.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const steps = useMemo<ApStep[]>(
    () => (Array.isArray(profile?.steps) ? profile!.steps : []), [profile])

  // Optimistic: the tick paints immediately and the write follows. A failed
  // write reverts and toasts via dbResult — cosmetic state still shouldn't lie.
  const toggle = useCallback(async (key: string) => {
    if (!workOrderId) return
    const next = { ...local }
    if (next[key]) delete next[key]; else next[key] = true
    setLocal(next)
    const { error } = await supabase
      .from('work_orders').update({ ap_ticks: next }).eq('id', workOrderId)
    if (!dbResult('Saving checklist', error)) setLocal(local)
  }, [local, workOrderId])

  if (!profile) return null

  const tickable = !!workOrderId
  const Tick = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div
      onClick={tickable ? () => toggle(k) : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 9, padding: '6px 0',
        fontSize: 12.5, cursor: tickable ? 'pointer' : 'default',
      }}
    >
      <div style={{
        flex: '0 0 15px', height: 15, borderRadius: 4, marginTop: 2,
        border: `1.5px solid ${local[k] ? 'var(--c-st-booked)' : 'var(--c-fg-3)'}`,
        background: local[k] ? 'var(--c-st-booked)' : 'transparent',
        color: 'var(--c-chip-ink)', fontSize: 11, fontWeight: 900,
        display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
      }}>{local[k] ? '✓' : ''}</div>
      <div style={{ opacity: local[k] ? 0.55 : 1 }}>{children}</div>
    </div>
  )

  const Pill = ({ bg, ink, children }: { bg?: string; ink?: string; children: React.ReactNode }) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px',
      borderRadius: 99, fontSize: 11.5, fontWeight: 800, letterSpacing: '0.02em',
      background: bg ?? 'var(--c-wash2)', color: ink ?? 'var(--c-fg-2)',
    }}>{children}</span>
  )

  const secLabel: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 10,
  }
  const sec: React.CSSProperties = { padding: '15px 18px', borderBottom: '1px solid var(--c-wash2)' }
  const kS: React.CSSProperties = {
    flex: '0 0 92px', color: 'var(--c-fg-3)', fontSize: 11, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: 2,
  }
  const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div style={{ display: 'flex', gap: 12, padding: '6px 0', fontSize: 12.5 }}>
      <div style={kS}>{k}</div>
      <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{children}</div>
    </div>
  )

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10004,
        background: 'rgba(0,0,0,.5)', display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, height: '100dvh', background: 'var(--c-bg)',
          overflowY: 'auto', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header — the CLIENT is the headline; the procedure name sits under
            it, because on an inherited profile they differ and someone needs to
            see they are in the right place. */}
        <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--c-wash2)', position: 'relative' }}>
          <div style={{ ...secLabel, marginBottom: 5 }}>How to send this invoice</div>
          <div className="c-arch" style={{ fontSize: 21, letterSpacing: '-0.01em' }}>{clientName}</div>
          <div style={{ fontSize: 12.5, color: 'var(--c-fg-3)', marginTop: 3 }}>
            {profile.name}{woNumber ? ` · ${woNumber}` : ''}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              position: 'absolute', top: 12, right: 12, background: 'none', border: 'none',
              color: 'var(--c-fg-3)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4,
            }}
          >×</button>
        </div>

        {/* At a glance — channel, PO, payment. Answers the three questions
            before anyone reads a step. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '13px 18px', borderBottom: '1px solid var(--c-wash2)' }}>
          <Pill>{isPortal(profile.submission_method)
            ? `${profile.portal_name || 'Portal'} submission`
            : 'Email submission'}</Pill>
          {profile.po_required
            ? <Pill bg="var(--c-st-warm)" ink="var(--c-chip-ink)">PO required</Pill>
            : <Pill bg="rgba(207,214,212,.22)">No PO</Pill>}
          {profile.payment_method && (
            <Pill
              bg={/check/i.test(profile.payment_method) ? 'var(--c-st-uncon)' : 'var(--c-st-booked)'}
              ink="var(--c-chip-ink)"
            >Pays {profile.payment_method}</Pill>
          )}
        </div>

        {steps.length > 0 && (
          <div style={sec}>
            <div style={secLabel}>Steps</div>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {steps.map((s, i) => (
                <li key={i} style={{
                  display: 'flex', gap: 11, padding: '8px 0',
                  borderTop: i === 0 ? 'none' : '1px solid var(--c-wash2)',
                  paddingTop: i === 0 ? 0 : 8,
                }}>
                  <div style={{
                    flex: '0 0 21px', height: 21, borderRadius: '50%',
                    background: 'var(--c-fg)', color: 'var(--c-bg)', fontSize: 11, fontWeight: 900,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
                  }}>{i + 1}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>{s.title}</div>
                    {s.detail && (
                      <>
                        <button
                          onClick={() => setOpen(o => ({ ...o, [i]: !o[i] }))}
                          style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                            fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                            color: 'var(--c-fg-3)', marginTop: 3, letterSpacing: '0.02em',
                          }}
                        >{open[i] ? 'Hide detail ▴' : 'Show detail ▾'}</button>
                        {open[i] && (
                          <div style={{ fontSize: 12.5, color: 'var(--c-fg-2)', lineHeight: 1.5, marginTop: 5 }}>
                            {s.detail}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div style={sec}>
          <div style={secLabel}>Package{tickable ? '' : ' (ticks appear on an invoice)'}</div>
          {PACKAGE_ITEMS.map((t, i) => <Tick key={i} k={`pkg:${i}`}>{t}</Tick>)}
        </div>

        {(profile.submit_to || profile.cc_to || profile.portal_url || profile.login_email || profile.po_notes) && (
          <div style={sec}>
            <div style={secLabel}>{isPortal(profile.submission_method) ? 'Access' : 'Send to'}</div>
            {profile.portal_name && <Row k="Portal">{profile.portal_name}</Row>}
            {profile.portal_url && (
              <Row k="URL">
                <a href={profile.portal_url} target="_blank" rel="noreferrer"
                   style={{ color: 'var(--c-st-cold)' }}>{profile.portal_url}</a>
              </Row>
            )}
            {profile.login_email && <Row k="Login">{profile.login_email}</Row>}
            {/* Never a password — see migration 20260908120000. */}
            {profile.login_email && profile.credential_hint && (
              <Row k="Password"><span style={{ color: 'var(--c-fg-3)', fontStyle: 'italic' }}>{profile.credential_hint}</span></Row>
            )}
            {profile.submit_to && <Row k="To">{profile.submit_to}</Row>}
            {profile.cc_to && <Row k="Copy">{profile.cc_to}</Row>}
            {profile.po_notes && <Row k="PO">{profile.po_notes}</Row>}
          </div>
        )}

        {(profile.tips || clientNotes) && (
          <div style={sec}>
            <div style={secLabel}>Watch out</div>
            {profile.tips && (
              <div style={{
                display: 'flex', gap: 9, padding: '11px 12px', borderRadius: 10,
                background: 'rgba(255,169,77,.14)', fontSize: 12.5, lineHeight: 1.5,
              }}><div>⚠︎</div><div>{profile.tips}</div></div>
            )}
            {clientNotes && (
              <div style={{
                display: 'flex', gap: 9, padding: '11px 12px', borderRadius: 10, marginTop: profile.tips ? 8 : 0,
                background: 'rgba(255,169,77,.14)', fontSize: 12.5, lineHeight: 1.5,
              }}><div>⚠︎</div><div><b style={{ color: 'var(--c-st-warm)' }}>{clientName}:</b> {clientNotes}</div></div>
            )}
          </div>
        )}

        {/* The one global row, collapsed. Same content under every label. */}
        {global && !profile.is_global && Array.isArray(global.steps) && global.steps.length > 0 && (
          <div style={{ padding: '13px 18px' }}>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: 'var(--c-fg-3)' }}>
                General AP reference ▾
              </summary>
              <div style={{ marginTop: 8 }}>
                {global.steps.map((s, i) => (
                  <div key={i} style={{ marginBottom: 9 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{s.title}</div>
                    {s.detail && <div style={{ fontSize: 12, color: 'var(--c-fg-3)', lineHeight: 1.5 }}>{s.detail}</div>}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}
