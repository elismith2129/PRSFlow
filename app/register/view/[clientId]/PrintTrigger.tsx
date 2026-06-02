'use client'
import { useEffect } from 'react'

export default function PrintTrigger() {
  useEffect(() => {
    // Small delay so images can load before the print dialog opens
    const t = setTimeout(() => window.print(), 800)
    return () => clearTimeout(t)
  }, [])
  return null
}
