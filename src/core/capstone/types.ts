import type { BuildTask, Placement, Settings } from '../build/types'

// A capstone: "design a real system" as four stages on one persistent board.
//   1 Requirements: estimate the numbers that drive the design.
//   2 First design: a small build, with the one new idea.
//   3 Where it breaks: the same board under growing load.
//   4 Final review: your design next to a reference design.

export interface Estimate {
  question: string
  options: string[]
  answer: number
  why: string
}

export interface ReviewLine {
  label: string
  yours: string
  reference: string
  why: string
  ok: boolean
}

export interface Review {
  lines: ReviewLine[]
  tradeoffs: string[]
  interview: string[]
}

export interface Capstone {
  id: string
  title: string
  stages: [string, string, string, string]
  // The client brief, pinned on every stage.
  brief: { title: string; lines: string[] }
  estimate: { intro: string; questions: Estimate[] }
  first: BuildTask
  scale: BuildTask
  review: (placed: Placement, settings: Settings) => Review
}
