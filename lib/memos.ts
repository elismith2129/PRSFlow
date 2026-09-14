// ─────────────────────────────────────────────────────────────────────────────
// lib/memos — company memos (Eli, 2026-09-14; mock docs/design-refs/
// memos-options.html; migration 20260914160000).
//
// A memo is addressed to an AUDIENCE by role and shows as a full-screen
// pop-up on the person's landing surface (dashboard / runner hub — never
// inside a work order). Reading it is a receipt; signing it is initials.
//
// SOFT THEN HARD (Eli): one "I'll read it later" per memo; HARD_AFTER_HOURS
// after that press the memo blocks until signed. Both derive from the
// receipt — nothing is scheduled, nothing runs on a timer.
//
// Audience is strict and enforced in RLS (memo_audiences_for_me): runners
// never see 'admin', admin never sees 'runners', 'everyone' reaches both.
// Owners + managers see every memo (they send them) and every receipt.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, type UserProfile } from '@/lib/supabase'
import { dbResult } from '@/lib/db'

export type MemoAudience = 'admin' | 'runners' | 'everyone'
export type MemoKind = 'note' | 'page'

export type Memo = {
  id: string
  title: string
  kind: MemoKind
  body_html: string
  audience: MemoAudience
  requires_ack: boolean
  sent_by: string | null
  sent_by_name: string | null
  sent_at: string
  archived_at: string | null
}

export type MemoReceipt = {
  memo_id: string
  user_id: string
  first_seen_at: string
  deferred_at: string | null
  acknowledged_at: string | null
  initials: string | null
}

/** Hours after the one "later" before the memo blocks the app. */
export const HARD_AFTER_HOURS = 48

export const AUDIENCE_LABEL: Record<MemoAudience, string> = {
  admin: 'Admin', runners: 'Runners', everyone: 'Everyone',
}

/** Who a memo reaches, by role — the same rule the RLS applies. */
export function audienceRoles(a: MemoAudience): UserProfile['role'][] {
  const admin: UserProfile['role'][] = ['owner', 'manager', 'billing', 'asst_manager', 'tech']
  if (a === 'runners') return ['runner']
  if (a === 'admin') return admin
  return [...admin, 'runner']
}

export function canSendMemos(role: UserProfile['role'] | undefined | null): boolean {
  return role === 'owner' || role === 'manager'
}

// ── A person's own view ───────────────────────────────────────────────────────

export type MyMemo = Memo & { receipt: MemoReceipt | null }

/** The audiences that reach a role — mirrors memo_audiences_for_me() in SQL. */
export function audiencesFor(role: UserProfile['role'] | null | undefined): MemoAudience[] {
  if (!role) return []
  return role === 'runner' ? ['runners', 'everyone'] : ['admin', 'everyone']
}

/**
 * Everything addressed to ME, newest first, with my receipt. RLS does the
 * addressing for staff — but a sender (owner/manager) can SELECT every memo,
 * so the audience is applied here too: a runner-only memo must never pop for
 * Eli, and must not sit on his personal board (it is on his SENT list).
 */
export async function fetchMyMemos(me: Pick<UserProfile, 'id' | 'role'>): Promise<MyMemo[]> {
  const [{ data: memos, error }, { data: rec, error: rErr }] = await Promise.all([
    supabase.from('memos').select('*').is('archived_at', null).in('audience', audiencesFor(me.role)).order('sent_at', { ascending: false }),
    supabase.from('memo_receipts').select('*').eq('user_id', me.id),
  ])
  if (!dbResult('Loading memos', error) || !dbResult('Loading memo receipts', rErr)) return []
  const mine = new Map((rec ?? []).map(r => [r.memo_id, r as MemoReceipt]))
  return (memos ?? []).map(m => ({ ...(m as Memo), receipt: mine.get(m.id) ?? null }))
}

/** Signed, or a just-read memo that has been opened. */
export function isDone(m: MyMemo): boolean {
  if (!m.receipt) return false
  return m.requires_ack ? !!m.receipt.acknowledged_at : true
}

/** Deferred, and the grace period has run out — the gate goes hard. */
export function isHard(m: MyMemo, now = Date.now()): boolean {
  const d = m.receipt?.deferred_at
  if (!d || isDone(m)) return false
  return now - new Date(d).getTime() >= HARD_AFTER_HOURS * 3600 * 1000
}

/** When a deferred memo turns hard, for the "blocks Wed 9:12 PM" copy. */
export function hardAt(m: MyMemo | MemoReceipt | null): Date | null {
  const d = (m && 'receipt' in m ? m.receipt?.deferred_at : (m as MemoReceipt | null)?.deferred_at) ?? null
  return d ? new Date(new Date(d).getTime() + HARD_AFTER_HOURS * 3600 * 1000) : null
}

/**
 * What the pop-up shows: unread memos, oldest first (a stack of five is read
 * as five). A deferred memo whose grace has NOT run out stays out of the
 * pop-up until its next natural showing — it comes back on the next open,
 * which is exactly this call on the next mount.
 */
export function pendingMemos(all: MyMemo[]): MyMemo[] {
  return all
    .filter(m => !isDone(m))
    .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
}

