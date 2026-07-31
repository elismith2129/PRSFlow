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
      <div style={{ fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-fg-3)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: 'Inter', color: value ? 'var(--c-fg)' : 'var(--c-fg-3)' }}>{value || '—'}</div>
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
  // Only a PDF gets an <iframe>. NEVER iframe anything else.
  //
  // This used to be `!isImagePath(...) || imgFailed`, so a failed <img> flipped the
  // component into document mode and rendered an iframe at the file — and an iframe
  // pointing at a format the browser can't display inline makes the browser DOWNLOAD
  // it. That's the "white box that auto-downloads the file" bug: iPhone IDs are
  // often HEIC, Chrome and Firefox can't render HEIC, the <img> failed, and the
  // fallback turned into a download.
  const isPdf = /\.pdf$/i.test(client?.id_file_url ?? '')
  // Something we can plausibly show in an <img>: a known image extension, or an
  // unknown/extensionless path (worth attempting — many uploads have no extension).
  const canTryImage = !isPdf && !imgFailed

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
      className="c-modal-backdrop" style={{ zIndex: 10003 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div data-modal-gradient style={{ background: 'var(--c-bg)', borderRadius: 12, width: '100%', maxWidth: 540, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 48px rgba(0,0,0,0.6)', margin: '0 16px' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 13, color: 'var(--c-fg)' }}>Registration Record</div>
            {client?.registered_at && (
              <div style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--c-fg-3)', marginTop: 2 }}>
                Submitted {fmtSubmitted(client.registered_at)}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => window.open(`/register/view/${clientId}`, '_blank')}
              style={{ padding: '5px 12px', background: 'var(--c-fg)', color: 'var(--c-bg)', borderRadius: 4, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const, cursor: 'pointer' }}
            >
              Export PDF
            </button>
            <button onClick={onClose} style={{ background: 'none', color: 'var(--c-fg-3)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '18px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ color: 'var(--c-fg-3)', fontFamily: 'Inter', fontSize: 11, textAlign: 'center', padding: 40 }}>Loading…</div>
          ) : !client ? (
            <div style={{ color: 'var(--c-st-hot)', fontFamily: 'Inter', fontSize: 11 }}>Could not load registration data.</div>
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
              <div style={{ borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--c-fg-3)' }}>
                    Billing Address
                  </div>
                  <button
                    onClick={copyBillingAddress}
                    disabled={!mailingBlock}
                    title={mailingBlock ? 'Copy name, street and city/state/ZIP as a mailing block' : 'No address on file'}
                    style={{
                      padding: '4px 10px', borderRadius: 4,
                      cursor: mailingBlock ? 'pointer' : 'not-allowed',
                      fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                      background: copied ? 'var(--c-wash2)' : 'transparent',
                      color: copied ? 'var(--c-fg)' : mailingBlock ? 'var(--c-fg)' : 'var(--c-fg-3)',
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
                <span style={{ fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--c-fg-3)' }}>Terms & Conditions</span>
                <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 9, fontFamily: 'Inter', background: client.terms_accepted ? 'rgba(78,240,162,0.12)' : 'rgba(240,78,122,0.12)', color: client.terms_accepted ? 'var(--c-st-booked)' : 'var(--c-st-hot)', border: `1px solid ${client.terms_accepted ? 'rgba(78,240,162,0.3)' : 'rgba(240,78,122,0.3)'}` }}>
                  {client.terms_accepted ? '✓ Accepted' : 'Not accepted'}
                  {client.terms_accepted_at ? ` · ${new Date(client.terms_accepted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 9, fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--c-fg-3)', marginBottom: 8 }}>Government-Issued ID</div>
                {!client.id_file_url ? (
                  <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-3)' }}>No ID on file</div>
                ) : !idUrl ? (
                  <div style={{ fontSize: 11, fontFamily: 'Inter', color: 'var(--c-fg-3)' }}>Loading ID…</div>
                ) : isPdf ? (
                  <div>
                    <iframe
                      src={idUrl}
                      title="Client ID document"
                      style={{ width: '100%', height: 320, borderRadius: 6, background: '#fff', display: 'block' }}
                    />
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 14 }}>
                      <button onClick={() => setLightboxOpen(true)} style={{ background: 'none', padding: 0, color: 'var(--c-fg)', fontFamily: 'Inter', fontSize: 10, cursor: 'pointer' }}>Expand</button>
                      <a href={idUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c-fg-3)', fontFamily: 'Inter', fontSize: 10, textDecoration: 'none' }}>Open in new tab ↗</a>
                    </div>
                  </div>
                ) : canTryImage ? (
                  <div>
                    <img
                      src={idUrl}
                      alt="Client ID"
                      onClick={() => setLightboxOpen(true)}
                      onError={() => setImgFailed(true)}
                      title="Click to enlarge"
                      style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 6, objectFit: 'contain', display: 'block', cursor: 'zoom-in' }}
                    />
                    <div style={{ marginTop: 4, fontSize: 9, fontFamily: 'Inter', color: 'var(--c-fg-3)' }}>Click to enlarge</div>
                  </div>
                ) : (
                  /* The image wouldn't render. Say so plainly and give an explicit
                     link — do NOT fall back to an iframe, which silently downloads.
                     The usual cause is HEIC (iPhone default): Safari shows it,
                     Chrome and Firefox don't. */
                  <div style={{ background: 'rgba(249,115,22,0.06)', borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 11.5, fontFamily: 'Inter', color: 'var(--c-fg-2)', lineHeight: 1.65 }}>
                      This ID can’t be previewed in this browser — it’s most likely an
                      iPhone <b>HEIC</b> photo, which Chrome and Firefox can’t display.
                      <b> Open this page in Safari</b> to view it inline.
                    </div>
                    <a
                      href={idUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'inline-block', marginTop: 9, padding: '6px 12px', borderRadius: 5, color: 'var(--c-fg)', fontFamily: "'Archivo Black', sans-serif", fontWeight: 400, fontSize: 10, textDecoration: 'none' }}
                    >
                      Open the file ↗
                    </a>
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
      <div onClick={() => setLightboxOpen(false)} className="c-modal-backdrop" style={{ zIndex: 10004 }}>
        <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '92vw', maxHeight: '90vh', width: isPdf ? '90vw' : undefined, height: isPdf ? '90vh' : undefined }}>
          {isPdf ? (
            <iframe src={idUrl} title="Client ID document" style={{ width: '100%', height: '100%', borderRadius: 8, background: '#fff', display: 'block' }} />
          ) : (
            <img src={idUrl} alt="Client ID" style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, display: 'block' }} />
          )}
          <button onClick={() => setLightboxOpen(false)} style={{ position: 'absolute', top: -16, right: -16, background: 'var(--c-bg)', color: 'var(--c-fg)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, fontFamily: 'Inter', flexShrink: 0 }}>×</button>
        </div>
      </div>
    )}
    </>
  )
}
