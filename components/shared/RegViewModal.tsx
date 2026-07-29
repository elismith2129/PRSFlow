'use client'
import React, { useEffect, useState } from 'react'
import { supabase, Client } from '@/lib/supabase'
import { toast } from '@/components/ui/Toaster'

function isImagePath(path: string | null | undefined): boolean {
  if (!path) return false
  return /\.(jpg|jpeg|png|heic|webp)$/i.test(path)
}

// Fields a mailing block needs — a subset of Client so any row selecting these
// columns (the registrations list, the review modal) can reuse this.
export type MailingAddressSource = Pick<
  Client,
  'name' | 'fname' | 'lname' | 'address_street' | 'address_street2' | 'address_city' | 'address_state' | 'address_zip'
>

// Build a paste-ready mailing block from a registration:
//   Name
//   Street
//   Street line 2          (line omitted entirely when blank)
//   City, ST ZIP
// Every piece is trimmed and blanks are dropped, so a partial address never
// pastes as a stray comma or an empty line.
export function buildMailingBlock(c: MailingAddressSource): string {
  const name = (c.name || [c.fname, c.lname].filter(Boolean).join(' ') || '').trim()
  const cityState = [c.address_city, c.address_state].map(s => (s || '').trim()).filter(Boolean).join(', ')
  const cityLine = [cityState, (c.address_zip || '').trim()].filter(Boolean).join(' ')
  return [name, c.address_street, c.address_street2, cityLine]
    .map(s => (s || '').trim())
    .filter(Boolean)
    .join('\n')
}

export function RegField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: 'Inter', color: value ? 'var(--text)' : 'var(--text3)' }}>{value || '—'}</div>
    </div>
  )
}

