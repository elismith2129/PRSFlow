'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, Lead } from '@/lib/supabase'
import { statusFillClass } from '@/components/carved'
import { useClientsVersion } from '@/hooks/useClientsVersion'
import { useClientContactsVersion } from '@/hooks/useClientContactsVersion'

/**
 * WHAT THE CRM'S ONE SEARCH BAR FINDS (Eli, 2026-10-12 — the Ramp rework:
 * "ramp just has the search bar at the top that applies to everything on that
 * page"). One list, across leads, clients and registrations, each hit saying
 * what it is. It replaced three separate boxes: "Search N leads…" (All Leads
 * only, and only inside the lit status pills), the Clients search, and the
 * Registrations search.
 *
 * Same stance as the Billing Hub's search: it IGNORES the tab and the filters.
 * You look for a person, not for a person-in-a-folder.
 *
 * A REGISTRATION IS A CLIENT ROW (clients.registered_at), so a registered
 * person is ONE hit — a Client with a "Registration" button — not two rows
 * that are the same human.
 *
 * Mounted only while the bar has text in it, so the clients read happens when
 * someone actually searches. Leads come from the page (already loaded, already
 * live). Clients ride the shared clients channel and contacts the shared
 * contacts channel — never open another channel for either.
 */

type SClient = {
  id: string
  type: string | null
  name: string | null
  fname: string | null
  lname: string | null
  email: string | null
  phone: string | null
  artist_name: string | null
  artists: string[] | null
  registered_at: string | null
}
type SContact = {
  client_id: string
  fname: string | null
  lname: string | null
  email: string | null
  artists: string[] | null
  contact_type: string | null
}

/** Rows drawn per kind. A two-letter query can match hundreds; past this the
 *  list says so and the fix is to keep typing. */
const MAX_ROWS = 80

const person = (f?: string | null, l?: string | null) => [f, l].filter(Boolean).join(' ').trim()
const digits = (s?: string | null) => (s || '').replace(/\D/g, '')

function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return '—'
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase()
  return (w[0][0] + w[w.length - 1][0]).toUpperCase()
}

/** Every row of a table, paged — a bare select stops at 1,000 rows and would
 *  make an older client unfindable without ever saying so. */
async function fetchAll<T>(table: 'clients' | 'client_contacts', columns: string, orderBy: string): Promise<T[]> {
  let all: T[] = []
  let from = 0
  const BATCH = 1000
  while (true) {
    const { data, error } = await supabase.from(table).select(columns).order(orderBy).range(from, from + BATCH - 1)
    if (error || !data || data.length === 0) break
    all = all.concat(data as unknown as T[])
    if (data.length < BATCH) break
    from += BATCH
  }
  return all
}

