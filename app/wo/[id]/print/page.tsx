import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function WOPrintPage({ params }: { params: { id: string } }) {
  const { data: wo } = await supabase.from('work_orders').select('*').eq('id', params.id).single()
  if (!wo) notFound()

  const [{ data: stRows }, { data: equipRows }, { data: rentRows }, { data: payRows }] = await Promise.all([
    supabase.from('studio_time_rows').select('*').eq('work_order_id', wo.id).order('sort_order'),
    supabase.from('equipment_condition_rows').select('*').eq('work_order_id', wo.id),
    supabase.from('rental_rows').select('*').eq('work_order_id', wo.id).order('sort_order'),
    supabase.from('payment_rows').select('*').eq('work_order_id', wo.id).order('recorded_at'),
  ])

  const stTotal = (stRows ?? []).reduce((s: number, r: any) => s + (Number(r.charge) || 0), 0)
  const rentTotal = (rentRows ?? []).reduce((s: number, r: any) => s + (Number(r.charge) || 0), 0)
  const grandTotal = stTotal + rentTotal
  const totalPaid = (payRows ?? []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0)
  const balanceDue = grandTotal - totalPaid

  const EQUIPMENT = ['Speakers', 'Microphone', 'Console']
  const sessionDates: string[] = Array.from(new Set((stRows ?? []).map((r: any) => r.date).filter(Boolean))).sort() as string[]

  function fmtDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const cell = 'border: 1px solid #ccc; padding: 5px 7px; font-size: 10px;'
  const th = 'border: 1px solid #ccc; padding: 5px 7px; font-size: 9px; background: #f5f5f5; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;'

  return (
    <html>
      <head>
        <title>Work Order {wo.invoice_number ? `#${wo.invoice_number}` : ''}</title>
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Courier New', monospace; font-size: 11px; color: #111; background: white; padding: 24px 32px; }
          h1 { font-size: 15px; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
          h2 { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
          td, th { ${cell} }
          thead th { ${th} }
          .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 20px; }
          .meta-row { display: flex; gap: 8px; margin-bottom: 5px; align-items: baseline; }
          .meta-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #666; min-width: 90px; }
          .meta-value { font-size: 11px; border-bottom: 1px solid #ccc; flex: 1; min-height: 16px; }
          .section { margin-bottom: 18px; }
          .totals-row { display: flex; justify-content: space-between; padding: 4px 8px; border-bottom: 1px solid #eee; }
          .legal { font-size: 8px; color: #444; line-height: 1.7; padding: 8px; border: 1px solid #ddd; margin-bottom: 10px; }
          @media print {
            body { padding: 12px 20px; }
            button { display: none; }
          }
        `}</style>
      </head>
      <body>

        {/* Print button (hidden on print) */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <div style={{ textAlign: 'right', marginBottom: 16 }}>
          {/* @ts-expect-error HTML string onclick is intentional for print-only page */}
          <button onClick="window.print()" style={{ padding: '6px 16px', background: '#111', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
            Print / Save PDF
          </button>
        </div>

        {/* Branding */}
        <div style={{ textAlign: 'center', marginBottom: 16, borderBottom: '2px solid #111', paddingBottom: 12 }}>
          <h1>Paramount Recording Group</h1>
          <div style={{ fontSize: 9, color: '#555', marginTop: 3 }}>Paramount · Encore · Ameraycan · Wilder · Track · Enterprise</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10 }}>
            <span>Recording Studios (323) 465-4000</span>
            <span><strong>Invoice #</strong> {wo.invoice_number || '___________'}</span>
          </div>
        </div>

        {/* Meta */}
        <div className="meta-grid">
          <div>
            {[['Session Date', wo.session_date], ['From', wo.from_time], ['To', wo.to_time], ['Studios', (wo.studios ?? []).join(', ')], ['Engineer', wo.engineer], ['Assistant', wo.second_engineer], ['Producer', wo.producer], ['Payment', wo.payment_status], ['Food Budget', wo.food_budget ? `Yes — $${wo.food_amount ?? ''}` : 'No']].map(([label, val]) => (
              <div key={label as string} className="meta-row">
                <div className="meta-label">{label}</div>
                <div className="meta-value">{val || ''}</div>
              </div>
            ))}
          </div>
          <div>
            {[['Client', wo.client], ['Artist', wo.artist], ['Label', wo.label], ['Ordered By', wo.ordered_by], ['PO #', wo.po_number], ['Phone', wo.phone], ['Email', wo.email]].map(([label, val]) => (
              <div key={label as string} className="meta-row">
                <div className="meta-label">{label}</div>
                <div className="meta-value">{val || ''}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Studio Time */}
        <div className="section">
          <h2>Studio Time</h2>
          <table>
            <thead><tr>{['Studio', 'Date', 'Session Info', 'From', 'To', 'Hrs', 'Rate', 'Charge'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {(stRows ?? []).map((r: any) => (
                <tr key={r.id}>
                  <td>{r.studio}</td><td>{r.date}</td><td>{r.session_info}</td>
                  <td>{r.from_time}</td><td>{r.to_time}</td>
                  <td>{r.total_hours ?? ''}</td><td>{r.rate}</td>
                  <td>{r.charge != null ? `$${Number(r.charge).toFixed(2)}` : ''}</td>
                </tr>
              ))}
              <tr><td colSpan={7} style={{ textAlign: 'right', fontWeight: 700, background: '#f5f5f5' }}>Studio Total</td><td style={{ fontWeight: 700 }}>${stTotal.toFixed(2)}</td></tr>
            </tbody>
          </table>
        </div>

        {/* Equipment Condition */}
        {sessionDates.length > 0 && (
          <div className="section">
            <h2>Equipment Condition</h2>
            <table>
              <thead><tr><th>Equipment</th>{sessionDates.map(d => <th key={d}>{fmtDate(d)}</th>)}</tr></thead>
              <tbody>
                {EQUIPMENT.map(eq => (
                  <tr key={eq}>
                    <td style={{ fontWeight: 600 }}>{eq}</td>
                    {sessionDates.map(d => {
                      const row = (equipRows ?? []).find((r: any) => r.equipment === eq && r.date === d)
                      return <td key={d} style={{ textAlign: 'center', color: row?.condition === 'ok' ? '#16a34a' : row?.condition === 'not_ok' ? '#dc2626' : '#aaa' }}>{row?.condition === 'ok' ? '✓ OK' : row?.condition === 'not_ok' ? '✗ NOT OK' : '—'}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Rentals */}
        <div className="section">
          <h2>Rentals</h2>
          <table>
            <thead><tr>{['Qty', 'Item', 'Supplier', 'Date(s) Used', 'Rate', 'Charge'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {(rentRows ?? []).filter((r: any) => r.item).map((r: any) => (
                <tr key={r.id}><td>{r.qty}</td><td>{r.item}</td><td>{r.supplier}</td><td>{r.dates_used}</td><td>{r.rate}</td><td>{r.charge != null ? `$${Number(r.charge).toFixed(2)}` : ''}</td></tr>
              ))}
              <tr><td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, background: '#f5f5f5' }}>Rentals Total</td><td style={{ fontWeight: 700 }}>${rentTotal.toFixed(2)}</td></tr>
            </tbody>
          </table>
        </div>

        {/* Bottom columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <h2>Session Notes</h2>
            <div style={{ border: '1px solid #ccc', minHeight: 80, padding: 8, fontSize: 10, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{wo.session_notes}</div>
            <div className="legal">
              By signing below, I acknowledge that I am authorized to approve charges for this session. I accept responsibility for all associated costs and understand that payment is due in full at the time of service unless otherwise agreed. I also acknowledge that Paramount Recording is not responsible for any media, personal items, or equipment left behind.
              <br /><br />
              <em>No Tapes, CDs, DVDs, Thumb Drives, Computer Drives or other Recording Media will be released until payment in full is received.</em>
            </div>
            {[['Signature', wo.legal_signature], ['Print Name', wo.legal_name], ['Date', wo.legal_date]].map(([label, val]) => (
              <div key={label as string} className="meta-row" style={{ marginBottom: 8 }}>
                <div className="meta-label">{label}</div>
                <div className="meta-value">{val || ''}</div>
              </div>
            ))}
          </div>
          <div>
            <h2>Payments</h2>
            <table style={{ marginBottom: 12 }}>
              <thead><tr><th>Type</th><th>Amount</th></tr></thead>
              <tbody>
                {(payRows ?? []).filter((p: any) => p.payment_type || p.amount).map((p: any) => (
                  <tr key={p.id}><td>{p.payment_type}</td><td>{p.amount != null ? `$${Number(p.amount).toFixed(2)}` : ''}</td></tr>
                ))}
              </tbody>
            </table>
            <div style={{ border: '1px solid #ccc' }}>
              {[['Studio Total', `$${stTotal.toFixed(2)}`], ['Rentals Total', `$${rentTotal.toFixed(2)}`], ['Grand Total', `$${grandTotal.toFixed(2)}`], ['Total Paid', `$${totalPaid.toFixed(2)}`], ['Balance Due', `$${balanceDue.toFixed(2)}`]].map(([label, val], i) => (
                <div key={label} className="totals-row" style={{ fontWeight: i >= 2 ? 700 : 400, background: i === 4 && balanceDue > 0 ? '#fff5f5' : i === 2 ? '#f5f5f5' : 'white' }}>
                  <span>{label}</span><span>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </body>
    </html>
  )
}
