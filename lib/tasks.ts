import { supabase, DashboardTask, UserProfile } from '@/lib/supabase'

// Task panel tabs. Each tab resolves to a set of user_profiles by display_name
// (looked up dynamically — no hardcoded UUIDs). A tab shows tasks whose
// assigned_to is one of those users' ids.
export type TabDef = { key: string; label: string; names: string[] }
export const TAB_DEFS: TabDef[] = [
  { key: 'eli',       label: 'Eli',       names: ['Eli'] },
  { key: 'adam_mike', label: 'Adam-Mike', names: ['Adam-Mike'] },
  { key: 'fernando',  label: 'Fernando',  names: ['Fernando'] },
  { key: 'aaron',     label: 'Aaron',     names: ['Aaron'] },
  // Sam replaced Quinn 2026-09-01 (display_name must be exactly 'Sam' in
  // user_profiles — these tabs match on it).
  { key: 'asst',      label: 'Asst Mgr',  names: ['Sam', 'Isaac'] },
  { key: 'tech',      label: 'Tech',      names: ['Sierra', 'Tom'] },
]

// Flat "Assign to" dropdown options, in exact display order. Individual people
// (Adam-Mike / Eli / Fernando / Aaron) map to their own profile; the Asst Mgr and
// Tech options represent a PAIR and assign to the primary member's id (Sam /
// Sierra), which lands the task in the corresponding member-based tab. The option
// keys intentionally match the TAB_DEFS keys so the dropdown can default to the
// active tab. `primaryName` is resolved to an id at save time via resolveAssignTo.
//
// The pair genuinely SHARES the task: as of migration 20260728200000 the
// dashboard_tasks RLS policy grants each member of a paired role read + update on
// any non-private task assigned to a peer holding the same role. So assigning to
// "Asst Mgr" reaches Sam AND Isaac even though the row stores Sam's id.
// (Sam replaced Quinn as the primary 2026-09-01; Quinn's open tasks were
// reassigned to Sam's id in the same SQL pass so none left the tab.)
// (Storing one id keeps assigned_to a plain FK — don't "fix" this by fanning the
// task out into duplicate rows per member.)
export const ASSIGN_OPTIONS: { key: string; label: string; primaryName: string }[] = [
  { key: 'adam_mike', label: 'Adam-Mike', primaryName: 'Adam-Mike' },
  { key: 'eli',       label: 'Eli',       primaryName: 'Eli' },
  { key: 'fernando',  label: 'Fernando',  primaryName: 'Fernando' },
  { key: 'aaron',     label: 'Aaron',     primaryName: 'Aaron' },
  { key: 'asst',      label: 'Asst Mgr',  primaryName: 'Sam' },
  { key: 'tech',      label: 'Tech',      primaryName: 'Sierra' },
]

// Resolve a dropdown option key to the assigned_to user id (its primary member),
// looked up by display_name (case-insensitive). No hardcoded UUIDs.
export function resolveAssignTo(optionKey: string, profiles: UserProfile[]): string | null {
  const opt = ASSIGN_OPTIONS.find(o => o.key === optionKey)
  if (!opt) return null
  const match = profiles.find(p => p.display_name?.toLowerCase() === opt.primaryName.toLowerCase())
  return match ? match.id : null
}

// Resolve a user id to a display name (for the assigned-to / assigned-by meta line).
export function nameForId(id: string | null, profiles: UserProfile[]): string {
  if (!id) return 'Unassigned'
  const p = profiles.find(x => x.id === id)
  return p?.display_name || 'Unknown'
}

// owner / manager / billing see every tab and can assign to anyone;
// asst_manager sees only the Asst Mgr tab, tech sees only the Tech tab.
export function visibleTabsForRole(role: UserProfile['role'] | null | undefined): TabDef[] {
  if (role === 'asst_manager') return TAB_DEFS.filter(t => t.key === 'asst')
  if (role === 'tech') return TAB_DEFS.filter(t => t.key === 'tech')
  return TAB_DEFS
}

