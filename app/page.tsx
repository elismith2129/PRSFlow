'use client'
import { useEffect, useState } from 'react'
import { supabase, Lead, Client, QCReport } from '@/lib/supabase'
import { TodoModule } from '@/components/dashboard/TodoModule'
import { LocationStrip } from '@/components/dashboard/LocationStrip'
import { QCHomeWidget } from '@/components/dashboard/QCHomeWidget'

export default function DashboardPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [qcReports, setQcReports] = useState<QCReport[]>([])
  const [loading, setLoading] = useState(true)
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  useEffect(() => {
    async function load() {
      const [{ data: leadsData }, { data: clientsData }, { data: qcData }] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('clients').select('*').order('created_at', { ascending: false }),
        supabase.from('qc_reports').select('*').order('created_at', { ascending: false }),
      ])
      setLeads(leadsData || [])
      setClients(clientsData || [])
      setQcReports(qcData || [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'Syne', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 4 }}>
            {greeting} — here's your briefing
          </div>
          <h1 style={{ fontFamily: 'DM Serif Display', fontSize: 32, letterSpacing: -1, lineHeight: 1.05 }}>
            Paramount <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Recording Studios</em>
          </h1>
        </div>
        <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--text2)', lineHeight: 1.8 }}>
          {now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          <br />
          <span style={{ color: 'var(--text3)' }}>
            {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Location strip */}
      <LocationStrip />

      {/* Main grid: TODO + sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14, alignItems: 'start' }}>
        <TodoModule leads={leads} clients={clients} loading={loading} onRefresh={() => {}} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <QCHomeWidget reports={qcReports} />
          {/* Calendar placeholder */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, overflow: 'hidden', opacity: 0.45
          }}>
            <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 13 }}>📅 Calendar</div>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <span style={{
                fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em',
                color: 'var(--text3)', padding: '3px 8px',
                border: '1px solid var(--border)', borderRadius: 4
              }}>COMING SOON</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
