'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase, Lead, Booking, DashboardTask, DashboardTaskComment, Flag, FlagComment } from '@/lib/supabase'
import { LocationStrip } from '@/components/dashboard/LocationStrip'
import { useRouter } from 'next/navigation'

const TAB_ROLE: Record<string, 'admin' | 'studio_manager' | 'asst_manager' | 'billing'> = {
  me:      'admin',
  mgr:     'studio_manager',
  asst:    'asst_manager',
  billing: 'billing',
}

async function fetchTasks(role: string): Promise<DashboardTask[]> {
  const { data } = await supabase
    .from('dashboard_tasks')
    .select('*')
    .eq('assigned_role', role)
    .eq('completed', false)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  return data || []
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  )
}

export default function DashboardPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTaskTab, setActiveTaskTab] = useState<'me' | 'mgr' | 'billing' | 'asst'>('me')
  const [tasks, setTasks] = useState<DashboardTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<DashboardTask | null>(null)
  const [taskComments, setTaskComments] = useState<DashboardTaskComment[]>([])
  const [commentText, setCommentText] = useState('')
  const [commentPhoto, setCommentPhoto] = useState<File | null>(null)
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [newTaskPhoto, setNewTaskPhoto] = useState<File | null>(null)
  const [taskSubmitting, setTaskSubmitting] = useState(false)
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('Staff')
  const [showHistory, setShowHistory] = useState(false)
  const [completedTasks, setCompletedTasks] = useState<DashboardTask[]>([])
  const [historySearch, setHistorySearch] = useState('')
  const [selectedHistoryTask, setSelectedHistoryTask] = useState<DashboardTask | null>(null)
  const [historyTaskComments, setHistoryTaskComments] = useState<DashboardTaskComment[]>([])
  const [flags, setFlags] = useState<Flag[]>([])
  const [flagsLoading, setFlagsLoading] = useState(true)
  const [selectedFlag, setSelectedFlag] = useState<Flag | null>(null)
  const [flagComments, setFlagComments] = useState<FlagComment[]>([])
  const [flagCommentText, setFlagCommentText] = useState('')
  const [flagCommentPhoto, setFlagCommentPhoto] = useState<File | null>(null)
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [currentUserName, setCurrentUserName] = useState<string>('Staff')
  const [pendingCategory, setPendingCategory] = useState<'facility_general' | 'gear_equipment' | 'client_billing' | null>(null)
  const newTaskPhotoRef = useRef<HTMLInputElement>(null)
  const commentPhotoRef = useRef<HTMLInputElement>(null)
  const flagCommentPhotoRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const needsActionLeads = leads
    .filter(l => l.needs_contact === true && l.status !== 'dead' && l.status !== 'booked' && l.status !== 'cold')
    .slice(0, 5)
  const confirmedSessions = bookings.filter(b => b.status === 'confirmed')
  const tentativeSessions = bookings.filter(b => b.status === 'tentative')

  useEffect(() => {
    async function load() {
      const d = new Date()
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
      const today = d.toISOString().slice(0, 10)
      const [{ data: leadsData }, { data: bookingsData }, { data: flagsData }] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('bookings').select('*').lte('start_date', today).gte('end_date', today).order('from_time', { ascending: true }),
        supabase.from('flags').select('*').in('status', ['pending', 'acknowledged']).is('deleted_at', null).order('created_at', { ascending: false }),
      ])
      setLeads(leadsData || [])
      setBookings(bookingsData || [])
      setFlags(flagsData || [])
      setLoading(false)
      setFlagsLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.email) setCurrentUserEmail(data.user.email)
    })
  }, [])

  useEffect(() => {
    async function load() {
      setTasksLoading(true)
      setTasks(await fetchTasks(TAB_ROLE[activeTaskTab]))
      setTasksLoading(false)
    }
    load()
  }, [activeTaskTab])

  async function reloadTasks() {
    setTasksLoading(true)
    setTasks(await fetchTasks(TAB_ROLE[activeTaskTab]))
    setTasksLoading(false)
  }

  async function fetchCompletedTasks() {
    const roles = TAB_ROLE[activeTaskTab]
    const visibleRoles: string[] = roles === 'admin'
      ? ['admin', 'studio_manager', 'asst_manager', 'billing']
      : roles === 'studio_manager'
      ? ['studio_manager', 'asst_manager', 'billing']
      : roles === 'billing'
      ? ['billing', 'asst_manager']
      : ['asst_manager']
    const { data } = await supabase
      .from('dashboard_tasks')
      .select('*')
      .in('assigned_role', visibleRoles)
      .eq('completed', true)
      .is('deleted_at', null)
      .order('completed_at', { ascending: false })
      .limit(100)
    setCompletedTasks(data || [])
  }

  async function uploadPhoto(file: File): Promise<string | null> {
    const path = `dashboard-tasks/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
    const { data, error } = await supabase.storage.from('checklist-photos').upload(path, file, { upsert: true })
    if (!data || error) return null
    const { data: { publicUrl } } = supabase.storage.from('checklist-photos').getPublicUrl(data.path)
    return publicUrl
  }

  async function loadComments(taskId: string) {
    const { data } = await supabase
      .from('dashboard_task_comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
    setTaskComments(data || [])
  }

  async function handleOpenTask(task: DashboardTask) {
    setSelectedTask(task)
    setCommentText('')
    setCommentPhoto(null)
    if (commentPhotoRef.current) commentPhotoRef.current.value = ''
    await loadComments(task.id)
  }

  async function handleAddTask() {
    if (!newTaskText.trim() || taskSubmitting) return
    setTaskSubmitting(true)
    const photo_url = newTaskPhoto ? await uploadPhoto(newTaskPhoto) : null
    const { data, error } = await supabase.from('dashboard_tasks').insert({
      text: newTaskText.trim(),
      assigned_role: TAB_ROLE[activeTaskTab],
      source: 'manual',
      photo_url,
    })
    console.log('task insert result:', { data, error })
    setNewTaskText('')
    setNewTaskPhoto(null)
    if (newTaskPhotoRef.current) newTaskPhotoRef.current.value = ''
    setAddingTask(false)
    setTaskSubmitting(false)
    await reloadTasks()
  }

  async function handleDeleteTask(task: DashboardTask) {
    setTasks(prev => prev.filter(t => t.id !== task.id))
    await supabase.from('dashboard_tasks').update({ deleted_at: new Date().toISOString() }).eq('id', task.id)
  }

  async function handleComment() {
    if (!selectedTask || taskSubmitting) return
    if (!commentText.trim() && !commentPhoto) return
    setTaskSubmitting(true)
    const photo_url = commentPhoto ? await uploadPhoto(commentPhoto) : null
    await supabase.from('dashboard_task_comments').insert({
      task_id: selectedTask.id,
      text: commentText.trim() || null,
      photo_url,
      created_by_name: currentUserEmail,
    })
    setCommentText('')
    setCommentPhoto(null)
    if (commentPhotoRef.current) commentPhotoRef.current.value = ''
    await loadComments(selectedTask.id)
    setTaskSubmitting(false)
  }

  async function handleCompleteTask() {
    if (!selectedTask || taskSubmitting) return
    setTaskSubmitting(true)
    const photo_url = commentPhoto ? await uploadPhoto(commentPhoto) : null
    if (commentText.trim() || photo_url) {
      await supabase.from('dashboard_task_comments').insert({
        task_id: selectedTask.id,
        text: commentText.trim() || null,
        photo_url,
        created_by_name: currentUserEmail,
      })
    }
    await supabase.from('dashboard_tasks').update({
      completed: true,
      completed_at: new Date().toISOString(),
    }).eq('id', selectedTask.id)
    setTasks(prev => prev.filter(t => t.id !== selectedTask.id))
    setSelectedTask(null)
    setCommentText('')
    setCommentPhoto(null)
    setTaskSubmitting(false)
  }

  async function loadFlagComments(flagId: string) {
    const { data } = await supabase
      .from('flag_comments')
      .select('*')
      .eq('flag_id', flagId)
      .order('created_at', { ascending: true })
    setFlagComments(data || [])
  }

  async function handleOpenFlag(flag: Flag) {
    setSelectedFlag(flag)
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    setPendingCategory(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    await loadFlagComments(flag.id)
  }

  async function handleFlagComment() {
    if (!selectedFlag || flagSubmitting) return
    if (!flagCommentText.trim() && !flagCommentPhoto) return
    setFlagSubmitting(true)
    const photo_url = flagCommentPhoto ? await uploadPhoto(flagCommentPhoto) : null
    await supabase.from('flag_comments').insert({
      flag_id: selectedFlag.id,
      text: flagCommentText.trim() || null,
      photo_url,
      created_by_name: currentUserEmail,
    })
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    await loadFlagComments(selectedFlag.id)
    setFlagSubmitting(false)
  }

  async function handleAcknowledgeFlag() {
    if (!selectedFlag || flagSubmitting) return
    setFlagSubmitting(true)
    const photo_url = flagCommentPhoto ? await uploadPhoto(flagCommentPhoto) : null
    if (flagCommentText.trim() || photo_url) {
      await supabase.from('flag_comments').insert({
        flag_id: selectedFlag.id,
        text: flagCommentText.trim() || null,
        photo_url,
        created_by_name: currentUserEmail,
      })
    }
    const updated = await supabase.from('flags').update({
      status: 'acknowledged',
      acknowledged_by: currentUserEmail,
      acknowledged_at: new Date().toISOString(),
      acknowledged_note: flagCommentText.trim() || null,
      ...(pendingCategory ? { category: pendingCategory } : {}),
    }).eq('id', selectedFlag.id).select().single()
    if (updated.data) {
      setFlags(prev => prev.map(f => f.id === selectedFlag.id ? updated.data : f))
      setSelectedFlag(updated.data)
    }
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    setPendingCategory(null)
    setFlagSubmitting(false)
  }

  async function handleResolveFlag() {
    if (!selectedFlag || flagSubmitting) return
    setFlagSubmitting(true)
    const photo_url = flagCommentPhoto ? await uploadPhoto(flagCommentPhoto) : null
    if (flagCommentText.trim() || photo_url) {
      await supabase.from('flag_comments').insert({
        flag_id: selectedFlag.id,
        text: flagCommentText.trim() || null,
        photo_url,
        created_by_name: currentUserEmail,
      })
    }
    await supabase.from('flags').update({
      status: 'resolved',
      resolved_by: currentUserEmail,
      resolved_at: new Date().toISOString(),
      resolved_note: flagCommentText.trim() || null,
    }).eq('id', selectedFlag.id)
    setFlags(prev => prev.filter(f => f.id !== selectedFlag.id))
    setSelectedFlag(null)
    setFlagCommentText('')
    setFlagCommentPhoto(null)
    if (flagCommentPhotoRef.current) flagCommentPhotoRef.current.value = ''
    setFlagSubmitting(false)
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'Syne', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 4 }}>
            {greeting} — here's your briefing
          </div>
          <h1 style={{ fontFamily: 'DM Serif Display', fontSize: 32, letterSpacing: -1, lineHeight: 1.05 }}>
            Paramount <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Recording Studios</em>
          </h1>
        </div>
        <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--text2)', lineHeight: 1.8 }}>
          {now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          <br />
          <span style={{ color: 'var(--text3)' }}>
            {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Location strip */}
      <LocationStrip />

      {/* 3-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 14, alignItems: 'start', marginTop: 14 }}>

        {/* COL 1 — NEEDS ACTION */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 13 }}>NEEDS ACTION</div>
          </div>
          <div style={{ borderBottom: '1px solid var(--border)' }}>
            {loading ? (
              <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
            ) : needsActionLeads.length === 0 ? (
              <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>✓ All clear</div>
            ) : (
              needsActionLeads.map((l, i) => {
                const statusColor =
                  l.status === 'hot' ? 'var(--hot)' :
                  l.status === 'warm' ? 'var(--warm)' :
                  'var(--text3)'
                const reason =
                  l.status === 'hot' ? 'Follow up now' :
                  l.status === 'warm' ? 'Follow up due' :
                  l.status === 'uncontacted' ? 'Never contacted' :
                  'Needs attention'
                return (
                  <div
                    key={l.id}
                    style={{
                      padding: '9px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: i < needsActionLeads.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{l.fname} {l.lname}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{reason}</div>
                    </div>
                    <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', color: statusColor, textTransform: 'uppercase' }}>
                      {l.status}
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div style={{ padding: '10px 16px' }}>
            <button
              onClick={() => router.push('/crm')}
              style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'DM Mono' }}
            >
              View all in CRM →
            </button>
          </div>
        </div>

        {/* COL 2 — TODAY'S SESSIONS */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 13 }}>TODAY'S SESSIONS</div>
          </div>
          <div style={{ padding: '10px 0' }}>
            {loading ? (
              <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
            ) : confirmedSessions.length === 0 && tentativeSessions.length === 0 ? (
              <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>No sessions today</div>
            ) : (
              <>
                {confirmedSessions.length > 0 && (
                  <div style={{ marginBottom: tentativeSessions.length > 0 ? 10 : 0 }}>
                    <div style={{ padding: '2px 16px 6px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', color: '#14B8A6', textTransform: 'uppercase' }}>
                      Confirmed
                    </div>
                    {confirmedSessions.map(b => (
                      <div key={b.id} style={{ margin: '0 16px 6px 16px', padding: '8px 12px', borderLeft: '2px solid #14B8A6', background: 'rgba(20,184,166,0.05)', borderRadius: '0 6px 6px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.artist || b.client_name || '—'}
                          </div>
                          <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text3)', textTransform: 'uppercase', background: 'var(--surface2)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {b.session_type}
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                          {b.from_time || '—'} – {b.to_time || '—'} · {b.location}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {tentativeSessions.length > 0 && (
                  <div>
                    <div style={{ padding: '2px 16px 6px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', color: '#F97316', textTransform: 'uppercase' }}>
                      Tentative
                    </div>
                    {tentativeSessions.map(b => (
                      <div key={b.id} style={{ margin: '0 16px 6px 16px', padding: '8px 12px', borderLeft: '2px solid #F97316', background: 'rgba(249,115,22,0.05)', borderRadius: '0 6px 6px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.artist || b.client_name || '—'}
                          </div>
                          <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text3)', textTransform: 'uppercase', background: 'var(--surface2)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {b.session_type}
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                          {b.from_time || '—'} – {b.to_time || '—'} · {b.location}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* COL 3 — TASKS */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 13 }}>TASKS</div>
              {tasks.length > 0 && (
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#c8f04e', color: '#0d0f14', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {tasks.length}
                </div>
              )}
            </div>
            <button
              onClick={async () => { await fetchCompletedTasks(); setShowHistory(true) }}
              style={{ fontSize: 10, color: '#c8f04e', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'DM Mono', letterSpacing: '0.04em' }}
            >
              history →
            </button>
          </div>
          {/* Tab row */}
          <div style={{ display: 'flex', gap: 3, padding: '6px 8px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', }}>
            {(['me', 'mgr', 'billing', 'asst'] as const).map(tab => {
              const labels = { me: 'Me', mgr: 'Mgr', billing: 'Billing', asst: 'Asst' }
              const isActive = activeTaskTab === tab
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTaskTab(tab)}
                  style={{
                    flex: 1, padding: '5px 4px', fontSize: 10, fontFamily: 'Syne',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? '#0d0f14' : 'var(--text3)',
                    background: isActive ? '#c8f04e' : 'transparent',
                    border: 'none', cursor: 'pointer', borderRadius: 6,
                    textTransform: 'uppercase', letterSpacing: '0.06em', transition: 'all 0.1s',
                  }}
                >
                  {labels[tab]}
                </button>
              )
            })}
          </div>
          {/* Task list */}
          <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 60 }}>
            {tasksLoading ? (
              <div style={{ padding: '8px', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
            ) : tasks.length === 0 ? (
              <div style={{ padding: '8px', color: 'var(--text3)', fontSize: 11 }}>No tasks</div>
            ) : (
              tasks.map(task => (
                <div
                  key={task.id}
                  onClick={() => handleOpenTask(task)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '10px 12px',
                    background: 'var(--surface2)',
                    border: task.source !== 'manual' ? '0.5px solid var(--border)' : '0.5px solid var(--border)',
                    borderLeft: task.source !== 'manual' ? '2px solid #F97316' : '0.5px solid var(--border)',
                    borderRadius: task.source !== 'manual' ? '0 8px 8px 0' : 8,
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: '#F97316',
                    marginTop: 4, flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4 }}>
                      {task.text}
                    </div>
                    {task.due_date && (
                      <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 3, fontFamily: 'DM Mono' }}>
                        Due {task.due_date}
                      </div>
                    )}
                    {task.source !== 'manual' && task.source_label && (
                      <div style={{ fontSize: 9, color: 'var(--warm)', marginTop: 3, fontFamily: 'DM Mono' }}>
                        {task.source_label}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteTask(task) }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text3)', fontSize: 14, padding: '0 2px',
                      lineHeight: 1, flexShrink: 0, opacity: 0.4,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
          {/* Footer: add task */}
          <div style={{ padding: '8px', borderTop: '1px solid var(--border)' }}>
            {!addingTask ? (
              <button
                onClick={() => setAddingTask(true)}
                style={{
                  width: '100%', padding: '8px', fontSize: 11, fontFamily: 'DM Mono',
                  color: 'var(--text3)', background: 'transparent', letterSpacing: '0.04em',
                  border: '1px dashed var(--border)', borderRadius: 8, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                + add task
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  autoFocus
                  value={newTaskText}
                  onChange={e => setNewTaskText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                  placeholder="Task description…"
                  style={{
                    padding: '6px 8px', fontSize: 11, background: 'var(--surface2)',
                    border: '1px solid var(--border)', borderRadius: 6,
                    color: 'var(--text)', fontFamily: 'DM Mono', outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <label style={{ fontSize: 10, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Mono', whiteSpace: 'nowrap' }}>
                    {newTaskPhoto ? newTaskPhoto.name : '+ Photo'}
                    <input
                      ref={newTaskPhotoRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => setNewTaskPhoto(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => { setAddingTask(false); setNewTaskText(''); setNewTaskPhoto(null); if (newTaskPhotoRef.current) newTaskPhotoRef.current.value = '' }}
                    style={{
                      padding: '5px 10px', fontSize: 10, fontFamily: 'DM Mono',
                      background: 'transparent', border: '1px solid var(--border)',
                      borderRadius: 6, cursor: 'pointer', color: 'var(--text3)',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddTask}
                    disabled={taskSubmitting || !newTaskText.trim()}
                    style={{
                      padding: '5px 10px', fontSize: 10, fontFamily: 'DM Mono',
                      background: newTaskText.trim() ? '#c8f04e' : 'var(--surface2)',
                      color: newTaskText.trim() ? '#0d0f14' : 'var(--text3)',
                      border: 'none', borderRadius: 6,
                      cursor: newTaskText.trim() ? 'pointer' : 'default',
                    }}
                  >
                    {taskSubmitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* FLAGS PANEL */}
      <div style={{ marginTop: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 13 }}>FLAGS</div>
          {flags.filter(f => f.status === 'pending').length > 0 && (
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#c8f04e', color: '#0d0f14', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {flags.filter(f => f.status === 'pending').length}
            </div>
          )}
          {flags.filter(f => f.status === 'acknowledged').length > 0 && (
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#F97316', color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {flags.filter(f => f.status === 'acknowledged').length}
            </div>
          )}
        </div>
        {flagsLoading ? (
          <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>Loading…</div>
        ) : flags.length === 0 ? (
          <div style={{ padding: '12px 16px', color: 'var(--text3)', fontSize: 11 }}>No open flags</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, padding: 12 }}>
            {flags.map(flag => {
              const isPending = flag.status === 'pending'
              const borderColor = isPending ? '#F97316' : '#14B8A6'
              const statusColor = isPending ? '#F97316' : '#14B8A6'
              const categoryConfig: Record<string, { label: string; color: string; bg: string }> = {
                facility_general: { label: 'Facility / General', color: 'var(--text3)', bg: 'var(--surface2)' },
                gear_equipment: { label: 'Gear / Equipment', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
                client_billing: { label: 'Client / Billing', color: '#60A5FA', bg: 'rgba(96,165,250,0.12)' },
              }
              const catInfo = flag.category ? categoryConfig[flag.category] : null
              return (
                <div
                  key={flag.id}
                  onClick={() => handleOpenFlag(flag)}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--surface2)',
                    border: '0.5px solid var(--border)',
                    borderLeft: `2px solid ${borderColor}`,
                    borderRadius: '0 8px 8px 0',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text3)', textTransform: 'uppercase', background: 'var(--surface)', padding: '2px 6px', borderRadius: 4, border: '0.5px solid var(--border)' }}>
                        {flag.studio}
                      </span>
                      {catInfo && (
                        <span style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.06em', color: catInfo.color, background: catInfo.bg, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase' }}>
                          {catInfo.label}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.08em', color: statusColor, textTransform: 'uppercase', flexShrink: 0 }}>
                      {flag.status}
                    </span>
                  </div>
                  {flag.runner_note && (
                    <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {flag.runner_note}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8 }}>
                    {flag.source_label ? (
                      <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                        {flag.source_label}
                      </div>
                    ) : (
                      <div style={{ flex: 1 }} />
                    )}
                    <div style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {new Date(flag.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* TASK MODAL */}
      {selectedTask && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setSelectedTask(null) }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 480, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Modal header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
              <button
                onClick={() => setSelectedTask(null)}
                style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15, color: 'var(--text)', paddingRight: 24, lineHeight: 1.3 }}>
                {selectedTask.text}
              </div>
              {selectedTask.photo_url && (
                <img
                  src={selectedTask.photo_url}
                  alt=""
                  style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: 8 }}
                />
              )}
              {selectedTask.source !== 'manual' && selectedTask.source_label && (
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, fontFamily: 'DM Mono' }}>
                  {selectedTask.source_label}
                </div>
              )}
              {selectedTask.due_date && (
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, fontFamily: 'DM Mono' }}>
                  Due {selectedTask.due_date}
                </div>
              )}
            </div>

            {/* Comment thread */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
              {taskComments.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>No updates yet</div>
              ) : (
                taskComments.map(c => (
                  <div key={c.id} style={{ marginBottom: 14 }}>
                    {c.text && (
                      <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{c.text}</div>
                    )}
                    {c.photo_url && (
                      <img
                        src={c.photo_url}
                        alt=""
                        style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: c.text ? 6 : 0 }}
                      />
                    )}
                    <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4, fontFamily: 'DM Mono' }}>
                      {c.created_by_name && `${c.created_by_name} · `}{fmtTime(c.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--border)' }} />

            {/* Input area */}
            <div style={{ padding: '12px 20px' }}>
              <textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Add a note…"
                rows={2}
                style={{
                  width: '100%', padding: '8px', fontSize: 11,
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                  outline: 'none', resize: 'none', boxSizing: 'border-box',
                }}
              />
              <label style={{ display: 'block', fontSize: 10, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Mono', marginTop: 6, marginBottom: 8 }}>
                {commentPhoto ? commentPhoto.name : '+ Attach photo'}
                <input
                  ref={commentPhotoRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => setCommentPhoto(e.target.files?.[0] ?? null)}
                />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleComment}
                  disabled={taskSubmitting || (!commentText.trim() && !commentPhoto)}
                  style={{
                    flex: 1, padding: '8px', fontSize: 11, fontFamily: 'DM Mono',
                    background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 6, cursor: 'pointer', color: 'var(--text2)',
                  }}
                >
                  Comment
                </button>
                <button
                  onClick={handleCompleteTask}
                  disabled={taskSubmitting}
                  style={{
                    flex: 1, padding: '8px', fontSize: 11, fontFamily: 'DM Mono',
                    background: '#c8f04e', color: '#0d0f14',
                    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  {taskSubmitting ? 'Saving…' : 'Complete'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {showHistory && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowHistory(false); setHistorySearch('') } }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 520, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15 }}>Completed Tasks</div>
              <button onClick={() => { setShowHistory(false); setHistorySearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
              <input
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                placeholder="Search completed tasks…"
                style={{ width: '100%', padding: '7px 10px', fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: 'DM Mono', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {completedTasks
                .filter(t => !historySearch || t.text.toLowerCase().includes(historySearch.toLowerCase()))
                .map(t => (
                  <div
                    key={t.id}
                    onClick={async () => {
                      const { data } = await supabase
                        .from('dashboard_task_comments')
                        .select('*')
                        .eq('task_id', t.id)
                        .order('created_at', { ascending: true })
                      setHistoryTaskComments(data || [])
                      setSelectedHistoryTask(t)
                    }}
                    style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, border: '0.5px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#14B8A6', marginTop: 4, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, flex: 1 }}>{t.text}</div>
                        <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--surface)', color: 'var(--text3)', border: '0.5px solid var(--border)', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {t.assigned_role.replace('_', ' ')}
                        </div>
                      </div>
                      {t.source !== 'manual' && t.source_label && (
                        <div style={{ fontSize: 9, color: 'var(--warm)', marginTop: 3, fontFamily: 'DM Mono' }}>{t.source_label}</div>
                      )}
                      <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4, fontFamily: 'DM Mono' }}>
                        Completed {t.completed_at ? new Date(t.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </div>
                    </div>
                  </div>
                ))
              }
              {completedTasks.filter(t => !historySearch || t.text.toLowerCase().includes(historySearch.toLowerCase())).length === 0 && (
                <div style={{ padding: '12px', color: 'var(--text3)', fontSize: 11 }}>No completed tasks found</div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedHistoryTask && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setSelectedHistoryTask(null); setHistoryTaskComments([]) } }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 480, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
              <button
                onClick={() => { setSelectedHistoryTask(null); setHistoryTaskComments([]) }}
                style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1, padding: 0 }}
              >×</button>
              <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', color: '#14B8A6', textTransform: 'uppercase', marginBottom: 6 }}>COMPLETED</div>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15, color: 'var(--text)', paddingRight: 24, lineHeight: 1.3 }}>
                {selectedHistoryTask.text}
              </div>
              {selectedHistoryTask.photo_url && (
                <img src={selectedHistoryTask.photo_url} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: 8 }} />
              )}
              {selectedHistoryTask.source !== 'manual' && selectedHistoryTask.source_label && (
                <div style={{ fontSize: 10, color: 'var(--warm)', marginTop: 4, fontFamily: 'DM Mono' }}>{selectedHistoryTask.source_label}</div>
              )}
              {selectedHistoryTask.due_date && (
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, fontFamily: 'DM Mono' }}>Due {selectedHistoryTask.due_date}</div>
              )}
              {selectedHistoryTask.completed_at && (
                <div style={{ fontSize: 10, color: '#14B8A6', marginTop: 2, fontFamily: 'DM Mono' }}>
                  Completed {new Date(selectedHistoryTask.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
              {historyTaskComments.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>No updates</div>
              ) : (
                historyTaskComments.map(c => (
                  <div key={c.id} style={{ marginBottom: 14 }}>
                    {c.text && <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{c.text}</div>}
                    {c.photo_url && (
                      <img src={c.photo_url} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: c.text ? 6 : 0 }} />
                    )}
                    <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4, fontFamily: 'DM Mono' }}>
                      {c.created_by_name && `${c.created_by_name} · `}{fmtTime(c.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* FLAG MODAL */}
      {selectedFlag && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setSelectedFlag(null) }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 480, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Modal header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
              <button
                onClick={() => setSelectedFlag(null)}
                style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, paddingRight: 24 }}>
                <span style={{
                  fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em',
                  textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4,
                  color: selectedFlag.status === 'pending' ? '#F97316' : '#14B8A6',
                  background: selectedFlag.status === 'pending' ? 'rgba(249,115,22,0.12)' : 'rgba(20,184,166,0.12)',
                }}>
                  {selectedFlag.status}
                </span>
                <span style={{ fontSize: 10, fontFamily: 'Syne', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {selectedFlag.studio}
                </span>
              </div>
              {selectedFlag.source_label && (
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono' }}>
                  {selectedFlag.source_label}
                </div>
              )}
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Runner note — read only */}
              {selectedFlag.runner_note && (
                <div>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                    Runner Note
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                    {selectedFlag.runner_note}
                  </div>
                </div>
              )}

              {/* Acknowledged box */}
              {selectedFlag.status === 'acknowledged' && (
                <div style={{ background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.25)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#14B8A6', marginBottom: 4 }}>
                    Acknowledged
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'DM Mono' }}>
                    {selectedFlag.acknowledged_by}
                    {selectedFlag.acknowledged_at && ` · ${new Date(selectedFlag.acknowledged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                  {selectedFlag.acknowledged_note && (
                    <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 6, lineHeight: 1.5 }}>
                      {selectedFlag.acknowledged_note}
                    </div>
                  )}
                </div>
              )}

              {/* Comment thread */}
              {flagComments.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>No updates yet</div>
              ) : (
                flagComments.map(c => (
                  <div key={c.id} style={{ marginBottom: 2 }}>
                    {c.text && (
                      <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{c.text}</div>
                    )}
                    {c.photo_url && (
                      <img
                        src={c.photo_url}
                        alt=""
                        style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: c.text ? 6 : 0 }}
                      />
                    )}
                    <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 4, fontFamily: 'DM Mono' }}>
                      {c.created_by_name && `${c.created_by_name} · `}{fmtTime(c.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--border)' }} />

            {/* Input area */}
            <div style={{ padding: '12px 20px' }}>
              <textarea
                value={flagCommentText}
                onChange={e => setFlagCommentText(e.target.value)}
                placeholder="Add a note…"
                rows={2}
                style={{
                  width: '100%', padding: '8px', fontSize: 11,
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                  outline: 'none', resize: 'none', boxSizing: 'border-box',
                }}
              />
              <label style={{ display: 'block', fontSize: 10, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Mono', marginTop: 6, marginBottom: 8 }}>
                {flagCommentPhoto ? flagCommentPhoto.name : '+ Attach photo'}
                <input
                  ref={flagCommentPhotoRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => setFlagCommentPhoto(e.target.files?.[0] ?? null)}
                />
              </label>

              {/* Category picker — only shown when flag has no category */}
              {selectedFlag.category === null && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, fontFamily: 'Syne', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>
                    Category
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['facility_general', 'gear_equipment', 'client_billing'] as const).map(catKey => {
                      const catConfig = {
                        facility_general: { label: 'Facility / General', activeColor: 'var(--text3)', activeBg: 'var(--surface2)', activeBorder: 'var(--text3)' },
                        gear_equipment: { label: 'Gear / Equipment', activeColor: '#F59E0B', activeBg: 'rgba(245,158,11,0.15)', activeBorder: '#F59E0B' },
                        client_billing: { label: 'Client / Billing', activeColor: '#60A5FA', activeBg: 'rgba(96,165,250,0.15)', activeBorder: '#60A5FA' },
                      }[catKey]
                      const isSelected = pendingCategory === catKey
                      return (
                        <button
                          key={catKey}
                          onClick={() => setPendingCategory(catKey)}
                          style={{
                            flex: 1, padding: '5px 4px', fontSize: 9, fontFamily: 'Syne', fontWeight: 700,
                            letterSpacing: '0.04em', textTransform: 'uppercase',
                            color: isSelected ? catConfig.activeColor : 'var(--text3)',
                            background: isSelected ? catConfig.activeBg : 'transparent',
                            border: isSelected ? `1px solid ${catConfig.activeBorder}` : '1px solid var(--border)',
                            borderRadius: 6, cursor: 'pointer',
                          }}
                        >
                          {catConfig.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleFlagComment}
                  disabled={flagSubmitting || (!flagCommentText.trim() && !flagCommentPhoto)}
                  style={{
                    flex: 1, padding: '8px', fontSize: 11, fontFamily: 'DM Mono',
                    background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 6, cursor: 'pointer', color: 'var(--text2)',
                  }}
                >
                  Comment
                </button>
                {selectedFlag.status === 'pending' && (() => {
                  const canAck = selectedFlag.category !== null || pendingCategory !== null
                  return (
                    <button
                      onClick={handleAcknowledgeFlag}
                      disabled={flagSubmitting || !canAck}
                      style={{
                        flex: 1, padding: '8px', fontSize: 11, fontFamily: 'DM Mono',
                        background: canAck ? '#c8f04e' : 'var(--surface2)',
                        color: canAck ? '#0d0f14' : 'var(--text3)',
                        border: 'none', borderRadius: 6,
                        cursor: canAck ? 'pointer' : 'default',
                        fontWeight: 600,
                      }}
                    >
                      {flagSubmitting ? 'Saving…' : 'Acknowledge'}
                    </button>
                  )
                })()}
                {selectedFlag.status === 'acknowledged' && (
                  <button
                    onClick={handleResolveFlag}
                    disabled={flagSubmitting}
                    style={{
                      flex: 1, padding: '8px', fontSize: 11, fontFamily: 'DM Mono',
                      background: '#14B8A6', color: '#fff',
                      border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    {flagSubmitting ? 'Saving…' : 'Resolve'}
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}