export function RegViewModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [client, setClient] = useState<Client | null>(null)
  const [idUrl, setIdUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  // Treat as a document (embed via iframe) when the path isn't a known image
  // extension OR an <img> render failed — this shows PDFs inline and rescues
  // extensionless image uploads instead of falling to an "opens in new tab" link.
  const isDoc = !isImagePath(client?.id_file_url) || imgFailed

  useEffect(() => {
    supabase.from('clients').select('*').eq('id', clientId).single().then(({ data }) => {
      if (data) {
        setClient(data as Client)
        if (data.id_file_url) {
          // The client-ids bucket is private; a service-role server route mints the
          // signed URL (the browser anon key can't sign paths it doesn't own).
          fetch(`/api/client-id-photo?storagePath=${encodeURIComponent(data.id_file_url)}`)
            .then(r => r.ok ? r.json() : null)
            .then(j => { if (j?.signedUrl) setIdUrl(j.signedUrl) })
            .catch(() => {})
        }
      }
      setLoading(false)
    })
  }, [clientId])

  const fmtSubmitted = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const mailingBlock = client ? buildMailingBlock(client) : ''

  // Copy the whole billing address in one action instead of picking out cells.
  // navigator.clipboard needs a secure context; on failure say so rather than
  // flashing "Copied" over an empty clipboard.
  async function copyBillingAddress() {
    if (!mailingBlock) return
    try {
      await navigator.clipboard.writeText(mailingBlock)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast('Could not copy — the browser blocked clipboard access.', 'error')
    }
  }

  return (
    <>
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10003, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div data-modal-gradient style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 540, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 48px rgba(0,0,0,0.6)', margin: '0 16px' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>Registration Record</div>
            {client?.registered_at && (
              <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                Submitted {fmtSubmitted(client.registered_at)}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => window.open(`/register/view/${clientId}`, '_blank')}
              style={{ padding: '5px 12px', background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 4, fontFamily: 'Syne', fontWeight: 700, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const, cursor: 'pointer' }}
            >
              Export PDF
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '18px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ color: 'var(--text3)', fontFamily: 'Inter', fontSize: 11, textAlign: 'center', padding: 40 }}>Loading…</div>
          ) : !client ? (
            <div style={{ color: 'var(--hot)', fontFamily: 'Inter', fontSize: 11 }}>Could not load registration data.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <RegField label="First Name" value={client.fname} />
                <RegField label="Last Name" value={client.lname} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <RegField label="Email" value={client.email} />
                <RegField label="Phone" value={client.phone} />
              </div>
              {/* Billing address — grouped into one bordered block so the whole
                  thing can be copied in a single action. Staff previously had to
                  select and copy each cell separately to fill an invoice. */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text3)' }}>
                    Billing Address
                  </div>
                  <button
                    onClick={copyBillingAddress}
                    disabled={!mailingBlock}
                    title={mailingBlock ? 'Copy name, street and city/state/ZIP as a mailing block' : 'No address on file'}
                    style={{
                      padding: '4px 10px', borderRadius: 4,
                      cursor: mailingBlock ? 'pointer' : 'not-allowed',
                      fontFamily: 'Syne', fontWeight: 700, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                      background: copied ? 'rgba(var(--accent-rgb), 0.14)' : 'transparent',
                      color: copied ? 'var(--accent)' : mailingBlock ? 'var(--text)' : 'var(--text3)',
                      border: `1px solid ${copied ? 'rgba(var(--accent-rgb), 0.45)' : 'var(--border)'}`,
                      opacity: mailingBlock ? 1 : 0.55,
                      transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                    }}
                  >
                    {copied ? '✓ Copied' : 'Copy Address'}
                  </button>
                </div>
                <RegField label="Street Address" value={client.address_street} />
                {client.address_street2 && <RegField label="Address Line 2" value={client.address_street2} />}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                  <RegField label="City" value={client.address_city} />
                  <RegField label="State" value={client.address_state} />
                  <RegField label="ZIP" value={client.address_zip} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <RegField label="Instagram" value={client.instagram ? `@${client.instagram.replace(/^@/, '')}` : null} />
                <RegField label="How They Heard" value={client.how_heard} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                <span style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text3)' }}>Terms & Conditions</span>
                <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 9, fontFamily: 'Inter', background: client.terms_accepted ? 'rgba(78,240,162,0.12)' : 'rgba(240,78,122,0.12)', color: client.terms_accepted ? 'var(--booked)' : 'var(--hot)', border: `1px solid ${client.terms_accepted ? 'rgba(78,240,162,0.3)' : 'rgba(240,78,122,0.3)'}` }}>
                  {client.terms_accepted ? '✓ Accepted' : 'Not accepted'}
                  {client.terms_accepted_at ? ` · ${new Date(client.terms_accepted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text3)', marginBottom: 8 }}>Government-Issued ID</div>
                {!client.id_file_url ? (
                  <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--text3)' }}>No ID on file</div>
                ) : !idUrl ? (
                  <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--text3)' }}>Loading ID…</div>
                ) : isDoc ? (
                  <div>
                    <iframe
                      src={idUrl}
                      title="Client ID document"
                      style={{ width: '100%', height: 320, border: '1px solid var(--border)', borderRadius: 6, background: '#fff', display: 'block' }}
                    />
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 14 }}>
                      <button onClick={() => setLightboxOpen(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontFamily: 'Inter', fontSize: 10, cursor: 'pointer' }}>Expand</button>
                      <a href={idUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text3)', fontFamily: 'Inter', fontSize: 10, textDecoration: 'none' }}>Open in new tab ↗</a>
                    </div>
                  </div>
                ) : (
                  <div>
                    <img
                      src={idUrl}
                      alt="Client ID"
                      onClick={() => setLightboxOpen(true)}
                      onError={() => setImgFailed(true)}
                      title="Click to enlarge"
                      style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 6, border: '1px solid var(--border)', objectFit: 'contain', display: 'block', cursor: 'zoom-in' }}
                    />
                    <div style={{ marginTop: 4, fontSize: 9, fontFamily: 'Inter', color: 'var(--text3)' }}>Click to enlarge</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Lightbox — enlarges the ID (image or embedded doc) in-app, above the modal at z 10004 */}
    {lightboxOpen && idUrl && (
      <div onClick={() => setLightboxOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10004, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '92vw', maxHeight: '90vh', width: isDoc ? '90vw' : undefined, height: isDoc ? '90vh' : undefined }}>
          {isDoc ? (
            <iframe src={idUrl} title="Client ID document" style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, background: '#fff', display: 'block' }} />
          ) : (
            <img src={idUrl} alt="Client ID" style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, display: 'block' }} />
          )}
          <button onClick={() => setLightboxOpen(false)} style={{ position: 'absolute', top: -16, right: -16, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, fontFamily: 'Inter', flexShrink: 0 }}>×</button>
        </div>
      </div>
    )}
    </>
  )
}
