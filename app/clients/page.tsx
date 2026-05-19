'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, Client, Lead } from '@/lib/supabase'
import { ClientList } from '@/components/clients/ClientList'
import { ClientProfile } from '@/components/clients/ClientProfile'
import { ClientModal } from '@/components/clients/ClientModal'

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [prefill, setPrefill] = useState<Partial<Client> | null>(null)
  const [search, setSearch] = useState('')
  const [billingFilter, setBillingFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [{ data: clientsData }, { data: leadsData }] = await Promise.all([
      supabase.from('clients').select('*').order('created_at', { ascending: false }),
      supabase.from('leads').select('*').eq('status', 'booked').order('created_at', { ascending: false }),
    ])
    setClients((clientsData || []).map(c => ({ ...c, artists: c.artists || [] })))
    setLeads(leadsData || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = clients.filter(c => {
    const q = search.toLowerCase()
    const matchQ = !q || `${c.fname} ${c.lname} ${c.company} ${c.label} ${c.email}`.toLowerCase().includes(q)
    const matchB = !billingFilter || c.billing === billingFilter
    const matchT = !typeFilter || c.type === typeFilter
    return matchQ && matchB && matchT
  })

  const selected = clients.find(c => c.id === selectedId) || null

  function openNew() {
    setEditingClient(null)
    setPrefill(null)
    setModalOpen(true)
  }

  function openEdit(c: Client) {
    setEditingClient(c)
    setPrefill(null)
    setModalOpen(true)
  }

  function openFromLead(lead: Lead) {
    // Check for duplicate
    const exists = clients.find(c =>
      (c.email && c.email === lead.email) ||
      (c.fname === lead.fname && c.lname === lead.lname)
    )
    if (exists) {
      setSelectedId(exists.id)
      return
    }
    setPrefill({
      fname: lead.fname, lname: lead.lname, company: lead.company,
      label: lead.label, email: lead.email, phone: lead.phone,
      billing: lead.billing, notes: lead.notes, source: lead.source,
      booking: lead.booking, type: lead.label ? 'label' : 'individual',
      lead_id: lead.id,
    })
    setEditingClient(null)
    setModalOpen(true)
  }

  async function handleSave(data: Partial<Client>) {
    if (editingClient) {
      const { data: updated } = await supabase.from('clients').update(data).eq('id', editingClient.id).select().single()
      if (updated) setClients(prev => prev.map(c => c.id === updated.id ? { ...updated, artists: updated.artists || [] } : c))
    } else {
      const { data: created } = await supabase.from('clients').insert(data).select().single()
      if (created) {
        const newClient = { ...created, artists: created.artists || [] }
        setClients(prev => [newClient, ...prev])
        setSelectedId(created.id)
      }
    }
    setModalOpen(false)
  }

  async function exportClients() {
    const rows = [['Name', 'Company', 'Type', 'Label', 'Email', 'Phone', 'Billing', 'Created']]
    filtered.forEach(c => rows.push([
      `${c.fname} ${c.lname}`, c.company, c.type, c.label,
      c.email, c.phone, c.billing, c.created_at?.split('T')[0] || ''
    ]))
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `prs_clients_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'DM Serif Display', fontSize: 28, letterSpacing: -0.5 }}>
          Client <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Profiles</em>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportClients} style={btnStyle('secondary')}>↓ Export</button>
          <button onClick={openNew} style={btnStyle('primary')}>+ New Client</button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const, alignItems: 'center' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, company, label, email…"
          style={{ ...inputStyle, flex: 1, minWidth: 200 }}
        />
        <select value={billingFilter} onChange={e => setBillingFilter(e.target.value)} style={inputStyle}>
          <option value="">All Billing</option>
          <option value="COD">COD</option>
          <option value="Billing">Billing</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={inputStyle}>
          <option value="">All Types</option>
          <option value="individual">Individual</option>
          <option value="label">Label</option>
          <option value="company">Company</option>
        </select>
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{filtered.length} of {clients.length}</span>
      </div>

      {/* Main layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 14, alignItems: 'start' }}>
        <ClientList
          clients={filtered}
          selectedId={selectedId}
          loading={loading}
          onSelect={setSelectedId}
          onNew={openNew}
          bookedLeads={leads}
          onCreateFromLead={openFromLead}
        />
        <ClientProfile
          client={selected}
          onEdit={openEdit}
          onNewWorkOrder={() => {}}
        />
      </div>

      {/* Modal */}
      {modalOpen && (
        <ClientModal
          initial={editingClient || prefill || undefined}
          isEdit={!!editingClient}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '8px 12px', borderRadius: 7,
  fontFamily: 'DM Mono', fontSize: 11, outline: 'none',
}

function btnStyle(variant: 'primary' | 'secondary'): React.CSSProperties {
  return {
    padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Syne',
    fontWeight: 700, fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase',
    background: variant === 'primary' ? 'var(--accent)' : 'transparent',
    color: variant === 'primary' ? '#0d0f14' : 'var(--text2)',
    border: variant === 'primary' ? 'none' : '1px solid var(--border)',
    transition: 'all 0.15s',
  }
}
