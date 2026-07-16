'use client'
import React, { useEffect, useState } from 'react'
import { supabase, Client } from '@/lib/supabase'

function isImagePath(path: string | null | undefined): boolean {
  if (!path) return false
  return /\.(jpg|jpeg|png|heic|webp)$/i.test(path)
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
              <RegField label="Street Address" value={client.address_street} />
              {client.address_street2 && <RegField label="Address Line 2" value={client.address_street2} />}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                <RegField label="City" value={client.address_city} />
                <RegField label="State" value={client.address_state} />
                <RegField label="ZIP" value={client.address_zip} />
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
                ) : isImagePath(client.id_file_url) ? (
                  <div>
                    <img
                      src={idUrl}
                      alt="Client ID"
                      onClick={() => setLightboxOpen(true)}
                      title="Click to enlarge"
                      style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 6, border: '1px solid var(--border)', objectFit: 'contain', display: 'block', cursor: 'zoom-in' }}
                    />
                    <div style={{ marginTop: 4, fontSize: 9, fontFamily: 'Inter', color: 'var(--text3)' }}>Click to enlarge</div>
                  </div>
                ) : (
                  <a href={idUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text2)', fontFamily: 'Inter', fontSize: 11 }}>
                    <span style={{ fontSize: 18 }}>📄</span> View ID document (PDF) — opens in new tab
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Lightbox — enlarges the ID image in-app (above the modal at z 10004) */}
    {lightboxOpen && idUrl && (
      <div onClick={() => setLightboxOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10004, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '92vw', maxHeight: '90vh' }}>
          <img src={idUrl} alt="Client ID" style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, display: 'block' }} />
          <button onClick={() => setLightboxOpen(false)} style={{ position: 'absolute', top: -16, right: -16, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, fontFamily: 'Inter', flexShrink: 0 }}>×</button>
        </div>
      </div>
    )}
    </>
  )
}
