// ─────────────────────────────────────────────────────────────────────────────
// lib/flags — the Flags page's data layer (2026-09-15, flags + tasks merged).
// Mock: docs/design-refs/flags-options.html. Migration 20260915140000.
//
// A FLAG is anything that needs doing; a task is a flag someone typed. Same
// row: `dashboard_tasks`. A flag is never nobody's — its KIND decides its
// DEPARTMENT (by DB trigger, mirrored here for optimistic UI):
//     facility · gear          → tech   (mics are gear)
//     clients_billing · office → admin
// Visibility is RLS's job (tech: department = 'tech'; admin roles: all;
// everyone: own). Nothing here re-implements the policy client-side — that is
// how the Isaac/Quinn peer bug happened (see lib/tasks.ts).
//
// lib/tasks.ts is left intact: the dashboard's Your List and Flo's briefing
// still read through it. This module is the page's own vocabulary.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, DashboardTask, DashboardTaskComment, FlagKind, FlagDepartment, FlagStudio, UserProfile } from '@/lib/supabase'
import { dbResult } from '@/lib/db'

export type Flag = DashboardTask

export const KINDS: { key: FlagKind; label: string; department: FlagDepartment }[] = [
  { key: 'facility',        label: 'Facility',          department: 'tech' },
  { key: 'gear',            label: 'Gear',              department: 'tech' },
  { key: 'clients_billing', label: 'Clients & billing', department: 'admin' },
  { key: 'office',          label: 'Office',            department: 'admin' },
]
export const KIND_LABEL: Record<FlagKind, string> = Object.fromEntries(KINDS.map(k => [k.key, k.label])) as Record<FlagKind, string>
export function departmentOf(kind: FlagKind): FlagDepartment {
  return kind === 'facility' || kind === 'gear' ? 'tech' : 'admin'
}
export const DEPT_LABEL: Record<FlagDepartment, string> = { tech: 'Tech', admin: 'Admin' }

export const STUDIOS: { key: FlagStudio; code: string; label: string }[] = [
  { key: 'paramount', code: 'PRS', label: 'Paramount' },
  { key: 'ameraycan', code: 'ARS', label: 'Ameraycan' },
  { key: 'encore',    code: 'ERS', label: 'Encore' },
  { key: 'track',     code: 'TRK', label: 'Track' },
]
export function studioCode(s: string | null | undefined): string {
  return STUDIOS.find(x => x.key === s)?.code ?? ''
}

/** Kind colours — the status palette, one per kind, nothing new. */
export const KIND_COLOR: Record<FlagKind, string> = {
  facility: 'var(--c-st-uncon)',
  gear: 'var(--c-st-tech)',
  clients_billing: 'var(--c-st-warm)',
  office: 'var(--c-st-dead)',
}

/** Tech sees the Tech list only; every other office role is Admin. */
export function myDepartment(role: UserProfile['role'] | null | undefined): FlagDepartment {
  return role === 'tech' ? 'tech' : 'admin'
}
export function isAdminRole(role: UserProfile['role'] | null | undefined): boolean {
  return role === 'owner' || role === 'manager' || role === 'billing' || role === 'asst_manager'
}

