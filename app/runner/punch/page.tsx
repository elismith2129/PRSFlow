'use client'
// ─────────────────────────────────────────────────────────────────────────────
// /runner/punch — missed-punch report + personal record (2026-08-14).
//
// HR-SPEC §5 verbatim: shift date, punch type (clock in/out, meal in/out),
// correct time, optional note → punch_correction_requests. Classification
// (same-day vs late) is a DB trigger; the runner cannot choose it.
//
// Identity comes from the SESSION (spec §15b ruling — individual logins).
// The shared runner account has no person behind it, so it sees a notice
// instead of the form. Below the form: the person's own trailing-90-day
// record, colour-coded green→red — the accountability view Eli asked for,
// same bands as the admin HR page (lib/punches.ts, single source).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useUserProfile } from '@/hooks/useUserProfile'
import { dbResult } from '@/lib/db'
import { getLocalToday } from '@/lib/time'
import {
  PUNCH_TYPES, PunchRequest, REPORT_CLASS_LABEL, fromDbTime, missBand,
  punchTypeLabel, to24h, windowFloor,
} from '@/lib/punches'

const STUDIO_ABBR: Record<string, string> = {
  paramount: 'PRS', ameraycan: 'ARS', encore: 'ERS', track: 'TRK',
}

export default function RunnerPunchPage() {
  const router = useRouter()
  const { profile, loading: profileLoading } = useUserProfile()

  // The shared runner login is a role, not a person — a punch filed from it
  // can't be attributed, so the form is closed to it until individual runner
  // accounts exist (spec §15b).
  const isSharedRunner = profile?.email === 'runner@paramountrecording.com'

  const [shiftChoice, setShiftChoice] = useState<'today' | 'yesterday' | 'other'>('today')
  const [otherDate, setOtherDate] = useState('')
  const [punchType, setPunchType] = useState<PunchRequest['punch_type']>('clock_in')
  const [time, setTime] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [sentAt, setSentAt] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [mine, setMine] = useState<PunchRequest[]>([])

  const today = getLocalToday()

  const load = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('punch_correction_requests')
      .select('*')
      .eq('staff_id', profile.id)
      .gte('shift_date', windowFloor())
      .order('submitted_at', { ascending: false })
    setMine((data ?? []) as PunchRequest[])
  }, [profile])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!profile) return
    const channel = supabase
      .channel('runner-punches-mine')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'punch_correction_requests' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile, load])

  function shiftDate(): string {
    if (shiftChoice === 'today') return today
    if (shiftChoice === 'yesterday') {
      const d = new Date(`${today}T12:00:00`)
      d.setDate(d.getDate() - 1)
      return d.toISOString().slice(0, 10)
    }
    return otherDate
  }

  async function submit() {
    if (!profile) return
    setFormError(null)
    const date = shiftDate()
    if (!date) { setFormError('Pick the day of the shift.'); return }
    const t24 = to24h(time)
    if (!t24) { setFormError('Enter the time the punch should say — like 6:00 PM.'); return }
    setSaving(true)
    let studioAbbr: string | null = null
    try {
      const saved = localStorage.getItem('prsflo-runner-studio')
      studioAbbr = saved ? STUDIO_ABBR[saved] ?? null : null
    } catch {}
    const { error } = await supabase.from('punch_correction_requests').insert({
      staff_id: profile.id,
      shift_date: date,
      punch_type: punchType,
      claimed_time: t24,
      employee_note: note.trim() || null,
      studio: studioAbbr,
    })
    setSaving(false)
    if (!dbResult('Sending punch report', error)) return
    setSentAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
    setTime(''); setNote(''); setShiftChoice('today'); setOtherDate('')
    load()
  }

  // ── Shared bits ────────────────────────────────────────────────────────────
  const surface: React.CSSProperties = {
    background: 'var(--c-srf, var(--c-bg))',
    boxShadow: 'var(--c-softsh)',
    borderRadius: 18,
    padding: '13px 14px',
  }
  const seg = (on: boolean): React.CSSProperties => ({
    padding: '9px 13px', borderRadius: 99, fontSize: 12, fontWeight: 700,
    border: 'none', font: 'inherit', cursor: 'pointer', minHeight: 38,
    background: on ? 'var(--c-wash2)' : 'var(--c-wash)',
    color: 'var(--c-fg)', opacity: on ? 1 : 0.55,
    WebkitTapHighlightColor: 'transparent',
  })
  const well: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 7,
    background: 'var(--c-wash)', borderRadius: 12, padding: '0 11px', minHeight: 44,
  }
  const input: React.CSSProperties = {
    flex: 1, minWidth: 0, outline: 'none', fontSize: 14,
    background: 'transparent', border: 'none', font: 'inherit', color: 'var(--c-fg)',
  }

  const band = missBand(mine.length)

  return (
    <div style={{
      minHeight: '100dvh', maxWidth: '100vw', overflowX: 'hidden',
      background: 'var(--c-bg)', color: 'var(--c-fg)',
      paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '14px 16px 10px', position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--c-bg)',
      }}>
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="c-control c-raised"
          style={{
            width: 38, height: 38, borderRadius: 99, flexShrink: 0,
            background: 'var(--c-wash)', color: 'var(--c-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, cursor: 'pointer',
          }}
        >←</button>
        <div>
          <div className="c-arch" style={{ fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            Missed a punch
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.5 }}>Goes straight to the manager queue</div>
        </div>
      </div>

      <div style={{ padding: '4px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {profileLoading ? (
          <div style={{ ...surface, textAlign: 'center', opacity: 0.5, padding: 28 }}>Loading…</div>
        ) : !profile || isSharedRunner ? (
          <div style={{ ...surface, fontSize: 13, lineHeight: 1.55 }}>
            <b>Personal logins are coming.</b> Punch reports need to be filed under
            your own name, and this device is signed in with the shared runner
            login. Until your personal PIN is set up, report the missed punch to
            your manager directly.
          </div>
        ) : (
          <>
            {/* ── The form (HR-SPEC §5.1: four fields, submit) ─────────────── */}
            <div style={surface}>
              <div className="c-label" style={{ marginBottom: 8 }}>Which shift</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                <button style={seg(shiftChoice === 'today')} onClick={() => setShiftChoice('today')}>Tonight</button>
                <button style={seg(shiftChoice === 'yesterday')} onClick={() => setShiftChoice('yesterday')}>Yesterday</button>
                <button style={seg(shiftChoice === 'other')} onClick={() => setShiftChoice('other')}>Other day</button>
              </div>
              {shiftChoice === 'other' && (
                <div style={{ ...well, marginBottom: 12 }}>
                  <input type="date" value={otherDate} onChange={e => setOtherDate(e.target.value)} style={input} max={today} />
                </div>
              )}

              <div className="c-label" style={{ marginBottom: 8 }}>What was missed</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {PUNCH_TYPES.map(p => (
                  <button key={p.value} style={seg(punchType === p.value)} onClick={() => setPunchType(p.value)}>
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="c-label" style={{ marginBottom: 6 }}>The time it should say</div>
              <div style={{ ...well, marginBottom: 12 }}>
                <input value={time} onChange={e => setTime(e.target.value)} placeholder="6:00 PM" style={input} inputMode="text" />
              </div>

              <div className="c-label" style={{ marginBottom: 6 }}>Note (optional)</div>
              <div style={{ ...well, minHeight: 56, marginBottom: 14 }}>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Got pulled into load-in on the way in" style={input} />
              </div>

              {formError && (
                <div style={{ fontSize: 12, color: 'var(--c-st-hot)', fontWeight: 700, marginBottom: 10 }}>{formError}</div>
              )}
              {sentAt && !formError && (
                <div style={{ fontSize: 12, color: 'var(--c-st-booked)', fontWeight: 700, marginBottom: 10 }}>
                  Sent {sentAt} — it's in the manager queue.
                </div>
              )}

              <button
                onClick={submit}
                disabled={saving}
                style={{
                  width: '100%', minHeight: 50, borderRadius: 14,
                  background: 'var(--c-wash2)', color: 'var(--c-fg)',
                  border: 'none', font: 'inherit', fontSize: 13.5, fontWeight: 800,
                  cursor: 'pointer', opacity: saving ? 0.6 : 1,
                  boxShadow: 'var(--c-softsh)',
                }}
              >
                {saving ? 'Sending…' : 'Submit report'}
              </button>
              <div style={{ fontSize: 10.5, opacity: 0.45, lineHeight: 1.5, marginTop: 9 }}>
                This is your written confirmation — it's timestamped and kept.
                Same-day reports are the good kind: report it the night it happens.
              </div>
            </div>

            {/* ── Personal record (accountability, colour-coded) ───────────── */}
            <div style={surface}>
              <div className="c-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Your last 90 days
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 11, fontWeight: 800, color: band.color, textTransform: 'none', letterSpacing: 0,
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: band.color }} />
                  {band.label}
                </span>
              </div>
              {mine.length === 0 ? (
                <div style={{ fontSize: 12.5, opacity: 0.5 }}>No missed punches. Keep it that way.</div>
              ) : (
                mine.map((r, i) => (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0',
                    boxShadow: i > 0 ? '0 -1px 0 var(--c-wash)' : undefined, fontSize: 12,
                  }}>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <b>{punchTypeLabel(r.punch_type)}</b>
                      <span style={{ opacity: 0.55 }}> · {r.shift_date} · {fromDbTime(r.claimed_time)}</span>
                    </div>
                    <span style={{ fontSize: 10, opacity: 0.55, flexShrink: 0 }}>{REPORT_CLASS_LABEL[r.report_class]}</span>
                    <span className={`c-pill ${r.status === 'rejected' ? 'c-fill-hot' : r.status === 'pending' ? 'c-fill-warm' : 'c-fill-booked'}`} style={{ flexShrink: 0 }}>
                      {r.status === 'entered_in_adp' ? 'In ADP' : r.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
