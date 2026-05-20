'use client'
import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase, Client, ClientContact } from '@/lib/supabase'
import { ClientList, BookingCountMap, ContactsMap } from '@/components/clients/ClientList'
import { ClientProfile } from '@/components/clients/ClientProfile'

export default function ClientsPage() {
  return (
    <Suspense>
      <ClientsPageInner />
    </Suspense>
  )
}

function ClientsPageInner() {
  const [clients, setClients] = useState<Client[]>([])
  const [contactsMap, setContactsMap] = useState<ContactsMap>({})
  const [bookingCountMap, setBookingCountMap] = useState<BookingCountMap>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const hasAutoSelected = useRef(false)
  const searchParams = useSearchParams()
  const idParam = searchParams.get('id')

  const load = useCallback(async () => {
    const [
      { data: clientsData },
      { data: contactsData },
      { data: bookingData },
    ] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('client_contacts').select('id, client_id, fname, lname, email, phone, instagram, role, notes'),
      supabase.from('leads').select('client_id').not('client_id', 'is', null),
    ])

    setClients((clientsData || []).map(c => ({ ...c, artists: c.artists || [] })) as Client[])

    const cMap: ContactsMap = {}
    for (const ct of (contactsData || []) as ClientContact[]) {
      if (!cMap[ct.client_id]) cMap[ct.client_id] = []
      cMap[ct.client_id].push(ct)
    }
    setContactsMap(cMap)

    const bMap: BookingCountMap = {}
    for (const row of (bookingData || [])) {
      if (row.client_id) bMap[row.client_id] = (bMap[row.client_id] || 0) + 1
    }
    setBookingCountMap(bMap)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-select: prefer ?id= param, otherwise fall back to first client
  useEffect(() => {
    if (loading || hasAutoSelected.current || clients.length === 0) return
    if (idParam && clients.some(c => c.id === idParam)) {
      setSelectedId(idParam)
    } else {
      setSelectedId(clients[0].id)
    }
    hasAutoSelected.current = true
  }, [loading, clients, idParam])

  const selected = clients.find(c => c.id === selectedId) || null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px - 24px)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '60fr 40fr', gap: 14, flex: 1, minHeight: 0 }}>
        <ClientList
          clients={clients}
          contactsMap={contactsMap}
          bookingCountMap={bookingCountMap}
          selectedId={selectedId}
          loading={loading}
          onSelect={setSelectedId}
        />
        <ClientProfile
          client={selected}
          contacts={selected ? (contactsMap[selected.id] || []) : []}
          bookingCount={selected ? (bookingCountMap[selected.id] || 0) : 0}
          loading={loading}
          onRefresh={load}
        />
      </div>
    </div>
  )
}
