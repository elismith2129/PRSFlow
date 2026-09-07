// ─────────────────────────────────────────────────────────────────────────────
// Flo briefing lines — the ONE shape shared by the server generator
// (lib/server/floBriefing.ts) and the dashboard reader (lib/home.ts).
// A line is a headline plus an optional `go` key naming where the reader
// acts on it (Eli 2026-09-07: "this isn't an explanation — a bullet, and a
// button to the page they need"). The model emits the key; the UI maps it
// to a route. Keep this file client-safe (no server imports).
// ─────────────────────────────────────────────────────────────────────────────

export const FLO_GO_KEYS = ['notes', 'runner-notes', 'flags', 'holds', 'tasks', 'crm'] as const
export type FloGo = (typeof FLO_GO_KEYS)[number]

export type FloLine = { text: string; go?: FloGo }

/** Where each go key lands. /shift-notes reads ?tab=runner on mount. */
export const FLO_GO_ROUTES: Record<FloGo, string> = {
  'notes': '/shift-notes',
  'runner-notes': '/shift-notes?tab=runner',
  'flags': '/flags',
  'holds': '/calendar',
  'tasks': '/tasks',
  'crm': '/crm',
}

/** Chip label per key (the arrow is added by the renderer). */
export const FLO_GO_LABELS: Record<FloGo, string> = {
  'notes': 'notes',
  'runner-notes': 'notes',
  'flags': 'flags',
  'holds': 'calendar',
  'tasks': 'tasks',
  'crm': 'crm',
}

function isGo(v: unknown): v is FloGo {
  return typeof v === 'string' && (FLO_GO_KEYS as readonly string[]).includes(v)
}

/** Normalize a stored or model-written lines array. Tolerates the pre-2026-09-07
 *  string[] rows (→ {text}) and drops unknown go keys rather than failing —
 *  a briefing with a bad link is still a briefing. */
export function normFloLines(v: unknown): FloLine[] {
  if (!Array.isArray(v)) return []
  const out: FloLine[] = []
  for (const item of v) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ text: item.trim() })
    } else if (item && typeof item === 'object') {
      const o = item as { text?: unknown; go?: unknown }
      if (typeof o.text !== 'string' || !o.text.trim()) continue
      out.push(isGo(o.go) ? { text: o.text.trim(), go: o.go } : { text: o.text.trim() })
    }
  }
  return out
}
