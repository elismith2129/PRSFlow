'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase, Lead, Booking, DashboardTask, DashboardTaskComment } from '@/lib/supabase'
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
  const newTaskPhotoRef = useRef<HTMLInputElement>(null)
  const commentPhotoRef = useRef<HTMLInputElement>(null)
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
      const [{ data: leadsData }, { data: bookingsData }] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('bookings').select('*').lte('start_date', today).gte('end_date', today).order('from_time', { ascending: true }),
      ])
      setLeads(leadsData || [])
      setBookings(bookingsData || [])
      setLoading(false)
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
              onClick={() => {/* completed view — wired in next build */}}
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
                    background: task.source !== 'manual' ? '#F97316' : '#3b3f52',
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

    </div>
  )
}
