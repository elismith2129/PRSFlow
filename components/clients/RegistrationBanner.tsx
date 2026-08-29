'use client'
// Pending-registration banner + review modal.
//
// This used to live inside ClientsPageInner, which meant it only appeared once
// you were already on the CLIENTS tab — so a returned registration went unseen
// by anyone working leads. It now mounts at the CRM page level, above the tab
// bar, where it is visible on every CRM tab.
//
// Owns its own fetch AND its own realtime subscription (project standing rule:
// never a bare on-mount fetch), so a registration submitted while the page is
// open surfaces without a refresh.
import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { logAppError } from '@/lib/errlog'
import { useClientsVersion } from '@/hooks/useClientsVersion'

export interface PendingReg {
  id: string
  name: string
  email: string | null
  phone: string | null
  instagram: string | null
  how_heard: string | null
  address_street: string | null
  address_street2: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  registered_at: string
  id_file_url: string | null
  terms_accepted: boolean | null
}

// "2h ago" / "yesterday" — how long this person has been waiting on us. A
// duration answers the question a timestamp doesn't: is this fresh, or has it
// been sitting all week?
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

function isImagePath(path: string | null): boolean {
  if (!path) return false
  return /\.(jpg|jpeg|png|heic|webp)$/i.test(path)
}

