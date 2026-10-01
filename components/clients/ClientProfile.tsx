'use client'
// ─── CLIENT PROFILE — one Edit, one Save (rebuild 2026-09-30) ────────────────
// Mock: docs/design-refs/crm-clients-v3.html (Eli approved 2026-09-30).
//
// WHY A REBUILD, NOT A PATCH. Eli: "we cannot edit names and client accounts
// properly — things are not saving." Three separate causes, all structural:
//
//  1. TYPING GOT WIPED. Every A&R/Admin card kept a draft and reset it from
//     props on any refetch (`useEffect(() => setDraft({...contact}), [contact])`).
//     The list refetches on EVERY clients/client_contacts change by anyone, and
//     each refetch makes new objects — so a reload mid-edit silently replaced
//     what you'd typed before you reached the card's own Save.
//  2. A LABEL'S PRIMARY REP HAD NO CONTROL. clients.fname/lname on a label is
//     its primary rep, copied onto leads/sessions/WOs — but the profile only
//     edited the company name. 10 Summers had Dijon McFarlane (Mustard himself)
//     there and nobody could fix it from the app.
//  3. FIXES REVERTED. Any name save on a label re-stamped that hidden rep onto
//     every linked record. Now a rep change replaces the old spelling only
//     (lib/propagateClientRename.ts + lib/clientEdits.ts).
//
// THE MODEL NOW: view mode is read-only (links, tags and the reg link still
// work in place). Edit takes a private copy of the client + its contacts that
// NOTHING outside this component can overwrite; Save diffs that copy against
// what was loaded and writes only what changed. Fields you changed outline
// amber so you can see what Save is about to do.
//
// Rejected: keeping inline per-field autosave. It's what made a label edit
// half-saved (name saved on blur, contact card waiting on its own Save), and
// it's why the rep could never be offered — a rep change touches the client
// row and the contact list at once.
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase, Client, ClientContact, CLIENT_TYPE_LABELS } from '@/lib/supabase'
import PhoneInput from '@/components/shared/PhoneInput'
import { RegViewModal } from '@/components/shared/RegViewModal'
import { STARTER_TAGS } from '@/lib/tags'
import { dbResult } from '@/lib/db'
import { toast } from '@/components/ui/Toaster'
import { propagateClientRename, propagateContactRename } from '@/lib/propagateClientRename'
import { fullName, moveContactToArtists, removeContact } from '@/lib/clientEdits'
import { ApCard, type ApProfile } from '@/components/billing/ApCard'

interface BookingLead {
  id: number
  fname: string
  lname: string
  artist_name: string | null
  session_date: string
  booking: string
  created_at: string
}

interface Props {
  client: Client | null
  contacts: ClientContact[]
  bookingCount: number
  loading?: boolean
  isMobile?: boolean
  onRefresh: () => void
  onBack?: () => void
  onDelete?: () => void
}

// ─── Draft shapes ────────────────────────────────────────────────────────────

const CLIENT_KEYS = [
  'name', 'fname', 'lname', 'email', 'phone', 'instagram', 'how_heard', 'artist_name',
  'address_street', 'address_street2', 'address_city', 'address_state', 'address_zip',
  'notes', 'ap_profile_id', 'ap_notes',
] as const
type ClientKey = typeof CLIENT_KEYS[number]
type ClientDraft = Record<ClientKey, string> & { artists: string[] }

interface ContactDraft {
  key: string                // contact id, or tmp-… for a new card
  orig: ClientContact | null // null = new
  fname: string
  lname: string
  email: string
  phone: string
  role: string
  contact_type: 'anr' | 'admin'
  artists: string[]
  removed: boolean
  toArtist: boolean
}

const s = (v: string | null | undefined) => (v ?? '')
const norm = (v: string) => v.trim()
const same = (a: string | null | undefined, b: string | null | undefined) => norm(s(a)) === norm(s(b))
const nameKey = (f: string | null | undefined, l: string | null | undefined) => fullName(f, l).toLowerCase()

function clientDraftOf(c: Client): ClientDraft {
  const d = { artists: [...(c.artists || [])] } as ClientDraft
  for (const k of CLIENT_KEYS) d[k] = s(c[k] as string | null | undefined)
  // Older individuals have `name` but no first/last — split so the boxes aren't empty.
  if (c.type !== 'label' && !c.fname && !c.lname) {
    const parts = s(c.name).trim().split(/\s+/).filter(Boolean)
    d.fname = parts[0] || ''
    d.lname = parts.slice(1).join(' ')
  }
  return d
}

function contactDraftOf(ct: ClientContact): ContactDraft {
  return {
    key: ct.id, orig: ct,
    fname: s(ct.fname), lname: s(ct.lname), email: s(ct.email), phone: s(ct.phone), role: s(ct.role),
    contact_type: ct.contact_type === 'admin' ? 'admin' : 'anr',
    artists: [...(ct.artists || [])],
    removed: false, toArtist: false,
  }
}

/** The contact whose name matches the label's own fname/lname — its primary rep. */
function repContactOf(client: Client, contacts: ClientContact[]): ClientContact | null {
  const k = nameKey(client.fname, client.lname)
  if (!k) return null
  return contacts.find(c => nameKey(c.fname, c.lname) === k) ?? null
}

// ─── Small pieces ────────────────────────────────────────────────────────────

const AMBER = 'inset 0 0 0 1px rgba(255,169,77,.65)'

