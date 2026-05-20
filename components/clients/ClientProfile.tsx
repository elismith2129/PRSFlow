'use client'
import React from 'react'
import { Client, ClientContact, CLIENT_TYPE_LABELS } from '@/lib/supabase'

interface Props {
  client: Client | null
  contacts: ClientContact[]
  bookingCount: number
}

export function ClientProfile({ client, contacts, bookingCount }: Props) {
  if (!client) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 10,
        alignItems: 'center', justifyContent: 'center', flex: 1,
        color: 'var(--text3)', fontSize: 11,
      }}>
        Select a client to view details
      </div>
    )
  }

  const isLabel = client.type === 'label'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', flex: 1, minHeight: 0,
    }}>
      <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontFamily: 'DM Serif Display', fontSize: 22, letterSpacing: -0.3, lineHeight: 1.2, marginBottom: 8 }}>
          {client.name}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
          <span style={{
            fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em',
            padding: '3px 7px', borderRadius: 3,
            background: isLabel ? 'rgba(200,240,78,0.12)' : 'rgba(139,144,168,0.12)',
            color: isLabel ? 'var(--accent)' : 'var(--text3)',
            border: `1px solid ${isLabel ? 'rgba(200,240,78,0.3)' : 'var(--border)'}`,
          }}>
            {CLIENT_TYPE_LABELS[client.type].toUpperCase()}
          </span>
          {bookingCount > 0 && (
            <span style={{
              fontSize: 8, fontFamily: 'DM Mono', color: 'var(--text3)',
              background: 'var(--surface2)', padding: '3px 7px', borderRadius: 3,
              border: '1px solid var(--border)',
            }}>
              {bookingCount} booking{bookingCount !== 1 ? 's' : ''}
            </span>
          )}
          {client.registered_at && (
            <span style={{
              fontSize: 8, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em',
              padding: '3px 7px', borderRadius: 3,
              background: 'rgba(78,240,162,0.12)', color: 'var(--booked)',
              border: '1px solid rgba(78,240,162,0.3)',
            }}>
              REGISTERED
            </span>
          )}
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '14px 20px 16px' }}>
        {isLabel ? (
          <LabelBody client={client} contacts={contacts} />
        ) : (
          <IndividualBody client={client} />
        )}

        {client.notes && (
          <>
            <SectionHeader label="Notes" mt={16} />
            <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.7, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 6 }}>
              {client.notes}
            </div>
          </>
        )}

        <div style={{ marginTop: 16, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
          {!client.registered_at && 'Migrated · '}
          Added {client.created_at ? new Date(client.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
        </div>
      </div>
    </div>
  )
}

function LabelBody({ client, contacts }: { client: Client; contacts: ClientContact[] }) {
  return (
    <>
      <SectionHeader label="Contacts (A&Rs)" mt={0} />
      {contacts.length === 0 ? (
        <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 12 }}>No contacts on file.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
          {contacts.map(ct => (
            <div key={ct.id} style={{
              padding: '8px 10px', background: 'var(--surface2)',
              border: '1px solid var(--border)', borderRadius: 6,
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>
                {ct.fname} {ct.lname}
                {ct.role && (
                  <span style={{
                    fontSize: 9, color: 'var(--text3)', marginLeft: 6,
                    fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}>
                    {ct.role}
                  </span>
                )}
              </div>
              {ct.email && <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono' }}>{ct.email}</div>}
              {ct.phone && <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>{ct.phone}</div>}
            </div>
          ))}
        </div>
      )}

      {(client.artists || []).length > 0 && (
        <>
          <SectionHeader label="Artists" mt={14} />
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 }}>
            {(client.artists || []).map((a, i) => (
              <span key={i} style={{
                fontSize: 10, fontFamily: 'DM Mono', color: 'var(--text2)',
                background: 'var(--surface2)', border: '1px solid var(--border)',
                padding: '3px 8px', borderRadius: 4,
              }}>
                {a}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function IndividualBody({ client }: { client: Client }) {
  return (
    <>
      <SectionHeader label="Contact" mt={0} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', marginBottom: 4 }}>
        {client.email && <InfoField label="Email" value={client.email} />}
        {client.phone && <InfoField label="Phone" value={client.phone} />}
        {client.instagram && <InfoField label="Instagram" value={client.instagram} />}
        {client.how_heard && <InfoField label="How heard" value={client.how_heard} />}
      </div>

      {(client.address_street || client.address_city) && (
        <>
          <SectionHeader label="Billing Address" mt={14} />
          <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'DM Mono', lineHeight: 1.7 }}>
            {client.address_street && <div>{client.address_street}</div>}
            {client.address_street2 && <div>{client.address_street2}</div>}
            {(client.address_city || client.address_state || client.address_zip) && (
              <div>{[client.address_city, client.address_state, client.address_zip].filter(Boolean).join(', ')}</div>
            )}
          </div>
        </>
      )}

      <SectionHeader label="Verification" mt={14} />
      {client.registered_at ? (
        <div style={{ fontSize: 10, color: 'var(--booked)', fontFamily: 'DM Mono' }}>
          Registered {new Date(client.registered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {client.terms_accepted && ' · Terms accepted'}
          {client.id_file_url && ' · ID on file'}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>Not yet registered</div>
      )}
    </>
  )
}

function SectionHeader({ label, mt = 14 }: { label: string; mt?: number }) {
  return (
    <div style={{
      fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.14em',
      textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6, marginTop: mt,
    }}>
      {label}
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'DM Mono' }}>{value}</div>
    </div>
  )
}
