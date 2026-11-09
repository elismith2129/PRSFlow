'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ADDR_EVENT, basePath, pageName, readHop, rememberedContext, writeHop } from '@/lib/navMemory'

/**
 * THE RETURN PILL (option B, nav-memory-options.html, Eli 2026-11-09).
 *
 * Arrive on a page from a different page and a small pill at the top says
 * where you came from — "← Back to Billing hub · Needs review" — and takes
 * you straight back to that exact address. ONE level deep by design: it is
 * not a breadcrumb trail; three pages in, it still names only the page you
 * were on last. The rail is the trail.
 *
 * This component also does the remembering. Mounted once in the main layout,
 * it watches the path: when the base path changes, the page you were on
 * becomes `from` and the new page becomes `here`. `here.href` is kept current
 * as the page rewrites its own query (useAddress fires ADDR_EVENT), so the
 * next page points back at the exact view, not the bare path.
 *
 * Hidden when: fresh tab (nothing before), the hop is this same page (a view
 * switch is replaceState and never gets here), or you ✕'d it. The ↗ on the
 * pill opens the previous page in a new window instead (option D).
 */
export function ReturnPill() {
  const pathname = usePathname()
  const router = useRouter()
  const [from, setFrom] = useState<{ href: string; base: string } | null>(null)

  useEffect(() => {
    const base = basePath(pathname)
    const here = { href: window.location.pathname + window.location.search, base }
    const prev = readHop()
    let next
    if (!prev) next = { here, from: null, dismissed: false }
    else if (prev.here.base !== base) next = { here, from: prev.here, dismissed: false }
    else next = { ...prev, here: { ...prev.here, href: here.href } }
    writeHop(next)
    setFrom(next.from && !next.dismissed && next.from.base !== base ? next.from : null)

    const onAddr = (e: Event) => {
      const href = (e as CustomEvent<string>).detail
      const cur = readHop(); if (!cur || cur.here.base !== base) return
      writeHop({ ...cur, here: { href, base } })
    }
    window.addEventListener(ADDR_EVENT, onAddr)
    return () => window.removeEventListener(ADDR_EVENT, onAddr)
  }, [pathname])

  if (!from) return null
  const ctx = rememberedContext(from.base)
  // Going back is an ordinary hop: on the old page the pill then offers the
  // page you just left, which is what the browser's own Back does too.
  const go = () => router.push(from.href)
  const dismiss = () => {
    const cur = readHop(); if (cur) writeHop({ ...cur, dismissed: true })
    setFrom(null)
  }
  const name = pageName(from.base)
  return (
    <div className="c-return" role="navigation" aria-label="Return to previous page">
      <button type="button" className="c-return-go" onClick={go}>
        <span className="c-return-arr">←</span>
        <span>Back to {name}</span>
        {ctx && <span className="c-return-ctx">· {ctx}</span>}
      </button>
      <a className="c-return-nw" href={from.href} target="_blank" rel="noopener" title={`Open ${name} in a new window`}>↗</a>
      <button type="button" className="c-return-x" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  )
}
