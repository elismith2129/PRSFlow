'use client'
import { Client } from '@/lib/supabase'

interface Props {
  client: Client | null
  onEdit: (c: Client) => void
  onNewWorkOrder: (clientId: number) => void
}

export function ClientProfile({ client, onEdit, onNewWorkOrder }: Props) {
  if (!client) {
    return (
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, minHeight: 300,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text3)', gap: 10
      }}>
        <div style={{ fontSize: 28, opacity: 0.2 }}>👤</div>
        <div style={{ fontSize: 11 }}>Select a client to view their profile</div>
      </div>
    )
  }

  const c = client
  const typeIcon = { individual: '👤', label: '🏷', company: '🏢' }[c.type] || '👤'
  const displayName = `${c.fname || ''} ${c.lname || ''}`.trim() || c.company || '(unnamed)'

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 22 }}>{typeIcon}</span>
            <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 20 }}>{displayName}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
            <span style={{ fontSize: 9, background: 'var(--surface2)', padding: '3px 8px', borderRadius: 4, color: 'var(--text2)' }}>
              {c.type}
            </span>
            <span style={{
              fontSize: 9, fontFamily: 'Syne', fontWeight: 700, padding: '3px 8px', borderRadius: 3,
              background: c.billing === 'COD' ? 'rgba(200,240,78,0.1)' : 'rgba(78,143,240,0.1)',
              color: c.billing === 'COD' ? 'var(--accent)' : 'var(--accent2)'
            }}>{c.billing}</span>
            {c.label && (
              <span style={{ fontSize: 9, color: 'var(--accent2)', background: 'rgba(78,143,240,0.1)', padding: '3px 8px', borderRadius: 4 }}>
                {c.label}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onEdit(c)} style={outlineBtn}>Edit</button>
          <button onClick={() => onNewWorkOrder(c.id)} style={accentBtn}>+ Work Order</button>
        </div>
      </div>

      {/* Contact */}
      <SectionLabel>Contact</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <ContactField label="Email" value={c.email} />
        <ContactField label="Phone" value={c.phone} />
        {c.source && <ContactField label="Source" value={c.source} />}
        {c.booking && <ContactField label="Booking Type" value={c.booking} />}
      </div>

      {c.notes && (
        <>
          <SectionLabel>Notes</SectionLabel>
          <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 14, padding: 10, background: 'var(--surface2)', borderRadius: 6 }}>
            {c.notes}
          </div>
        </>
      )}

      {/* Artists (label only) */}
      {c.type === 'label' && c.artists?.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4, marginBottom: 8 }} />
          <SectionLabel>Artist Roster</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 14 }}>
            {c.artists.map((a: string, i: number) => (
              <span key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', padding: '4px 10px', borderRadius: 5, fontSize: 11 }}>
                {a}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Work Orders placeholder */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 0 }}>Work Orders</SectionLabel>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', padding: '12px 0', textAlign: 'center' }}>
        Work orders will appear here once the Work Order module is built.
      </div>

      {/* Client since */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
        <div style={{ fontSize: 9, color: 'var(--text3)' }}>
          Client since {c.created_at ? new Date(c.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children, style }: { children: React.ReactNode, style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8, ...style }}>
      {children}
    </div>
  )
}

function ContactField({ label, value }: { label: string, value: string }) {
  if (!value) return null
  return (
    <div>
      <div style={{ fontSize: 9, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

const outlineBtn: React.CSSProperties = {
  padding: '7px 14px', background: 'transparent',
  border: '1px solid var(--border)', color: 'var(--text2)',
  borderRadius: 6, fontFamily: 'DM Mono', fontSize: 11, cursor: 'pointer',
}

const accentBtn: React.CSSProperties = {
  padding: '7px 14px', background: 'var(--accent)', color: '#0d0f14',
  border: 'none', borderRadius: 6, fontFamily: 'Syne',
  fontWeight: 700, fontSize: 11, cursor: 'pointer',
}
