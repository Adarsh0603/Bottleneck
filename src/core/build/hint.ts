import type { ReviewLine } from '../capstone/types'

// The hint a capstone shows after HINT_AFTER failed runs: the first part of the design that
// differs from the reference answer, with why it matters and what the reference does.
// `only` limits it to the parts the current stage is about. `reference: false` leaves out
// what the reference does, so the hint explains why without giving the answer.
export function hintFromReview(lines: ReviewLine[], only?: string[], reference = true): string | null {
  const off = lines.find((l) => !l.ok && (!only || only.includes(l.label)))
  if (!off) return null
  return reference ? `${off.label}: ${off.why} The reference answer: ${off.reference}.` : `${off.label}: ${off.why}`
}

// The pointer for a build that jammed: pieces are on the board but the flow stops between them.
export const ORDER_LOOK = 'Follow one request from the front door to the end. Does each part get it from the one before?'