/** Age is the only alarm: open past 72h is hot. */
export const HOT_AFTER_MS = 72 * 60 * 60 * 1000
export function isHot(f: Flag, now = Date.now()): boolean {
  return !f.completed && now - new Date(f.created_at).getTime() > HOT_AFTER_MS
}
export function ageLabel(iso: string, now = Date.now()): string {
  const ms = Math.max(0, now - new Date(iso).getTime())
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** "runner checklist · Hunter" / "work order · PRS · Lainey Wilson" / "Fernando". */
export function sourceLine(f: Flag, nameOf: (id: string | null) => string): string {
  if (f.source === 'runner_flag') return ['runner checklist', f.created_by_name].filter(Boolean).join(' · ')
  if (f.source === 'wo_flag') return ['work order', f.source_label, f.created_by_name].filter(Boolean).join(' · ')
  return f.assigned_by ? nameOf(f.assigned_by) : (f.created_by_name || '')
}

// ── Roster ───────────────────────────────────────────────────────────────────
export type RosterRow = { id: string; display_name: string; role: string }
/** Names for the assign picker and the meta lines. SECURITY DEFINER RPC —
 *  tech can't read other profiles directly (Jul 2 hardening). */
export async function fetchRoster(): Promise<RosterRow[]> {
  const { data, error } = await supabase.rpc('flag_roster')
  if (error) { console.error('flag_roster', error); return [] }
  return (data as RosterRow[]) || []
}

// ── Reads ────────────────────────────────────────────────────────────────────
// No department / person filter here — RLS scopes the rows. The page groups.
export async function fetchOpenFlags(): Promise<Flag[]> {
  const { data, error } = await supabase
    .from('dashboard_tasks')
    .select('*')
    .eq('completed', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) console.error('fetchOpenFlags', error)
  return data || []
}
export async function fetchDoneFlags(sinceIso: string): Promise<Flag[]> {
  const { data, error } = await supabase
    .from('dashboard_tasks')
    .select('*')
    .eq('completed', true)
    .is('deleted_at', null)
    .gte('completed_at', sinceIso)
    .order('completed_at', { ascending: false })
    .limit(200)
  if (error) console.error('fetchDoneFlags', error)
  return data || []
}
export async function fetchFlagComments(taskId: string): Promise<DashboardTaskComment[]> {
  const { data } = await supabase
    .from('dashboard_task_comments')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
  return data || []
}

// ── Writes ───────────────────────────────────────────────────────────────────
export async function uploadFlagPhoto(file: File): Promise<string | null> {
  const path = `dashboard-tasks/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
  const { data, error } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
  if (!data || error) { dbResult('Uploading photo', error); return null }
  return data.path   // private bucket — SignedImage signs on read
}

export async function addFlag(input: {
  text: string; kind: FlagKind; studio: FlagStudio | null; assignedTo: string | null
  dueDate: string | null; photoPath: string | null; by: UserProfile
}): Promise<Flag | null> {
  const { data, error } = await supabase.from('dashboard_tasks').insert({
    text: input.text.trim(),
    assigned_role: 'admin',           // legacy column; department is the routing now
    source: 'manual',
    kind: input.kind,
    department: departmentOf(input.kind),
    studio: input.studio,
    assigned_to: input.assignedTo,
    assigned_by: input.by.id,
    created_by_name: input.by.display_name,
    due_date: input.dueDate,
    photo_url: input.photoPath,
  }).select('*').single()
  if (!dbResult('Adding flag', error)) return null
  return data as Flag
}

export async function assignFlag(id: string, assignedTo: string | null): Promise<boolean> {
  const { error } = await supabase.from('dashboard_tasks').update({ assigned_to: assignedTo }).eq('id', id)
  return dbResult('Assigning flag', error)
}
export async function rekindFlag(id: string, kind: FlagKind): Promise<boolean> {
  const { error } = await supabase.from('dashboard_tasks').update({ kind, department: departmentOf(kind) }).eq('id', id)
  return dbResult('Changing kind', error)
}
export async function setFlagDue(id: string, dueDate: string | null): Promise<boolean> {
  const { error } = await supabase.from('dashboard_tasks').update({ due_date: dueDate }).eq('id', id)
  return dbResult('Setting due date', error)
}
export async function doneFlag(id: string, done: { note: string | null; vendor: string | null; cost: number | null }): Promise<boolean> {
  const { error } = await supabase.from('dashboard_tasks').update({
    completed: true,
    completed_at: new Date().toISOString(),
    completed_note: done.note,
    done_vendor: done.vendor,
    done_cost: done.cost,
  }).eq('id', id)
  return dbResult('Marking done', error)
}
export async function reopenFlag(id: string): Promise<boolean> {
  const { error } = await supabase.from('dashboard_tasks').update({ completed: false, completed_at: null }).eq('id', id)
  return dbResult('Reopening flag', error)
}
/** "Not a real issue" — closes with a note, no vendor / cost. */
export async function dismissFlag(id: string, note: string): Promise<boolean> {
  return doneFlag(id, { note: note.trim() || 'Not a real issue', vendor: null, cost: null })
}
export async function removeFlag(id: string): Promise<boolean> {
  const { error } = await supabase.from('dashboard_tasks').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  return dbResult('Removing flag', error)
}
export async function addFlagComment(taskId: string, text: string, photoPath: string | null, createdByName: string): Promise<boolean> {
  const { error } = await supabase.from('dashboard_task_comments').insert({
    task_id: taskId, text: text.trim() || null, photo_url: photoPath, created_by_name: createdByName,
  })
  return dbResult('Adding note', error)
}
