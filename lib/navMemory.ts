'use client'
import { useEffect, useRef } from 'react'

/**
 * NAV MEMORY (Eli, 2026-11-09 — docs/design-refs/nav-memory-options.html).
 *
 * "Say you're in the billing hub and you need to look at the calendar real
 * quick. It's difficult because when you come back … it just defaults to the
 * front page and it doesn't stick to where you are."
 *
 * The fault: a page's position (which view, which bins, which week) lived in
 * React state. Leave the page, the state is gone. This file is the one small
 * memory the app has about where you were:
 *
 *   1. A page writes its position into the ADDRESS (`?v=cod&bins=balance`)
 *      with history.replaceState — no navigation, no re-render, the Back
 *      button and a bookmark both land on the exact view.
 *   2. The same address is remembered PER DEVICE under the page's path, so
 *      the rail's link to that page can point at it instead of the bare path.
 *   3. The page you came FROM is remembered for one hop, so the return pill
 *      can say "← Back to Billing hub · Needs review".
 *
 * Nothing here touches the database. localStorage for the per-device memory
 * (survives a reload), sessionStorage for the one-hop return (dies with the
 * tab, which is right: a new tab has no "back").
 *
 * In-app tabs were considered and REJECTED (pages would stay mounted together
 * — one-realtime-channel-per-table-per-page, iPad memory). The browser already
 * has tabs; option D just makes every link open in one at the right address.
 */

const ADDR = 'prsflo-addr:'       // + base path → { href, ctx }
const FROM = 'prsflo-from'        // one hop, see NavHop
/** Fired by useAddress after it rewrites the address, so the Rail and the
 *  ReturnPill can refresh without polling. detail = the remembered href. */
export const ADDR_EVENT = 'prsflo-addr'

export type Remembered = { href: string; ctx?: string }

function safe<T>(fn: () => T, fallback: T): T { try { return fn() } catch { return fallback } }

/** The human name of a page, for the pill and the new-window menu. Base path
 *  only. Keep in step with the Rail's items. */
export const PAGE_NAMES: Record<string, string> = {
  '/': 'Dashboard', '/calendar': 'Calendar', '/crm': 'CRM', '/texting': 'Texting & campaigns',
  '/lakers': 'Lakers', '/billing': 'Billing hub', '/petty-cash': 'Petty cash', '/srs': 'SRS',
  '/ap-protocols': 'Client AP protocols', '/memos': 'Memos', '/shift-notes': 'Shift notes',
  '/daily-ops': 'Daily ops', '/runner': 'Runner hub', '/mic-inventory': 'Mic inventory',
  '/engineers': 'Engineers', '/nadines': "Nadine's", '/punches': 'Punches', '/hiring': 'Hiring',
  '/training': 'Training', '/rates': 'Rates', '/positions': 'Positions', '/feedback': 'DEV',
}
export function pageName(base: string): string {
  return PAGE_NAMES[base] ?? base.replace(/^\//, '').replace(/-/g, ' ')
}
export function basePath(href: string): string {
  const p = href.split('?')[0].split('#')[0]
  return p.length > 1 ? p.replace(/\/$/, '') : p
}

/** Where the rail should send someone for `base`: the address they last had
 *  open there, or the bare path. */
export function rememberedAddress(base: string): string {
  return safe(() => (JSON.parse(localStorage.getItem(ADDR + base) || 'null') as Remembered | null)?.href, undefined) ?? base
}
export function rememberedContext(base: string): string | undefined {
  return safe(() => (JSON.parse(localStorage.getItem(ADDR + base) || 'null') as Remembered | null)?.ctx, undefined)
}

/** Read one search param from the live address (no useSearchParams, so no
 *  Suspense boundary — same pattern as the CRM's ?lead= handling). */
export function readParam(key: string): string | null {
  return safe(() => new URLSearchParams(window.location.search).get(key), null)
}

/**
 * The page calls this with its position. Each change rewrites the address
 * in place and remembers it. `ctx` is the few words the return pill shows
 * after the page name ("Needs review", "Week of Nov 9").
 *
 * Only the keys given are touched; params the page does not own (e.g. the
 * calendar's ?newBooking= deep links) are left alone. An empty / undefined
 * value removes the key, so the default state leaves a clean address.
 */
export function useAddress(
  state: Record<string, string | undefined | null>,
  ctx?: string,
  /** One-shot deep-link params the page acts on once (?newBooking=, ?lead=).
   *  They are never remembered, and while one is in the live address the
   *  address is left alone so the page's own effect gets to read it. */
  drop: string[] = [],
) {
  const first = useRef(true)
  const json = JSON.stringify(state)
  const dropKey = drop.join(',')
  useEffect(() => {
    const base = basePath(window.location.pathname)
    const sp = new URLSearchParams(window.location.search)
    const oneShot = drop.some(k => sp.has(k))
    for (const [k, v] of Object.entries(state)) {
      if (v == null || v === '') sp.delete(k); else sp.set(k, v)
    }
    const liveQs = sp.toString()
    const liveHref = base + (liveQs ? '?' + liveQs : '')
    // First run: the page has just restored itself from this very address —
    // don't rewrite it until something actually changes.
    if (!first.current && !oneShot && liveHref !== window.location.pathname + window.location.search) {
      safe(() => window.history.replaceState(window.history.state, '', liveHref), undefined)
    }
    first.current = false
    for (const k of drop) sp.delete(k)
    const memQs = sp.toString()
    const memHref = base + (memQs ? '?' + memQs : '')
    safe(() => localStorage.setItem(ADDR + base, JSON.stringify({ href: memHref, ctx } satisfies Remembered)), undefined)
    safe(() => window.dispatchEvent(new CustomEvent(ADDR_EVENT, { detail: memHref })), undefined)
  }, [json, ctx, dropKey]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** One hop of history, kept by ReturnPill. `here` is the page you are on
 *  (full address, kept current as the page rewrites its query); `from` is
 *  the page before it. */
export type NavHop = { here: { href: string; base: string }; from: { href: string; base: string } | null; dismissed: boolean }
export function readHop(): NavHop | null {
  return safe(() => JSON.parse(sessionStorage.getItem(FROM) || 'null') as NavHop | null, null)
}
export function writeHop(hop: NavHop) {
  safe(() => sessionStorage.setItem(FROM, JSON.stringify(hop)), undefined)
}