export function unreadCount(all: MyMemo[]): number {
  return all.filter(m => !isDone(m)).length
}

export async function markSeen(memoId: string): Promise<void> {
  const { error } = await supabase.rpc('memo_seen', { p_memo_id: memoId })
  dbResult('Recording memo opened', error, { silent: true })
}

export async function deferMemo(memoId: string): Promise<boolean> {
  const { error } = await supabase.rpc('memo_defer', { p_memo_id: memoId })
  return dbResult('Saving "read later"', error)
}

export async function ackMemo(memoId: string, initials: string): Promise<boolean> {
  const { error } = await supabase.rpc('memo_ack', { p_memo_id: memoId, p_initials: initials })
  return dbResult('Signing memo', error)
}

/** Stamp "last opened the app" — called once per app load on both surfaces. */
export async function touchLastSeen(): Promise<void> {
  const { error } = await supabase.rpc('touch_last_seen')
  dbResult('Recording app open', error, { silent: true })
}

// ── The sender's side ─────────────────────────────────────────────────────────

export async function sendMemo(input: {
  title: string
  kind: MemoKind
  body_html: string
  audience: MemoAudience
  requires_ack: boolean
  sender: UserProfile
}): Promise<Memo | null> {
  const { data, error } = await supabase
    .from('memos')
    .insert({
      title: input.title.trim(),
      kind: input.kind,
      body_html: input.body_html,
      audience: input.audience,
      requires_ack: input.requires_ack,
      sent_by: input.sender.id,
      sent_by_name: input.sender.display_name,
    })
    .select('*')
    .single()
  if (!dbResult('Sending memo', error)) return null
  return data as Memo
}

export async function archiveMemo(memoId: string): Promise<boolean> {
  const { error } = await supabase.from('memos').update({ archived_at: new Date().toISOString() }).eq('id', memoId)
  return dbResult('Archiving memo', error)
}

export type ScoreRow = {
  user: Pick<UserProfile, 'id' | 'display_name' | 'initials' | 'role'> & { last_seen_at: string | null }
  receipt: MemoReceipt | null
  state: 'signed' | 'read' | 'deferred' | 'seen' | 'unopened'
}

export type Scoreboard = {
  rows: ScoreRow[]
  total: number
  done: number
  deferred: number
  unopened: number
}

/** Every person the memo reaches, with their receipt (or the lack of one). */
export async function fetchScoreboard(memo: Memo): Promise<Scoreboard> {
  const roles = audienceRoles(memo.audience)
  const [{ data: users, error }, { data: rec, error: rErr }] = await Promise.all([
    supabase.from('user_profiles').select('id, display_name, initials, role, last_seen_at').in('role', roles).is('deleted_at', null).order('display_name'),
    supabase.from('memo_receipts').select('*').eq('memo_id', memo.id),
  ])
  if (!dbResult('Loading memo recipients', error) || !dbResult('Loading memo receipts', rErr)) {
    return { rows: [], total: 0, done: 0, deferred: 0, unopened: 0 }
  }
  const byUser = new Map((rec ?? []).map(r => [r.user_id, r as MemoReceipt]))
  const rows: ScoreRow[] = (users ?? []).map(u => {
    const r = byUser.get(u.id) ?? null
    let state: ScoreRow['state'] = 'unopened'
    if (r?.acknowledged_at) state = 'signed'
    else if (r && !memo.requires_ack) state = 'read'
    else if (r?.deferred_at) state = 'deferred'
    else if (r) state = 'seen'
    return { user: u as ScoreRow['user'], receipt: r, state }
  })
  const done = rows.filter(r => r.state === 'signed' || r.state === 'read').length
  return {
    rows,
    total: rows.length,
    done,
    deferred: rows.filter(r => r.state === 'deferred').length,
    unopened: rows.filter(r => r.state === 'unopened').length,
  }
}

/** Sender's list: every memo (incl. archived when asked) with done/total. */
export async function fetchAllMemos(opts?: { includeArchived?: boolean }): Promise<(Memo & { done: number; total: number })[]> {
  const q = supabase.from('memos').select('*').order('sent_at', { ascending: false })
  const { data: memos, error } = opts?.includeArchived ? await q : await q.is('archived_at', null)
  if (!dbResult('Loading memos', error)) return []
  const [{ data: users }, { data: rec }] = await Promise.all([
    supabase.from('user_profiles').select('id, role').is('deleted_at', null),
    supabase.from('memo_receipts').select('memo_id, user_id, acknowledged_at'),
  ])
  const roleOf = new Map((users ?? []).map(u => [u.id, u.role as UserProfile['role']]))
  return (memos ?? []).map(m => {
    const roles = new Set(audienceRoles(m.audience as MemoAudience))
    const total = (users ?? []).filter(u => roles.has(u.role as UserProfile['role'])).length
    const done = (rec ?? []).filter(r => r.memo_id === m.id && roles.has(roleOf.get(r.user_id) as UserProfile['role']) && (m.requires_ack ? !!r.acknowledged_at : true)).length
    return { ...(m as Memo), done, total }
  })
}
