// ─────────────────────────────────────────────────────────────────────────────
// lib/draft — phone-side draft persistence for the runner's batch pages
// (Eli, 2026-08-24: "anything a runner types in … saves when they navigate
// away or don't hit save. I'm counting on errors in saving and navigating
// away and I don't want their input to get wiped.")
//
// The batch pages (stock, petty cash, mics) hold typed input in React state
// until an explicit Save — so a back-tap, a crashed save, or iOS killing the
// PWA silently discarded everything. This mirrors that state into
// localStorage as they type; the page re-applies it on the next visit and
// clears it after a SUCCESSFUL save. Not realtime, not shared between
// devices, not a sync layer — just the phone remembering what its own runner
// typed. Checklists don't need this (they save on every tap).
//
// Keys embed the date, and every write prunes drafts older than 3 days, so
// stale drafts age out instead of resurrecting last week's counts.
// ─────────────────────────────────────────────────────────────────────────────

const PREFIX = 'prsflo-draft:'

/** `draftKey('stock', 'paramount', '2026-08-24')` — date LAST (pruning reads it). */
export function draftKey(page: string, studio: string, date: string): string {
  return `${PREFIX}${page}:${studio}:${date}`
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    pruneDrafts()
  } catch {
    // Quota/private-mode failures lose nothing the page didn't already hold.
  }
}

export function clearDraft(key: string): void {
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}

function pruneDrafts(): void {
  try {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 3)
    const cut = cutoff.toISOString().slice(0, 10)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      const date = k.slice(k.lastIndexOf(':') + 1)
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < cut) localStorage.removeItem(k)
    }
  } catch { /* ignore */ }
}
