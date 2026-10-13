'use client'
import React, { useEffect, useRef } from 'react'

/**
 * THE SHARED PAGE TOP — one search bar, one header, one row of view tabs, the
 * same on every page (Eli, 2026-10-12, the Ramp rework:
 * docs/design-refs/rail-header-real-pages.html). Before this, every page built
 * its own top: big title-words on the CRM, Billing and Daily Ops, a small title
 * on Lakers / SRS / Petty Cash, a label over a title on Engineers and Shift
 * Notes, and no title at all on Memos, Punches, Hiring and Positions.
 *
 * THE RULES (the six on the mock — keep them, they are the point):
 *  1. The small grey label is the RAIL GROUP the page lives in. The title is
 *     the page's name. One size, one place.
 *  2. ONE search bar, at the very top, and only on a page that has a list to
 *     search — leave `search` off and there is no bar (Dashboard, Training…).
 *     A page never keeps a second search box of its own further down.
 *  3. UNDERLINED WORDS SWITCH THE VIEW. Pills only ever filter the list you
 *     are on. (The underline is one of the two sanctioned exceptions to the
 *     no-lines law — the other is the outline on the rail's current page.)
 *  4. Buttons sit on the right. The main one is .c-btn (the light pill); any
 *     other is .c-soft. Never a green pill, never a grey chip.
 *  5. An explanation goes behind the "?" (pass a <Hint/> as `hint`), not in a
 *     paragraph under the title.
 *
 * It owns no data and no state: the page passes the query in and gets changes
 * back, exactly like a controlled input. A count that needs you (`hot`) stays
 * full strength even on a tab you are not on — the Billing Hub's COD rule:
 * a number that needs you is never quiet.
 */

export type PageView<K extends string = string> = {
  key: K
  label: string
  /** Shown beside the word, mono and quiet. Omit or null for no count. */
  count?: number | null
  /** The count is a red pill. For "needs you now" only (stale leads, a COD
   *  balance) — never decoration. */
  hot?: boolean
  title?: string
}

export function PageTop<K extends string = string>({
  crumb, title, hint, actions, search, views, view, onView, dimViews,
}: {
  /** The rail group this page sits in ("CRM", "Billing"). Omit for a page that
   *  is its own row on the rail (Calendar). */
  crumb?: string
  title: string
  /** A <Hint tip="…" /> — the "?" beside the title. */
  hint?: React.ReactNode
  /** Buttons for the right-hand side. */
  actions?: React.ReactNode
  /** Omit on a page with nothing to search. */
  search?: { value: string; onChange: (v: string) => void; placeholder: string }
  views?: PageView<K>[]
  view?: K
  onView?: (key: K) => void
  /** Grey the view tabs out while a search is overriding them (a search looks
   *  across every view, so leaving one lit would imply it filters the hits). */
  dimViews?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const hasSearch = !!search

  // ⌘K / Ctrl+K puts the cursor in the search from anywhere on the page.
  useEffect(() => {
    if (!hasSearch) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hasSearch])

  return (
    <div className="c-pagetop">
      {search && (
        <label className="c-topsearch">
          <span className="c-topsearch-gl" aria-hidden>⌕</span>
          <input
            ref={inputRef}
            value={search.value}
            onChange={e => search.onChange(e.target.value)}
            // Esc empties the bar: a search is a detour, and one key gets you back.
            onKeyDown={e => { if (e.key === 'Escape' && search.value) { e.preventDefault(); search.onChange('') } }}
            placeholder={search.placeholder}
            autoComplete="off"
            spellCheck={false}
            aria-label={search.placeholder}
          />
          {search.value
            ? <span className="c-bclr" role="button" onClick={e => { e.preventDefault(); search.onChange(''); inputRef.current?.focus() }}>clear ✕</span>
            : <span className="c-kbd" aria-hidden>⌘K</span>}
        </label>
      )}

      <div className="c-ph">
        <div style={{ minWidth: 0 }}>
          {crumb && <span className="c-ph-crumb">{crumb}</span>}
          <h1>{title}{hint}</h1>
        </div>
        {actions && <div className="c-ph-actions">{actions}</div>}
      </div>

      {views && views.length > 0 && (
        <div className={`c-views${dimViews ? ' c-dim' : ''}`} role="tablist">
          {views.map(v => (
            <button
              key={v.key}
              type="button"
              role="tab"
              className={`c-view${view === v.key ? ' c-on' : ''}`}
              aria-selected={view === v.key}
              aria-current={view === v.key ? 'page' : undefined}
              title={v.title}
              onClick={() => onView?.(v.key)}
            >
              {v.label}
              {v.count != null && (
                <span className={`c-view-n${v.hot ? ' c-hot' : ''}`}>{v.hot && v.count > 99 ? '99+' : v.count}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
