// ─────────────────────────────────────────────────────────────────────────────
// HR checklists — the three fixed lists a case is built from (2026-09-21).
//
// Eli: "type a name, select new hire, promotion, or separation and then the
// checklists for each of those… + the checklist for adding these to ADP."
//
// New hire and separation are PRG-P02 (docs/hr/) as written. Promotion is
// new — Eli's own list (offer letter signed, job description signed, ADP
// changes) plus the supervisory-training clause from HR-SPEC §6. ADP rows
// carry the WFN menu path in `help` so the list is a copy job, not a memory
// job. PRSFlo never talks to ADP (HR-SPEC §1.1).
//
// These are COPIED onto hr_case_items when a case is created (lib/hrCases.ts
// buildCaseItems). Editing this file changes the next case, never a live one.
// Dates are computed from the case anchor: start date (new hire), effective
// date (promotion), last day (separation). `only` filters rows by separation
// type. `auto` marks rows the app ticks itself.
// ─────────────────────────────────────────────────────────────────────────────

export type HrCaseKind = 'new_hire' | 'promotion' | 'separation'
export type SeparationType = 'involuntary' | 'quit_72_notice' | 'quit_short_notice'

export type ChecklistCtx = {
  kind: HrCaseKind
  /** ISO date (YYYY-MM-DD) — start / effective / last day */
  anchor: string
  separationType?: SeparationType | null
  /** ISO timestamp of when notice was given (separation) */
  noticeAt?: string | null
  /** computed final pay date for a separation */
  finalPayDue?: string | null
}

export type ChecklistSpec = {
  grp: string
  label: string
  help?: string
  owner?: 'Eli' | 'Fernando' | 'Lynair' | 'Eli · Lynair' | 'auto'
  due?: (c: ChecklistCtx) => string | null
  legal?: boolean
  auto?: 'docs_signed' | 'notice_recorded'
  only?: (c: ChecklistCtx) => boolean
}

// ── date math (ISO in, ISO out, no timezones — these are calendar days) ─────

function parse(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}
export function addDays(iso: string, n: number): string {
  const d = parse(iso); d.setUTCDate(d.getUTCDate() + n); return fmt(d)
}
export function addMonths(iso: string, n: number): string {
  const d = parse(iso); d.setUTCMonth(d.getUTCMonth() + n); return fmt(d)
}
/** Mon–Fri only. Day one itself doesn't count; I-9 §2 is "within 3 business
 *  days AFTER the first day of work". */
export function addBusinessDays(iso: string, n: number): string {
  const d = parse(iso); let left = n
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) left--
  }
  return fmt(d)
}

/** LC 201 / 202. Involuntary → at the moment of termination (the last day).
 *  Quit with 72+ hours' notice → the last day. Quit with less → 72 hours
 *  after notice (calendar days; the law says hours, we show the date). */
export function finalPayDue(sep: SeparationType | null | undefined, lastDay: string, noticeAt?: string | null): string | null {
  if (!sep) return null
  if (sep === 'involuntary' || sep === 'quit_72_notice') return lastDay
  if (noticeAt) return fmt(new Date(new Date(noticeAt).getTime() + 72 * 3600 * 1000))
  return addDays(lastDay, 3)
}

// ── the lists ───────────────────────────────────────────────────────────────

