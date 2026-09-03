// ─────────────────────────────────────────────────────────────────────────────
// lib/woValidation — the checks a work order must pass before it can be COMPLETED.
//
// RULING 2026-08-10 (Eli): "for any row, it's going to need start and end time.
// If it's left blank, we need a stop to completing the WO. A message and a
// highlight of the error, like most forms."
//
// WHY IT EXISTS: a row with no times still contributes money to the WO. The
// engineer charge falls back to a stored hours figure when the clock can't be
// read, so a blank-time row can quietly add cost to the Grand Total while
// showing "—" on screen. Rather than make that mismatch readable, this stops the
// bad data from being signed off at all — fix the cause, not the symptom.
//
// Deliberately a pure function in its own file, not a check inside the popup:
// the admin WO screen and the runner's Finish are two separate code paths to the
// same "this WO is done" decision, and they must not be able to disagree about
// what "done" requires.
//
// Blocks COMPLETING only. Saving is always allowed — a session in progress often
// has no end time yet, and refusing to save would lose the rest of someone's work.
// ─────────────────────────────────────────────────────────────────────────────

import { timeToMins } from '@/lib/time'

/**
 * LOCKOUTS ARE EXEMPT FROM THE TIMES RULE (Eli, 2026-09-03 — Mustard's
 * monthly WO opened on a wall of thirty red rows). A lockout's day rows carry
 * the monthly rent split, not sessions: most days legitimately have no times,
 * ever — the only timed rows are the days a runner actually covered the
 * tenant (the shared-runner sheet reads those). Warning about the rest is
 * noise, and BLOCKING Complete on them would make the rent un-invoiceable at
 * month end. Lives here, not in the popup, so the admin gate and the runner
 * banner can never disagree about the exemption.
 */
export function woNeedsTimes(bookingStatus: string | null | undefined): boolean {
  return bookingStatus !== 'lockout'
}

/** How many problem rows a banner spells out before folding to "+ N more". */
const DETAIL_CAP = 4

/** "Sep 1 · Studio B (From, To) · … + 26 more" — capped so a big WO's banner
 *  stays a banner instead of becoming the page (the WO-1083 screenshot). */
export function problemsDetail(problems: RowTimeProblem[]): string {
  const shown = problems.slice(0, DETAIL_CAP)
    .map(p => `${p.where} (${p.fields.join(', ')})`)
    .join(' · ')
  const extra = problems.length - DETAIL_CAP
  return extra > 0 ? `${shown} · + ${extra} more` : shown
}

/** Only the fields the check looks at, so both the popup's form rows and raw DB rows fit. */
export type ValidatableStudioRow = {
  id: string
  studio?: string | null
  date?: string | null
  from_time?: string | null
  to_time?: string | null
  eng_visible?: boolean | null
  eng_name?: string | null
  eng_role?: 'engineer' | 'assistant' | null
  eng_from_time?: string | null
  eng_to_time?: string | null
}

export type RowTimeProblem = {
  rowId: string
  /** Human location for the message: "Aug 12 · Studio A" / "Aug 12 · 2ND". */
  where: string
  /** Which fields are missing or unreadable, in display order. */
  fields: string[]
}

/** Blank, whitespace, or something TimeInput could not parse. */
function badTime(t: string | null | undefined): boolean {
  if (!t || !t.trim()) return true
  return isNaN(timeToMins(t))
}

