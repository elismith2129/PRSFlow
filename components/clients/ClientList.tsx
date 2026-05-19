'use client'
import { Client, Lead } from '@/lib/supabase'

interface Props {
  clients: Client[]
  selectedId: number | null
  loading: boolean
  onSelect: (id: number) => void
  onNew: () => void
  bookedLeads: Lead[]
  onCreateFromLead: (lead: Lead) => void
}

const TYPE_ICON: Record<string, string> = { individual: '👤', label: '🏷', company: '🏢' }

export function ClientList({ clients, selectedId, loading, onSelect, onNew, bookedLeads, onCreateFromLead }: Props) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
        ) : clients.length === 0 ? (
          <EmptyState onNew={onNew} bookedLeads={bookedLeads} onCreateFromLead={onCreateFromLead} />
        ) : (
          clients.map(c => (
            <div
              key={c.id}
              onClick={() => onSelect(c.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 16px', cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
                background: selectedId === c.id ? 'var(--surface2)' : 'transparent',
                transition: 'background 0.15s',
              }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'var(--surface2)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 16, flexShrink: 0,
                border: selectedId === c.id ? '1px solid var(--accent)' : '1px solid var(--border)'
              }}>
                {TYPE_ICON[c.type] || '👤'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.fname} {c.lname}{c.company ? ` — ${c.company}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' as const }}>
                  {c.label && (
                    <span style={{ fontSize: 9, color: 'var(--accent2)', background: 'rgba(78,143,240,0.1)', padding: '2px 6px', borderRadius: 3 }}>
                      {c.label}
                    </span>
                  )}
                  <span style={{
                    fontSize: 9, fontFamily: 'Syne', fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                    background: c.billing === 'COD' ? 'rgba(200,240,78,0.1)' : 'rgba(78,143,240,0.1)',
                    color: c.billing === 'COD' ? 'var(--accent)' : 'var(--accent2)'
                  }}>
                    {c.billing}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function EmptyState({ onNew, bookedLeads, onCreateFromLead }: {
  onNew: () => void, bookedLeads: Lead[], onCreateFromLead: (l: Lead) => void
}) {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 8 }}>👥</div>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>No client profiles yet</div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 14 }}>
          Create profiles manually or generate from booked leads below.
        </div>
        <button onClick={onNew} style={{
          padding: '8px 20px', background: 'var(--accent)', color: '#0d0f14',
          border: 'none', borderRadius: 6, fontFamily: 'Syne',
          fontWeight: 700, fontSize: 11, cursor: 'pointer'
        }}>+ New Client</button>
      </div>

      {bookedLeads.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 }}>
            Generate from booked leads
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
            {bookedLeads.slice(0, 15).map(l => (
              <div key={l.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', background: 'var(--surface2)',
                border: '1px solid var(--border)', borderRadius: 7
              }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500 }}>{l.fname} {l.lname}</div>
                  <div style={{ fontSize: 10, color: 'var(--text2)' }}>{l.company || l.booking}</div>
                </div>
                <button onClick={() => onCreateFromLead(l)} style={{
                  padding: '4px 10px', background: 'rgba(78,143,240,0.1)',
                  border: '1px solid var(--accent2)', color: 'var(--accent2)',
                  borderRadius: 5, fontFamily: 'DM Mono', fontSize: 9, cursor: 'pointer'
                }}>Create →</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
