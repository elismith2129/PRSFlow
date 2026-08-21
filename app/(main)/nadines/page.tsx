'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Nadine's — internal build-out hub.
//
// Scope of THIS page (phase 1): the permit-set spec so anyone can answer a
// booker's "does my show fit" question without opening a PDF, the configurations
// with their real capacities, the tracked open items, and the render/photo plates.
//
// Deliberately NOT here yet (phase 2+, each its own sub-chunk and branch):
// build-out checklists, cost/materials line items, and the contractor directory.
// Those are all write-heavy and need their own tables; this page is the shell
// they'll hang off. Tabs are the seam — add one per module.
//
// This is INTERNAL. It lives inside the (main) route group so it is behind
// AuthGuard and RLS. It is not the public venue page — the numbers on it include
// three items that must not appear in anything a booker or sponsor sees. See the
// Open Items tab.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useUserProfile } from '@/hooks/useUserProfile'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { OpenItemsSection } from '@/components/nadines/OpenItemsSection'
import { PlatesSection } from '@/components/nadines/PlatesSection'
import { VENUE, HARD_NUMBERS, ROOM_CHARACTER, CONFIGURATIONS } from '@/lib/nadines'

type Tab = 'spec' | 'room' | 'open-items' | 'plates'

const TABS: { key: Tab; label: string }[] = [
  { key: 'spec', label: 'Spec' },
  { key: 'room', label: 'The Room' },
  { key: 'open-items', label: 'Open Items' },
  { key: 'plates', label: 'Plates' },
]

export default function NadinesPage() {
  const [tab, setTab] = useState<Tab>('spec')
  const isMobile = useIsMobile()
  const { profile, loading } = useUserProfile()

  // Eli-only for now — matched on his accounts, the same gate the CRM Campaigns
  // tab and DEV → Errors use. (Two addresses because his PIN login is attached to
  // eli@paramountrecording.com, not the Gmail address.)
  //
  // This guards the page BODY so typing /nadines directly does nothing for other
  // staff; components/layout/Nav.tsx hides the nav item with the same check.
  // NEITHER IS A DATA BOUNDARY — the `venue_open_items` RLS policy still allows
  // any authenticated read and owner/manager/billing/asst_manager write, so a
  // staff member with the anon key could still reach the rows directly. If the
  // venue data needs to be genuinely restricted, that's a separate RLS migration.
  const isEli = profile?.email === 'eli@paramountrecording.com'

  // Render nothing at all until the profile resolves, so the page never flashes
  // its contents to a staff member before the gate closes.
  if (loading) return null

  if (!isEli) {
    return (
      <div
        style={{
          padding: '64px 32px',
          textAlign: 'center',
          fontFamily: 'Inter',
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        This page isn&rsquo;t available on your account.
      </div>
    )
  }

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px' }}>
      {/* Page header — venue identity and the regulatory facts that never change. */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'Syne',
            fontWeight: 800,
            fontSize: isMobile ? 24 : 30,
            letterSpacing: -0.5,
            color: 'var(--text)',
          }}
        >
          {VENUE.name}
        </h1>
        <div
          style={{
            marginTop: 6,
            fontFamily: 'Inter',
            fontSize: 12,
            color: 'var(--text3)',
            lineHeight: 1.6,
          }}
        >
          {VENUE.address}
          <br />
          {VENUE.building} · Occupancy {VENUE.occupancyGroup} · Type {VENUE.constructionType} · Zone {VENUE.zone}
        </div>
      </div>

      {/* Tabs. The seam for phase-2 modules — checklists, costs, contractors. */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          borderBottom: '1px solid var(--border)',
          marginBottom: 24,
          overflowX: isMobile ? 'auto' : undefined,
        }}
      >
        {TABS.map(t => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                fontFamily: 'Inter',
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                letterSpacing: '0.04em',
                color: active ? 'var(--text)' : 'var(--text3)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'spec' && <SpecTab />}
      {tab === 'room' && <RoomTab />}
      {tab === 'open-items' && <OpenItemsSection />}
      {tab === 'plates' && <PlatesSection />}
    </div>
  )
}

// ─── Spec ────────────────────────────────────────────────────────────────────
// Reads almost like a tech rider, per §7 of the brief: a booker is scanning for
// dimensions, clear height and occupant load. The three figures they check first
// are pulled out above the full table rather than buried in it.
function SpecTab() {
  const isMobile = useIsMobile()
  const headline = HARD_NUMBERS.filter(n => n.emphasis)

  return (
    <div style={{ maxWidth: 760 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gap: 12,
          marginBottom: 28,
        }}
      >
        {headline.map(n => (
          <div
            key={n.label}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 16,
            }}
          >
            <div
              style={{
                fontFamily: 'Inter',
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text3)',
                marginBottom: 8,
              }}
            >
              {n.label}
            </div>
            <div
              style={{
                fontFamily: 'Syne',
                fontWeight: 800,
                fontSize: 22,
                color: 'var(--accent)',
                lineHeight: 1.15,
              }}
            >
              {n.value}
            </div>
          </div>
        ))}
      </div>

      <SectionHeader title="Permit set" />
      <SpecTable
        rows={[
          { label: 'Permit', value: VENUE.permit },
          { label: 'Scope', value: VENUE.permitScope },
          { label: 'Occupancy group', value: VENUE.occupancyGroup },
          { label: 'Construction type', value: VENUE.constructionType },
          { label: 'Zone', value: VENUE.zone },
          { label: 'Code consultant', value: VENUE.codeConsultant },
          { label: 'Structural engineer', value: `${VENUE.structuralEngineer} · job ${VENUE.structuralJobNumber}` },
        ]}
      />

      <div style={{ height: 28 }} />

      <SectionHeader title="Hard numbers" />
      <p
        style={{
          margin: '-4px 0 12px',
          fontFamily: 'Inter',
          fontSize: 11,
          lineHeight: 1.6,
          color: 'var(--text3)',
        }}
      >
        Code numbers from the approved permit set, not estimates. Use verbatim — a production
        manager will hold us to them.
      </p>
      <SpecTable rows={HARD_NUMBERS} />
    </div>
  )
}

