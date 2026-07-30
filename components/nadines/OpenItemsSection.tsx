'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Nadine's → Open Items.
//
// The five unresolved items from §5 of the venue brief. Item definitions come
// from lib/nadines.ts (code); only status/owner/notes live in Supabase
// (`venue_open_items`), keyed by `item_key`. An item with no row yet reads as
// 'open', so the table starts empty and needs no seed.
//
// Three of the five are flagged `blocksExternalClaims` — rigging, courtyard
// capacity and alcohol. This page is internal so the items are shown in full;
// the flag exists to stop the figures being lifted off this page onto a rate
// sheet or a sponsor deck before the determination lands.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  OPEN_ITEMS,
  OPEN_ITEM_STATUSES,
  type OpenItemStatus,
  type VenueOpenItem,
} from '@/lib/nadines'

// First letter of display_name's first word + first letter of its last word,
// uppercased. NOTE: this is a verbatim third copy — the same function already
// exists locally in components/admin/MicInventorySection.tsx and
// app/(main)/crm/page.tsx. It is duplicated rather than imported because there is
// no lib/initials.ts to import from; extracting one is a worthwhile cleanup but
// touching crm/page.tsx wasn't in scope for this change.
function profileInitials(displayName: string | null | undefined): string {
  if (!displayName) return ''
  const words = displayName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const first = words[0][0] || ''
  const last = words.length > 1 ? words[words.length - 1][0] || '' : ''
  return (first + last).toUpperCase()
}

const STATUS_LABELS: Record<OpenItemStatus, string> = {
  open: 'Open',
  in_progress: 'Chasing',
  resolved: 'Resolved',
}