export function CrmSearchResults({ query, leads, onOpenLead, onOpenClient, onOpenRegistration }: {
  query: string
  leads: Lead[]
  onOpenLead: (id: number) => void
  onOpenClient: (id: string) => void
  onOpenRegistration: (clientId: string) => void
}) {
  const [clients, setClients] = useState<SClient[]>([])
  const [contacts, setContacts] = useState<SContact[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const clientsVersion = useClientsVersion()
  const contactsVersion = useClientContactsVersion()

  const load = useCallback(async () => {
    const [c, ct] = await Promise.all([
      fetchAll<SClient>('clients', 'id, type, name, fname, lname, email, phone, artist_name, artists, registered_at', 'name'),
      fetchAll<SContact>('client_contacts', 'client_id, fname, lname, email, artists, contact_type', 'id'),
    ])
    setClients(c)
    setContacts(ct)
    setLoadingClients(false)
  }, [])
  useEffect(() => { load() }, [load, clientsVersion, contactsVersion])

  const q = query.trim().toLowerCase()
  const qDigits = digits(q)

  const { leadHits, clientHits } = useMemo(() => {
    const has = (v?: string | null) => !!v && v.toLowerCase().includes(q)
    // Three digits before a phone match counts — "12" is in every number.
    const phoneHit = (p?: string | null) => qDigits.length >= 3 && digits(p).includes(qDigits)

    const leadHits = !q ? [] : leads.filter(l =>
      has(person(l.fname, l.lname)) || has(l.email) || has(l.company) || has(l.label) || has(l.artist_name) || phoneHit(l.phone))

    const byClient: Record<string, SContact[]> = {}
    for (const ct of contacts) (byClient[ct.client_id] ||= []).push(ct)

    // `why` is the thing that matched when it wasn't the client's own name —
    // typing an A&R or an artist finds the label, and the row says which.
    const clientHits: { c: SClient; why: string | null }[] = []
    if (q) for (const c of clients) {
      if (has(c.name) || has(person(c.fname, c.lname))) { clientHits.push({ c, why: null }); continue }
      if (has(c.email)) { clientHits.push({ c, why: c.email }); continue }
      if (phoneHit(c.phone)) { clientHits.push({ c, why: c.phone }); continue }
      if (has(c.artist_name)) { clientHits.push({ c, why: `Artist · ${c.artist_name}` }); continue }
      const artist = (c.artists || []).find(a => has(a))
      if (artist) { clientHits.push({ c, why: `Artist · ${artist}` }); continue }
      let why: string | null = null
      for (const ct of byClient[c.id] || []) {
        const who = person(ct.fname, ct.lname)
        const role = ct.contact_type === 'admin' ? 'Admin' : 'A&R'
        if (has(who)) { why = `${role} · ${who}`; break }
        if (has(ct.email)) { why = `${role} · ${ct.email}`; break }
        const a = (ct.artists || []).find(x => has(x))
        if (a) { why = `Artist · ${a}${who ? ` (${who})` : ''}`; break }
      }
      if (why) clientHits.push({ c, why })
    }
    return { leadHits, clientHits }
  }, [q, qDigits, leads, clients, contacts])

  /** The matched run, on a wash chip. Tone only — colour is status, never emphasis. */
  const mark = (text: string | null | undefined): React.ReactNode => {
    const t = text || ''
    const i = q ? t.toLowerCase().indexOf(q) : -1
    if (i < 0) return t
    return <>{t.slice(0, i)}<span className="c-srch-hit">{t.slice(i, i + q.length)}</span>{t.slice(i + q.length)}</>
  }

  const total = leadHits.length + clientHits.length
  const disc: React.CSSProperties = {
    width: 26, height: 26, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'DM Mono, monospace', fontSize: 10, fontWeight: 700, letterSpacing: '0.02em',
  }
  const nameStyle: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-fg)', flexShrink: 0, maxWidth: '55%' }
  const metaStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 10.5, color: 'var(--c-fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }
  const sl = <span style={{ color: 'var(--c-fg-3)' }}> / </span>

  return (
    <div className="c-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minHeight: 0 }}>
      <div className="c-lozenge" style={{ flexShrink: 0 }}>
        <b>Search results · leads, clients and registrations</b>
        <span className="c-ct">{loadingClients ? `${leadHits.length}…` : total}</span>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {leadHits.slice(0, MAX_ROWS).map(l => {
          const who = person(l.fname, l.lname) || '—'
          return (
            <div key={`l${l.id}`} className="c-row" onClick={() => onOpenLead(l.id)} style={{ cursor: 'pointer', marginBottom: 4 }} title="Open this lead">
              <span className="c-srch-kind">Lead</span>
              <div className={`c-dot ${statusFillClass(l.status)}`} style={{ ...disc, color: l.status === 'hot' ? 'var(--c-hot-text)' : 'var(--c-chip-ink)' }}>{initials(who)}</div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={nameStyle}>
                  {l.label && l.artist_name
                    ? <>{mark(l.label)}{sl}{mark(who)}{sl}{mark(l.artist_name)}</>
                    : l.artist_name
                      ? <>{mark(who)} <span style={{ color: 'var(--c-fg-3)' }}>·</span> {mark(l.artist_name)}</>
                      : <>{mark(who)}{l.company && <span style={{ color: 'var(--c-fg-3)', fontWeight: 400 }}> · {mark(l.company)}</span>}</>}
                </div>
                <div style={metaStyle}>{mark(l.email)}{l.email && l.phone ? ' · ' : ''}{mark(l.phone)}</div>
              </div>
            </div>
          )
        })}
        {leadHits.length > MAX_ROWS && (
          <div className="c-sub" style={{ padding: '4px 12px 10px', fontSize: 11 }}>Showing the first {MAX_ROWS} of {leadHits.length} leads. Keep typing to narrow it.</div>
        )}

        {clientHits.slice(0, MAX_ROWS).map(({ c, why }) => {
          const name = c.name || person(c.fname, c.lname) || '—'
          return (
            <div key={`c${c.id}`} className="c-row" onClick={() => onOpenClient(c.id)} style={{ cursor: 'pointer', marginBottom: 4 }} title="Open this client">
              <span className="c-srch-kind">Client</span>
              <div className="c-dot" style={{ ...disc, background: 'var(--c-wash2)', color: 'var(--c-fg)' }}>{initials(name)}</div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={nameStyle}>{mark(name)}</div>
                <div style={metaStyle}>{why ? mark(why) : (c.type === 'label' ? 'Label / Billing' : 'COD')}</div>
              </div>
              {c.registered_at && (
                <button
                  type="button"
                  className="c-bact"
                  onClick={e => { e.stopPropagation(); onOpenRegistration(c.id) }}
                  title="Open their registration"
                  style={{ flexShrink: 0 }}
                >
                  Registration
                </button>
              )}
            </div>
          )
        })}
        {clientHits.length > MAX_ROWS && (
          <div className="c-sub" style={{ padding: '4px 12px 10px', fontSize: 11 }}>Showing the first {MAX_ROWS} of {clientHits.length} clients. Keep typing to narrow it.</div>
        )}

        {loadingClients && (
          <div className="c-sub" style={{ padding: '10px 12px', fontSize: 11 }}>Looking through clients…</div>
        )}
        {!loadingClients && total === 0 && (
          <div className="c-sub" style={{ padding: 20, textAlign: 'center' }}>Nothing matches that.</div>
        )}
      </div>
    </div>
  )
}