function SpecTable({ rows }: { rows: { label: string; value: string; note?: string }[] }) {
  const isMobile = useIsMobile()
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {rows.map((row, i) => (
        <div
          key={row.label}
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: isMobile ? 2 : 16,
            padding: '11px 14px',
            borderTop: i === 0 ? 'none' : '1px solid var(--border)',
          }}
        >
          <div
            style={{
              flex: isMobile ? undefined : '0 0 200px',
              fontFamily: 'Inter',
              fontSize: 11,
              color: 'var(--text3)',
              paddingTop: isMobile ? 0 : 1,
            }}
          >
            {row.label}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'Inter', fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5 }}>
              {row.value}
            </div>
            {row.note && (
              <div
                style={{
                  marginTop: 3,
                  fontFamily: 'Inter',
                  fontSize: 11,
                  color: 'var(--text3)',
                  lineHeight: 1.5,
                }}
              >
                {row.note}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── The Room ────────────────────────────────────────────────────────────────
// §3 and §4 of the brief. The character copy is the marketing asset; the
// configurations are what a booker matches their show against.
function RoomTab() {
  const isMobile = useIsMobile()

  return (
    <div style={{ maxWidth: 760 }}>
      <SectionHeader title="Positioning" />
      <p
        style={{
          margin: '0 0 24px',
          fontFamily: 'DM Serif Display',
          fontSize: isMobile ? 17 : 19,
          lineHeight: 1.5,
          color: 'var(--text)',
        }}
      >
        {ROOM_CHARACTER.positioning}
      </p>

      <SectionHeader title="The room" />
      <ul
        style={{
          margin: '0 0 24px',
          paddingLeft: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
        }}
      >
        {ROOM_CHARACTER.features.map(f => (
          <li
            key={f}
            style={{ fontFamily: 'Inter', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text2)' }}
          >
            {f}
          </li>
        ))}
      </ul>

      <SectionHeader title="Courtyard" />
      <div
        style={{
          marginBottom: 24,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 16,
        }}
      >
        <p style={{ margin: 0, fontFamily: 'Inter', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text2)' }}>
          {ROOM_CHARACTER.courtyard.summary}
        </p>
        <p
          style={{
            margin: '12px 0 0',
            paddingTop: 12,
            borderTop: '1px solid var(--border)',
            fontFamily: 'Inter',
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--warm)',
          }}
        >
          {ROOM_CHARACTER.courtyard.caveat}
        </p>
      </div>

      <SectionHeader title="Configurations" count={CONFIGURATIONS.filter(c => !c.pending).length} countColor="teal" />
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {CONFIGURATIONS.map((c, i) => (
          <div
            key={c.mode}
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              gap: isMobile ? 2 : 16,
              padding: '11px 14px',
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
              opacity: c.pending ? 0.55 : 1,
            }}
          >
            <div
              style={{
                flex: isMobile ? undefined : '0 0 200px',
                fontFamily: 'Inter',
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--text)',
              }}
            >
              {c.mode}
            </div>
            <div
              style={{
                flex: 1,
                fontFamily: 'Inter',
                fontSize: 12,
                lineHeight: 1.5,
                color: c.pending ? 'var(--warm)' : 'var(--text2)',
              }}
            >
              {c.notes}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
