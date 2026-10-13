'use client'
import React from 'react'

/**
 * THE ONE DATE STEPPER — ‹ label › (Eli, 2026-10-12, the Ramp rework, rule 5
 * on the mock: "the same ‹ date › control on Calendar, Daily Ops, Tenants and
 * Petty Cash. Today each page has its own version"). It sits in the page
 * header's actions. It knows nothing about dates: the page passes the label
 * and handles the two arrows, so a month, a week or a day all use it.
 */
export function DateStep({ label, onPrev, onNext, nextDisabled, prevDisabled, title }: {
  label: React.ReactNode
  onPrev: () => void
  onNext: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
  title?: string
}) {
  return (
    <span className="c-step" title={title}>
      <button type="button" onClick={onPrev} disabled={prevDisabled} aria-label="Earlier">‹</button>
      <b>{label}</b>
      <button type="button" onClick={onNext} disabled={nextDisabled} aria-label="Later">›</button>
    </span>
  )
}
