'use client'

/**
 * /dev-style — CARVED DESIGN SYSTEM STYLE GUIDE
 * docs/PRSFLO-DESIGN-SPEC.md §1 step 3. Every primitive and every state, in both
 * themes, so the system can be approved on a preview URL before any real surface
 * is migrated.
 *
 * The primitives themselves carry zero inline styles — that is the point. The
 * inline styles on THIS page are demo-harness layout only (grid gaps, spacing).
 * It is a workbench, not a migrated surface; do not copy its patterns.
 */
import React, { useEffect, useState } from 'react'
import {
  Surface, Button, SoftButton, Input, Panel, StatusPill, StatusDot, Count,
  RoomCard, EventChip, Row, Table, TableHead, TableRow, Modal, NewLeadPulse,
  type CarvedStatus,
} from '@/components/carved'
import SectionHeader from '@/components/ui/SectionHeader'
import StatusBadge from '@/components/ui/StatusBadge'

const STATUSES: { slot: CarvedStatus; label: string; means: string }[] = [
  { slot: 'hot', label: 'Hot', means: 'Hot lead · urgent · cancelled session' },
  { slot: 'warm', label: 'Warm', means: 'Warm lead · tentative session' },
  { slot: 'cold', label: 'Cold', means: 'Cold lead' },
  { slot: 'booked', label: 'Booked', means: 'Booked · confirmed · live room' },
  { slot: 'uncon', label: 'Uncon', means: 'Uncontacted · tour' },
  { slot: 'dead', label: 'DNB', means: 'DNB · tech · open hours' },
]

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={{ margin: '56px 0' }}>
      <h2 className="c-label" style={{ marginBottom: 6, letterSpacing: '0.14em' }}>{title}</h2>
      {note && <p className="c-sub" style={{ marginBottom: 18, maxWidth: 620 }}>{note}</p>}
      {children}
    </section>
  )
}

function Rowify({ children, gap = 8 }: { children: React.ReactNode; gap?: number }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap, alignItems: 'center' }}>{children}</div>
}

