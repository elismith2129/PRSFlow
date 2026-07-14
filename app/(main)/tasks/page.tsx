'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, DashboardTask, DashboardTaskComment, UserProfile } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { SectionHeader } from '@/components/ui/SectionHeader'
import {
  visibleTabsForRole,
  idsForTab,
  nameForId,
  fetchTasks,
  fetchCompletedTasks,
  fetchMyTasks,
  fetchMyCompletedTasks,
  isOwnOnlyRole,
  fmtTaskTime,
  uploadTaskPhoto,
} from '@/lib/tasks'
import { SignedImage } from '@/components/shared/SignedImage'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function TasksPage() {
  const router = useRouter()
  const { profile, loading: profileLoading } = useUserProfile()
  const canAssign = !!profile && (profile.role === 'owner' || profile.role === 'manager' || profile.role === 'billing')
  const ownOnly = isOwnOnlyRole(profile?.role)
  const visibleTabs = visibleTabsForRole(profile?.role)

  const [allProfiles, setAllProfiles] = useState<UserProfile[]>([])
  const [activeTaskTab, setActiveTaskTab] = useState<string>('eli')
  const defaultTabSetRef = useRef(false)
  const [tabReady, setTabReady] = useState(false)
  const [activeTasks, setActiveTasks] = useState<DashboardTask[]>([])
  const [completedTasks, setCompletedTasks] = useState<DashboardTask[]>([])
  const [loading, setLoading] = useState(true)
  // Completed section is collapsed by default; a non-empty search overrides the
  // collapse so search always finds completed matches.
  const [showCompleted, setShowCompleted] = useState(false)
  const [search, setSearch] = useState('')

  const [selectedTask, setSelectedTask] = useState<DashboardTask | null>(null)
  const [taskComments, setTaskComments] = useState<DashboardTaskComment[]>([])
  const [commentText, setCommentText] = useState('')
  const [commentPhoto, setCommentPhoto] = useState<File | null>(null)
  const [commentPhotoPreview, setCommentPhotoPreview] = useState<string | null>(null)
  const [taskSubmitting, setTaskSubmitting] = useState(false)
  const [currentUserName, setCurrentUserName] = useState<string>('Staff')
  const commentPhotoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.email) setCurrentUserName(data.user.email)
    })
  }, [])

  // Fetch the full user_profiles list once on mount — used to resolve tab ids
  // and the assigned-to / assigned-by meta lines.
  useEffect(() => {
    supabase
      .from('user_profiles')
      .select('*')
      .is('deleted_at', null)
      .order('display_name', { ascending: true })
      .then(({ data }) => setAllProfiles((data as UserProfile[]) || []))
  }, [])

  // Once the profile + profiles are loaded, default the active tab to the user's
  // own tab when it's visible, otherwise the first visible tab. Runs once.
  useEffect(() => {
    if (profileLoading || defaultTabSetRef.current || allProfiles.length === 0) return
    defaultTabSetRef.current = true
    // Own-only tiers use a single "My Tasks" view — no tab to select.
    if (ownOnly) { setTabReady(true); return }
    const tabs = visibleTabsForRole(profile?.role)
    let initial = tabs.length > 0 ? tabs[0].key : 'eli'
    const name = profile?.display_name?.toLowerCase()
    if (name) {
      const own = tabs.find(t => t.names.some(n => n.toLowerCase() === name))
      if (own) initial = own.key
    }
    setActiveTaskTab(initial)
    setTabReady(true)
  }, [profileLoading, profile, allProfiles])

  useEffect(() => {
    // Hold the first fetch until the default tab is settled, so a restricted user
    // (asst_manager / tech) never momentarily loads another tab's tasks.
    if (profileLoading || !tabReady) return
    async function load() {
      setLoading(true)
      if (ownOnly && profile?.id) {
        const [active, completed] = await Promise.all([fetchMyTasks(profile.id), fetchMyCompletedTasks(profile.id)])
        setActiveTasks(active)
        setCompletedTasks(completed)
      } else {
        const ids = idsForTab(activeTaskTab, allProfiles)
        const [active, completed] = await Promise.all([fetchTasks(ids), fetchCompletedTasks(ids)])
        setActiveTasks(active)
        setCompletedTasks(completed)
      }
      setLoading(false)
    }
    load()
  }, [activeTaskTab, allProfiles, profileLoading, tabReady, ownOnly, profile?.id])

  async function reload() {
    if (ownOnly && profile?.id) {
      const [active, completed] = await Promise.all([fetchMyTasks(profile.id), fetchMyCompletedTasks(profile.id)])
      setActiveTasks(active)
      setCompletedTasks(completed)
      return
    }
    const ids = idsForTab(activeTaskTab, allProfiles)
    const [active, completed] = await Promise.all([fetchTasks(ids), fetchCompletedTasks(ids)])
    setActiveTasks(active)
    setCompletedTasks(completed)
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
    clearCommentPhoto()
    await loadComments(task.id)
  }

  // Set the selected comment photo and its object-URL preview, revoking any prior
  // preview URL to avoid leaks.
  function pickCommentPhoto(file: File | null) {
    setCommentPhoto(file)
    setCommentPhotoPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return file ? URL.createObjectURL(file) : null
    })
  }

  function clearCommentPhoto() {
    setCommentPhoto(null)
    setCommentPhotoPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (commentPhotoRef.current) commentPhotoRef.current.value = ''
  }

  async function handleComment() {
    if (!selectedTask || taskSubmitting) return
    if (!commentText.trim() && !commentPhoto) return
    setTaskSubmitting(true)
    const photo_url = commentPhoto ? await uploadTaskPhoto(commentPhoto) : null
    await supabase.from('dashboard_task_comments').insert({
      task_id: selectedTask.id,
      text: commentText.trim() || null,
      photo_url,
      created_by_name: currentUserName,
    })
    setCommentText('')
    clearCommentPhoto()
    await loadComments(selectedTask.id)
    setTaskSubmitting(false)
  }

  async function handleCompleteTask() {
    if (!selectedTask || taskSubmitting) return
    setTaskSubmitting(true)
    const photo_url = commentPhoto ? await uploadTaskPhoto(commentPhoto) : null
    if (commentText.trim() || photo_url) {
      await supabase.from('dashboard_task_comments').insert({
        task_id: selectedTask.id,
        text: commentText.trim() || null,
        photo_url,
        created_by_name: currentUserName,
      })
    }
    await supabase.from('dashboard_tasks').update({
      completed: true,
      completed_at: new Date().toISOString(),
    }).eq('id', selectedTask.id)
    setSelectedTask(null)
    setCommentText('')
    clearCommentPhoto()
    setTaskSubmitting(false)
    await reload()
  }

  async function handleDeleteSelectedTask() {
    if (!selectedTask) return
    await supabase.from('dashboard_tasks').update({ deleted_at: new Date().toISOString() }).eq('id', selectedTask.id)
    setSelectedTask(null)
    setCommentText('')
    clearCommentPhoto()
    await reload()
  }

  function handleCancelTaskModal() {
    setSelectedTask(null)
    setCommentText('')
    clearCommentPhoto()
  }

  async function handleSaveAndCloseTask() {
    if (!selectedTask || taskSubmitting) return
    // Persist any unsent note/photo, then close.
    if (commentText.trim() || commentPhoto) {
      await handleComment()
    }
    setSelectedTask(null)
    setCommentText('')
    clearCommentPhoto()
    await reload()
  }

  function TaskRow({ task }: { task: DashboardTask }) {
    return (
      <div
        onClick={() => handleOpenTask(task)}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '12px 14px',
          background: 'var(--surface2)',
          border: '0.5px solid var(--border)',
          borderLeft: task.source !== 'manual' ? '2px solid var(--warm)' : '0.5px solid var(--border)',
          borderRadius: task.source !== 'manual' ? '0 8px 8px 0' : 8,
          cursor: 'pointer',
        }}
      >
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: task.completed ? 'var(--booked)' : 'var(--warm)',
          marginTop: 5, flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task.text}
          </div>
          {task.source !== 'manual' && task.source_label && (
            <div style={{ fontSize: 9, color: 'var(--warm)', marginTop: 3, fontFamily: 'DM Mono' }}>
              {task.source_label}
            </div>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--cold)', fontFamily: 'DM Mono', textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1 }}>
          by {nameForId(task.assigned_by, allProfiles)}
          <br />
          {fmtDate(task.created_at)}
        </div>
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const activeFiltered = q ? activeTasks.filter(t => t.text.toLowerCase().includes(q)) : activeTasks
  const completedFiltered = q ? completedTasks.filter(t => t.text.toLowerCase().includes(q)) : completedTasks
  // Rows show when expanded OR while searching (search overrides collapse).
  const completedVisible = showCompleted || q.length > 0

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: 'Syne', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 4 }}>
            Tasks
          </div>
          <h1 style={{ fontFamily: 'DM Serif Display', fontSize: 32, letterSpacing: -1, lineHeight: 1.05 }}>
            All <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Tasks</em>
          </h1>
        </div>
        <button
          onClick={() => router.push('/')}
          style={{ fontSize: 11, fontFamily: 'DM Mono', color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 6 }}
        >
          ← Dashboard
        </button>
      </div>

      {/* Tab row (owner/manager/billing) OR a single "My Tasks" label (own-only tiers) */}
      {ownOnly ? (
        <div style={{ padding: '6px 0', marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontFamily: 'Syne', fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            My Tasks
          </span>
        </div>
      ) : (
        <div className="hide-scrollbar" style={{ display: 'flex', gap: 4, padding: '6px 0', overflowX: 'auto', whiteSpace: 'nowrap', marginBottom: 14 }}>
          {visibleTabs.map(tab => {
            const isActive = activeTaskTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTaskTab(tab.key)}
                style={{
                  flexShrink: 0, padding: '4px 12px', fontSize: 11, fontFamily: 'Syne',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--bg)' : 'var(--text3)',
                  background: isActive ? 'var(--accent)' : 'transparent',
                  border: 'none', cursor: 'pointer', borderRadius: 6, whiteSpace: 'nowrap',
                  textTransform: 'uppercase', letterSpacing: '0.06em', transition: 'all 0.1s',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search tasks…"
        style={{
          width: '100%', padding: '9px 12px', fontSize: 12, fontFamily: 'DM Mono',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          color: 'var(--text)', outline: 'none', boxSizing: 'border-box', marginBottom: 14,
        }}
      />

      {/* ACTIVE */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '13px 16px 0', borderBottom: '1px solid var(--border)' }}>
          <SectionHeader title="ACTIVE" count={activeFiltered.length > 0 ? activeFiltered.length : undefined} />
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ padding: '4px', color: 'var(--text3)', fontSize: 12 }}>Loading…</div>
          ) : activeFiltered.length === 0 ? (
            <div style={{ padding: '4px', color: 'var(--text3)', fontSize: 12 }}>No active tasks</div>
          ) : (
            activeFiltered.map(task => <TaskRow key={task.id} task={task} />)
          )}
        </div>
      </div>

      {/* COMPLETED — collapsed by default; header toggles open/closed */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div
          onClick={() => setShowCompleted(v => !v)}
          style={{ padding: '13px 16px 0', borderBottom: completedVisible ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}
        >
          <SectionHeader title={`COMPLETED (${completedFiltered.length}) ${completedVisible ? '▲' : '▼'}`} />
        </div>
        {completedVisible && (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading ? (
              <div style={{ padding: '4px', color: 'var(--text3)', fontSize: 12 }}>Loading…</div>
            ) : completedFiltered.length === 0 ? (
              <div style={{ padding: '4px', color: 'var(--text3)', fontSize: 12 }}>No completed tasks</div>
            ) : (
              completedFiltered.map(task => <TaskRow key={task.id} task={task} />)
            )}
          </div>
        )}
      </div>

      {/* TASK MODAL */}
      {selectedTask && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) handleCancelTaskModal() }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '100%', maxWidth: 480, margin: '0 20px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Header — Complete button only, right aligned (hidden for already-completed tasks) */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', minHeight: 28 }}>
              {!selectedTask.completed && (
                <button
                  onClick={handleCompleteTask}
                  disabled={taskSubmitting}
                  style={{
                    border: '1px solid var(--booked)', background: 'transparent', color: 'var(--booked)',
                    fontSize: 10, fontFamily: 'DM Mono', fontWeight: 700, textTransform: 'uppercase',
                    padding: '5px 12px', borderRadius: 4, cursor: 'pointer', letterSpacing: '0.04em',
                  }}
                >
                  Complete
                </button>
              )}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {/* Description */}
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {selectedTask.text}
                {selectedTask.photo_url && (
                  <SignedImage
                    path={selectedTask.photo_url}
                    alt=""
                    style={{ display: 'block', maxWidth: '100%', maxHeight: 220, borderRadius: 8, objectFit: 'cover', marginTop: 10 }}
                  />
                )}
              </div>

              {/* Assigned meta */}
              <div style={{ fontSize: 10, color: 'var(--cold)', fontFamily: 'DM Mono', marginTop: 12 }}>
                Assigned to: {nameForId(selectedTask.assigned_to, allProfiles)} · by {nameForId(selectedTask.assigned_by, allProfiles)} · {fmtDate(selectedTask.created_at)}
              </div>

              {/* Updates */}
              <div style={{ fontSize: 10, color: 'var(--cold)', fontFamily: 'DM Mono', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 18, marginBottom: 10 }}>
                Updates
              </div>
              {taskComments.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--cold)', fontStyle: 'italic' }}>No updates yet</div>
              ) : (
                taskComments.map(c => (
                  <div key={c.id} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: 'var(--cold)', fontFamily: 'DM Mono', marginBottom: 3 }}>
                      {c.created_by_name && `${c.created_by_name} · `}{fmtTaskTime(c.created_at)}
                    </div>
                    {c.text && (
                      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{c.text}</div>
                    )}
                    {c.photo_url && (
                      <SignedImage
                        path={c.photo_url}
                        alt=""
                        style={{ display: 'block', maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover', marginTop: c.text ? 6 : 0 }}
                      />
                    )}
                  </div>
                ))
              )}

              {/* Comment input */}
              <textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder="Add a note..."
                style={{
                  width: '100%', height: 72, padding: '10px 12px', fontSize: 12,
                  background: 'var(--bg)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 6, color: 'var(--text)', fontFamily: 'DM Mono',
                  outline: 'none', resize: 'none', boxSizing: 'border-box', marginTop: 16,
                }}
              />
              {commentPhotoPreview && (
                <img
                  src={commentPhotoPreview}
                  alt=""
                  style={{ display: 'block', maxHeight: 80, borderRadius: 4, marginBottom: 8, marginTop: 8 }}
                />
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <label style={{ fontSize: 11, color: 'var(--text2)', cursor: 'pointer', fontFamily: 'DM Mono' }}>
                  {commentPhoto ? commentPhoto.name : '+ Attach photo'}
                  <input
                    ref={commentPhotoRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => pickCommentPhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  onClick={handleComment}
                  disabled={taskSubmitting || (!commentText.trim() && !commentPhoto)}
                  style={{
                    border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'var(--text2)',
                    fontSize: 11, fontFamily: 'DM Mono', padding: '6px 14px', borderRadius: 6,
                    cursor: (commentText.trim() || commentPhoto) ? 'pointer' : 'default',
                  }}
                >
                  {taskSubmitting ? 'Saving…' : 'Submit'}
                </button>
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {canAssign && (
                <button
                  onClick={handleDeleteSelectedTask}
                  style={{
                    border: '1px solid rgba(239,68,68,0.4)', background: 'transparent', color: 'var(--hot)',
                    fontSize: 11, fontFamily: 'DM Mono', padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button
                onClick={handleCancelTaskModal}
                style={{
                  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)',
                  fontSize: 11, fontFamily: 'DM Mono', padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAndCloseTask}
                disabled={taskSubmitting}
                style={{
                  background: 'var(--accent)', color: 'var(--bg)', border: 'none',
                  fontSize: 11, fontFamily: 'DM Mono', fontWeight: 600, padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                }}
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