export function OpenItemsSection() {
  const { profile } = useUserProfile()
  const isMobile = useIsMobile()
  // tech and runner are read-only everywhere else in the app; keep that here.
  const canEdit =
    !!profile && ['owner', 'manager', 'billing', 'asst_manager'].includes(profile.role)

  const [rows, setRows] = useState<Record<string, VenueOpenItem>>({})
  const [loading, setLoading] = useState(true)
  const [draftNote, setDraftNote] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('venue_open_items').select('*')
    if (!dbResult('Loading open items', error)) {
      setLoading(false)
      return
    }
    const byKey: Record<string, VenueOpenItem> = {}
    for (const r of (data as VenueOpenItem[]) || []) byKey[r.item_key] = r
    setRows(byKey)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    // Standing architecture rule: pair every Supabase fetch with a realtime
    // subscription. Channel names must be unique across the app.
    const channel = supabase
      .channel('venue-open-items')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'venue_open_items' },
        () => { load() },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  async function save(itemKey: string, patch: Partial<VenueOpenItem>) {
    if (!canEdit) return
    const existing = rows[itemKey]
    const definition = OPEN_ITEMS.find(i => i.key === itemKey)
    // Use `in` rather than `??` to decide whether a field was supplied. With `??`,
    // an explicit `{ notes: null }` (the user clearing the box) falls through to
    // the existing value and the note can never be deleted — the same class of bug
    // as a falsy check swallowing a deliberate zero.
    const next = {
      item_key: itemKey,
      status: 'status' in patch ? patch.status! : existing?.status ?? 'open',
      owner: 'owner' in patch ? patch.owner : existing?.owner ?? definition?.owner ?? null,
      notes: 'notes' in patch ? patch.notes : existing?.notes ?? null,
      updated_at: new Date().toISOString(),
      updated_by: profile?.initials || profileInitials(profile?.display_name || ''),
    }
    const { error } = await supabase
      .from('venue_open_items')
      .upsert(next, { onConflict: 'item_key' })
    if (!dbResult('Saving open item', error)) return
    // Drop the local draft so the saved row becomes the single source for this
    // field again — otherwise the stale draft keeps masking realtime updates
    // another staff member makes to the same note.
    if ('notes' in patch) setDraftNote(d => { const { [itemKey]: _drop, ...rest } = d; return rest })
    load()
  }

  const blocking = OPEN_ITEMS.filter(
    i => i.blocksExternalClaims && (rows[i.key]?.status ?? 'open') !== 'resolved',
  ).length

  return (
    <div style={{ maxWidth: 760 }}>
      <SectionHeader
        title="Open items"
        count={OPEN_ITEMS.filter(i => (rows[i.key]?.status ?? 'open') !== 'resolved').length}
        countColor="orange"
      />

      {/* The standing warning from the brief, stated once at the top rather than
          repeated per item. Disappears on its own once all three close. */}
      {blocking > 0 && (
        <div
          style={{
            marginBottom: 20,
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid rgba(var(--accent-rgb), 0.35)',
            background: 'rgba(var(--accent-rgb), 0.07)',
            fontFamily: 'Inter',
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--text2)',
          }}
        >
          <strong style={{ color: 'var(--text)' }}>
            {blocking} unresolved item{blocking === 1 ? '' : 's'} block{blocking === 1 ? 's' : ''} external claims.
          </strong>{' '}
          Nothing about rigging capacity, courtyard capacity or alcohol goes into a
          rate sheet, a booker quote or a sponsor deck until the determination is in
          hand and the item is marked resolved here.
        </div>
      )}

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontFamily: 'Inter', fontSize: 11 }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {OPEN_ITEMS.map(item => {
            const row = rows[item.key]
            const status: OpenItemStatus = row?.status ?? 'open'
            const owner = row?.owner ?? item.owner
            const resolved = status === 'resolved'
            return (
              <div
                key={item.key}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderLeft: item.blocksExternalClaims && !resolved
                    ? '3px solid var(--warm)'
                    : '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 16,
                  opacity: resolved ? 0.6 : 1,
                  transition: 'opacity 0.15s ease',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: isMobile ? 'flex-start' : 'center',
                    flexDirection: isMobile ? 'column' : 'row',
                    gap: 8,
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'Syne',
                      fontWeight: 700,
                      fontSize: 14,
                      color: 'var(--text)',
                      textDecoration: resolved ? 'line-through' : 'none',
                    }}
                  >
                    {item.title}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: isMobile ? 0 : 'auto' }}>
                    {item.blocksExternalClaims && !resolved && (
                      <span
                        style={{
                          fontFamily: 'Inter',
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--warm)',
                          border: '1px solid var(--warm)',
                          borderRadius: 4,
                          padding: '2px 6px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Do not publish
                      </span>
                    )}
                    <StatusBadge status={status} />
                  </div>
                </div>

                <p
                  style={{
                    margin: '0 0 12px',
                    fontFamily: 'Inter',
                    fontSize: 12,
                    lineHeight: 1.65,
                    color: 'var(--text2)',
                  }}
                >
                  {item.detail}
                </p>

                <div
                  style={{
                    fontFamily: 'Inter',
                    fontSize: 11,
                    color: 'var(--text3)',
                    marginBottom: canEdit ? 12 : 0,
                  }}
                >
                  With: <span style={{ color: 'var(--text2)' }}>{owner}</span>
                  {row?.updated_at && (
                    <>
                      {' · updated '}
                      {new Date(row.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {row.updated_by ? ` by ${row.updated_by}` : ''}
                    </>
                  )}
                </div>

                {canEdit && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {OPEN_ITEM_STATUSES.map(s => (
                        <button
                          key={s}
                          onClick={() => save(item.key, { status: s })}
                          style={{
                            flex: isMobile ? 1 : undefined,
                            padding: '6px 12px',
                            fontFamily: 'Inter',
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            borderRadius: 5,
                            cursor: 'pointer',
                            border: status === s
                              ? '1px solid var(--accent)'
                              : '1px solid var(--border)',
                            background: status === s
                              ? 'rgba(var(--accent-rgb), 0.12)'
                              : 'transparent',
                            color: status === s ? 'var(--accent)' : 'var(--text3)',
                          }}
                        >
                          {STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={draftNote[item.key] ?? row?.notes ?? ''}
                      onChange={e => setDraftNote(d => ({ ...d, [item.key]: e.target.value }))}
                      onBlur={e => {
                        e.currentTarget.style.borderColor = 'var(--border)'
                        const typed = e.target.value.trim()
                        if (typed !== (row?.notes ?? '')) save(item.key, { notes: typed || null })
                      }}
                      placeholder="What came back — determination, date, who said it…"
                      rows={2}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        background: 'var(--surface2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '8px 10px',
                        fontFamily: 'Inter',
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: 'var(--text)',
                        outline: 'none',
                        resize: 'vertical',
                      }}
                      onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                    />
                  </div>
                )}

                {!canEdit && row?.notes && (
                  <p
                    style={{
                      margin: '10px 0 0',
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'var(--surface2)',
                      fontFamily: 'Inter',
                      fontSize: 12,
                      lineHeight: 1.55,
                      color: 'var(--text2)',
                    }}
                  >
                    {row.notes}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default OpenItemsSection