export default function DevStylePage() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [modalOpen, setModalOpen] = useState(false)
  const [toggled, setToggled] = useState(true)
  const [text, setText] = useState('')

  // Read the live theme on mount so the toggle starts in sync with the app.
  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark')
  }, [])

  // Flip data-theme exactly the way Nav.tsx does — dark is the ABSENCE of the
  // attribute. Deliberately does NOT write localStorage: this is a preview
  // control, and it shouldn't change the theme the rest of the app remembers.
  function flip() {
    const next = theme === 'light' ? 'dark' : 'light'
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
    setTheme(next)
  }

  return (
    <Surface>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px 120px' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <h1 className="c-arch" style={{ fontSize: 34, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
              Carved<br />Design System
            </h1>
            <p className="c-sub" style={{ marginTop: 10, maxWidth: 620 }}>
              Every primitive and state, both registers. Containers carve in, controls
              raise out and press in. Colour is status and nothing else — there is no
              accent colour in this system.
            </p>
          </div>
          <Button onClick={flip}>{theme === 'light' ? 'View dark' : 'View light'}</Button>
        </div>

        {/* TOKENS ─────────────────────────────────────────────────────────── */}
        <Block
          title="Tokens"
          note="The whole palette. Status colours are identical in both themes — dark dims them by rule, never by substituting a second palette."
        >
          <Rowify gap={10}>
            {STATUSES.map((s) => (
              <div key={s.slot} style={{ width: 150 }}>
                <div className={`c-pool c-fill-${s.slot}`} style={{ height: 54, borderRadius: 18 }} />
                <div className="c-label" style={{ marginTop: 7 }}>{s.label}</div>
                <div className="c-sub" style={{ fontSize: 11 }}>{s.means}</div>
              </div>
            ))}
          </Rowify>
        </Block>

        {/* TYPOGRAPHY ─────────────────────────────────────────────────────── */}
        <Block
          title="Typography"
          note="Archivo Black for display (always weight 400, never bolded), Inter for UI, DM Mono for code-like things. The scale gap is the style: big display with negative tracking, tiny tracked-out labels, little in between."
        >
          <div className="c-arch" style={{ fontSize: 40, letterSpacing: '-0.03em' }}>Paramount Recording</div>
          <div className="c-arch" style={{ fontSize: 22, letterSpacing: '-0.02em', marginTop: 4 }}>Skilla Baby</div>
          <p style={{ marginTop: 12, maxWidth: 620 }}>
            Inter body copy. Mixed case for greetings and heads — the all-caps shout was
            deliberately retired for comfort.
          </p>
          <div className="c-label" style={{ marginTop: 12 }}>Small label · uppercase · tracked out</div>
          <div className="c-mono" style={{ marginTop: 6 }}>WO-1007 · 8:00 PM–4:00 AM · 1ST-LR</div>
        </Block>

        {/* CONTROLS ───────────────────────────────────────────────────────── */}
        <Block
          title="Controls — raised, press in"
          note="Hold any of these to feel the press: it depresses into the material. Primary is an ink fill in light, ivory in dark (Law 5 — only small elements may be ivory)."
        >
          <Rowify>
            <Button>Start booking</Button>
            <Button onClick={() => setModalOpen(true)}>Open modal</Button>
            <SoftButton>Send reg</SoftButton>
            <SoftButton>Call</SoftButton>
            <SoftButton on={toggled} onClick={() => setToggled(!toggled)}>
              {toggled ? 'Toggled on' : 'Toggled off'}
            </SoftButton>
          </Rowify>
        </Block>

        {/* INPUTS ─────────────────────────────────────────────────────────── */}
        <Block
          title="Inputs — carved in"
          note="Focus is a depth change, not an outline. Click into one: the fill lifts to wash2, with no border and no ring."
        >
          <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
            <Input placeholder="Search client name…" value={text} onChange={setText} />
            <Input placeholder="Assistant (optional)" />
          </div>
        </Block>

        {/* STATUS ─────────────────────────────────────────────────────────── */}
        <Block
          title="Status — the only colour"
          note="Always a solid fill with chip ink, never coloured text on paper and never an outline. Hot is the exception: pale text for punch."
        >
          <Rowify>
            {STATUSES.map((s) => <StatusPill key={s.slot} status={s.slot} label={s.label} />)}
          </Rowify>
          <Rowify gap={16}>
            <span style={{ marginTop: 18, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {STATUSES.map((s) => (
                <span key={s.slot} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <StatusDot status={s.slot} />
                  <span className="c-label" style={{ opacity: 0.85 }}>{s.label}</span>
                </span>
              ))}
            </span>
          </Rowify>
          <Rowify gap={8}>
            <span style={{ marginTop: 18, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Count>1</Count><Count>12</Count><Count>1725</Count>
              <span className="c-sub" style={{ marginLeft: 6 }}>count badges</span>
            </span>
          </Rowify>
        </Block>

        {/* PANELS ─────────────────────────────────────────────────────────── */}
        <Block
          title="Panels — carved containers"
          note="The container is a hole in the material; its header is a capsule lozenge resting on the surface. No borders anywhere — grouping comes from the carve."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <Panel title="Needs action" action={{ label: 'View all →' }}>
              <Row>
                <NewLeadPulse />
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 13.5 }}>Marina Olszak</b>
                  <div className="c-sub">New · never contacted</div>
                </div>
                <StatusPill status="uncontacted" label="Uncon" />
              </Row>
              <Row>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 13.5 }}>Sesen Tsegab</b>
                  <div className="c-sub">Follow up now</div>
                </div>
                <StatusPill status="hot" label="Hot" />
              </Row>
              <Row selected>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 13.5 }}>Austin Bessey</b>
                  <div className="c-sub">Selected row — carved in, no colour</div>
                </div>
                <StatusPill status="warm" label="Warm" />
              </Row>
            </Panel>

            <Panel title="Tasks" count={1} action={{ label: 'Show all →' }}>
              <div className="c-inset2" style={{ borderRadius: 14, padding: '11px 14px', display: 'flex', gap: 9, alignItems: 'center' }}>
                <StatusDot status="warm" />
                <span style={{ fontSize: 13 }}>Vendor invoices need approval</span>
              </div>
            </Panel>
          </div>
        </Block>

        {/* ROOM CARDS ─────────────────────────────────────────────────────── */}
        <Block
          title="Room cards"
          note="Empty rooms are dim second-level cuts. Booked rooms are colored pools carved INTO the surface — they carry calendar status, so they carry colour."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 9 }}>
            <RoomCard room="Paramount A" />
            <RoomCard room="Paramount X" artist="Skilla Baby" meta="Interscope · 2P–10P" engineer="1ST-LR" status="booked" />
            <RoomCard room="Encore B" artist="Mustard" meta="10 Summers · 12P–12A" engineer="1ST-CU" status="booked" />
            <RoomCard room="Ameraycan A" artist="Hold" meta="Tentative" status="tentative" />
            <RoomCard room="Track North" artist="Camper" meta="DJ Camper" status="booked" />
            <RoomCard room="Track South" />
          </div>
        </Block>

        {/* EVENT CHIPS ────────────────────────────────────────────────────── */}
        <Block
          title="Calendar chips"
          note="Raised, solid status fill, Archivo title, mono engineer tag. In dark they become alpha fills so they sit in the room. Calendar LAYOUT is fenced off by spec §10 — this is chip styling only."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 9 }}>
            <EventChip title="UntilJapan" meta="Interscope · 8P–8A" engineer="1ST-LR" status="confirmed" />
            <EventChip title="Apollo Red" meta="Interscope · 8P–4A" status="tentative" />
            <EventChip title="TOUR" meta="Label walkthrough" status="tour" />
            <EventChip title="TECH" meta="9A–12P" status="tech" />
            <EventChip title="Dropped session" meta="Was 8P–2A" status="confirmed" cancelled />
          </div>
        </Block>

        {/* TABLE ──────────────────────────────────────────────────────────── */}
        <Block
          title="Table"
          note="Header is a lozenge; rows alternate carved and plain. No rules, no dividers — the alternation does the work."
        >
          <div className="c-panel">
            <Table>
              <TableHead
                template="1.2fr .7fr .7fr .7fr .5fr .7fr .8fr"
                columns={['Studio', 'Date', 'From', 'To', 'Hrs', 'Rate', 'Total']}
              />
              <TableRow template="1.2fr .7fr .7fr .7fr .5fr .7fr .8fr"
                cells={['PRS A', '7-3', '8:00 PM', '4:00 AM', '8h', '$175/hr', '$1,400.00']} />
              <TableRow template="1.2fr .7fr .7fr .7fr .5fr .7fr .8fr"
                cells={['PRS X', '7-4', '2:00 PM', '10:00 PM', '8h', '$175/hr', '$1,400.00']} />
              <TableRow template="1.2fr .7fr .7fr .7fr .5fr .7fr .8fr"
                cells={['1ST', '7-4', '2:00 PM', '10:00 PM', '8h', 'Engineer…', '—']} />
            </Table>
          </div>
        </Block>

        {/* EXTENDED LEGACY COMPONENTS ─────────────────────────────────────── */}
        <Block
          title="Extended components — legacy vs carved"
          note="SectionHeader and StatusBadge are extended, not duplicated (spec §8). Pass carved to opt in; every existing caller renders exactly as before."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            <div>
              <div className="c-label" style={{ marginBottom: 10 }}>Legacy (unchanged)</div>
              <SectionHeader title="Needs action" count={5} action={{ label: 'View all →' }} />
              <Rowify>
                <StatusBadge status="hot" />
                <StatusBadge status="booked" />
                <StatusBadge status="uncontacted" />
              </Rowify>
            </div>
            <div>
              <div className="c-label" style={{ marginBottom: 10 }}>Carved</div>
              <SectionHeader carved title="Needs action" count={5} action={{ label: 'View all →' }} />
              <Rowify>
                <StatusBadge carved status="hot" />
                <StatusBadge carved status="booked" />
                <StatusBadge carved status="uncontacted" />
              </Rowify>
            </div>
          </div>
        </Block>

        {/* PULSE ──────────────────────────────────────────────────────────── */}
        <Block
          title="New-lead pulse"
          note="The only animated element in the entire app. No new colour — the system's own ink in light, soft white in dark. Nothing else may pulse. Honours prefers-reduced-motion."
        >
          <Rowify gap={12}>
            <NewLeadPulse />
            <span className="c-sub">New · never contacted</span>
          </Rowify>
        </Block>

        <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
          <h3 className="c-arch" style={{ fontSize: 24, letterSpacing: '-0.02em', marginBottom: 8 }}>
            Carved modal
          </h3>
          <p className="c-sub" style={{ marginBottom: 18 }}>
            A carved panel floating on the one permitted outer shadow. Everything
            inside follows the same laws — no borders, controls raised.
          </p>
          <Input placeholder="Type something…" />
          <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
            <SoftButton onClick={() => setModalOpen(false)}>Cancel</SoftButton>
            <Button onClick={() => setModalOpen(false)}>Save</Button>
          </div>
        </Modal>
      </div>
    </Surface>
  )
}