function Label({ children }: { children: React.ReactNode }) {
  return <div className="c-label" style={{ fontSize: 10, marginBottom: 4 }}>{children}</div>
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 20px', borderTop: '1px solid var(--c-wash)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span className="c-label" style={{ flex: 1 }}>{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

function Field({ label, value, dim }: { label: string; value: React.ReactNode; dim?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Label>{label}</Label>
      <div style={{ fontSize: 13.5, opacity: dim ? 0.35 : 1, overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  )
}

function TextBox({ label, value, orig, onChange, placeholder, multiline }: {
  label?: string; value: string; orig: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean
}) {
  const changed = !same(value, orig)
  const style: React.CSSProperties = { boxShadow: changed ? AMBER : undefined }
  return (
    <div style={{ minWidth: 0 }}>
      {label && <Label>{label}</Label>}
      {multiline ? (
        <textarea className="c-textarea" rows={3} value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)} style={{ ...style, width: '100%', resize: 'vertical' }} />
      ) : (
        <input className="c-input" value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)} style={style} />
      )}
    </div>
  )
}

function PhoneBox({ label, value, orig, onChange }: { label?: string; value: string; orig: string; onChange: (v: string) => void }) {
  const changed = !same(value.replace(/\D/g, ''), orig.replace(/\D/g, ''))
  return (
    <div style={{ minWidth: 0 }}>
      {label && <Label>{label}</Label>}
      <div className="c-input" style={{ display: 'flex', alignItems: 'center', boxShadow: changed ? AMBER : undefined }}>
        <PhoneInput value={value} onChange={onChange} variant="inline" placeholder="Phone" style={{ width: '100%' }} />
      </div>
    </div>
  )
}

function Chip({ children, onRemove, tone }: { children: React.ReactNode; onRemove?: () => void; tone?: 'new' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px', borderRadius: 99,
      background: tone === 'new' ? 'rgba(255,169,77,.15)' : 'var(--c-wash2)',
      color: tone === 'new' ? 'var(--c-st-warm)' : undefined, fontSize: 12, fontWeight: 600,
    }}>
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} title="Remove" style={{ background: 'none', padding: 0, opacity: 0.5, fontSize: 11, lineHeight: 1, cursor: 'pointer', color: 'inherit' }}>✕</button>
      )}
    </span>
  )
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '.06em', padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap',
      background: tone === 'ok' ? 'color-mix(in srgb, var(--c-st-booked) 15%, transparent)'
        : tone === 'warn' ? 'color-mix(in srgb, var(--c-st-warm) 15%, transparent)' : 'var(--c-wash2)',
      color: tone === 'ok' ? 'var(--c-st-booked)' : tone === 'warn' ? 'var(--c-st-warm)' : undefined,
      opacity: tone ? 1 : 0.8,
    }}>{children}</span>
  )
}

const linkBtn: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
  background: 'none', padding: 0, cursor: 'pointer', color: 'var(--c-fg)', opacity: 0.6,
}
const actA: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--c-wash2)',
  color: 'var(--c-fg-2)', textDecoration: 'none', whiteSpace: 'nowrap',
}

function ArtistAdder({ onAdd, placeholder = '+ Add artist' }: { onAdd: (name: string) => void; placeholder?: string }) {
  const [v, setV] = useState('')
  const commit = () => { const n = v.trim(); if (n) onAdd(n); setV('') }
  return (
    <input
      value={v} placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      onBlur={commit}
      className="c-input"
      style={{ width: 150, height: 28, borderRadius: 99, fontSize: 12, display: 'inline-block' }}
    />
  )
}

const addUnique = (list: string[], name: string) =>
  list.some(a => a.toLowerCase() === name.trim().toLowerCase()) ? list : [...list, name.trim()]

// ─── Main component ──────────────────────────────────────────────────────────

