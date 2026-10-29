import type { ReviewLine } from '../capstone/types'

// The hint a capstone shows after HINT_AFTER failed runs: the first part of the design that
// differs from the reference answer, with why it matters and what the reference does.
// `only` limits it to the parts the current stage is about.
export function hintFromReview(lines: ReviewLine[], only?: string[]): string | null {
  const off = lines.find((l) => !l.ok && (!only || only.includes(l.label)))
  return off ? `${off.label}: ${off.why} The reference answer: ${off.reference}.` : null
}
