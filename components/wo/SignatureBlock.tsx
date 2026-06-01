'use client'
import { useRef, useState, useEffect } from 'react'

export function SignatureBlock() {
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  function getPos(e: MouseEvent | Touch, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    function startDraw(pos: { x: number; y: number }) {
      drawing.current = true
      ctx!.beginPath()
      ctx!.moveTo(pos.x, pos.y)
    }
    function draw(pos: { x: number; y: number }) {
      if (!drawing.current) return
      ctx!.lineTo(pos.x, pos.y)
      ctx!.stroke()
    }
    function stopDraw() { drawing.current = false }

    const onMD = (e: MouseEvent) => startDraw(getPos(e, canvas))
    const onMM = (e: MouseEvent) => draw(getPos(e, canvas))
    const onMU = () => stopDraw()
    const onTS = (e: TouchEvent) => { e.preventDefault(); startDraw(getPos(e.touches[0], canvas)) }
    const onTM = (e: TouchEvent) => { e.preventDefault(); draw(getPos(e.touches[0], canvas)) }
    const onTE = () => stopDraw()

    canvas.addEventListener('mousedown', onMD)
    canvas.addEventListener('mousemove', onMM)
    canvas.addEventListener('mouseup', onMU)
    canvas.addEventListener('mouseleave', onMU)
    canvas.addEventListener('touchstart', onTS, { passive: false })
    canvas.addEventListener('touchmove', onTM, { passive: false })
    canvas.addEventListener('touchend', onTE)
    return () => {
      canvas.removeEventListener('mousedown', onMD)
      canvas.removeEventListener('mousemove', onMM)
      canvas.removeEventListener('mouseup', onMU)
      canvas.removeEventListener('mouseleave', onMU)
      canvas.removeEventListener('touchstart', onTS)
      canvas.removeEventListener('touchmove', onTM)
      canvas.removeEventListener('touchend', onTE)
    }
  }, [open])

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.08em', color: '#666', minWidth: 90,
  }

  return (
    <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid #ccc' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
        Authorization
      </div>

      {/* Legal name */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <span style={labelStyle}>Legal Name</span>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Type full legal name"
          style={{
            flex: 1, border: 'none', borderBottom: '1px solid #aaa', outline: 'none',
            fontFamily: 'Courier New, monospace', fontSize: 11, padding: '2px 4px', background: 'transparent',
          }}
        />
      </div>

      {/* Signature canvas */}
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            fontSize: 9, padding: '4px 14px', border: '1px solid #aaa', background: 'white',
            cursor: 'pointer', borderRadius: 3, fontFamily: 'Courier New, monospace',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}
        >
          + Add Signature
        </button>
      ) : (
        <div>
          <div style={{ fontSize: 8, color: '#888', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Signature — draw below
          </div>
          <canvas
            ref={canvasRef}
            width={900}
            height={120}
            style={{
              border: '1px solid #aaa', display: 'block', cursor: 'crosshair',
              width: '100%', touchAction: 'none', background: 'white',
            }}
          />
          <button
            onClick={clearCanvas}
            style={{
              marginTop: 4, fontSize: 9, padding: '3px 10px', border: '1px solid #ddd',
              background: 'white', cursor: 'pointer', borderRadius: 3,
              fontFamily: 'Courier New, monospace', color: '#666',
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
