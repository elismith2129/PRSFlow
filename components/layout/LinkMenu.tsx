'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

/**
 * OPEN IN A NEW WINDOW (option D, nav-memory-options.html, Eli 2026-11-09:
 * "a simple open in new window option could be a helpful option").
 *
 * The honest answer to "tabs": staff already have browser tabs. This makes
 * every rail link open in one, at the remembered address (lib/navMemory).
 * Three ways in, all small:
 *   · desktop hover — a ↗ at the right edge of the row (CSS, .c-rail-nw)
 *   · right-click — a little menu: Open · Open in new window · Copy link
 *   · touch long-press (550ms) — the same menu; iPad Safari does not fire
 *     contextmenu for a long press reliably, so the timer is the real path.
 * ⌘/Ctrl-click already worked on every link; nothing here changes that.
 *
 * `MenuLink` wraps ONE link row. Its children are the row's content; the
 * `href` is the remembered address. The ↗ is a sibling, never nested inside
 * the <a> (an <a> in an <a> is not HTML).
 */
type MenuState = { x: number; y: number } | null

export function MenuLink({
  href, label, className, style, onNavigate, children, ariaCurrent,
}: {
  href: string; label: string; className?: string; style?: React.CSSProperties
  onNavigate?: () => void; children: React.ReactNode; ariaCurrent?: 'page'
}) {
  const router = useRouter()
  const [menu, setMenu] = useState<MenuState>(null)
  const timer = useRef<number | null>(null)
  const moved = useRef(false)

  const openNew = () => { try { window.open(href, '_blank', 'noopener') } catch { /* popup blocked */ } }
  const copy = () => { try { navigator.clipboard?.writeText(window.location.origin + href) } catch { /* no clipboard */ } }

  const onContextMenu = (e: React.MouseEvent) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }
  const onTouchStart = (e: React.TouchEvent) => {
    moved.current = false
    const t = e.touches[0]
    timer.current = window.setTimeout(() => { if (!moved.current) setMenu({ x: t.clientX, y: t.clientY }) }, 550)
  }
  const cancel = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null } }
  const onTouchMove = () => { moved.current = true; cancel() }
  const onTouchEnd = (e: React.TouchEvent) => { if (menu) e.preventDefault(); cancel() }

  return (
    <div className="c-rail-row" onContextMenu={onContextMenu} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={cancel}>
      <Link href={href} className={className} style={style} aria-current={ariaCurrent} onClick={e => { if (menu) { e.preventDefault(); return } onNavigate?.() }}>
        {children}
      </Link>
      <button type="button" className="c-rail-nw" onClick={e => { e.stopPropagation(); openNew() }} title={`Open ${label} in a new window`} aria-label={`Open ${label} in a new window`} tabIndex={-1}>↗</button>
      {menu && <Popup x={menu.x} y={menu.y} label={label} onClose={() => setMenu(null)} onOpen={() => { setMenu(null); onNavigate?.(); router.push(href) }} onNew={() => { setMenu(null); openNew() }} onCopy={() => { setMenu(null); copy() }} />}
    </div>
  )
}

function Popup({ x, y, label, onClose, onOpen, onNew, onCopy }: {
  x: number; y: number; label: string; onClose: () => void; onOpen: () => void; onNew: () => void; onCopy: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // Next tick so the opening press does not close it.
    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', away, true)
      document.addEventListener('keydown', key)
    }, 0)
    return () => { window.clearTimeout(id); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key) }
  }, [onClose])
  // Keep it on screen.
  const w = 190, h = 118
  const left = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - w - 8)
  const top = Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 9999) - h - 8)
  return (
    <div ref={ref} className="c-linkmenu" style={{ left, top }} role="menu" aria-label={label}>
      <button type="button" role="menuitem" onClick={onOpen}>Open {label}</button>
      <button type="button" role="menuitem" onClick={onNew}>Open in new window ↗</button>
      <button type="button" role="menuitem" className="c-sep" onClick={onCopy}>Copy link</button>
    </div>
  )
}
