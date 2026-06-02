'use client'

export default function SOPPage() {
  return (
    <div style={{ height: 'calc(100vh - 52px)', display: 'flex', flexDirection: 'column' }}>
      <iframe
        src="/sop.html"
        style={{ flex: 1, width: '100%', border: 'none' }}
        title="PRS Flow Training Guide"
      />
    </div>
  )
}