export function RegistrationBanner({ onNavigate }: {
  // Called with the client id after a registration is confirmed, so the host
  // page can switch to its clients view and select the new profile.
  onNavigate: (clientId: string) => void
}) {
  const [pendingRegs, setPendingRegs] = useState<PendingReg[]>([])
  const [open, setOpen] = useState(false)
  // Shared `clients` channel — see hooks/useClientsVersion.
  const clientsVersion = useClientsVersion()

  const load = useCallback(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from('clients')
      .select('id, name, email, phone, instagram, how_heard, address_street, address_street2, address_city, address_state, address_zip, registered_at, id_file_url, terms_accepted')
      .not('registered_at', 'is', null)
      .is('profile_confirmed_at', null)
      .gt('registered_at', thirtyDaysAgo)
      .order('registered_at', { ascending: false })
    setPendingRegs((data || []) as PendingReg[])
  }, [])

  useEffect(() => { load() }, [load, clientsVersion])

  // Confirming a registration is ONE write that matters: `clients
  // .profile_confirmed_at`. Every surface that counts pending registrations —
  // this banner, the Nav badge and the Rail badge — queries
  // `registered_at IS NOT NULL AND profile_confirmed_at IS NULL`. Nothing reads
  // `registration_tokens.registration_reviewed`; it was added "for future
  // granular tracking" (CHUNK_4_BRIEFING) and never wired up.
  //
  // BUG FIXED 2026-08-28: the banner row's own "Create profile" button called
  // this function directly, and this function only ever wrote the token flag.
  // So the row vanished optimistically, the DB was never told the profile was
  // confirmed, and the next fetch — on remount, or on the shared clients
  // channel firing — brought the badge straight back. Only the modal's path
  // worked, because the modal did the clients write itself first.
  //
  // Order matters now: write, verify, and only then drop it locally. Same
  // reasoning the modal already carried — never clear the row on an unverified
  // write, or the banner disagrees with the database.
  async function handleNavigate(id: string) {
    const { error } = await supabase
      .from('clients')
      .update({ profile_confirmed_at: new Date().toISOString() })
      .eq('id', id)
    if (!dbResult('Confirming registration', error)) return

    setPendingRegs(prev => prev.filter(r => r.id !== id))
    setOpen(false)

    // Best-effort bookkeeping on a column nothing reads yet. It is deliberately
    // NOT dbResult'd: a failure here would fire a red "your change was NOT
    // saved" toast over a confirm that did in fact save, which is worse than
    // silence. Still reported to Admin → Errors so it stays visible.
    const { error: tokenError } = await supabase
      .from('registration_tokens')
      .update({ registration_reviewed: true })
      .eq('client_id', id)
      .eq('registration_reviewed', false)
    if (tokenError) {
      logAppError(
        new Error(`[db] Marking registration reviewed: ${tokenError.message || 'unknown error'}`),
        { source: 'db', code: tokenError.code },
      )
    }

    onNavigate(id)
  }

  if (pendingRegs.length === 0) return null

  return (
    <>
      {/* OPTION D + C's PULSE (Eli's pick, 2026-08-20 — mock
          docs/design-refs/reg-banner-options.html). The old banner was a grey
          strip in the same wash as every panel around it, saying only a
          number; it read as page furniture and got skimmed past. This names
          the PEOPLE — a name is harder to ignore than a count — and gives each
          one its own action, so the usual one-or-two case is handled without
          opening anything. Teal, not hot: nothing is wrong, a client did their
          part and is waiting on us. Past three, the rest collapse into a
          "+N more" that opens the full review modal.
          The click targets are deliberate: each row's button confirms THAT
          person (same handleNavigate the modal calls); the header and the
          overflow line open the modal. */}
      <div
        style={{
          marginBottom: 12, padding: '12px 14px', flexShrink: 0,
          background: 'var(--c-wash2)', borderRadius: 14,
          boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, var(--c-st-booked) 45%, transparent)',
        }}
      >
        <div
          onClick={() => setOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9, cursor: 'pointer' }}
        >
          {/* Same slow pulse as the Web Inquiry alert — it reads as live
              rather than decorated. */}
          <span
            style={{
              width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
              background: 'var(--c-st-booked)',
              animation: 'regPulse 2s ease-in-out infinite',
            }}
          />
          <span style={{ fontSize: 9, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)', padding: '3px 9px', borderRadius: 99 }}>
            Registration{pendingRegs.length !== 1 ? 's' : ''} back
          </span>
          <span style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-2)' }}>
            waiting on {pendingRegs.length === 1 ? 'their' : 'their'} client profile
          </span>
        </div>

        {pendingRegs.slice(0, 3).map(reg => {
          const initials = (reg.name || '')
            .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '—'
          return (
            <div
              key={reg.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '7px 9px', borderRadius: 9,
                background: 'var(--c-bg)', marginBottom: 5,
              }}
            >
              <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: 'var(--c-st-booked)', color: 'var(--c-chip-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontFamily: 'Inter', fontWeight: 800 }}>
                {initials}
              </span>
              <span style={{ fontSize: 12, fontFamily: 'Inter', fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {reg.name}
              </span>
              <span style={{ fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg-3)', marginLeft: 'auto', flexShrink: 0 }}>
                {timeAgo(reg.registered_at)}
              </span>
              <button
                type="button"
                onClick={() => handleNavigate(reg.id)}
                className="c-control"
                style={{ flexShrink: 0, fontSize: 9, fontFamily: 'Inter', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', background: 'var(--c-wash2)', color: 'var(--c-fg)', padding: '6px 11px', borderRadius: 99, cursor: 'pointer' }}
              >
                Create profile
              </button>
            </div>
          )
        })}

        {pendingRegs.length > 3 && (
          <div
            onClick={() => setOpen(true)}
            style={{ fontSize: 10.5, fontFamily: 'Inter', color: 'var(--c-fg-2)', cursor: 'pointer', padding: '4px 2px 0' }}
          >
            + {pendingRegs.length - 3} more — review all →
          </div>
        )}
      </div>

      {open && (
        <RegistrationReviewModal
          regs={pendingRegs}
          onClose={() => setOpen(false)}
          onNavigate={handleNavigate}
        />
      )}
    </>
  )
}

// ─── Registration review modal ────────────────────────────────────────────────

function RegistrationReviewModal({ regs, onClose, onNavigate }: {
  regs: PendingReg[]
  onClose: () => void
  onNavigate: (id: string) => Promise<void>
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  useEffect(() => {
    async function fetchSignedUrls() {
      const map: Record<string, string> = {}
      for (const reg of regs) {
        if (!reg.id_file_url) continue
        const { data, error } = await supabase.storage.from('client-ids').createSignedUrl(reg.id_file_url, 3600)
        if (error) console.error('[client-ids] signed URL failed for', reg.id_file_url, error.message)
        if (data?.signedUrl) map[reg.id] = data.signedUrl
      }
      setSignedUrls(map)
    }
    fetchSignedUrls()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The confirm write itself now lives in the parent's handleNavigate, so this
  // path and the banner row's button are literally the same code — the split
  // between them is what let the banner button ship without a confirm write at
  // all. This is only the spinner. handleNavigate does not navigate on a failed
  // write, so a failure correctly leaves the card sitting here.
  async function confirm(id: string) {
    setConfirmingId(id)
    try {
      await onNavigate(id)
    } finally {
      setConfirmingId(null)
    }
  }

  const ghostBtn: React.CSSProperties = {
    background: 'none', color: 'var(--c-fg-2)',
    borderRadius: 6, padding: '7px 16px', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400,
    fontSize: 10, letterSpacing: '0.06em', cursor: 'pointer',
  }

  return (
    <>
      <div onClick={onClose} className="c-modal-backdrop" style={{ zIndex: 1000 }}>
        <div onClick={e => e.stopPropagation()} data-modal-gradient="" style={{ width: '100%', maxWidth: 580, maxHeight: '88vh', overflowY: 'auto', background: 'var(--c-bg)', borderRadius: 12 }}>

          {/* Header */}
          <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--c-bg)', zIndex: 1 }}>
            <div>
              <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 15 }}>New Registrations</div>
              <div style={{ fontSize: 10, color: 'var(--c-fg-3)', fontFamily: 'Inter', marginTop: 2 }}>
                {regs.length} pending — review ID and confirm to create client profile
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', color: 'var(--c-fg-3)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>

          {/* Registration cards */}
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {regs.map(reg => {
              const isConfirming = confirmingId === reg.id
              const regDate = new Date(reg.registered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              const signedUrl = signedUrls[reg.id]
              const hasImage = reg.id_file_url && isImagePath(reg.id_file_url)
              const hasPdf = reg.id_file_url && !isImagePath(reg.id_file_url)

              const addressLine = [reg.address_street, reg.address_street2].filter(Boolean).join(', ')
              const cityLine = [reg.address_city, [reg.address_state, reg.address_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')

              return (
                <div key={reg.id} style={{ background: 'var(--c-wash)', borderRadius: 10, overflow: 'hidden' }}>

                  {/* Top: ID thumb + identity */}
                  <div style={{ display: 'flex', gap: 14, padding: '14px 14px 12px' }}>
                    {/* ID thumbnail — always shown */}
                    <div style={{ flexShrink: 0 }}>
                      {!reg.id_file_url ? (
                        <div style={{ width: 80, height: 80, borderRadius: 7, background: 'var(--c-bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <span style={{ fontSize: 22, opacity: 0.25 }}>🪪</span>
                          <span style={{ fontSize: 8, fontFamily: 'Inter', color: 'var(--c-fg-3)', textAlign: 'center' as const }}>No ID{'\n'}uploaded</span>
                        </div>
                      ) : hasImage && signedUrl ? (
                        <img
                          src={signedUrl}
                          onClick={() => setLightboxUrl(signedUrl)}
                          title="Click to view full size"
                          style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 7, cursor: 'pointer', display: 'block' }}
                        />
                      ) : hasImage && !signedUrl ? (
                        <div style={{ width: 80, height: 80, borderRadius: 7, background: 'var(--c-bg)', animation: 'shimmer 1.4s ease-in-out infinite' }} />
                      ) : hasPdf && signedUrl ? (
                        <a href={signedUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 80, height: 80, borderRadius: 7, background: 'var(--c-bg)', textDecoration: 'none', gap: 4 }}>
                          <span style={{ fontSize: 24 }}>📄</span>
                          <span style={{ fontSize: 8, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, color: 'var(--c-fg-3)', letterSpacing: '0.06em' }}>PDF — tap to open</span>
                        </a>
                      ) : (
                        <div style={{ width: 80, height: 80, borderRadius: 7, background: 'var(--c-bg)', animation: 'shimmer 1.4s ease-in-out infinite' }} />
                      )}
                      {hasImage && signedUrl && (
                        <div style={{ textAlign: 'center' as const, marginTop: 4, fontSize: 8, color: 'var(--c-fg-3)', fontFamily: 'Inter' }}>tap to enlarge</div>
                      )}
                    </div>

                    {/* Identity + contact */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 18, lineHeight: 1.2, marginBottom: 6 }}>{reg.name}</div>
                      <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', lineHeight: 1.8 }}>
                        {reg.email && <div>{reg.email}</div>}
                        {reg.phone && <div>{reg.phone}</div>}
                        {reg.instagram && <div>@{reg.instagram.replace(/^@/, '')}</div>}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 9, fontFamily: 'Inter', color: 'var(--c-fg-3)' }}>
                        Registered {regDate}
                      </div>
                    </div>
                  </div>

                  {/* Address + how heard */}
                  {(addressLine || cityLine || reg.how_heard) && (
                    <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.15)' }}>
                      {(addressLine || cityLine) && (
                        <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-2)', lineHeight: 1.6, marginBottom: reg.how_heard ? 6 : 0 }}>
                          {addressLine && <div>{addressLine}</div>}
                          {cityLine && <div>{cityLine}</div>}
                        </div>
                      )}
                      {reg.how_heard && (
                        <div style={{ fontSize: 10, fontFamily: 'Inter', color: 'var(--c-fg-3)' }}>
                          How heard: <span style={{ color: 'var(--c-fg-2)' }}>{reg.how_heard}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Footer: badges + confirm button */}
                  <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' as const }}>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
                      {reg.terms_accepted && (
                        <span style={{ fontSize: 8, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.08em', color: 'var(--c-st-booked)', background: 'rgba(20,184,166,0.1)', padding: '2px 6px', borderRadius: 3 }}>
                          TERMS ACCEPTED
                        </span>
                      )}
                      {reg.id_file_url ? (
                        <span style={{ fontSize: 8, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.08em', color: 'var(--c-fg)', background: 'var(--c-wash2)', padding: '2px 6px', borderRadius: 3 }}>
                          ID ON FILE
                        </span>
                      ) : (
                        <span style={{ fontSize: 8, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.08em', color: 'var(--c-fg-3)', background: 'var(--c-bg)', padding: '2px 6px', borderRadius: 3 }}>
                          NO ID
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => confirm(reg.id)}
                      disabled={isConfirming}
                      style={{ background: 'var(--c-fg)', color: 'var(--c-bg)', borderRadius: 5, padding: '7px 16px', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' as const, cursor: isConfirming ? 'default' : 'pointer', opacity: isConfirming ? 0.7 : 1, flexShrink: 0 }}
                    >
                      {isConfirming ? 'Creating…' : 'Create Client Profile →'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={ghostBtn}>Close</button>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div onClick={() => setLightboxUrl(null)} className="c-modal-backdrop" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '92vw', maxHeight: '90vh' }}>
            <img src={lightboxUrl} alt="ID document" style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, display: 'block' }} />
            <button onClick={() => setLightboxUrl(null)} style={{ position: 'absolute', top: -16, right: -16, background: 'var(--c-bg)', color: 'var(--c-fg)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, fontFamily: 'Inter', flexShrink: 0 }}>×</button>
          </div>
        </div>
      )}
    </>
  )
}
