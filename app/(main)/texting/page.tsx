'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase, Lead } from '@/lib/supabase'
import { STARTER_TAGS } from '@/lib/tags'
import { TextingListView } from '@/components/crm/TextingListView'
import { CampaignsPanel } from '@/components/crm/CampaignsPanel'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useUserProfile } from '@/hooks/useUserProfile'
import { useWebInquiries } from '@/components/notifications/WebInquiryProvider'
import { PageTop } from '@/components/layout/PageTop'

/**
 * TEXTING & CAMPAIGNS — the two outreach tabs, on a page of their own
 * (Eli, 2026-10-12, the rail rework: "leaving clients/crm/reg on the same page,
 * then one for campaigns/texting"). They were the 4th and 5th title-words on
 * /crm; both views are moved here unchanged (TextingListView, CampaignsPanel).
 *
 * ELI ONLY (ruling, same day: "campaigns and texting should be Eli only").
 * Campaigns always was; Texting was open to every CRM role and is not any more.
 * Same shape of gate as /nadines: the rail hides the item and this guards the
 * page BODY, so typing /texting does nothing for anyone else. NEITHER IS A DATA
 * BOUNDARY — the texting list is read from `clients`, which every CRM role can
 * read anyway, and a campaign send is gated separately by /api/send-campaign.
 *
 * Wears the shared page top (components/layout/PageTop) since 2026-10-13; the
 * search bar feeds the texting list.
 */
export default function TextingPage() {
  // Carved surfaces paint their own ground — same mount/unmount marker as /crm.
  useEffect(() => {
    document.documentElement.classList.add('c-page')
    return () => document.documentElement.classList.remove('c-page')
  }, [])

  const isMobile = useIsMobile()
  const { profile, loading: profileLoading } = useUserProfile()
  const isEli = profile?.email === 'eli@paramountrecording.com'
  // Real-time: the shared leads channel (WebInquiryProvider) bumps this on any
  // leads change. Campaigns builds its recipient list from leads; never open a
  // second leads channel for it.
  const { leadsVersion } = useWebInquiries()
  const [tab, setTab] = useState<'texting' | 'campaigns'>('texting')
  const [query, setQuery] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])

  // Same paged read as the CRM page — a bare select stops at 1,000 rows and
  // would quietly shorten a campaign's recipient list.
  const load = useCallback(async () => {
    let all: Lead[] = []
    let from = 0
    const BATCH = 1000
    while (true) {
      const { data, error } = await supabase
        .from('leads').select('*')
        .order('created_at', { ascending: false })
        .range(from, from + BATCH - 1)
      if (error || !data || data.length === 0) break
      all = all.concat(data as Lead[])
      if (data.length < BATCH) break
      from += BATCH
    }
    setLeads(all)
  }, [])
  useEffect(() => { if (isEli) load() }, [isEli, load, leadsVersion])

  // Render nothing until the profile resolves, so the page never flashes its
  // contents to someone before the gate closes.
  if (profileLoading) return null
  if (!isEli || !profile) {
    return <div className="c-bempty">Texting and campaigns are Eli&apos;s page.</div>
  }

  const allTags = Array.from(new Set([...STARTER_TAGS, ...leads.flatMap(l => l.tags || [])])).sort((a, b) => a.localeCompare(b))

  return (
    // The CRM's own frame (90% zoom on desktop, full-height column), so both
    // views sit exactly as they did when they were CRM tabs.
    <div style={{ display: 'flex', flexDirection: 'column', ...(isMobile
      ? { height: 'calc(100vh - 36px)' }
      : { zoom: 0.9, height: 'calc((100vh - 36px) / 0.9)' }) }}>
      {/* Counter-zoomed like the CRM page: 0.9 × 1/0.9 = 1, so the page top is
          the same size here as everywhere. Goes when the 90% zoom goes. */}
      <div style={isMobile ? { flexShrink: 0 } : { zoom: 1 / 0.9, flexShrink: 0 }}>
        <PageTop<'texting' | 'campaigns'>
          crumb="CRM"
          title="Texting & campaigns"
          search={tab === 'texting' ? { value: query, onChange: setQuery, placeholder: 'Search the text list — name, email, phone…' } : undefined}
          views={[{ key: 'texting', label: 'Texting' }, { key: 'campaigns', label: 'Campaigns' }]}
          view={tab}
          onView={setTab}
        />
      </div>

      {tab === 'texting' && (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <TextingListView search={query} />
        </div>
      )}

      {tab === 'campaigns' && (
        <CampaignsPanel leads={leads} allTags={allTags} profile={profile} />
      )}
    </div>
  )
}
