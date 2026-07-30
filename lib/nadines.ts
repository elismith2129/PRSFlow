// ─────────────────────────────────────────────────────────────────────────────
// Nadine's — venue build-out reference data.
//
// WHY THIS IS IN CODE AND NOT THE DATABASE (same reasoning as lib/testBatches.ts):
// everything in this file comes off the approved permit set. It is a transcription
// of a stamped drawing, not user data. It changes only when a revised set is
// issued — which is a commit, not a form submission. Putting it in Supabase would
// buy a migration and an editing UI for content nobody should be free-typing, and
// would let the numbers drift away from the drawings they came from.
//
// The ONE thing here that is genuinely data is the *status* of each open item
// (§5 of the venue brief) — those change as determinations come back from the
// engineer, the code consultant and counsel. So OPEN_ITEMS below defines the
// items (stable, in code, keyed by `key`) and the `venue_open_items` table holds
// only the mutable status/owner/notes per key. See
// supabase/migrations/20260729130000_venue_open_items.sql.
//
// DO NOT round, restate or "clean up" the figures. They are code numbers from
// LADBS permit 26016-10000-03929, not estimates, and they are what a booker's
// production manager will hold us to.
// ─────────────────────────────────────────────────────────────────────────────

/** Identity + regulatory facts. From §1 of the venue brief. */
export const VENUE = {
  name: "Nadine's",
  address: '6249 W Santa Monica Blvd, Los Angeles, CA 90038',
  building: '1947 brick warehouse, two storey with mezzanine',
  permit: 'LADBS 26016-10000-03929',
  permitScope:
    'T.I. and change of use — adult TV/radio school → multi media studio / banquet hall',
  occupancyGroup: 'A-2',
  // Sheet A1 says III-A, sheet A2.2 says III-B. III-A is what §1 of the brief
  // carries, so it is what we show — but the conflict is unresolved and tracked
  // as open item `drawing-set-conflicts`. Do not quote this to a fire marshal
  // until that closes.
  constructionType: 'III-A',
  zone: '[Q]C2-2D-CPIO (Hollywood CPIO, Corridor 2)',
  codeConsultant: 'Design & Code Consultants, Sherman Oaks',
  structuralEngineer: 'Peter T. Erdelyi & Assoc.',
  structuralJobNumber: 'IVRA-011-26:00',
} as const

/**
 * The hard numbers — §2 of the brief, verbatim.
 * `emphasis` marks the three figures a booker checks first.
 */
export const HARD_NUMBERS: {
  label: string
  value: string
  emphasis?: boolean
  note?: string
}[] = [
  { label: 'Total occupant load', value: '230', emphasis: true, note: 'Whole building, all spaces. Interior only.' },
  { label: 'Building gross', value: '3,920 sq ft' },
  { label: 'Main hall (banquet)', value: '1,903 sq ft · 126 occupants' },
  { label: 'Dance floor', value: '341 sq ft · 49 occupants' },
  { label: 'Conference room', value: '489 sq ft · 32 occupants' },
  { label: 'Lobby', value: '129 sq ft · 18 occupants' },
  { label: 'Mezzanine offices', value: "263 sq ft and 217 sq ft" },
  { label: 'Interior hall dimensions', value: `79'-6" long × 45'-3" wide`, emphasis: true },
  { label: 'Clear height to truss soffit', value: `11'-10"`, emphasis: true, note: 'The number that kills lighting packages — lead with it.' },
  { label: 'Building height', value: `16'-8"` },
  { label: 'Restrooms', value: 'Men 2 WC / 1 urinal / 1 lav · Women 3 WC / 1 lav' },
  { label: 'Accessible seating', value: '5 positions provided' },
  { label: 'Fire protection', value: 'NFPA 13 sprinklers throughout, new fire alarm' },
  { label: 'Assistive listening', value: 'Required and provided (A-2 assembly)' },
  { label: 'Parking', value: 'Zero — exempt under AB 2097 (within ½ mile of major transit)' },
]

/** §3 — the room's character. This is the marketing asset; lead with it. */
export const ROOM_CHARACTER = {
  positioning: 'Industrial bones with old-Hollywood glamour. Deliberately not a black-box venue.',
  features: [
    'Four exposed heavy-timber bowstring trusses — curved top chords in warm Douglas fir, dark riveted steel gusset plates at the panel points',
    'Roof deck between the trusses is matte black',
    'Side walls exposed unpainted red brick, aged, with visible mortar repairs',
    'Exposed round galvanized spiral ductwork along both brick walls below the truss line',
    'Crystal empire chandeliers hung on chains from the truss bottom chords',
    'Polished concrete floor',
    'Mezzanine levels at both ends with black steel cable railings',
  ],
  courtyard: {
    summary:
      'Enclosed, gated, finished. White painted brick perimeter, overlapping tan shade sails, dark sealed concrete with a circular scored pattern and in-ground uplights.',
    // The 230 occupant load is interior only. Whether the courtyard can legally
    // hold guests is a separate entitlement question — see open item
    // `courtyard-assembly`.
    caveat:
      'Finished and photographs well, but NOT cleared as assembly space. Treat as aesthetic only until the entitlement question closes — quote no courtyard capacity.',
  },
} as const

