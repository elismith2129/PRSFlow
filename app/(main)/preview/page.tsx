'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /preview — device-frame viewer for reviewing branches (2026-08-14, for Eli).
//
// Squarespace-style computer/phone/ipad toggle: renders the app in an iframe
// sized to a real device, so the mobile UI can be reviewed from a desktop
// without grabbing a phone each pass. Because useIsMobile() and every
// @media (max-width: 768px) rule read the IFRAME's viewport, a 390px frame
// renders the genuine phone layout — not a scaled-down desktop.
//
// - Same-origin iframe: shares the login session automatically.
// - Unlisted route inside (main): AuthGuard applies, not in the rail.
// - Dev tool, not a staff surface: deliberately plain, no mock cycle.
// - Touch behaviour (iOS scroll lock etc.) is NOT emulated — real-phone
//   checks still matter before merge.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'

type DeviceKey = 'desktop' | 'phone' | 'ipad'

const DEVICES: Record<DeviceKey, { label: string; w: number; h: number } | null> = {
  desktop: null, // null = fill the available space, no frame
  phone: { label: 'iPhone', w: 390, h: 844 },
  ipad: { label: 'iPad', w: 820, h: 1180 },
}

const QUICK_LINKS: { label: string; path: string }[] = [
  { label: 'Dashboard', path: '/' },
  { label: 'CRM', path: '/crm' },
  { label: 'Calendar', path: '/calendar' },
  { label: 'Billing', path: '/billing' },
  { label: 'Runner hub', path: '/runner' },
]

export default function PreviewPage() {
  const [device, setDevice] = useState<DeviceKey>('phone')
  const [landscape, setLandscape] = useState(false)
  const [path, setPath] = useState('/')
  const [pathInput, setPathInput] = useState('/')
  const [reloadKey, setReloadKey] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  // Arrived via the floating DeviceToggle? Preload its page + device.
  // window.location.search, matching the CRM ?lead= pattern (no useSearchParams).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const p = params.get('path')
    const d = params.get('device')
    if (p && p.startsWith('/')) { setPath(p); setPathInput(p) }
    if (d === 'phone' || d === 'ipad' || d === 'desktop') setDevice(d)
  }, [])

  const preset = DEVICES[device]
  const frameW = preset ? (landscape ? preset.h : preset.w) : 0
  const frameH = preset ? (landscape ? preset.w : preset.h) : 0

  // Fit the device frame to the visible area (scale down only, never up).
  useEffect(() => {
    function fit() {
      if (!preset || !stageRef.current) { setScale(1); return }
      const r = stageRef.current.getBoundingClientRect()
      const s = Math.min(1, (r.width - 24) / frameW, (r.height - 24) / frameH)
      setScale(s > 0 ? s : 1)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [preset, frameW, frameH])

  function go(p: string) {
    const clean = p.startsWith('/') ? p : `/${p}`
    setPath(clean)
    setPathInput(clean)
    setReloadKey(k => k + 1)
  }

  const segBtn = (on: boolean): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 99, fontSize: 12, fontWeight: 700,
    cursor: 'pointer', border: 'none', font: 'inherit',
    background: on ? 'var(--c-wash2)' : 'transparent',
    color: 'var(--c-fg)', opacity: on ? 1 : 0.55,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 24px)', gap: 12 }}>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 99, background: 'var(--c-wash)' }}>
          {(Object.keys(DEVICES) as DeviceKey[]).map(k => (
            <button key={k} style={segBtn(device === k)} onClick={() => setDevice(k)}>
              {k === 'desktop' ? 'Computer' : DEVICES[k]!.label}
            </button>
          ))}
        </div>
        {preset && (
          <button style={segBtn(landscape)} onClick={() => setLandscape(l => !l)}>
            ⟳ Rotate
          </button>
        )}
        <form
          onSubmit={e => { e.preventDefault(); go(pathInput) }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 200 }}
        >
          <input
            className="c-input"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            placeholder="/runner"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button style={segBtn(false)} type="submit">Go</button>
          <button style={segBtn(false)} type="button" onClick={() => setReloadKey(k => k + 1)}>Reload</button>
        </form>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {QUICK_LINKS.map(l => (
          <button key={l.path} style={segBtn(path === l.path)} onClick={() => go(l.path)}>
            {l.label}
          </button>
        ))}
        {preset && (
          <span style={{ fontSize: 11, opacity: 0.45, alignSelf: 'center', marginLeft: 'auto' }}>
            {frameW} × {frameH}{scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ''} · looks only — touch quirks still need a real phone
          </span>
        )}
      </div>

      {/* ── Stage ────────────────────────────────────────────────────────── */}
      <div ref={stageRef} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto' }}>
        {preset ? (
          <div style={{
            width: frameW * scale, height: frameH * scale, flexShrink: 0,
          }}>
            <div style={{
              width: frameW, height: frameH,
              transform: `scale(${scale})`, transformOrigin: 'top left',
              borderRadius: 34, overflow: 'hidden',
              boxShadow: 'var(--c-softsh)', background: 'var(--c-bg)',
              // A hairline so the frame reads as an object on both themes.
              outline: '6px solid var(--c-wash2)',
            }}>
              <iframe
                key={`${device}-${landscape}-${reloadKey}`}
                src={path}
                title="Device preview"
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              />
            </div>
          </div>
        ) : (
          <iframe
            key={`desktop-${reloadKey}`}
            src={path}
            title="Desktop preview"
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: 18, boxShadow: 'var(--c-softsh)', background: 'var(--c-bg)' }}
          />
        )}
      </div>
    </div>
  )
}
