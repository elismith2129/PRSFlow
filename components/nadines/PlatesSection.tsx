'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Nadine's → Plates. Renders and key site photos.
//
// Files are served from `public/nadines/` and named by PLATES[].file in
// lib/nadines.ts. There is no upload flow and no `storage` bucket here on
// purpose: these are a handful of fixed reference images that belong with the
// build, not user content — dropping a file in the folder is the whole workflow,
// and it costs no table, no bucket policy and no signed URLs.
//
// A slot whose file isn't present yet renders as a labelled placeholder rather
// than a broken image, so the gallery reads as "4 of 10 in" instead of looking
// broken. Detection is client-side via onError, because the browser is the only
// thing that knows whether the file resolved.
//
// Provenance rule from the brief §6: the 33 ultra-wide 14mm photos are DISTORTED
// and are documentation only — never use them here or for renders. Only the
// 24mm/24MP set is listed in PLATES.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { useIsMobile } from '@/hooks/useIsMobile'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { PLATES } from '@/lib/nadines'

export function PlatesSection() {
  const isMobile = useIsMobile()
  const [missing, setMissing] = useState<Record<string, boolean>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)

  const present = PLATES.filter(p => !missing[p.file]).length

  return (
    <div style={{ maxWidth: 900 }}>
      <SectionHeader title="Plates" count={present} countColor="teal" />

      <p
        style={{
          margin: '0 0 20px',
          fontFamily: 'Inter',
          fontSize: 12,
          lineHeight: 1.6,
          color: 'var(--text3)',
        }}
      >
        Drop files into <code style={{ fontFamily: 'DM Mono', color: 'var(--text2)' }}>public/nadines/</code> using
        the filename shown on each empty slot. Empty slots are expected — 4 renders exist so far.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 14,
        }}
      >
        {PLATES.map(plate => {
          const isMissing = missing[plate.file]
          return (
            <div
              key={plate.file}
              onClick={isMissing ? undefined : () => setLightbox(`/nadines/${plate.file}`)}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                overflow: 'hidden',
                cursor: isMissing ? 'default' : 'zoom-in',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  // 3:2 — the native aspect of the 24MP 24mm set.
                  aspectRatio: '3 / 2',
                  background: 'var(--surface2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isMissing ? (
                  <div style={{ textAlign: 'center', padding: 12 }}>
                    <div
                      style={{
                        fontFamily: 'DM Mono',
                        fontSize: 11,
                        color: 'var(--text3)',
                        marginBottom: 4,
                        wordBreak: 'break-all',
                      }}
                    >
                      {plate.file}
                    </div>
                    <div
                      style={{
                        fontFamily: 'Inter',
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: 'var(--text3)',
                        opacity: 0.7,
                      }}
                    >
                      Not added yet
                    </div>
                  </div>
                ) : (
                  <img
                    src={`/nadines/${plate.file}`}
                    alt={plate.caption}
                    onError={() => setMissing(m => ({ ...m, [plate.file]: true }))}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text)' }}>
                  {plate.caption}
                </div>
                {plate.plate && (
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                    {plate.plate}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* In-app lightbox, matching the pattern used by the registration ID viewer. */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            // Below the Nav (99999) per the z-index ladder in CLAUDE.md.
            zIndex: 10001,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={lightbox}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        </div>
      )}
    </div>
  )
}

export default PlatesSection
