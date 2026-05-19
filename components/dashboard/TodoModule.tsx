'use client'
import { useState, useMemo } from 'react'
import { Lead, Client } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Props {
  leads: Lead[]
  clients: Client[]
  loading: boolean
  onRefresh: () => void
}

type Section = 'leads' | 'calendar' | 'clients' | null

function getMissingFields(l: Lead): string[] {
  const missing: string[] = []
  if (!l.fname || !l.lname) missing.push('name')
  if (!l.email && !l.phone) missing.push('contact')
  if (!l.booking) missing.push('booking type')
  if (!l.source) missing.push('source')
  if (!l.status || l.status === 'uncontacted') missing.push('status')
  if (!l.notes) missing.push('notes')
  if ((l.status === 'hot' || l.status === 'booked') && !l.quote) missing.push('quote')
  return missing
}

function daysSince(dateStr: string): number {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function isRecentLead(l: Lead): boolean {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  return new Date(l.last_contact || l.created_at || '') >= cutoff
}

const STATUS_COLORS: Record<string, string> = {
  hot: 'var(--hot)', warm: 'var(--warm)', cold: 'var(--cold)',
  uncontacted: 'var(--uncontacted)', booked: 'var(--booked)', dead: 'var(--text3)'
}

export function TodoModule({ leads, clients, loading, onRefresh }: Props) {
  const router = useRouter()
  const [openSection, setOpenSection] = useState<Section>(null)
  const [loggingId, setLoggingId] = useState<number | null>(null)

  const hotDue = useMemo(() =>
    leads.filter(l => l.status === 'hot').sort((a, b) => daysSince(b.last_contact) - daysSince(a.last_contact)),
    [leads])

  const warmDue = useMemo(() =>
    leads.filter(l => l.status === 'warm').sort((a, b) => daysSince(b.last_contact) - daysSince(a.last_contact)),
    [leads])

  const incompleteDue = useMemo(() =>
    leads.filter(l => l.status !== 'dead' && l.status !== 'booked' && getMissingFields(l).length > 0 && isRecentLead(l))
      .sort((a, b) => {
        const pri: Record<string, number> = { hot: 0, booked: 1, warm: 2, cold: 3, uncontacted: 4 }
        return (pri[a.status] ?? 5) - (pri[b.status] ?? 5)
      }),
    [leads])

  const incompleteClients = useMemo(() =>
    clients.filter(c => !c.fname || (!c.email && !c.phone) || !c.billing),
    [clients])

  const leadTotal = hotDue.length + warmDue.length + incompleteDue.length
  const clientTotal = incompleteClients.length
  const totalAll = leadTotal + clientTotal

  const leadColor = hotDue.length > 0 ? 'var(--hot)' : (warmDue.length + incompleteDue.length) > 0 ? 'var(--warm)' : 'var(--booked)'
  const clientColor = clientTotal > 0 ? 'var(--accent2)' : 'var(--booked)'

  async function logContact(leadId: number) {
    setLoggingId(leadId)
    await supabase.from('contact_log').insert({ lead_id: leadId, method: 'call' })
    await supabase.from('leads').update({ last_contact: new Date().toISOString().split('T')[0] }).eq('id', leadId)
    onRefresh()
    setLoggingId(null)
  }

  function toggle(section: Section) {
    setOpenSection(prev => prev === section ? null : section)
  }

  const boxStyle = (section: Section, color: string) => ({
    padding: '18px 20px', cursor: 'pointer',
    borderRight: section !== 'clients' ? '1px solid var(--border)' : undefined,
    transition: 'background 0.15s', position: 'relative' as const,
    background: openSection === section ? 'var(--surface2)' : 'transparent',
  })

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15 }}>Today's Tasks</div>
          <div style={{
            fontSize: 10, fontFamily: 'Syne', fontWeight: 700,
            padding: '3px 10px', borderRadius: 20,
            border: `1px solid ${totalAll === 0 ? 'var(--booked)' : leadColor}`,
            color: totalAll === 0 ? 'var(--booked)' : leadColor,
          }}>
            {loading ? 'Loading...' : totalAll === 0 ? '✓ All clear' : `${totalAll} task${totalAll > 1 ? 's' : ''} remaining`}
          </div>
        </div>
        <button
          onClick={() => router.push('/crm')}
          style={{
            padding: '5px 12px', background: 'transparent',
            border: '1px solid var(--accent)', color: 'var(--accent)',
            borderRadius: 6, fontFamily: 'DM Mono', fontSize: 10, cursor: 'pointer'
          }}>
          Open CRM →
        </button>
      </div>

      {/* 3 boxes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: '1px solid var(--border)' }}>
        {/* Leads */}
        <div style={boxStyle('leads', leadColor)} onClick={() => toggle('leads')}>
          <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 8 }}>Lead Mgmt</div>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 36, lineHeight: 1, color: leadColor }}>
            {loading ? '—' : leadTotal || '✓'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 4, lineHeight: 1.4 }}>
            {!loading && leadTotal > 0 && [
              hotDue.length && `${hotDue.length} hot`,
              warmDue.length && `${warmDue.length} warm`,
              incompleteDue.length && `${incompleteDue.length} incomplete`,
            ].filter(Boolean).join(' · ')}
            {!loading && leadTotal === 0 && <span style={{ color: 'var(--booked)' }}>All clear</span>}
          </div>
          <div style={{ position: 'absolute', bottom: 10, right: 12, fontSize: 10, color: 'var(--text3)', transform: openSection === 'leads' ? 'rotate(90deg)' : '', transition: 'transform 0.2s' }}>▸</div>
        </div>

        {/* Calendar */}
        <div style={{ ...boxStyle('calendar', 'var(--text3)'), opacity: 0.5, cursor: 'default' }}>
          <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 8 }}>Calendar</div>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 36, lineHeight: 1, color: 'var(--text3)' }}>—</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>coming soon</div>
        </div>

        {/* Clients */}
        <div style={boxStyle('clients', clientColor)} onClick={() => toggle('clients')}>
          <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 8 }}>Clients</div>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 36, lineHeight: 1, color: clientColor }}>
            {loading ? '—' : clientTotal || '✓'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 4, lineHeight: 1.4 }}>
            {!loading && clientTotal === 0 && <span style={{ color: 'var(--booked)' }}>All complete</span>}
            {!loading && clientTotal > 0 && `${clientTotal} incomplete profile${clientTotal > 1 ? 's' : ''}`}
          </div>
          <div style={{ position: 'absolute', bottom: 10, right: 12, fontSize: 10, color: 'var(--text3)', transform: openSection === 'clients' ? 'rotate(90deg)' : '', transition: 'transform 0.2s' }}>▸</div>
        </div>
      </div>

      {/* Expandable: Leads */}
      {openSection === 'leads' && (
        <div>
          {/* Hot */}
          <SectionHeader color="var(--hot)" label="Hot" sublabel="follow up daily" count={hotDue.length} />
          <div style={{ padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
            {hotDue.length === 0
              ? <EmptyState text="No hot leads" />
              : hotDue.slice(0, 8).map(l => (
                <LeadCard key={l.id} lead={l} type="hot" onLog={logContact} loggingId={loggingId} onOpen={() => router.push('/crm')} />
              ))}
          </div>

          {/* Warm */}
          <SectionHeader color="var(--warm)" label="Warm" sublabel="every 3 days" count={warmDue.length} />
          <div style={{ padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
            {warmDue.length === 0
              ? <EmptyState text="No warm leads due" />
              : warmDue.slice(0, 8).map(l => (
                <LeadCard key={l.id} lead={l} type="warm" onLog={logContact} loggingId={loggingId} onOpen={() => router.push('/crm')} />
              ))}
          </div>

          {/* Incomplete */}
          <SectionHeader color="var(--accent2)" label="Incomplete" sublabel="last 30 days only" count={incompleteDue.length} />
          <div style={{ padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
            {incompleteDue.length === 0
              ? <EmptyState text="✓ All leads complete" green />
              : incompleteDue.slice(0, 10).map(l => (
                <IncompleteCard key={l.id} lead={l} onOpen={() => router.push('/crm')} />
              ))}
          </div>
        </div>
      )}

      {/* Expandable: Calendar */}
      {openSection === 'calendar' && (
        <div style={{ padding: 20, color: 'var(--text3)', fontSize: 11, textAlign: 'center' }}>
          <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>📅</div>
          Calendar completeness tracking coming soon.
        </div>
      )}

      {/* Expandable: Clients */}
      {openSection === 'clients' && (
        <div>
          <SectionHeader color="var(--accent2)" label="Incomplete Profiles" sublabel="missing required fields" count={incompleteClients.length} />
          <div style={{ padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
            {incompleteClients.length === 0
              ? <EmptyState text="✓ All profiles complete" green />
              : incompleteClients.slice(0, 8).map(c => (
                <div key={c.id}
                  onClick={() => router.push('/clients')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '9px 11px', background: 'var(--surface2)',
                    borderRadius: 8, borderLeft: '2px solid var(--accent2)', cursor: 'pointer'
                  }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 500 }}>{c.fname || 'Unnamed'} {c.lname} {c.company ? `— ${c.company}` : ''}</div>
                    <div style={{ fontSize: 9, color: 'var(--accent2)', marginTop: 3 }}>
                      ⚠ {[!c.fname && 'name', (!c.email && !c.phone) && 'contact', !c.billing && 'billing'].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>edit ›</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SectionHeader({ color, label, sublabel, count }: { color: string, label: string, sublabel: string, count: number }) {
  return (
    <div style={{
      padding: '10px 20px 8px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', borderTop: '1px solid var(--border)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
        <div style={{ fontSize: 10, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color }}>{label}</div>
        <div style={{ fontSize: 9, color: 'var(--text3)' }}>{sublabel}</div>
      </div>
      <div style={{ fontSize: 10, fontFamily: 'Syne', fontWeight: 700, color }}>{count || ''}</div>
    </div>
  )
}

function EmptyState({ text, green }: { text: string, green?: boolean }) {
  return <div style={{ fontSize: 11, color: green ? 'var(--booked)' : 'var(--text3)', padding: '4px 0' }}>{text}</div>
}

function LeadCard({ lead: l, type, onLog, loggingId, onOpen }: {
  lead: Lead, type: 'hot' | 'warm',
  onLog: (id: number) => void, loggingId: number | null, onOpen: () => void
}) {
  const days = daysSince(l.last_contact)
  const urgent = type === 'hot' ? days >= 3 : days >= 7
  const color = type === 'hot' ? 'var(--hot)' : 'var(--warm)'
  const missing = getMissingFields(l)

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch',
      background: 'var(--surface2)', borderRadius: 8,
      border: `1px solid ${urgent ? color : 'var(--border)'}`, overflow: 'hidden'
    }}>
      <div style={{ flex: 1, padding: '9px 11px', cursor: 'pointer', minWidth: 0 }} onClick={onOpen}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {l.fname} {l.lname}
          </div>
          <div style={{ fontSize: 9, color: urgent ? color : 'var(--text3)', flexShrink: 0 }}>{days}d</div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {l.company || '—'}{l.booking ? ` · ${l.booking}` : ''}
        </div>
        {missing.length > 0 && (
          <div style={{ fontSize: 9, color: 'var(--accent2)', marginTop: 2 }}>⚠ {missing.slice(0, 3).join(' · ')}</div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={onOpen}
          title="Send outreach"
          style={{ flex: 1, padding: '0 11px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--accent2)', cursor: 'pointer', fontSize: 13 }}>
          ✉
        </button>
        <button
          onClick={() => onLog(l.id)}
          disabled={loggingId === l.id}
          title="Log call or text"
          style={{ flex: 1, padding: '0 11px', background: 'transparent', border: 'none', color: 'var(--booked)', cursor: 'pointer', fontSize: 12 }}>
          {loggingId === l.id ? '…' : '✔'}
        </button>
      </div>
    </div>
  )
}

function IncompleteCard({ lead: l, onOpen }: { lead: Lead, onOpen: () => void }) {
  const missing = getMissingFields(l)
  const color = STATUS_COLORS[l.status] || 'var(--text2)'

  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'stretch',
        background: 'var(--surface2)', borderRadius: 8,
        border: '1px solid var(--border)', overflow: 'hidden', cursor: 'pointer'
      }}>
      <div style={{ width: 3, background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, padding: '9px 11px', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 500 }}>{l.fname} {l.lname}</div>
          <span style={{ fontSize: 8, fontFamily: 'Syne', fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: 'rgba(0,0,0,0.2)', color, flexShrink: 0 }}>
            {l.status}
          </span>
        </div>
        <div style={{ fontSize: 9, color: 'var(--accent2)', marginTop: 3 }}>⚠ {missing.slice(0, 4).join(' · ')}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 10px', borderLeft: '1px solid var(--border)', color: 'var(--text3)', fontSize: 11 }}>
        edit ›
      </div>
    </div>
  )
}