/** "2026-08-12" → "Aug 12". Falls back to "(no date)" so a row is still findable. */
function whereDate(iso: string | null | undefined): string {
  if (!iso) return '(no date)'
  const d = new Date(iso + 'T12:00:00')
  if (isNaN(d.getTime())) return iso
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`
}

/**
 * Is this row's staff line in play?
 *
 * A standalone staff row (studio === '') is nothing BUT a staff line, so always.
 * On a studio row it's the sub-row's visibility — `eng_visible: false` is what
 * `staff_mode: 'none'` seeds, and an unstaffed session must not be asked for
 * engineer hours. A named-but-rateless "engineer, TBD" IS staffed and does need
 * times (CLAUDE.md — a name is optional, the role is not).
 */
function staffLineActive(r: ValidatableStudioRow): boolean {
  const standalone = !r.studio || r.studio.trim() === ''
  if (standalone) return true
  return r.eng_visible !== false
}

/**
 * Every row missing a required time. Empty array means the WO can be completed.
 *
 * Rules:
 *   • A studio row needs its own From and To (the Aug 10 ruling, unchanged).
 *   • Any active staff line needs From and To (they mirror the session times on
 *     creation, so a blank here means something was actively cleared).
 *   • A standalone staff row has no session times of its own — only staff times
 *     are required.
 *   • `asOf` (2026-09-03, Eli — the three-week-session ruling): rows dated
 *     AFTER `asOf` are skipped. A long session's start time "may adjust each
 *     morning — we update the start times with the runners that morning", so a
 *     future day's blank times are not missing, they are simply not known yet.
 *     The runner banner passes the operational day; Complete WO passes nothing
 *     and checks every row, because by completion every day has happened and
 *     the Aug 10 rule applies in full.
 */
export function findMissingTimes(rows: ValidatableStudioRow[], asOf?: string): RowTimeProblem[] {
  const out: RowTimeProblem[] = []

  for (const r of rows) {
    if (asOf && r.date && r.date > asOf) continue
    const standalone = !r.studio || r.studio.trim() === ''
    const fields: string[] = []

    if (!standalone) {
      if (badTime(r.from_time)) fields.push('From')
      if (badTime(r.to_time)) fields.push('To')
    }

    if (staffLineActive(r)) {
      const who = r.eng_role === 'engineer' ? '1ST' : '2ND'
      if (badTime(r.eng_from_time)) fields.push(`${who} From`)
      if (badTime(r.eng_to_time)) fields.push(`${who} To`)
    }

    if (fields.length === 0) continue

    const place = standalone
      ? r.eng_role === 'engineer' ? '1ST' : '2ND'
      : `Studio ${r.studio}`
    out.push({ rowId: r.id, where: `${whereDate(r.date)} · ${place}`, fields })
  }

  return out
}

/**
 * Staff lines that will be worked but never charged (RULING 2026-08-13).
 *
 * Eli: "I want there to be a notification that arises when there is an
 * engineering line that doesn't have a rate on it — noticing it's something we
 * have to manually enter and that can create errors."
 *
 * The rate is typed by hand on every line and there is no default any more (the
 * old $55 inheritance was removed the same day), so a forgotten rate is now the
 * likeliest way a session gets under-billed. It is silent by nature: the line
 * still shows a name and hours, and simply contributes $0 to the total.
 *
 * A WARNING, NOT A BLOCK — unlike missing times. A rateless staff line is
 * sometimes correct: an assistant is never rated on the work order (see the
 * runner WO page), and a line can legitimately be logged before the rate is
 * agreed. Refusing to complete would stop real work over a judgement call.
 *
 * Only flags lines that would otherwise BILL — the times have to be readable,
 * because a line with no times computes no hours and is already caught by
 * findMissingTimes.
 */
export function findMissingEngRates(
  rows: Array<ValidatableStudioRow & { eng_rate?: string | null }>,
): RowTimeProblem[] {
  const out: RowTimeProblem[] = []

  for (const r of rows) {
    if (!staffLineActive(r)) continue
    // ASSISTANTS ARE NEVER RATED ON THE WORK ORDER (Eli, 2026-08-13). A 2ND with
    // no rate is the normal, correct state — warning about it would fire on the
    // majority of sessions and train everyone to ignore the banner. Only an
    // ENGINEER line with hours and no rate is a missed charge.
    if (r.eng_role !== 'engineer') continue
    if ((r.eng_rate ?? '').trim()) continue
    // No readable clock → no hours → nothing to under-charge. That row's real
    // problem is its missing times, and it is reported there instead.
    if (badTime(r.eng_from_time) || badTime(r.eng_to_time)) continue

    const standalone = !r.studio || r.studio.trim() === ''
    const who = r.eng_role === 'engineer' ? '1ST' : '2ND'
    const place = standalone ? who : `Studio ${r.studio} · ${who}`
    out.push({
      rowId: r.id,
      where: `${whereDate(r.date)} · ${place}`,
      fields: [r.eng_name?.trim() || 'no name'],
    })
  }

  return out
}

/** One sentence for the warning banner. Null when every staff line has a rate. */
export function missingEngRatesMessage(problems: RowTimeProblem[]): string | null {
  if (problems.length === 0) return null
  const detail = problems.map(p => `${p.where} (${p.fields[0]})`).join(' · ')
  return problems.length === 1
    ? `One staff line has hours but no rate, so it will bill $0: ${detail}`
    : `${problems.length} staff lines have hours but no rate, so they will bill $0: ${detail}`
}

/**
 * The same person billed twice on the same day (RULING 2026-08-13).
 *
 * FOUND IN LIVE DATA (WO-1018, 29–30 July): each day had a studio row carrying
 * its staff sub-row AND a separate standalone staff row for the SAME engineer,
 * same rate, same hours. Both contribute to the engineer total, so the session
 * was billing that engineer twice — and on screen it just looks like two lines.
 *
 * Nothing creates this automatically. `+ Add Engineer` pre-fills the previous
 * staff line's name, rate and times as a convenience, so pressing it on a
 * session that already has that engineer on the studio row produces an exact
 * duplicate. Easy to do, invisible afterwards.
 *
 * A WARNING, not a block: two lines for one person on one day is legitimate
 * when someone genuinely worked two separate calls. Only the person looking at
 * it can tell, so it says what it found and leaves the decision alone.
 */
export function findDuplicateStaffLines(
  rows: Array<ValidatableStudioRow & { eng_rate?: string | null }>,
): RowTimeProblem[] {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

  // Staff carried by a STUDIO row — the sub-row. Keyed by date + person.
  const onStudioRow = new Set<string>()
  for (const r of rows) {
    const standalone = !r.studio || r.studio.trim() === ''
    if (standalone || r.eng_visible === false) continue
    if (!norm(r.eng_name)) continue
    onStudioRow.add(`${r.date ?? ''}|${norm(r.eng_name)}`)
  }

  const out: RowTimeProblem[] = []
  for (const r of rows) {
    const standalone = !r.studio || r.studio.trim() === ''
    if (!standalone || !norm(r.eng_name)) continue
    if (!onStudioRow.has(`${r.date ?? ''}|${norm(r.eng_name)}`)) continue
    out.push({
      rowId: r.id,
      where: whereDate(r.date),
      fields: [r.eng_name!.trim()],
    })
  }
  return out
}

/** One sentence for the duplicate-staff warning. Null when there are none. */
export function duplicateStaffMessage(problems: RowTimeProblem[]): string | null {
  if (problems.length === 0) return null
  const detail = problems.map(p => `${p.fields[0]} on ${p.where}`).join(' · ')
  return problems.length === 1
    ? `${detail} is on two lines for that day, so they will be charged twice. Delete one unless they really worked two calls.`
    : `${problems.length} staff lines are duplicates and will be charged twice: ${detail}. Delete the extras unless they really worked two calls.`
}

/**
 * EVERY DAY OF A CONFIRMED SESSION NEEDS START AND END TIMES (Eli's ruling,
 * 2026-09-03: "it needs to apply to every session on the table, not just day
 * one… start and end times required").
 *
 * The failure this exists to stop: a work order confirmed with blank times
 * reaches the runner, who then has to invent them. The gate sits where the
 * commitment is made — admin cannot SAVE a Confirmed work order while any
 * dated studio day is missing From or To.
 *
 * A long session is not an exception: seeding copies the booked times onto
 * every day, so a three-week WO passes as booked, and the mornings that shift
 * are EDITS to a real time rather than blanks nobody noticed.
 *
 * Tentative saves freely — deals close before times settle. Lockouts are
 * exempt entirely via woNeedsTimes: nobody knows their times in advance and
 * the runner enters them live.
 *
 * Returns the blocking message plus the rows to highlight, or null to proceed.
 */
export function confirmStartProblem(
  sessionStatus: string | null | undefined,
  rows: ValidatableStudioRow[],
): { message: string; rowIds: string[] } | null {
  if (sessionStatus !== 'confirmed') return null
  const missing = rows
    .filter(r => r.studio && r.studio.trim() !== '' && (r.date ?? '').trim() !== '')
    .filter(r => badTime(r.from_time) || badTime(r.to_time))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  if (missing.length === 0) return null

  const label = (r: ValidatableStudioRow) => {
    const f: string[] = []
    if (badTime(r.from_time)) f.push('From')
    if (badTime(r.to_time)) f.push('To')
    return `${whereDate(r.date)} (${f.join(', ')})`
  }
  const days = missing.slice(0, DETAIL_CAP).map(label).join(' · ')
  const extra = missing.length - DETAIL_CAP
  const detail = extra > 0 ? `${days} · + ${extra} more` : days
  return {
    message: missing.length === 1
      ? `A confirmed session needs start and end times on every day — ${detail} is missing them. (Keep it Tentative until the times are set.)`
      : `A confirmed session needs start and end times on every day — ${missing.length} days are missing them: ${detail}. (Keep it Tentative until the times are set.)`,
    rowIds: missing.map(r => r.id),
  }
}

/** One sentence for the banner. Null when there is nothing wrong. */
export function missingTimesMessage(problems: RowTimeProblem[]): string | null {
  if (problems.length === 0) return null
  const detail = problemsDetail(problems)
  return problems.length === 1
    ? `This work order can't be completed — one row is missing times: ${detail}`
    : `This work order can't be completed — ${problems.length} rows are missing times: ${detail}`
}
