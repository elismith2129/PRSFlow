'use client'

// Global provider for real-time "new Web Inquiry" notifications. Mounted once in
// app/(main)/layout.tsx (inside AuthGuard), so it lives for the whole authenticated
// internal app and any page can read the unacknowledged set via useWebInquiries().
//
// Drives three notification layers:
//   1. Persistent pulse/glow on the dashboard Needs Action lead card (via isUnacked)
//   2. Browser tab title badge (document.title, driven by `count`)
//   3. Transient site-wide toasts (WebInquiryToaster reads `toasts`)
//
// "Unacknowledged" = a lead with source='Web Inquiry' still status='uncontacted'.
// A lead clears only when its status changes away from 'uncontacted' (a realtime
// UPDATE), never on click/open. State hydrates on mount so overnight inquiries
// persist across refresh/navigation even before any realtime event fires.
//
// NOTE: realtime INSERT/UPDATE only fire once `leads` is added to the
// supabase_realtime publication — see supabase/leads-realtime.sql. Until then the
// mount-time hydration still surfaces existing unaddressed inquiries.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

// One transient toast, shown when a new Web Inquiry lead arrives in real time.
export type WebInquiryToast = { key: number; leadId: number; fname: string; lname: string }

type WebInquiryContextValue = {
  // Number of unacknowledged Web Inquiry leads (drives the tab badge).
  count: number
  // True while a given lead is still unacknowledged (drives the card pulse/badge).
  isUnacked: (leadId: number) => boolean
  // Transient slide-in toasts; cleared on dismiss/timeout (not persisted).
  toasts: WebInquiryToast[]
  dismissToast: (key: number) => void
  // Bumps on every leads INSERT/UPDATE the channel receives. List views (e.g. the
  // dashboard Needs Action module) watch this and re-fetch, so new/changed leads
  // appear live without a page refresh — reusing this single subscription.
  leadsVersion: number
}

const WebInquiryContext = createContext<WebInquiryContextValue>({
  count: 0,
  isUnacked: () => false,
  toasts: [],
  dismissToast: () => {},
  leadsVersion: 0,
})

export function useWebInquiries() {
  return useContext(WebInquiryContext)
}

const BASE_TITLE = 'PRSFlo'

export function WebInquiryProvider({ children }: { children: React.ReactNode }) {
  // Unacknowledged Web Inquiry lead IDs (source='Web Inquiry', status='uncontacted').
  const [unackedIds, setUnackedIds] = useState<number[]>([])
  const [toasts, setToasts] = useState<WebInquiryToast[]>([])
  const toastKeyRef = useRef(0)
  // Incremented on any leads INSERT/UPDATE so list views can re-fetch live.
  const [leadsVersion, setLeadsVersion] = useState(0)

  const bumpVersion = useCallback(() => setLeadsVersion(v => v + 1), [])
  const addUnacked = useCallback((id: number) => {
    setUnackedIds(prev => (prev.includes(id) ? prev : [...prev, id]))
  }, [])
  const removeUnacked = useCallback((id: number) => {
    setUnackedIds(prev => prev.filter(x => x !== id))
  }, [])
  const pushToast = useCallback((leadId: number, fname: string, lname: string) => {
    const key = ++toastKeyRef.current
    setToasts(prev => [...prev, { key, leadId, fname: fname || '', lname: lname || '' }])
  }, [])
  const dismissToast = useCallback((key: number) => {
    setToasts(prev => prev.filter(t => t.key !== key))
  }, [])

  // Step 5 — hydrate on mount: any Web Inquiry lead still 'uncontacted' is
  // unacknowledged immediately, so refresh/login re-surfaces overnight inquiries.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('leads')
      .select('id')
      .eq('source', 'Web Inquiry')
      .eq('status', 'uncontacted')
      .then(({ data }) => {
        if (cancelled || !data) return
        setUnackedIds((data as { id: number }[]).map(r => r.id))
      })
    return () => { cancelled = true }
  }, [])

  // Steps 1 & 6 — realtime: INSERT of a Web Inquiry uncontacted lead adds it + fires
  // a toast; UPDATE clears it once status moves away from 'uncontacted'.
  useEffect(() => {
    const channel = supabase
      .channel('web-inquiry-leads')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'leads' },
        payload => {
          bumpVersion()
          const row = payload.new as { id: number; source?: string; status?: string; fname?: string; lname?: string }
          if (row?.source === 'Web Inquiry' && row?.status === 'uncontacted') {
            addUnacked(row.id)
            pushToast(row.id, row.fname ?? '', row.lname ?? '')
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'leads' },
        payload => {
          bumpVersion()
          const row = payload.new as { id: number; source?: string; status?: string }
          if (row?.source !== 'Web Inquiry') return
          if (row.status !== 'uncontacted') removeUnacked(row.id)
          else addUnacked(row.id)
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [addUnacked, removeUnacked, pushToast, bumpVersion])

  const count = unackedIds.length

  // Step 3 — browser tab badge reflecting the live unacknowledged count.
  useEffect(() => {
    document.title = count > 0 ? `(${count} New) ${BASE_TITLE}` : BASE_TITLE
  }, [count])
  // Restore the plain title if the provider unmounts (e.g. navigating to /runner).
  useEffect(() => () => { document.title = BASE_TITLE }, [])

  const unackedSet = useMemo(() => new Set(unackedIds), [unackedIds])
  const value = useMemo<WebInquiryContextValue>(
    () => ({
      count,
      isUnacked: (leadId: number) => unackedSet.has(leadId),
      toasts,
      dismissToast,
      leadsVersion,
    }),
    [count, unackedSet, toasts, dismissToast, leadsVersion],
  )

  return <WebInquiryContext.Provider value={value}>{children}</WebInquiryContext.Provider>
}