export function ClientProfile({ client, contacts, bookingCount, loading, isMobile, onRefresh, onBack, onDelete }: Props) {
  const [bookings, setBookings] = useState<BookingLead[]>([])
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<ClientDraft | null>(null)
  const [cDrafts, setCDrafts] = useState<ContactDraft[]>([])
  const [repKey, setRepKey] = useState<string | null>(null)
  const [origRepKey, setOrigRepKey] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [regLinkUrl, setRegLinkUrl] = useState<string | null>(null)
  const [regLinkCopied, setRegLinkCopied] = useState(false)
  const [regLinkGenerating, setRegLinkGenerating] = useState(false)
  const [regViewOpen, setRegViewOpen] = useState(false)
  const [clientTags, setClientTags] = useState<string[]>(client?.tags || [])
  const [clientTagInput, setClientTagInput] = useState('')

  // ── AP submission procedure (2026-09-08) — linked by hand, never matched by
  // name: the AP sheet's names and QuickBooks' names disagree, so a guess would
  // attach the wrong instructions to a real invoice.
  const [apProfiles, setApProfiles] = useState<ApProfile[]>([])
  const [apOpen, setApOpen] = useState(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('ap_profiles').select('*').eq('is_global', false).order('family').order('name')
      if (alive) setApProfiles((data ?? []) as ApProfile[])
    })()
    return () => { alive = false }
  }, [])
  const apProfile = apProfiles.find(p => p.id === client?.ap_profile_id) ?? null

  useEffect(() => {
    if (!client) { setBookings([]); return }
    supabase
      .from('leads')
      .select('id, fname, lname, artist_name, session_date, booking, created_at')
      .eq('client_id', client.id)
      .eq('status', 'booked')
      .order('created_at', { ascending: false })
      .then(({ data }) => setBookings((data || []) as BookingLead[]))
  }, [client?.id])

  // Switching client always leaves edit mode — a draft belongs to one client.
  useEffect(() => {
    setEditing(false)
    setDraft(null)
    setCDrafts([])
    setRegLinkUrl(null)
    setRegLinkCopied(false)
    setRegLinkGenerating(false)
    setClientTags(client?.tags || [])
    setClientTagInput('')
  }, [client?.id])
  // Tags are tap-to-save and live outside edit mode; follow the server when idle.
  useEffect(() => { setClientTags(client?.tags || []) }, [client?.tags])

  const isLabel = client?.type === 'label'
  const rep = useMemo(() => (client && isLabel ? repContactOf(client, contacts) : null), [client, contacts, isLabel])

  // ── Edit mode ──────────────────────────────────────────────────────────────
  const startEdit = useCallback(() => {
    if (!client) return
    setDraft(clientDraftOf(client))
    setCDrafts(contacts.map(contactDraftOf))
    const rk = rep?.id ?? null
    setRepKey(rk)
    setOrigRepKey(rk)
    setEditing(true)
  }, [client, contacts, rep])

  const cancelEdit = useCallback(() => { setEditing(false); setDraft(null); setCDrafts([]) }, [])

  const setD = (k: ClientKey, v: string) => setDraft(d => (d ? { ...d, [k]: v } : d))
  const setC = (key: string, patch: Partial<ContactDraft>) =>
    setCDrafts(list => list.map(c => (c.key === key ? { ...c, ...patch } : c)))

  const addContactDraft = (type: 'anr' | 'admin') => {
    const key = `tmp-${Math.random().toString(36).slice(2)}`
    setCDrafts(list => [...list, {
      key, orig: null, fname: '', lname: '', email: '', phone: '', role: '', contact_type: type,
      artists: [], removed: false, toArtist: false,
    }])
  }

  const contactChanged = (c: ContactDraft): boolean => {
    if (!c.orig) return !!(c.fname.trim() || c.lname.trim() || c.email.trim())
    const o = c.orig
    return !same(c.fname, o.fname) || !same(c.lname, o.lname) || !same(c.email, o.email)
      || !same(c.phone.replace(/\D/g, ''), s(o.phone).replace(/\D/g, '')) || !same(c.role, o.role)
      || c.contact_type !== (o.contact_type === 'admin' ? 'admin' : 'anr')
      || JSON.stringify(c.artists) !== JSON.stringify(o.artists || [])
  }

  // Count of pending changes, for the save bar.
  const pending = useMemo(() => {
    if (!editing || !draft || !client) return 0
    const o = clientDraftOf(client)
    let n = CLIENT_KEYS.filter(k => !same(draft[k], o[k])).length
    if (JSON.stringify(draft.artists) !== JSON.stringify(o.artists)) n++
    if (repKey !== origRepKey) n++
    n += cDrafts.filter(c => c.removed || c.toArtist || contactChanged(c)).length
    return n
  }, [editing, draft, client, cDrafts, repKey, origRepKey])

  const save = useCallback(async () => {
    if (!client || !draft || saving) return
    setSaving(true)
    let touched = 0
    try {
      const live = cDrafts.filter(c => !c.removed && !c.toArtist)
      // 1. New contact cards → real rows (we need ids before a new card can be the rep).
      const idOf: Record<string, string> = {}
      for (const c of live.filter(c => !c.orig)) {
        if (!c.fname.trim() && !c.lname.trim() && !c.email.trim()) continue
        const { data, error } = await supabase.from('client_contacts').insert({
          client_id: client.id, fname: c.fname.trim() || null, lname: c.lname.trim() || null,
          email: c.email.trim() || null, phone: c.phone || null, role: c.role.trim() || null,
          contact_type: c.contact_type, artists: c.artists,
        }).select('id').limit(1)
        if (!dbResult('Adding contact', error) || !data?.[0]) return
        idOf[c.key] = data[0].id as string
      }
      // 2. Changed existing cards. A name change carries to the records that LINK
      //    this contact (propagateContactRename — by id, never by guessing).
      for (const c of live.filter(c => c.orig && contactChanged(c))) {
        const o = c.orig as ClientContact
        const patch: Partial<ClientContact> = {}
        if (!same(c.fname, o.fname)) patch.fname = c.fname.trim() || null
        if (!same(c.lname, o.lname)) patch.lname = c.lname.trim() || null
        if (!same(c.email, o.email)) patch.email = c.email.trim() || null
        if (!same(c.phone.replace(/\D/g, ''), s(o.phone).replace(/\D/g, ''))) patch.phone = c.phone || null
        if (!same(c.role, o.role)) patch.role = c.role.trim() || null
        if (c.contact_type !== (o.contact_type === 'admin' ? 'admin' : 'anr')) patch.contact_type = c.contact_type
        if (JSON.stringify(c.artists) !== JSON.stringify(o.artists || [])) patch.artists = c.artists
        const { error } = await supabase.from('client_contacts').update(patch).eq('id', o.id)
        if (!dbResult('Saving contact', error)) return
        await propagateContactRename({ ...o, ...patch } as ClientContact, patch)
      }

      // 3. The client row — only what changed.
      const o = clientDraftOf(client)
      const patch: Partial<Client> = {}
      for (const k of CLIENT_KEYS) {
        if (k === 'fname' || k === 'lname' || k === 'name') continue
        if (!same(draft[k], o[k])) (patch as Record<string, string | null>)[k] = draft[k].trim() || null
      }
      if (isLabel) {
        if (!same(draft.name, client.name) && draft.name.trim()) patch.name = draft.name.trim()
        // Primary rep = the starred card's name (as typed this save).
        const repCard = repKey ? cDrafts.find(c => c.key === repKey && !c.removed && !c.toArtist) : null
        const nf = repCard ? repCard.fname.trim() || null : (repKey === null && origRepKey !== null ? null : client.fname)
        const nl = repCard ? repCard.lname.trim() || null : (repKey === null && origRepKey !== null ? null : client.lname)
        if (!same(nf, client.fname)) patch.fname = nf
        if (!same(nl, client.lname)) patch.lname = nl
      } else {
        const f = draft.fname.trim(), l = draft.lname.trim()
        const full = fullName(f, l)
        if (full) {
          if (!same(f, client.fname)) patch.fname = f || null
          if (!same(l, client.lname)) patch.lname = l || null
          if (full !== client.name) patch.name = full
        }
      }
      // Roster: the edited list + anyone moved to artists + new per-A&R artists.
      let roster = [...draft.artists]
      for (const c of cDrafts.filter(c => c.toArtist)) roster = addUnique(roster, fullName(c.fname, c.lname))
      for (const c of live) {
        const before = c.orig?.artists || []
        for (const a of c.artists) if (!before.some(b => b.toLowerCase() === a.toLowerCase())) roster = addUnique(roster, a)
      }
      if (JSON.stringify(roster) !== JSON.stringify(client.artists || [])) patch.artists = roster

      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from('clients').update(patch).eq('id', client.id)
        if (!dbResult('Saving client', error)) return
        await propagateClientRename({ ...client, ...patch } as Client, patch, client)
      }

      // 4. Moved to artists: links + name go to the primary rep, card is removed.
      const repCardFinal = repKey ? cDrafts.find(c => c.key === repKey && !c.removed && !c.toArtist) : null
      const repRow: ClientContact | null = repCardFinal
        ? { ...(repCardFinal.orig || ({} as ClientContact)), id: repCardFinal.orig?.id || idOf[repCardFinal.key],
            fname: repCardFinal.fname.trim() || null, lname: repCardFinal.lname.trim() || null } as ClientContact
        : null
      for (const c of cDrafts.filter(c => c.toArtist && c.orig)) {
        const n = await moveContactToArtists(client.id, c.orig as ClientContact, repRow?.id ? repRow : null)
        if (n < 0) return
        touched += n
      }
      // 5. Removed cards: unlinked everywhere, then deleted. Names on old records stay.
      for (const c of cDrafts.filter(c => c.removed && c.orig && !c.toArtist)) {
        if (!(await removeContact((c.orig as ClientContact).id))) return
      }

      toast(touched > 0 ? `Saved · ${touched} linked record${touched === 1 ? '' : 's'} switched to the rep` : 'Saved', 'success')
      setEditing(false)
      setDraft(null)
      setCDrafts([])
    } finally {
      setSaving(false)
      onRefresh()
    }
  }, [client, draft, cDrafts, repKey, origRepKey, isLabel, saving, onRefresh])

  // ── Tags (tap-to-save, outside edit mode) ──────────────────────────────────
  const writeTags = useCallback(async (next: string[]) => {
    if (!client) return
    setClientTags(next)
    const { error } = await supabase.from('clients').update({ tags: next }).eq('id', client.id)
    dbResult('Saving tags', error)
  }, [client])

  // ── Delete ─────────────────────────────────────────────────────────────────
  const deleteClient = useCallback(async () => {
    if (!client) return
    setDeleting(true)
    try {
      // Unlink every contact first (leads/sessions/WOs keep their names).
      // (The old version also cleared a `leads.anr_admin_contact_id` column that
      // does not exist, and never checked a single write.)
      for (const ct of contacts) {
        if (!(await removeContact(ct.id))) return
      }
      for (const table of ['leads', 'work_orders'] as const) {
        const { error } = await supabase.from(table).update({ client_id: null }).eq('client_id', client.id)
        if (!dbResult(`Unlinking ${table}`, error)) return
      }
      const { error } = await supabase.from('clients').delete().eq('id', client.id)
      if (!dbResult('Deleting client', error)) return
      setShowDeleteConfirm(false)
      onDelete?.()
    } finally {
      setDeleting(false)
    }
  }, [client, contacts, onDelete])

  // ── Registration link (individuals) ────────────────────────────────────────
  const generateRegLink = useCallback(async () => {
    if (!client) return
    setRegLinkGenerating(true)
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await supabase.from('registration_tokens').insert({
      token, client_id: client.id, lead_id: null,
      prefill_email: client.email || null, prefill_name: client.name || null, expires_at: expiresAt,
    })
    setRegLinkGenerating(false)
    if (!dbResult('Creating registration link', error)) return
    setRegLinkUrl(`${window.location.origin}/register/${token}`)
  }, [client])

  const copyRegLink = useCallback(async () => {
    if (!regLinkUrl) return
    try { await navigator.clipboard.writeText(regLinkUrl) } catch (_) {}
    setRegLinkCopied(true)
    setTimeout(() => setRegLinkCopied(false), 2000)
  }, [regLinkUrl])

  const emailRegLink = useCallback(() => {
    if (!regLinkUrl || !client) return
    const subject = encodeURIComponent('Your Paramount Recording Studios registration link')
    const body = encodeURIComponent(
      `Hi ${client.name || 'there'},\n\nPlease complete your registration for Paramount Recording Studios using the link below:\n\n${regLinkUrl}\n\nThis link expires in 7 days.\n\n— Paramount Recording Studios`
    )
    window.location.href = `mailto:${client.email || ''}?subject=${subject}&body=${body}`
  }, [regLinkUrl, client])

  // ── Shells ─────────────────────────────────────────────────────────────────
  const shell: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden',
    background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 16,
  }

  if (loading && !client) {
    return (
      <div style={shell}>
        <div style={{ padding: '20px' }}>
          <div style={{ height: 22, borderRadius: 6, background: 'var(--c-wash)', width: '52%', marginBottom: 12 }} />
          <div style={{ height: 12, borderRadius: 4, background: 'var(--c-wash)', width: '28%' }} />
        </div>
      </div>
    )
  }
  if (!client) {
    return (
      <div style={{ ...shell, alignItems: 'center', justifyContent: 'center', fontSize: 12, opacity: 0.5 }}>
        Select a client to view their profile
      </div>
    )
  }

  const od = clientDraftOf(client)
  const grid: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px 16px',
  }
  const visibleContacts = editing ? cDrafts.filter(c => !c.removed && !c.toArtist) : contacts.map(contactDraftOf)
  const staleRep = isLabel && !rep && fullName(client.fname, client.lname)
  const artistsShown = editing && draft ? draft.artists : (client.artists || [])
  const movedNames = editing ? cDrafts.filter(c => c.toArtist).map(c => fullName(c.fname, c.lname)) : []

  return (
    <div style={shell}>
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>

        {/* ── Header ── */}
        <div style={{ padding: '18px 20px 14px' }}>
          {onBack && (
            <button onClick={onBack} style={{ ...linkBtn, marginBottom: 10, display: 'block' }}>← Back</button>
          )}
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="c-label">{isLabel ? 'Label' : `Individual · ${CLIENT_TYPE_LABELS.individual}`}</span>
              {editing && draft ? (
                isLabel ? (
                  <input className="c-input c-arch" value={draft.name} onChange={e => setD('name', e.target.value)}
                    placeholder="Label / company name"
                    style={{ fontSize: 22, height: 44, marginTop: 3, boxShadow: same(draft.name, od.name) ? undefined : AMBER }} />
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 3 }}>
                    {(['fname', 'lname'] as const).map(k => (
                      <input key={k} className="c-input c-arch" value={draft[k]} placeholder={k === 'fname' ? 'First' : 'Last'}
                        onChange={e => setD(k, e.target.value)}
                        style={{ fontSize: 20, height: 42, boxShadow: same(draft[k], od[k]) ? undefined : AMBER }} />
                    ))}
                  </div>
                )
              ) : (
                <h2 className="c-arch" style={{ fontWeight: 400, fontSize: isMobile ? 22 : 28, letterSpacing: '-0.03em', lineHeight: 1.05, marginTop: 2, overflowWrap: 'anywhere' }}>
                  {client.name}
                </h2>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9, alignItems: 'center' }}>
                {bookingCount > 0 && <Tag>{bookingCount} BOOKING{bookingCount === 1 ? '' : 'S'}</Tag>}
                {client.registered_at && (
                  <button onClick={() => setRegViewOpen(true)} style={{ background: 'none', padding: 0, cursor: 'pointer' }}>
                    <Tag tone="ok">✓ REGISTERED</Tag>
                  </button>
                )}
                {isLabel && apProfile && <Tag>AP: {apProfile.name.toUpperCase()}</Tag>}
                {client.sms_opt_in && <Tag>SMS OPT-IN</Tag>}
              </div>
            </div>
            {!editing && (
              <button className="c-btn" onClick={startEdit} style={{ flexShrink: 0 }}>Edit</button>
            )}
          </div>
        </div>

        {/* ── LABEL: contacts ── */}
        {isLabel && (
          <Section
            title="Contacts"
            action={editing ? (
              <div style={{ display: 'flex', gap: 14 }}>
                <button style={linkBtn} onClick={() => addContactDraft('anr')}>+ A&amp;R</button>
                <button style={linkBtn} onClick={() => addContactDraft('admin')}>+ Admin</button>
              </div>
            ) : undefined}
          >
            {staleRep && (!editing || repKey === null) && (
              <div style={{ fontSize: 12, color: 'var(--c-st-warm)', marginBottom: 8 }}>
                Rep on file is &ldquo;{fullName(client.fname, client.lname)}&rdquo; — not one of these contacts.
                {editing ? ' Star the right one.' : ' Edit to pick the right one.'}
              </div>
            )}
            {visibleContacts.length === 0 && (
              <div style={{ fontSize: 12, opacity: 0.5 }}>No contacts on file yet.{!editing && ' Edit to add one.'}</div>
            )}
            {visibleContacts.map(c => {
              const isRep = editing ? repKey === c.key : rep?.id === c.key
              const nm = fullName(c.fname, c.lname) || (c.orig ? 'Unnamed contact' : 'New contact')
              const o = c.orig
              return (
                <div key={c.key} style={{ background: 'var(--c-wash)', borderRadius: 14, padding: '11px 12px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{nm}{c.role && !editing ? <span style={{ fontWeight: 500, opacity: 0.5 }}> · {c.role}</span> : null}</div>
                      {!editing && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 3, fontSize: 11.5 }}>
                          {c.email && <><span style={{ opacity: 0.6 }}>{c.email}</span><a href={`mailto:${c.email}`} style={actA}>Email</a></>}
                          {c.phone && <>
                            <span style={{ opacity: 0.6 }}>{c.phone}</span>
                            <a href={`tel:${c.phone.replace(/\D/g, '')}`} style={actA}>Call</a>
                            <a href={`sms:${c.phone.replace(/\D/g, '')}`} style={actA}>Text</a>
                          </>}
                        </div>
                      )}
                    </div>
                    {editing ? (
                      <button
                        onClick={() => setRepKey(isRep ? null : c.key)}
                        title={isRep ? 'Primary rep — tap to clear' : 'Make this the primary rep'}
                        style={{ background: 'none', padding: 0, cursor: 'pointer' }}
                      >
                        <Tag tone={isRep ? 'ok' : undefined}>{isRep ? '★ PRIMARY REP' : '☆ MAKE REP'}</Tag>
                      </button>
                    ) : isRep ? <Tag tone="ok">★ PRIMARY REP</Tag> : null}
                    {editing ? (
                      <span className="c-seg" style={{ padding: 2 }}>
                        {(['anr', 'admin'] as const).map(t => (
                          <button key={t} type="button" className={c.contact_type === t ? 'c-on' : ''}
                            onClick={() => setC(c.key, { contact_type: t })}
                            style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 10px' }}>
                            {t === 'anr' ? 'A&R' : 'Admin'}
                          </button>
                        ))}
                      </span>
                    ) : <Tag>{c.contact_type === 'admin' ? 'ADMIN' : 'A&R'}</Tag>}
                  </div>

                  {editing && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 10 }}>
                        <TextBox value={c.fname} orig={s(o?.fname)} onChange={v => setC(c.key, { fname: v })} placeholder="First" />
                        <TextBox value={c.lname} orig={s(o?.lname)} onChange={v => setC(c.key, { lname: v })} placeholder="Last" />
                        <TextBox value={c.email} orig={s(o?.email)} onChange={v => setC(c.key, { email: v })} placeholder="Email" />
                        <PhoneBox value={c.phone} orig={s(o?.phone)} onChange={v => setC(c.key, { phone: v })} />
                        {c.contact_type === 'admin' && (
                          <TextBox value={c.role} orig={s(o?.role)} onChange={v => setC(c.key, { role: v })} placeholder="Role (AP, coordinator…)" />
                        )}
                      </div>
                      {c.contact_type === 'anr' && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 9 }}>
                          <span className="c-label" style={{ fontSize: 9.5 }}>Their artists</span>
                          {c.artists.map(a => (
                            <Chip key={a} onRemove={() => setC(c.key, { artists: c.artists.filter(x => x !== a) })}>{a}</Chip>
                          ))}
                          <ArtistAdder onAdd={n => setC(c.key, { artists: addUnique(c.artists, n) })} />
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end', marginTop: 9 }}>
                        {c.orig && (
                          <button
                            style={{ ...linkBtn, opacity: isRep ? 0.25 : 0.6, cursor: isRep ? 'default' : 'pointer' }}
                            disabled={isRep}
                            title={isRep ? 'This is the primary rep — star someone else first' : 'This person is the artist, not a rep'}
                            onClick={() => setC(c.key, { toArtist: true })}
                          >Move to artists →</button>
                        )}
                        <button style={{ ...linkBtn, color: 'var(--c-st-hot)', opacity: 0.85 }}
                          onClick={() => {
                            if (isRep) setRepKey(null)
                            if (c.orig) setC(c.key, { removed: true })
                            else setCDrafts(list => list.filter(x => x.key !== c.key))
                          }}>Remove</button>
                      </div>
                    </>
                  )}
                  {!editing && c.artists.length > 0 && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
                      {c.artists.map(a => <Chip key={a}>{a}</Chip>)}
                    </div>
                  )}
                </div>
              )
            })}
            {editing && cDrafts.some(c => c.toArtist || c.removed) && (
              <div style={{ fontSize: 11.5, opacity: 0.65, marginTop: 2 }}>
                {cDrafts.filter(c => c.toArtist).map(c => (
                  <div key={c.key}>
                    {fullName(c.fname, c.lname)} → artists.{' '}
                    {repKey ? 'Their leads, sessions and work orders switch to the primary rep.' : <span style={{ color: 'var(--c-st-warm)' }}>Star a primary rep so their sessions switch to them.</span>}{' '}
                    <button style={linkBtn} onClick={() => setC(c.key, { toArtist: false })}>Undo</button>
                  </div>
                ))}
                {cDrafts.filter(c => c.removed && !c.toArtist).map(c => (
                  <div key={c.key}>
                    {fullName(c.fname, c.lname) || 'Contact'} will be removed.{' '}
                    <button style={linkBtn} onClick={() => setC(c.key, { removed: false })}>Undo</button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── LABEL: artist roster ── */}
        {isLabel && (
          <Section title="Artists">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {artistsShown.length === 0 && movedNames.length === 0 && !editing && <span style={{ fontSize: 12, opacity: 0.5 }}>None on file.</span>}
              {artistsShown.map(a => (
                <Chip key={a} tone={editing && !(client.artists || []).includes(a) ? 'new' : undefined}
                  onRemove={editing ? () => setDraft(d => (d ? { ...d, artists: d.artists.filter(x => x !== a) } : d)) : undefined}>
                  {a}
                </Chip>
              ))}
              {movedNames.map(a => <Chip key={`m-${a}`} tone="new">{a}</Chip>)}
              {editing && <ArtistAdder onAdd={n => setDraft(d => (d ? { ...d, artists: addUnique(d.artists, n) } : d))} />}
            </div>
          </Section>
        )}

        {/* ── INDIVIDUAL: contact details ── */}
        {!isLabel && (
          <Section title="Contact">
            {editing && draft ? (
              <div style={grid}>
                <TextBox label="Email" value={draft.email} orig={od.email} onChange={v => setD('email', v)} />
                <PhoneBox label="Phone" value={draft.phone} orig={od.phone} onChange={v => setD('phone', v)} />
                <TextBox label="Artist name" value={draft.artist_name} orig={od.artist_name} onChange={v => setD('artist_name', v)} />
                <TextBox label="Instagram" value={draft.instagram} orig={od.instagram} onChange={v => setD('instagram', v)} />
                <TextBox label="How heard" value={draft.how_heard} orig={od.how_heard} onChange={v => setD('how_heard', v)} />
              </div>
            ) : (
              <div style={grid}>
                <Field label="Email" dim={!client.email} value={client.email
                  ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{client.email}<a href={`mailto:${client.email}`} style={actA}>Email</a></span>
                  : '—'} />
                <Field label="Phone" dim={!client.phone} value={client.phone
                  ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{client.phone}
                      <a href={`tel:${client.phone.replace(/\D/g, '')}`} style={actA}>Call</a>
                      <a href={`sms:${client.phone.replace(/\D/g, '')}`} style={actA}>Text</a></span>
                  : '—'} />
                <Field label="Artist name" dim={!client.artist_name} value={client.artist_name || '—'} />
                <Field label="Instagram" dim={!client.instagram} value={client.instagram || '—'} />
                <Field label="How heard" dim={!client.how_heard} value={client.how_heard || '—'} />
              </div>
            )}
          </Section>
        )}

        {/* ── Billing (both) ── */}
        <Section title={isLabel ? 'Billing' : 'Billing address'}>
          {editing && draft ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {isLabel && (
                <div style={grid}>
                  <div style={{ minWidth: 0 }}>
                    <Label>AP procedure</Label>
                    <select className="c-input" value={draft.ap_profile_id} onChange={e => setD('ap_profile_id', e.target.value)}
                      style={{ boxShadow: same(draft.ap_profile_id, od.ap_profile_id) ? undefined : AMBER, cursor: 'pointer' }}>
                      <option value="">Not set — no AP card on invoices</option>
                      {apProfiles.map(p => <option key={p.id} value={p.id}>{p.family} · {p.name}</option>)}
                    </select>
                  </div>
                  <TextBox label="Billing email" value={draft.email} orig={od.email} onChange={v => setD('email', v)} />
                  <PhoneBox label="Billing phone" value={draft.phone} orig={od.phone} onChange={v => setD('phone', v)} />
                </div>
              )}
              <div style={grid}>
                <TextBox label="Street" value={draft.address_street} orig={od.address_street} onChange={v => setD('address_street', v)} />
                <TextBox label="Street 2" value={draft.address_street2} orig={od.address_street2} onChange={v => setD('address_street2', v)} />
                <TextBox label="City" value={draft.address_city} orig={od.address_city} onChange={v => setD('address_city', v)} />
                <TextBox label="State" value={draft.address_state} orig={od.address_state} onChange={v => setD('address_state', v)} />
                <TextBox label="Zip" value={draft.address_zip} orig={od.address_zip} onChange={v => setD('address_zip', v)} />
              </div>
              {isLabel && (
                <TextBox label="AP notes for this client" multiline value={draft.ap_notes} orig={od.ap_notes} onChange={v => setD('ap_notes', v)}
                  placeholder="Anything specific to this client (e.g. Interscope: over $5,000 the invoice must be dated after the PO)…" />
              )}
            </div>
          ) : (
            <div style={grid}>
              {isLabel && (
                <Field label="AP procedure" dim={!apProfile} value={apProfile
                  ? <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{apProfile.family} · {apProfile.name}
                      <button onClick={() => setApOpen(true)} style={linkBtn}>How to send →</button></span>
                  : 'Not set'} />
              )}
              {isLabel && <Field label="Billing email" dim={!client.email} value={client.email || '—'} />}
              {isLabel && client.phone && <Field label="Billing phone" value={client.phone} />}
              <Field label="Address" dim={!client.address_street && !client.address_city}
                value={[client.address_street, client.address_street2, [client.address_city, client.address_state].filter(Boolean).join(', '), client.address_zip].filter(Boolean).join(' · ') || 'Not on file'} />
              {isLabel && client.ap_notes && <div style={{ gridColumn: '1 / -1' }}><Field label="AP notes" value={client.ap_notes} /></div>}
            </div>
          )}
        </Section>

        {/* ── Registration (individuals) ── */}
        {!isLabel && !editing && (
          <Section title="Registration">
            {client.registered_at ? (
              <button onClick={() => setRegViewOpen(true)} style={{ background: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, color: 'var(--c-st-booked)', textAlign: 'left' }}>
                ✓ Registered {new Date(client.registered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {client.terms_accepted && ' · Terms accepted'}
                {client.id_file_url && ' · ID on file'}
                <span style={{ opacity: 0.6, marginLeft: 6 }}>View →</span>
              </button>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 12.5, opacity: 0.55 }}>Not registered yet</span>
                  <button className="c-btn" onClick={generateRegLink} disabled={regLinkGenerating || !!regLinkUrl}
                    style={{ opacity: regLinkGenerating ? 0.6 : 1 }}>
                    {regLinkGenerating ? 'Creating…' : regLinkUrl ? '✓ Link created' : 'Send registration link'}
                  </button>
                </div>
                {regLinkUrl && (
                  <div style={{ background: 'var(--c-wash)', borderRadius: 12, padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <span style={{ fontSize: 11, opacity: 0.7, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{regLinkUrl}</span>
                    <button style={linkBtn} onClick={copyRegLink}>{regLinkCopied ? 'Copied' : 'Copy'}</button>
                    <button style={linkBtn} onClick={emailRegLink}>Email</button>
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {/* ── Booking history ── */}
        {!editing && (
          <Section title={`Booked sessions${bookings.length ? ` · ${bookings.length}` : ''}`}>
            {bookings.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.5 }}>No booked sessions linked yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {bookings.slice(0, 12).map(l => (
                  <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12.5 }}>
                    <span className="c-mono" style={{ fontSize: 11, opacity: 0.55, minWidth: 82 }}>
                      {l.session_date || new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[l.artist_name, fullName(l.fname, l.lname)].filter(Boolean).join(' · ') || '—'}
                    </span>
                    {l.booking && <span style={{ fontSize: 10.5, opacity: 0.5 }}>{l.booking}</span>}
                  </div>
                ))}
                {bookings.length > 12 && <div style={{ fontSize: 11, opacity: 0.45 }}>+{bookings.length - 12} more</div>}
              </div>
            )}
          </Section>
        )}

        {/* ── Notes ── */}
        <Section title="Notes">
          {editing && draft ? (
            <TextBox multiline value={draft.notes} orig={od.notes} onChange={v => setD('notes', v)} placeholder="Add notes…" />
          ) : (
            <div style={{ fontSize: 13, opacity: client.notes ? 0.8 : 0.35, whiteSpace: 'pre-wrap' }}>{client.notes || 'No notes.'}</div>
          )}
        </Section>

        {/* ── Tags (tap to save, any time) ── */}
        {!editing && (
          <Section title="Tags">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {clientTags.map(t => <Chip key={t} onRemove={() => writeTags(clientTags.filter(x => x !== t))}>{t}</Chip>)}
              {STARTER_TAGS.filter(t => !clientTags.includes(t)).map(t => (
                <button key={t} onClick={() => writeTags([...clientTags, t])}
                  style={{ background: 'none', padding: '4px 8px', fontSize: 11.5, opacity: 0.45, cursor: 'pointer', color: 'var(--c-fg)' }}>+ {t}</button>
              ))}
              <input
                value={clientTagInput}
                onChange={e => setClientTagInput(e.target.value)}
                onKeyDown={e => {
                  const t = clientTagInput.trim()
                  if (e.key === 'Enter' && t && !clientTags.includes(t)) { writeTags([...clientTags, t]); setClientTagInput('') }
                  if (e.key === 'Escape') setClientTagInput('')
                }}
                placeholder="+ Custom tag"
                className="c-input"
                style={{ width: 130, height: 28, borderRadius: 99, fontSize: 12, display: 'inline-block' }}
              />
            </div>
          </Section>
        )}

        {/* ── Footer ── */}
        {!editing && (
          <div style={{ padding: '12px 20px 18px', borderTop: '1px solid var(--c-wash)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 11, opacity: 0.4 }}>
              Added {client.created_at ? new Date(client.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
            </span>
            <button onClick={() => setShowDeleteConfirm(true)} style={{ ...linkBtn, color: 'var(--c-st-hot)' }}>Delete client</button>
          </div>
        )}
      </div>

      {/* ── Save bar ── */}
      {editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: '1px solid var(--c-wash2)', background: 'var(--c-wash)', flexShrink: 0, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180, fontSize: 12, opacity: 0.8 }}>
            {pending === 0 ? 'No changes yet.' : (
              <>
                <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: 'var(--c-st-warm)', marginRight: 7 }} />
                <b style={{ color: 'var(--c-st-warm)' }}>{pending} change{pending === 1 ? '' : 's'}</b>
                {' '}— name changes also update this client&apos;s linked leads, sessions and work orders.
              </>
            )}
          </div>
          <button onClick={cancelEdit} disabled={saving} style={{ ...linkBtn, opacity: 0.7 }}>Cancel</button>
          <button className="c-btn" onClick={save} disabled={saving || pending === 0}
            style={{ background: pending ? 'var(--c-st-booked)' : undefined, color: pending ? 'var(--c-chip-ink)' : undefined, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {showDeleteConfirm && (
        <div onClick={() => setShowDeleteConfirm(false)} className="c-modal-backdrop" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} className="c-sheet" style={{ padding: '20px 24px', maxWidth: 400, width: '100%' }}>
            <div className="c-arch" style={{ fontSize: 15, marginBottom: 8 }}>Delete {client.name}?</div>
            <div style={{ fontSize: 12.5, opacity: 0.7, lineHeight: 1.6, marginBottom: 18 }}>
              This permanently deletes the client and its contacts. Linked leads, sessions and work orders are unlinked, not deleted. This can&apos;t be undone.
            </div>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'flex-end', alignItems: 'center' }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={linkBtn}>Cancel</button>
              <button className="c-btn" onClick={deleteClient} disabled={deleting}
                style={{ background: 'var(--c-st-hot)', color: '#fff', opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
      {regViewOpen && <RegViewModal clientId={client.id} onClose={() => setRegViewOpen(false)} />}
      {apOpen && apProfile && (
        <ApCard profile={apProfile} clientName={client.name} clientNotes={client.ap_notes} onClose={() => setApOpen(false)} />
      )}
    </div>
  )
}
