'use client'
// General notes box for a runner list page (Eli, 2026-08-28 — ARS test pass).
// One shared note per (studio, operational day, section) in
// runner_section_notes — it annotates the LIST ("entered from Ezra's
// account, office run already done"), so both shifts read and extend the
// same text. Autosaves ~1s after typing stops + flush on background/unmount
// + the lib/draft localStorage net. Plain text on purpose — it's a margin
// note, not a document. The office reads it in Daily Ops' notes popup.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { dbResult } from '@/lib/db'
import { draftKey, readDraft, writeDraft, clearDraft } from '@/lib/draft'

export function SectionNotes({ studio, date, section, label = 'General notes' }: {
  studio: string
  date: string
  section: 'stock' | 'office' | 'mics'
  label?: string
}) {
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const dirtyRef = useRef(false)
  const textRef = useRef(text); textRef.current = text
  const loadedRef = useRef(false)
  const dKey = draftKey(`secnotes-${section}`, studio, date)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('runner_section_notes')
      .select('text')
      .eq('studio', studio).eq('date', date).eq('section', section)
      .order('created_at').limit(1)
    if (!dirtyRef.current) {
      const server = data?.[0]?.text ?? ''
      setText(server)
      const draft = readDraft<string>(dKey)
      if (draft != null && draft !== server) { setText(draft); dirtyRef.current = true }
    }
    loadedRef.current = true
  }, [studio, date, section, dKey])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const ch = supabase
      .channel(`secnotes-${section}-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runner_section_notes' }, () => {
        if (!dirtyRef.current) load()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [studio, section, load])

  const save = useCallback(async () => {
    const body = { studio, date, section, text: textRef.current }
    setState('saving')
    const { error } = await supabase
      .from('runner_section_notes')
      .upsert(body, { onConflict: 'studio,date,section' })
    if (!dbResult('Saving notes', error)) { setState('error'); return }
    if (textRef.current === body.text) {
      dirtyRef.current = false
      clearDraft(dKey)
      setState('saved')
    }
  }, [studio, date, section, dKey])
  const saveRef = useRef(save); saveRef.current = save

  useEffect(() => {
    if (!loadedRef.current || !dirtyRef.current) return
    writeDraft(dKey, text)
    const t = setTimeout(() => { saveRef.current() }, 1000)
    return () => clearTimeout(t)
  }, [text, dKey])

  useEffect(() => {
    const flush = () => { if (dirtyRef.current) saveRef.current() }
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  return (
    <div style={{ background: 'var(--c-srf, var(--c-bg))', boxShadow: 'var(--c-softsh)', borderRadius: 14, padding: '11px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 0.55 }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 700, opacity: state === 'error' ? 1 : 0.4, color: state === 'error' ? 'var(--c-st-hot)' : 'var(--c-fg)' }}>
          {state === 'saving' ? 'Saving…' : state === 'error' ? 'NOT saved' : state === 'saved' ? 'Saved' : 'Saves by itself'}
        </span>
      </div>
      <textarea
        value={text}
        onChange={e => { dirtyRef.current = true; setText(e.target.value) }}
        placeholder="Anything the office should know about this list…"
        rows={2}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'none', minHeight: 54,
          background: 'var(--c-wash)', border: 'none', borderRadius: 10,
          padding: '9px 11px', color: 'var(--c-fg)', font: 'inherit',
          fontSize: 12.5, lineHeight: 1.55, outline: 'none',
        }}
        onInput={e => {
          const ta = e.currentTarget
          ta.style.height = 'auto'
          ta.style.height = Math.max(54, ta.scrollHeight) + 'px'
        }}
      />
    </div>
  )
}