/** §4 — configurations to feature, with the real capacities where we have them. */
export const CONFIGURATIONS: { mode: string; notes: string; pending?: boolean }[] = [
  { mode: 'Seated theater', notes: 'Rows facing a stage at one end' },
  { mode: 'Cabaret / comedy', notes: 'Round two- and four-tops, small corner stage' },
  { mode: 'Banquet dinner', notes: 'Round ten-tops — 81 seats at rounds per plan' },
  { mode: 'Standing show', notes: 'Open floor' },
  { mode: 'Band rehearsal', notes: 'Open floor, backline along one brick wall' },
  { mode: 'Ceremony', notes: 'Centre aisle, installation at far end' },
  { mode: 'Courtyard reception', notes: 'Pending entitlement check — not bookable', pending: true },
]

/**
 * §5 — open items. STABLE KEYS: `key` is half the identity of the matching
 * `venue_open_items` row, so never rename one after a status has been recorded
 * or that status is orphaned (same rule as test-batch item ids).
 *
 * `blocksExternalClaims` marks the three items that must not appear in anything
 * a booker or sponsor sees until they close. This page is internal, so the items
 * themselves are shown in full — the flag is what stops the numbers being lifted
 * off this page onto a rate sheet or a deck by someone who didn't read the brief.
 */
export const OPEN_ITEMS: {
  key: string
  title: string
  detail: string
  owner: string
  blocksExternalClaims: boolean
}[] = [
  {
    key: 'rigging-capacity',
    title: 'Rigging capacity',
    detail:
      'Four existing bowstring trusses, 1947. Crystal chandeliers are already hung from the bottom chords. Written determination requested from Erdelyi for allowable point loads at panel points. Until it lands: make no rigging claims and quote no hanging weights. Bowstring trusses have a poor reputation for point loads — plan for ground-supported towers as the fallback.',
    owner: 'Peter T. Erdelyi & Assoc.',
    blocksExternalClaims: true,
  },
  {
    key: 'courtyard-assembly',
    title: 'Courtyard as assembly space',
    detail:
      'The 230 occupant load covers interior only. The approved set states no changes to parking, landscape or site improvements. Whether the courtyard can legally hold guests is a separate entitlement question. Verify with DCC before it appears as programmable square footage.',
    owner: 'Design & Code Consultants',
    blocksExternalClaims: true,
  },
  {
    key: 'alcohol',
    title: 'Alcohol',
    detail:
      'Zoning report shows Alcohol Sales Program: No, and the site is in an active 500-ft school zone (Vine Street Early Education Center). Not entitled. Land-use counsel before promising anything to a beverage sponsor.',
    owner: 'Land-use counsel',
    blocksExternalClaims: true,
  },
  {
    key: 'drawing-set-conflicts',
    title: 'Drawing-set inconsistencies',
    detail:
      'Sheet A1 says Type III-A, A2.2 says III-B. Sheet A2.2 carries a title block for a Long Beach single-family dwelling; A10 references a job on Olympic Blvd. Copy-paste artifacts in a stamped set — worth cleaning up.',
    owner: 'Design & Code Consultants',
    blocksExternalClaims: false,
  },
  {
    key: 'missing-drawings',
    title: 'Missing from the drawing set',
    detail:
      'No reflected ceiling plan, no interior elevations, no 3D model. Electrical, HVAC and sprinkler went out as separate permits — service amperage and panel schedule still needed before a tech spec sheet is possible.',
    owner: 'Design & Code Consultants',
    blocksExternalClaims: false,
  },
]

/** Status vocabulary for `venue_open_items.status`. Chosen to reuse StatusBadge's
 *  existing color map: open → gray, in_progress → lime, resolved → teal. */
export const OPEN_ITEM_STATUSES = ['open', 'in_progress', 'resolved'] as const
export type OpenItemStatus = (typeof OPEN_ITEM_STATUSES)[number]

/** Row shape of `venue_open_items`. */
export type VenueOpenItem = {
  id: string
  item_key: string
  status: OpenItemStatus
  owner: string | null
  notes: string | null
  updated_at: string
  updated_by: string | null
}

/**
 * Render / photo plates. Eli has 4 renders as of 29 July 2026; the rest are
 * placeholders so the gallery has correct slots and aspect ratios to fill.
 * Drop files into `public/nadines/` using the exact `file` name to light one up.
 *
 * Provenance note from §6 of the brief: there are 33 site photos shot at 14mm
 * ultra-wide which are DISTORTED — documentation only, never for renders or
 * marketing. The usable set is the 32 shot at 24mm/24MP. Only 24mm plates are
 * listed here.
 */
export const PLATES: { file: string; caption: string; plate?: string }[] = [
  { file: 'render-01.jpg', caption: 'Render — main hall' },
  { file: 'render-02.jpg', caption: 'Render — main hall, alternate configuration' },
  { file: 'render-03.jpg', caption: 'Render — mezzanine' },
  { file: 'render-04.jpg', caption: 'Render — courtyard' },
  { file: 'img-5622.jpg', caption: 'Hero — down the hall', plate: 'IMG_5622' },
  { file: 'img-5619.jpg', caption: 'Lobby into hall', plate: 'IMG_5619' },
  { file: 'img-5624.jpg', caption: 'Mezzanine looking down', plate: 'IMG_5624' },
  { file: 'img-5625.jpg', caption: 'Finished loft', plate: 'IMG_5625' },
  { file: 'img-5617.jpg', caption: 'Courtyard', plate: 'IMG_5617' },
  { file: 'img-5626.jpg', caption: 'Load-in door', plate: 'IMG_5626' },
]
