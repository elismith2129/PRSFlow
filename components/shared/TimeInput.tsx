'use client'

interface TimeInputProps {
  value: string
  onChange: (val: string) => void
  onBlur?: () => void
  placeholder?: string
  style?: React.CSSProperties
  disabled?: boolean
}

const TIMES: string[] = []
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    const ap = h < 12 ? 'AM' : 'PM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    TIMES.push(`${h12}:${m.toString().padStart(2, '0')} ${ap}`)
  }
}

export default function TimeInput({ value, onChange, onBlur, placeholder = '--:--', style, disabled }: TimeInputProps) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onChange(e.target.value)
    onBlur?.()
  }

  return (
    <select
      value={value || ''}
      onChange={handleChange}
      disabled={disabled}
      style={{
        background: '#1a1e28',
        color: value ? '#f0f0f0' : '#555',
        border: 'none',
        fontSize: 11,
        fontFamily: 'DM Mono, monospace',
        padding: '2px 0',
        width: '100%',
        cursor: 'pointer',
        ...style,
      }}
    >
      <option value="">{placeholder}</option>
      {TIMES.map(t => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  )
}