// Resolve a tab's display_names to user_profiles ids (case-insensitive).
export function idsForTab(tabKey: string, profiles: UserProfile[]): string[] {
  const def = TAB_DEFS.find(t => t.key === tabKey)
  if (!def) return []
  const byName: Record<string, string> = {}
  profiles.forEach(p => { if (p.display_name) byName[p.display_name.toLowerCase()] = p.id })
  return def.names.map(n => byName[n.toLowerCase()]).filter(Boolean) as string[]
}

// Active (incomplete) tasks for a set of assigned_to ids.
export async function fetchTasks(ids: string[]): Promise<DashboardTask[]> {
  if (ids.length === 0) return []
  const { data } = await supabase
    .from('dashboard_tasks')
    .select('*')
    .in('assigned_to', ids)
    .eq('completed', false)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  return data || []
}

// Completed tasks for a set of assigned_to ids, most-recently-completed first.
export async function fetchCompletedTasks(ids: string[]): Promise<DashboardTask[]> {
  if (ids.length === 0) return []
  const { data } = await supabase
    .from('dashboard_tasks')
    .select('*')
    .in('assigned_to', ids)
    .eq('completed', true)
    .is('deleted_at', null)
    .order('completed_at', { ascending: false })
    .limit(100)
  return data || []
}

// ── "My Tasks" fetchers (own-only tiers: asst_manager / tech / runner) ──
//
// These deliberately apply NO assigned_to/assigned_by filter — RLS
// (`dashboard_tasks_sel`) already scopes the result to exactly what this user may
// see, and it is the only correct authority on that. As of migration
// 20260728200000 that means: tasks they created, tasks assigned to them, AND —
// for the PAIRED roles (asst_manager, tech) — any non-private task assigned to
// someone holding the same role. That peer rule is why the old
// `.or(assigned_to.eq.X, assigned_by.eq.X)` filter had to go: it re-implemented
// a narrower version of the policy client-side and silently hid a teammate's
// shared task (Isaac could not see a task assigned to Quinn, and vice versa).
//
// Duplicating policy logic here is what caused that bug, so don't reintroduce a
// filter — a paired role also cannot resolve its peers' ids client-side anyway
// (tech/runner can only read their own user_profiles row).
//
// profileId is kept purely as a readiness guard so we don't fire the query
// before the session's profile has resolved.

// Active (incomplete) tasks visible to this user (own + created + role peers).
export async function fetchMyTasks(profileId: string): Promise<DashboardTask[]> {
  if (!profileId) return []
  const { data } = await supabase
    .from('dashboard_tasks')
    .select('*')
    .eq('completed', false)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  return data || []
}

// Completed tasks visible to this user, most-recent first.
export async function fetchMyCompletedTasks(profileId: string): Promise<DashboardTask[]> {
  if (!profileId) return []
  const { data } = await supabase
    .from('dashboard_tasks')
    .select('*')
    .eq('completed', true)
    .is('deleted_at', null)
    .order('completed_at', { ascending: false })
    .limit(100)
  return data || []
}

// True for roles that see only their own tasks (created or assigned), rather than
// the per-person tabs. owner/manager/billing keep the full tab set.
export function isOwnOnlyRole(role: UserProfile['role'] | null | undefined): boolean {
  return role === 'asst_manager' || role === 'tech' || role === 'runner'
}

// Format a comment/update timestamp as "Jun 25 · 02:30 PM".
export function fmtTaskTime(iso: string): string {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  )
}

// Upload a task/comment photo to the checklist-photos bucket under the
// dashboard-tasks/ prefix; returns the public URL or null on failure.
export async function uploadTaskPhoto(file: File): Promise<string | null> {
  const path = `dashboard-tasks/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
  const { data, error } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
  if (!data || error) {
    // Surface storage failures instead of silently saving a record with no photo.
    console.error('photo upload failed:', error)
    return null
  }
  // Store the storage PATH — checklist-photos is private; reads sign on demand.
  return data.path
}
