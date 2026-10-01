// Client-account edits that reach past the `clients` row (2026-09-30).
//
// WHY THIS FILE EXISTS — the 10 Summers case. Dijon McFarlane (Mustard's legal
// name) was filed as the label's A&R: on the label's own fname/lname (its
// "primary rep"), as an A&R contact card, and copied onto 7 leads plus their
// sessions and work orders. Nobody could fix it from the app:
//   • the label profile had no field for the primary rep at all, and
//   • any name save on the label re-pushed that hidden rep onto EVERY linked
//     lead / session / WO (propagateClientRename's old label branch), so a lead
//     fixed by hand reverted the next time anyone touched the label.
//
// Two rules now:
//   1. A rep change REPLACES THE OLD SPELLING where it appears — it never
//      stamps the new rep over every record. A label has several A&Rs; a lead
//      run by one of them must not be rewritten because the primary changed.
//   2. "Move to artists" (a person filed as a contact who is actually the
//      artist) re-points everything that named or linked that contact to the
//      primary rep, then removes the card. The name goes on the roster via the
//      caller's client save, not here, so the roster is written once.
import { supabase, ClientContact } from '@/lib/supabase'
import { dbResult } from '@/lib/db'

export const fullName = (fname: string | null | undefined, lname: string | null | undefined): string =>
  [fname, lname].map(s => (s || '').trim()).filter(Boolean).join(' ')

export interface PersonName { fname: string | null; lname: string | null }

/**
 * Replace one person's name with another on every record linked to this
 * client that stored a COPY of it: leads (fname/lname), sessions
 * (client_name / ordered_by) and work orders (client / ordered_by).
 * Exact-match only — anything spelled differently was typed by someone on
 * purpose and is left alone. Returns the number of rows touched, or -1 on a
 * failed write (already reported by dbResult).
 */
export async function replacePersonOnRecords(clientId: string, from: PersonName, to: PersonName): Promise<number> {
  const oldName = fullName(from.fname, from.lname)
  const newName = fullName(to.fname, to.lname)
  if (!oldName || !newName || oldName === newName) return 0
  let n = 0

  const { data: ld, error: ldErr } = await supabase
    .from('leads')
    .update({ fname: (to.fname || '').trim(), lname: (to.lname || '').trim() })
    .eq('client_id', clientId)
    .eq('fname', (from.fname || '').trim())
    .eq('lname', (from.lname || '').trim())
    .select('id')
  if (!dbResult('Updating linked leads', ldErr)) return -1
  n += (ld || []).length

  for (const col of ['client_name', 'ordered_by'] as const) {
    const { data, error } = await supabase
      .from('bookings').update({ [col]: newName })
      .eq('client_id', clientId).eq(col, oldName).select('id')
    if (!dbResult('Updating linked sessions', error)) return -1
    n += (data || []).length
  }
  for (const col of ['client', 'ordered_by'] as const) {
    const { data, error } = await supabase
      .from('work_orders').update({ [col]: newName })
      .eq('client_id', clientId).eq(col, oldName).select('id')
    if (!dbResult('Updating linked work orders', error)) return -1
    n += (data || []).length
  }
  return n
}

/**
 * Point every lead / session / work order that links `fromId` at `toId`
 * (null = unlink). Covers the A&R link and, on sessions and WOs, the admin
 * link (which is never re-pointed to a rep — it is cleared).
 */
export async function relinkContact(fromId: string, toId: string | null): Promise<boolean> {
  for (const table of ['leads', 'bookings', 'work_orders'] as const) {
    const { error } = await supabase.from(table).update({ anr_contact_id: toId }).eq('anr_contact_id', fromId)
    if (!dbResult(`Re-linking ${table}`, error)) return false
  }
  for (const table of ['bookings', 'work_orders'] as const) {
    const { error } = await supabase.from(table).update({ anr_admin_contact_id: null }).eq('anr_admin_contact_id', fromId)
    if (!dbResult(`Re-linking ${table}`, error)) return false
  }
  return true
}

/**
 * "Move to artists": the contact was really the artist. Re-point its links
 * and its name to the primary rep (when there is one), then delete the card.
 * The caller adds the name to the roster in the same save as the client row.
 */
export async function moveContactToArtists(clientId: string, contact: ClientContact, rep: ClientContact | null): Promise<number> {
  if (!(await relinkContact(contact.id, rep?.id ?? null))) return -1
  let n = 0
  if (rep) {
    n = await replacePersonOnRecords(clientId, contact, rep)
    if (n < 0) return -1
  }
  const { error } = await supabase.from('client_contacts').delete().eq('id', contact.id)
  if (!dbResult('Removing contact', error)) return -1
  return n
}

/** Remove a contact card: unlink it everywhere first (names on records stay). */
export async function removeContact(contactId: string): Promise<boolean> {
  if (!(await relinkContact(contactId, null))) return false
  const { error } = await supabase.from('client_contacts').delete().eq('id', contactId)
  return dbResult('Removing contact', error)
}