const NEW_HIRE: ChecklistSpec[] = [
  { grp: 'Documents', label: 'Offer letter signed', owner: 'auto', auto: 'docs_signed', legal: false,
    due: c => addDays(c.anchor, -1),
    help: 'Sent from this case. Ticks itself when the signature lands.' },
  { grp: 'Documents', label: 'Job description signed', owner: 'auto', auto: 'docs_signed',
    due: c => addDays(c.anchor, -1),
    help: 'Sent from this case. Ticks itself when the signature lands.' },

  { grp: 'Before ADP', label: 'Offer accepted in writing, filed', owner: 'Fernando' },
  { grp: 'Before ADP', label: 'Start date confirmed · non-exempt unless Eli says otherwise · studio and reporting manager set', owner: 'Fernando' },
  { grp: 'Before ADP', label: 'Sent to Eli: legal name, personal email, mobile, start date', owner: 'Fernando',
    help: 'That is all Eli needs to create the record. He enters position, rate and details himself.' },

  { grp: 'ADP — Eli', label: 'Create the hire in ADP', owner: 'Eli', due: c => addDays(c.anchor, -7),
    help: 'Process › HR › Hire / Rehire. Work location US · Hire someone: HR + Payroll + Time · Onboarding: STANDARD › Assign · tick "Use for notification" under the email or the invite never arrives · Hire Date = 7 days before day one · Reason CURR · Company 4DA · English (US). Then Ask the New Hire: CA · Reports To · FLSA N · I-9 Yes, Electronically · Works from Home No. Falls through? Hire/Rehire › In Progress › delete and restart — never resend a bad invite.' },
  { grp: 'ADP — Eli', label: 'Welcome email sent, cc Lynair', owner: 'Fernando', due: c => addDays(c.anchor, -7),
    help: 'Template on the last page of PRG-P02. Fernando sends and signs it.' },

  { grp: 'Day one', label: 'Notices handed over (the ones ADP doesn\'t already send)', owner: 'Fernando', due: c => c.anchor,
    help: 'Check Setup › Manage Onboarding › Standard › Tasks first and skip what\'s already in the packet. Ours: Wage Theft Prevention Act notice · harassment / discrimination / retaliation policy (signed) · CRD harassment fact sheet · paid sick leave notice · workers\' comp pamphlet + DWC-1 · DE 2515 and DE 2511 · Workplace Violence plan + training · IIPP · employee handbook (signed).' },
  { grp: 'Day one', label: 'I-9 Section 1 complete', owner: 'Fernando', due: c => c.anchor, legal: true },
  { grp: 'Day one', label: 'I-9 Section 2 complete', owner: 'Fernando', due: c => addBusinessDays(c.anchor, 3), legal: true,
    help: 'Within 3 business days of day one. Federal, non-negotiable.' },
  { grp: 'Day one', label: 'PRSFlo staff record + PIN', owner: 'Eli', due: c => c.anchor,
    help: 'node --env-file=.env.local scripts/set-pins.mjs --only <email> --name "Full Name" --initials XX — then link this case to the new profile (top of the case).' },
  { grp: 'Day one', label: 'Keys, codes, email, gear', owner: 'Fernando', due: c => c.anchor },
  { grp: 'Day one', label: 'Can punch and approve their own timecard before the first shift ends', owner: 'Fernando', due: c => c.anchor },
  { grp: 'Day one', label: 'Walked through punches, meals, same-day self-reporting, and approving their timecard each period', owner: 'Fernando', due: c => addDays(c.anchor, 7) },

  { grp: 'While onboarding runs', label: 'Onboarding progress checked in ADP; uploaded documents reviewed and approved (incl. I-9 docs)', owner: 'Fernando',
    help: 'Chase them if it stalls — nothing downstream can happen until they finish.' },
  { grp: 'While onboarding runs', label: 'Told Eli their steps are done → Eli does the final review and approve', owner: 'Eli' },
  { grp: 'While onboarding runs', label: 'Email Lynair: add to CalSavers', owner: 'Fernando', due: c => addDays(c.anchor, 30), legal: true,
    help: 'Only possible once onboarding completes (she needs address + SSN). The 30-day clock runs from the hire date regardless, so a slow onboarding compresses the window.' },
  { grp: 'While onboarding runs', label: 'Added to the training tracker — harassment due in 6 months, WPV at hire', owner: 'Fernando', due: c => addMonths(c.anchor, 6), legal: true,
    help: 'PRG-P04. Free CRD course for harassment (1 hr non-supervisory / 2 hrs supervisory). CRD does not reissue certificates — save it before closing the browser.' },

  { grp: '30 days', label: '30-day check: I-9 done · everything signed and filed · CalSavers confirmed · training scheduled · approving their own timecards', owner: 'Fernando', due: c => addDays(c.anchor, 30) },
]

const PROMOTION: ChecklistSpec[] = [
  { grp: 'Documents', label: 'Offer letter signed', owner: 'auto', auto: 'docs_signed',
    due: c => addDays(c.anchor, -1),
    help: 'Sent from this case. Ticks itself when the signature lands. Nothing in ADP moves before this.' },
  { grp: 'Documents', label: 'Job description signed', owner: 'auto', auto: 'docs_signed',
    due: c => addDays(c.anchor, -1),
    help: 'Sent from this case. Ticks itself when the signature lands.' },

  { grp: 'Before ADP', label: 'Offer accepted verbally, effective date agreed', owner: 'Eli' },
  { grp: 'Before ADP', label: 'New rate, title, hours per week, and vacation allotment decided (they\'re on the offer letter)', owner: 'Eli' },

  { grp: 'ADP — Eli', label: 'Change position and title', owner: 'Eli', due: c => c.anchor,
    help: 'People › Employment › Position. Effective date = the letter\'s effective date, not today.' },
  { grp: 'ADP — Eli', label: 'Change pay rate', owner: 'Eli', due: c => c.anchor,
    help: 'People › Pay Profile › Pay Rate, effective on the date. Tell Lynair the first period at the new rate is coming.' },
  { grp: 'ADP — Eli', label: 'Manager classification and reports-to set (only if they now supervise anyone)', owner: 'Eli', due: c => c.anchor,
    help: 'Per Lynair, ADP\'s Manager flag is the first pass for supervisor training status.' },
  { grp: 'ADP — Eli', label: 'Vacation allotment updated in ADP', owner: 'Eli', due: c => c.anchor,
    help: 'Front-loaded: the prorated one-time amount now, the full allotment every January 1.' },
  { grp: 'ADP — Eli', label: 'Signed offer letter and job description uploaded to their ADP record', owner: 'Fernando', due: c => c.anchor,
    help: 'Download both from this case. People › Documents.' },

  { grp: 'PRSFlo & training', label: 'Role changed in PRSFlo on the effective date', owner: 'Eli', due: c => c.anchor,
    help: 'user_profiles.role — on the date, not before.' },
  { grp: 'PRSFlo & training', label: 'Keys, codes, and access adjusted for the new role', owner: 'Fernando', due: c => c.anchor },
  { grp: 'PRSFlo & training', label: 'Supervisory harassment training (2 hrs) within 6 months — only if newly supervising', owner: 'Fernando', due: c => addMonths(c.anchor, 6), legal: true,
    help: 'Gov. Code 12950.1: a newly supervisory employee takes the 2-hour course within six months. Free CRD course; save the certificate.' },
]

