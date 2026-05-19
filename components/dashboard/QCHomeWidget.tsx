'use client'
import { QCReport } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const LOCATIONS = ['Paramount', 'Encore', 'Ameraycan', 'Track Record']

export function QCHomeWidget({ reports }: { reports: QCReport[] }) {
  const router = useRouter()
  const now = new Date()

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 13 }}>🎛 Session QC</div>
          <div style={{ fontSize: 9, color: 'var(--text2)', marginTop: 1 }}>Last 24 hrs</div>
        </div>
        <button onClick={() => router.push('/qc')} style={{
          padding: '4px 10px', background: 'transparent',
          border: '1px solid var(--accent2)', color: 'var(--accent2)',
          borderRadius: 5, fontFamily: 'DM Mono', fontSize: 9, cursor: 'pointer'
        }}>Open →</button>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {LOCATIONS.map(loc => {
          const locReps = reports.filter(r => {
            const d = new Date(r.created_at)
            return r.location === loc && (now.getTime() - d.getTime()) / 86400000 <= 1.5
          })
          const unread = locReps.filter(r => !r.manager_read).length
          const hasIssue = locReps.some(r => r.has_issue)
          const color = locReps.length === 0 ? 'var(--border)' : unread ? (hasIssue ? 'var(--hot)' : 'var(--accent2)') : 'var(--booked)'
          const label = locReps.length === 0 ? 'No report' : unread ? `${unread} unread${hasIssue ? ' ⚠' : ''}` : '✓ All read'
          const labelColor = locReps.length === 0 ? 'var(--text3)' : unread ? (hasIssue ? 'var(--hot)' : 'var(--accent2)') : 'var(--booked)'

          return (
            <div key={loc}
              onClick={() => router.push('/qc')}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '7px 10px', background: 'var(--surface2)',
                border: `1px solid ${color}`, borderRadius: 6, cursor: 'pointer'
              }}>
              <div style={{ fontSize: 11, fontWeight: 500 }}>{loc}</div>
              <div style={{ fontSize: 10, color: labelColor }}>{label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
