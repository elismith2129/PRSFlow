// Propagate a client / A&R rename out to the records that denormalize that name.
//
// `bookings` and `leads` both store copies of client-facing names (bookings:
// client_name / label / ordered_by; leads: label / fname / lname) rather than
// joining on client_id every render. That's deliberate — those surfaces need to
// render fast and legacy rows predate the FK — but it means fixing a spelling on
// the client profile used to leave the old spelling on every calendar chip,
// work order and lead that already referenced it.
//
// This module is the one place that reconciliation lives. It only ever rewrites
// NAME fields:
//   • Artist is NOT propagated — a label's bookings each have their own artist,
//     so pushing the client-level artist over them would destroy real data.
//   • Contact details (email/phone) are NOT propagated — a booking records who
//     was reachable at the time it was made.
//
// Work orders need no pass of their own: they read the client through the
// booking, so a booking update carries into the WO and its printed invoice.
import { supabase, Client, ClientContact } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { toast } from '@/components/ui/Toaster'

const fullName = (fname: string | null | undefined, lname: string | null | undefined): string =>
  [fname, lname].map(s => (s || '').trim()).filter(Boolean).join(' ')

// True when a patch actually touches a name field. Callers pass their whole
// update payload; there's no point querying for an email-only edit.
function touchesName(changed: Partial<Client> | Partial<ClientContact>): boolean {
  return 'name' in changed || 'fname' in changed || 'lname' in changed
}

/**
 * Push a client rename onto every booking and lead linked by client_id.
 *
 * A LABEL client's `name` is the label itself (bookings.label / leads.label),
 * while its fname/lname are the primary A&R (bookings.client_name — which is
 * what the label branch of the calendar's lead-conversion writes).
 * An INDIVIDUAL client's `name` is the person (bookings.client_name), and their
 * first/last map onto the lead's own first/last.
 *
 * `after` must be the client as it now exists (post-update), not the old row.
 */
export async function propagateClientRename(after: Client, changed: Partial<Client>): Promise<void> {
  if (!after?.id || !touchesName(changed)) return

  const isLabel = after.type === 'label'
  const bookingPatch: Record<string, string> = {}
  const leadPatch: Record<string, string> = {}

  if (isLabel) {
    if (after.name) {
      bookingPatch.label = after.name
      leadPatch.label = after.name
    }
    // The label's own fname/lname are its primary A&R contact.
    const anr = fullName(after.fname, after.lname)
    if (anr && ('fname' in changed || 'lname' in changed)) {
      bookingPatch.client_name = anr
      leadPatch.fname = (after.fname || '').trim()
      leadPatch.lname = (after.lname || '').trim()
    }
  } else {
    const person = after.name || fullName(after.fname, after.lname)
    if (person) bookingPatch.client_name = person
    if ('fname' in changed || 'lname' in changed) {
      // Normal path — the profile edits First and Last directly and saves them
      // alongside the combined `name`, so the lead gets both halves verbatim.
      leadPatch.fname = (after.fname || '').trim()
      leadPatch.lname = (after.lname || '').trim()
    } else if ('name' in changed && person) {
      // Fallback for any caller that still writes a combined name only (legacy
      // rows, imports, registration-created clients). Leads keep first and last
      // in separate columns, so split on the first space — the same convention
      // the new-lead form uses when it parses a typed A&R name.
      const parts = person.trim().split(/\s+/).filter(Boolean)
      leadPatch.fname = parts[0] || ''
      leadPatch.lname = parts.slice(1).join(' ')
    }
  }

  let updated = 0

  if (Object.keys(bookingPatch).length > 0) {
    const { data, error } = await supabase
      .from('bookings')
      .update(bookingPatch)
      .eq('client_id', after.id)
      .select('id')
    if (!dbResult('Updating linked sessions', error)) return
    updated += (data || []).length
  }

  if (Object.keys(leadPatch).length > 0) {
    const { data, error } = await supabase
      .from('leads')
      .update(leadPatch)
      .eq('client_id', after.id)
      .select('id')
    if (!dbResult('Updating linked leads', error)) return
    updated += (data || []).length
  }

  if (updated > 0) {
    toast(`Name updated on ${updated} linked record${updated === 1 ? '' : 's'}.`, 'success')
  }
}

/**
 * Push an A&R contact rename onto the bookings and leads that point at that
 * contact via anr_contact_id. For a label booking, `client_name` holds the A&R's
 * name and `ordered_by` holds who placed the order — both track this contact.
 *
 * `after` must be the contact as it now exists (post-update).
 */
export async function propagateContactRename(after: ClientContact, changed: Partial<ClientContact>): Promise<void> {
  if (!after?.id || !touchesName(changed)) return

  const name = fullName(after.fname, after.lname)
  if (!name) return

  let updated = 0

  const { data: bk, error: bkErr } = await supabase
    .from('bookings')
    .update({ client_name: name, ordered_by: name })
    .eq('anr_contact_id', after.id)
    .select('id')
  if (!dbResult('Updating linked sessions', bkErr)) return
  updated += (bk || []).length

  const { data: ld, error: ldErr } = await supabase
    .from('leads')
    .update({ fname: (after.fname || '').trim(), lname: (after.lname || '').trim() })
    .eq('anr_contact_id', after.id)
    .select('id')
  if (!dbResult('Updating linked leads', ldErr)) return
  updated += (ld || []).length

  if (updated > 0) {
    toast(`Contact name updated on ${updated} linked record${updated === 1 ? '' : 's'}.`, 'success')
  }
}