const SEPARATION: ChecklistSpec[] = [
  { grp: 'Final pay', label: 'Final pay ready — including all accrued, unused vacation', owner: 'Eli · Lynair', legal: true,
    due: c => c.finalPayDue ?? null,
    help: 'We let them go → at the moment of termination (LC 201). Quit with 72+ hours\' notice → the last day. Quit with less → within 72 hours of notice (LC 202). Late = up to 30 days of wages in penalties, even for an honest miss.' },
  { grp: 'Final pay', label: 'Eli approved · reason documented · Lynair has 48 hours\' notice so the check exists before the conversation', owner: 'Eli',
    only: c => c.separationType === 'involuntary', legal: true,
    due: c => addDays(c.anchor, -2) },
  { grp: 'Final pay', label: 'Resignation in writing, on this case (never verbal)', owner: 'Fernando',
    only: c => c.separationType !== 'involuntary' },
  { grp: 'Final pay', label: 'Date and time of notice recorded (sets the pay deadline)', owner: 'auto', auto: 'notice_recorded' },
  { grp: 'Final pay', label: 'Last day and vacation balance confirmed with Lynair', owner: 'Fernando' },

  { grp: 'Packet', label: 'Separation packet emailed', owner: 'Fernando', due: c => c.anchor,
    help: 'Return to us: CA Employment Separation Notice. Info only: DE 2511 · DE 2515 · DE 2320 · COBRA notice if on our health plan · final pay statement.' },

  { grp: 'ADP — Eli', label: 'Termination run in ADP', owner: 'Eli', due: c => c.anchor,
    help: 'Process › HR › Terminate Employment. Fernando gives Eli the last day worked, the reason, and the separation type. Resignation and separation documents uploaded.' },
  { grp: 'ADP — Eli', label: 'Final check timing confirmed against the rule above', owner: 'Eli', due: c => c.finalPayDue ?? null, legal: true },

  { grp: 'Close out', label: 'Email Lynair: REMOVE from CalSavers', owner: 'Fernando', due: c => c.anchor },
  { grp: 'Close out', label: 'Final timecard closed — punches, premiums, vacation paid out', owner: 'Fernando', due: c => c.anchor },
  { grp: 'Close out', label: 'PRSFlo: deactivate the profile, void the PIN, reassign their open tasks and work orders', owner: 'Eli', due: c => c.anchor },
  { grp: 'Close out', label: 'Keys, fobs, codes revoked · gear back · email off or forwarded · clients reassigned', owner: 'Fernando', due: c => c.anchor },
  { grp: 'Close out', label: 'Personnel file closed — keep 4 years', owner: 'Fernando', due: c => c.anchor },
]

export const CHECKLISTS: Record<HrCaseKind, ChecklistSpec[]> = {
  new_hire: NEW_HIRE,
  promotion: PROMOTION,
  separation: SEPARATION,
}

export const KIND_LABEL: Record<HrCaseKind, string> = {
  new_hire: 'New hire',
  promotion: 'Promotion',
  separation: 'Separation',
}

export const ANCHOR_LABEL: Record<HrCaseKind, string> = {
  new_hire: 'Start date',
  promotion: 'Effective date',
  separation: 'Last day',
}

export const SEPARATION_LABEL: Record<SeparationType, string> = {
  involuntary: 'We let them go',
  quit_72_notice: 'Quit, 72+ hrs notice',
  quit_short_notice: 'Quit, short notice',
}

/** Resolve a list against a case: filter `only`, compute due dates. */
export function resolveChecklist(c: ChecklistCtx) {
  return CHECKLISTS[c.kind]
    .filter(s => !s.only || s.only(c))
    .map((s, i) => ({
      sort_order: i,
      grp: s.grp,
      label: s.label,
      help: s.help ?? null,
      owner_role: s.owner ?? null,
      due_on: s.due ? s.due(c) : null,
      is_legal: !!s.legal,
      auto_key: s.auto ?? null,
    }))
}
