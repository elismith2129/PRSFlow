'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /runner/[studio]/notes — the notes ROOM (Eli, 2026-09-15; option A of
// docs/design-refs/runner-channel-options.html). Full screen: title, tabs for
// this studio and General with unread / for-you counts, then the channel
// (feed + pinned composer). The hub keeps a doorway; this is the room.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useReloadOnReturn } from '@/hooks/useReloadOnReturn'
import { RunnerNotesChannel } from '@/components/runner/RunnerNotesChannel'
import { type ChannelKey, type ChannelUnread, CHANNEL_SHORT, fetchChannelUnread, isChannel } from '@/lib/runnerChannel'

const STUDIO_META: Record<string, { label: string }> = {
  paramount: { label: 'Paramount' },
  ameraycan: { label: 'Ameraycan' },
  encore: { label: 'Encore' },
  track: { label: 'Track' },
}

export default function NotesRoomPage() {
  const router = useRouter()
  const params = useSearchParams()
  const { studio } = useParams<{ studio: string }>()
  const meta = STUDIO_META[studio] ?? { label: studio }
  const { profile } = useUserProfile()
  const home: ChannelKey = isChannel(studio) ? studio : 'general'
  const tabs: ChannelKey[] = home === 'general' ? ['general'] : [home, 'general']
  const wanted = params.get('c')
  const [tab, setTab] = useState<ChannelKey>(wanted && isChannel(wanted) && tabs.includes(wanted) ? wanted : home)
  const [unread, setUnread] = useState<ChannelUnread[]>([])
  // ONE runner_note_posts subscription on this page (standing rule): the
  // page holds it and bumps the feed via reloadKey; the feed doesn't subscribe.
  const [feedV, setFeedV] = useState(0)

  const loadUnread = useCallback(async () => {
    if (!profile) return
    setUnread(await fetchChannelUnread(profile, tabs))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, studio])
  useEffect(() => { loadUnread() }, [loadUnread])
  useReloadOnReturn(loadUnread)
  useEffect(() => {
    const ch = supabase
      .channel(`runner-notes-room-${studio}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runner_note_posts' }, () => { loadUnread(); setFeedV(v => v + 1) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runner_note_reads' }, () => loadUnread())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_tasks' }, () => setFeedV(v => v + 1))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [studio, loadUnread])

  const countFor = (c: ChannelKey) => unread.find(u => u.channel === c)

  return (
    <div style={{
      height: '100dvh', maxWidth: '100vw', overflow: 'hidden',
      background: 'var(--c-bg)', color: 'var(--c-fg)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: 'calc(12px + env(safe-area-inset-top, 0px)) 14px 0', background: 'var(--c-bg)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 8 }}>
          <button
            onClick={() => router.push(`/runner/${studio}`)}
            aria-label="Back"
            className="c-control c-raised"
            style={{ width: 38, height: 38, borderRadius: 99, flexShrink: 0, background: 'var(--c-wash)', color: 'var(--c-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, cursor: 'pointer' }}
          >←</button>
          <div>
            <div className="c-arch" style={{ fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Notes</div>
            <div style={{ fontSize: 11.5, opacity: 0.5 }}>
              {tab === 'general' ? 'General · every studio sees this' : `${meta.label} · everyone here sees this`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 5, paddingBottom: 8 }}>
          {tabs.map(c => {
            const on = c === tab
            const u = countFor(c)
            return (
              <button
                key={c}
                onClick={() => setTab(c)}
                style={{
                  border: 'none', font: 'inherit', cursor: 'pointer',
                  background: on ? 'var(--c-wash2)' : 'var(--c-wash)', color: 'var(--c-fg)',
                  borderRadius: 99, padding: '7px 13px', minHeight: 32,
                  fontSize: 10.5, fontWeight: 800, letterSpacing: '0.03em',
                  opacity: on ? 1 : 0.7,
                  boxShadow: on ? 'inset 0 0 0 1.5px rgba(217,214,205,0.25)' : undefined,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {CHANNEL_SHORT[c]}
                {u && !on && u.unread > 0 && (
                  <span className="c-mono" style={{ fontSize: 8.5, fontWeight: 700, borderRadius: 99, padding: '1px 6px', background: u.forMe > 0 ? 'var(--c-st-warm)' : 'var(--c-wash2)', color: u.forMe > 0 ? 'var(--c-chip-ink)' : 'var(--c-fg-2)' }}>
                    {u.unread > 30 ? '30+' : u.unread}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      <RunnerNotesChannel key={tab} channel={tab} variant="room" subscribe={false} reloadKey={feedV} />
    </div>
  )
}
