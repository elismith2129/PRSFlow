// ─────────────────────────────────────────────────────────────────────────────
// HR cases — types and the create/tick helpers the /hiring page uses.
//
// A case is one person-event (new hire / promotion / separation). Its
// checklist is copied from lib/hrChecklists.ts at create time and lives in
// hr_case_items; its offer letter / job description live in hr_documents
// (session 2 — send, sign, PDF). Owner + manager only (RLS).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '@/lib/supabase'
import {
  finalPayDue, resolveChecklist,
  type HrCaseKind, type SeparationType,
} from '@/lib/hrChecklists'

export type HrCase = {
  id: string
  kind: HrCaseKind
  subject_name: string
  staff_id: string | null
  recipient_email: string | null
  new_title: string | null
  studio: 'PRS' | 'ARS' | 'ERS' | 'TRK' | null
  anchor_date: string
  separation_type: SeparationType | null
  notice_at: string | null
  final_pay_due: string | null
  position_id: string | null
  from_position_title: string | null
  was_supervisory: boolean | null
  status: 'open' | 'closed'
  closed_at: string | null
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type HrCaseItem = {
  id: string
  case_id: string
  sort_order: number
  grp: string
  label: string
  help: string | null
  owner_role: string | null
  due_on: string | null
  is_legal: boolean
  auto_key: 'docs_signed' | 'notice_recorded' | null
  done_at: string | null
  done_by: string | null
  note: string | null
}

export type HrDocument = {
  id: string
  case_id: string
  kind: 'offer_letter' | 'job_description'
  fields: Record<string, unknown>
  body: string | null
  recipient_email: string | null
  sign_token: string | null
  sent_at: string | null
  sent_by: string | null
  opened_at: string | null
  signed_at: string | null
  signed_name: string | null
  signed_ip: string | null
  pdf_path: string | null
  created_at: string
  updated_at: string
}

export type HrPosition = {
  id: string
  title: string
  is_supervisory: boolean
  vacation_days: number
  default_hours_week: number | null
  reports_to: string | null
  prsflo_role: 'owner' | 'manager' | 'billing' | 'asst_manager' | 'tech' | 'runner' | null
  jd_body: string | null
  jd_is_draft: boolean
  sort_order: number
  is_active: boolean
}

export type NewCaseInput = {
  kind: HrCaseKind
  subject_name: string
  staff_id?: string | null
  recipient_email?: string | null
  new_title?: string | null
  studio?: HrCase['studio']
  anchor_date: string
  separation_type?: SeparationType | null
  /** ISO timestamp; separation only */
  notice_at?: string | null
  position?: HrPosition | null
  from_position_title?: string | null
  was_supervisory?: boolean | null
  created_by: string | null
}

/** Insert the case, then copy its checklist. Returns the new case id or an
 *  error message. Two writes, no transaction — if the items insert fails the
 *  case is removed so a half-case never sits in the list. */
export async function createCase(input: NewCaseInput): Promise<{ id: string } | { error: string }> {
  const fpd = input.kind === 'separation'
    ? finalPayDue(input.separation_type ?? null, input.anchor_date, input.notice_at ?? null)
    : null
  const { data: rows, error } = await supabase
    .from('hr_cases')
    .insert({
      kind: input.kind,
      subject_name: input.subject_name.trim(),
      staff_id: input.staff_id ?? null,
      recipient_email: input.recipient_email?.trim() || null,
      new_title: input.new_title?.trim() || null,
      studio: input.studio ?? null,
      anchor_date: input.anchor_date,
      separation_type: input.kind === 'separation' ? (input.separation_type ?? null) : null,
      notice_at: input.kind === 'separation' ? (input.notice_at ?? null) : null,
      final_pay_due: fpd,
      position_id: input.position?.id ?? null,
      from_position_title: input.from_position_title ?? null,
      was_supervisory: input.was_supervisory ?? null,
      created_by: input.created_by,
    })
    .select('id')
    .limit(1)
  const id = rows?.[0]?.id as string | undefined
  if (error || !id) return { error: error?.message ?? 'Case not created' }

  const items = resolveChecklist({
    kind: input.kind,
    anchor: input.anchor_date,
    separationType: input.separation_type ?? null,
    noticeAt: input.notice_at ?? null,
    finalPayDue: fpd,
    position: input.position ?? null,
    wasSupervisory: input.was_supervisory ?? null,
  }).map(it => ({
    ...it,
    case_id: id,
    // notice_recorded ticks itself when the case was created with a notice time
    done_at: it.auto_key === 'notice_recorded' && input.notice_at ? new Date().toISOString() : null,
    done_by: it.auto_key === 'notice_recorded' && input.notice_at ? input.created_by : null,
  }))
  const { error: iErr } = await supabase.from('hr_case_items').insert(items)
  if (iErr) {
    await supabase.from('hr_cases').delete().eq('id', id)
    return { error: iErr.message }
  }
  return { id }
}

export function progress(items: HrCaseItem[]): { done: number; total: number } {
  return { done: items.filter(i => i.done_at).length, total: items.length }
}

/** The one line under a name in the list: the first overdue legal item, else
 *  the next due item, else nothing. */
export function nextUp(items: HrCaseItem[], today: string): { label: string; due: string; overdue: boolean; legal: boolean } | null {
  const open = items.filter(i => !i.done_at && i.due_on).sort((a, b) => (a.due_on! < b.due_on! ? -1 : 1))
  const overdueLegal = open.find(i => i.is_legal && i.due_on! < today)
  const pick = overdueLegal ?? open[0]
  if (!pick) return null
  return { label: pick.label, due: pick.due_on!, overdue: pick.due_on! < today, legal: pick.is_legal }
}

export function fmtDate(iso: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(opts.year ? { year: 'numeric' } : {}) })
}

export function fmtDateLong(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}
