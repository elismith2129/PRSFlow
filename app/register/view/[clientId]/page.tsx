import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import PrintTrigger from './PrintTrigger'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function RegPrintPage({ params }: { params: { clientId: string } }) {
  const { data: client } = await supabase
    .from('clients')
    .select('fname, lname, email, phone, address_street, address_street2, address_city, address_state, address_zip, instagram, how_heard, terms_accepted, terms_accepted_at, registered_at, id_file_url')
    .eq('id', params.clientId)
    .single()

  if (!client) notFound()

  // Generate a 1-hour signed URL for the ID photo server-side
  let idUrl: string | null = null
  if (client.id_file_url) {
    const { data: signed } = await supabase.storage
      .from('client-ids')
      .createSignedUrl(client.id_file_url, 3600)
    idUrl = signed?.signedUrl ?? null
  }

  const fmtDate = (d: string | null) => d
    ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '—'
  const fmtDateTime = (d: string | null) => d
    ? new Date(d).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'

  const fullName = [client.fname, client.lname].filter(Boolean).join(' ') || '—'
  const fullAddress = [
    client.address_street,
    client.address_street2,
    [client.address_city, client.address_state, client.address_zip].filter(Boolean).join(', '),
  ].filter(Boolean).join('\n')

  return (
    <html>
      <head>
        <title>Registration — {fullName}</title>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');

          * { box-sizing: border-box; margin: 0; padding: 0; }

          body {
            font-family: 'DM Mono', monospace;
            font-size: 11px;
            color: #1a1a1a;
            background: #fff;
            padding: 40px 48px;
            max-width: 720px;
            margin: 0 auto;
          }

          .header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            border-bottom: 2px solid #1a1a1a;
            padding-bottom: 14px;
            margin-bottom: 20px;
          }
          .studio-name {
            font-family: 'Syne', sans-serif;
            font-weight: 800;
            font-size: 18px;
            letter-spacing: 0.04em;
            color: #1a1a1a;
            line-height: 1;
          }
          .studio-sub {
            font-family: 'DM Mono', monospace;
            font-size: 9px;
            color: #666;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            margin-top: 4px;
          }
          .doc-title {
            text-align: right;
            font-family: 'Syne', sans-serif;
            font-weight: 700;
            font-size: 13px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #1a1a1a;
          }
          .doc-date {
            font-family: 'DM Mono', monospace;
            font-size: 9px;
            color: #666;
            margin-top: 4px;
            text-align: right;
          }

          .client-name-block {
            margin-bottom: 20px;
            padding-bottom: 14px;
            border-bottom: 1px solid #e0e0e0;
          }
          .client-name-label {
            font-size: 8px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #999;
            margin-bottom: 4px;
          }
          .client-name {
            font-family: 'Syne', sans-serif;
            font-weight: 700;
            font-size: 20px;
            color: #1a1a1a;
          }

          .section {
            margin-bottom: 18px;
          }
          .section-title {
            font-size: 8px;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            color: #999;
            font-weight: 500;
            margin-bottom: 8px;
            padding-bottom: 4px;
            border-bottom: 1px solid #f0f0f0;
          }
          .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; }
          .grid-3 { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px 16px; }

          .field-label {
            font-size: 8px;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #aaa;
            margin-bottom: 2px;
          }
          .field-value {
            font-size: 11px;
            color: #1a1a1a;
            white-space: pre-wrap;
          }
          .field-empty { color: #ccc; }

          .terms-badge {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 9px;
            font-weight: 500;
            letter-spacing: 0.04em;
          }
          .terms-accepted { background: #e8faf2; color: #1a7a4a; border: 1px solid #b3e8d0; }
          .terms-declined { background: #fde8ed; color: #c0334e; border: 1px solid #f5b3c0; }

          .id-photo {
            max-width: 320px;
            max-height: 220px;
            object-fit: contain;
            border: 1px solid #ddd;
            border-radius: 4px;
            display: block;
            margin-top: 8px;
          }
          .no-id { color: #ccc; font-style: italic; }

          .footer {
            margin-top: 32px;
            padding-top: 12px;
            border-top: 1px solid #e0e0e0;
            display: flex;
            justify-content: space-between;
            font-size: 8px;
            color: #bbb;
            letter-spacing: 0.06em;
          }

          @media print {
            body { padding: 28px 36px; }
            .no-print { display: none !important; }
            @page { margin: 0.5in; size: letter; }
          }
        `}</style>
      </head>
      <body>
        <PrintTrigger />

        {/* Header */}
        <div className="header">
          <div>
            <div className="studio-name">PARAMOUNT</div>
            <div className="studio-sub">Recording Studios</div>
          </div>
          <div>
            <div className="doc-title">Client Registration</div>
            <div className="doc-date">Submitted {fmtDateTime(client.registered_at)}</div>
          </div>
        </div>

        {/* Client name */}
        <div className="client-name-block">
          <div className="client-name-label">Client Name</div>
          <div className="client-name">{fullName}</div>
        </div>

        {/* Contact */}
        <div className="section">
          <div className="section-title">Contact Information</div>
          <div className="grid-2">
            <div>
              <div className="field-label">Email</div>
              <div className={`field-value ${!client.email ? 'field-empty' : ''}`}>{client.email || '—'}</div>
            </div>
            <div>
              <div className="field-label">Phone</div>
              <div className={`field-value ${!client.phone ? 'field-empty' : ''}`}>{client.phone || '—'}</div>
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="section">
          <div className="section-title">Address</div>
          <div>
            <div className="field-label">Street</div>
            <div className={`field-value ${!client.address_street ? 'field-empty' : ''}`}>{client.address_street || '—'}</div>
          </div>
          {client.address_street2 && (
            <div style={{ marginTop: 8 }}>
              <div className="field-label">Line 2</div>
              <div className="field-value">{client.address_street2}</div>
            </div>
          )}
          <div className="grid-3" style={{ marginTop: 8 }}>
            <div>
              <div className="field-label">City</div>
              <div className={`field-value ${!client.address_city ? 'field-empty' : ''}`}>{client.address_city || '—'}</div>
            </div>
            <div>
              <div className="field-label">State</div>
              <div className={`field-value ${!client.address_state ? 'field-empty' : ''}`}>{client.address_state || '—'}</div>
            </div>
            <div>
              <div className="field-label">ZIP</div>
              <div className={`field-value ${!client.address_zip ? 'field-empty' : ''}`}>{client.address_zip || '—'}</div>
            </div>
          </div>
        </div>

        {/* Additional info */}
        <div className="section">
          <div className="section-title">Additional Information</div>
          <div className="grid-2">
            <div>
              <div className="field-label">Instagram</div>
              <div className={`field-value ${!client.instagram ? 'field-empty' : ''}`}>
                {client.instagram ? `@${client.instagram.replace(/^@/, '')}` : '—'}
              </div>
            </div>
            <div>
              <div className="field-label">How They Heard About Us</div>
              <div className={`field-value ${!client.how_heard ? 'field-empty' : ''}`}>{client.how_heard || '—'}</div>
            </div>
          </div>
        </div>

        {/* Terms */}
        <div className="section">
          <div className="section-title">Terms & Conditions</div>
          <span className={`terms-badge ${client.terms_accepted ? 'terms-accepted' : 'terms-declined'}`}>
            {client.terms_accepted ? '✓ Accepted' : 'Not accepted'}
            {client.terms_accepted_at ? ` · ${fmtDate(client.terms_accepted_at)}` : ''}
          </span>
        </div>

        {/* ID Photo */}
        <div className="section">
          <div className="section-title">Government-Issued ID</div>
          {idUrl ? (
            <img src={idUrl} alt="Client ID" className="id-photo" />
          ) : (
            <div className="no-id">No ID on file</div>
          )}
        </div>

        {/* Footer */}
        <div className="footer">
          <span>PARAMOUNT RECORDING STUDIOS — CONFIDENTIAL</span>
          <span>Printed {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </body>
    </html>
  )
}
