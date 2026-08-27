'use client'
// ─────────────────────────────────────────────────────────────────────────────
// RichNote — the app's ONLY rich-text surface (Eli, 2026-08-26): bold,
// bullet points, tab/shift-tab indent. Nothing else, on purpose — "think
// Apple Notes", scoped to what the notes actually need.
//
// No editor dependency (nine-dep rule): the browser's native editing engine
// via contentEditable + execCommand. execCommand is deprecated-but-immortal —
// every browser ships it; if it ever actually degrades, THAT is the day this
// file gets swapped for a real editor. For two buttons and a tab key it is
// the right-sized tool.
//
// Storage is a small HTML string. EVERYTHING renders through sanitizeNote(),
// a strict whitelist (b/strong/ul/ol/li/div/p/br, zero attributes) — pasted
// markup, scripts, styles and attributes are stripped at both edit-sync and
// display, so a note can never carry anything but text, bold and bullets.
// Paste is forced to plain text. Legacy plain-text notes (no '<' in them)
// render as pre-wrap text unchanged — no data migration needed anywhere.
//
// Used by: runner shift-notes (shift_note_docs), My Day shift-note posts
// (myday_note_posts), and the Daily Ops morning-review popup (read-only).
// List indent/spacing lives in globals.css under `.c-richnote`.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'

const ALLOWED = new Set(['B', 'STRONG', 'UL', 'OL', 'LI', 'DIV', 'P', 'BR'])

/** Strict whitelist: allowed tags survive attribute-less; unknown tags are
    unwrapped to their children; script/style/head-ish nodes vanish. */
export function sanitizeNote(html: string): string {
  if (typeof window === 'undefined' || !html.includes('<')) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    const tag = el.tagName
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT') return ''
    const inner = Array.from(el.childNodes).map(clean).join('')
    if (!ALLOWED.has(tag)) return inner // unwrap
    const t = tag.toLowerCase()
    if (t === 'br') return '<br>'
    return `<${t}>${inner}</${t}>`
  }
  return Array.from(doc.body.childNodes).map(clean).join('')
}

/** Plain-text form of a note — for one-line previews and search. */
export function noteText(html: string): string {
  if (!html.includes('<') || typeof window === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** True when the note has no visible content. */
export function noteIsEmpty(html: string): boolean {
  if (!html) return true
  if (!html.includes('<')) return html.trim() === ''
  if (typeof window === 'undefined') return html.trim() === ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').trim() === ''
}

/** Read-only display. Legacy plain text renders as pre-wrap unchanged. */
export function RichNoteView({ html, className, style }: {
  html: string
  className?: string
  style?: React.CSSProperties
}) {
  if (!html.includes('<')) {
    return (
      <div className={className} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word', ...style }}>
        {html}
      </div>
    )
  }
  return (
    <div
      className={`c-richnote ${className ?? ''}`}
      style={{ overflowWrap: 'break-word', ...style }}
      // Sanitized above render — the whitelist is the whole point of this file.
      dangerouslySetInnerHTML={{ __html: sanitizeNote(html) }}
    />
  )
}

export function RichNoteEditor({ value, onChange, placeholder, minHeight = 150, startWithBullets = false, style }: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
  /** Focus on an empty note starts a bullet list (the runner default). */
  startWithBullets?: boolean
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)

  // Sync external value in — but NEVER while the runner is typing here
  // (rewriting innerHTML mid-edit throws the caret to the start).
  useEffect(() => {
    const el = ref.current
    if (!el || document.activeElement === el) return
    const next = sanitizeNote(value)
    if (el.innerHTML !== next) el.innerHTML = next
  }, [value])

  const emit = () => { if (ref.current) onChange(ref.current.innerHTML) }
  const cmd = (name: string) => {
    ref.current?.focus()
    document.execCommand(name)
    emit()
  }

  const empty = noteIsEmpty(value)

  // Tiny plain-text controls, like every text editor's toolbar — no pills
  // (Eli, 2026-08-26). Just B and a bullet dot; indent is the tab key.
  const btn: React.CSSProperties = {
    border: 'none', background: 'transparent', font: 'inherit', cursor: 'pointer',
    color: 'var(--c-fg)', fontSize: 13, lineHeight: 1, padding: '4px 7px',
    opacity: 0.55, WebkitTapHighlightColor: 'transparent',
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 2, marginBottom: 3 }}>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => cmd('bold')}
          aria-label="Bold" style={{ ...btn, fontWeight: 800 }}>B</button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => cmd('insertUnorderedList')}
          aria-label="Bullet list" style={{ ...btn, fontSize: 16 }}>•</button>
      </div>
      <div
        ref={ref}
        className="c-richnote"
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onFocus={() => {
          setFocused(true)
          // Deterministic bullet scaffold — execCommand on an empty div is
          // flaky across browsers (the "no bullet" bug). Write the list
          // directly and put the caret inside it.
          const el = ref.current
          if (startWithBullets && el && (el.textContent ?? '').trim() === '') {
            el.innerHTML = '<ul><li><br></li></ul>'
            const li = el.querySelector('li')
            const sel = window.getSelection()
            if (li && sel) {
              const range = document.createRange()
              range.setStart(li, 0)
              range.collapse(true)
              sel.removeAllRanges()
              sel.addRange(range)
            }
            emit()
          }
        }}
        onBlur={() => { setFocused(false); emit() }}
        onKeyDown={e => {
          // Tab indents, shift-tab outdents — Apple Notes muscle memory.
          if (e.key === 'Tab') {
            e.preventDefault()
            document.execCommand(e.shiftKey ? 'outdent' : 'indent')
            emit()
          }
        }}
        onPaste={e => {
          // Plain text only — outside formatting never enters a note.
          e.preventDefault()
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
          emit()
        }}
        style={{
          minHeight, width: '100%', boxSizing: 'border-box',
          background: 'var(--c-wash)', borderRadius: 12,
          padding: '12px 13px', color: 'var(--c-fg)',
          fontSize: 13.5, lineHeight: 1.65, outline: 'none',
          ...style,
        }}
      />
      {empty && !focused && placeholder && (
        <div style={{
          position: 'absolute', top: 48, left: 13, right: 13, pointerEvents: 'none',
          fontSize: 13, lineHeight: 1.6, opacity: 0.35, whiteSpace: 'pre-wrap',
        }}>
          {placeholder}
        </div>
      )}
    </div>
  )
}
