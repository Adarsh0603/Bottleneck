import type { BuildTask, Placement, Settings } from '../build/types'

// A capstone: "design a real system" as four stages on one persistent board.
//   1 Requirements: estimate the numbers that drive the design.
//   2 First design: a small build, with the one new idea.
//   3 Where it breaks: the same board under growing load.
//   4 Final review: your design next to a reference design.

// The opening: a tiny working version of the system runs on a board, and a
// caption points at one piece at a time. Nothing to place, nothing to read first.
export interface IntroStep {
  say: string // one short sentence
  at?: string // id of the fixed piece to point at
  label?: string // the name on the pointer
}

export interface Intro {
  task: BuildTask // a small board with fixed pieces only
  steps: IntroStep[]
  start: string // the button on the last step
}

export interface Estimate {
  question: string
  options: string[]
  answer: number
  why: string
  // With an intro board: the piece the question is about, and the number written on it once answered.
  at?: string
  show?: string
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
  // What the first screen shows before the brief, when the project has one.
  intro?: Intro
  // The goals in a few words each, shown as chips on the requirements screen instead of the brief.
  goals?: string[]
  // The client brief, pinned on every stage.
  brief: { title: string; lines: string[] }
  // `summary` is what the numbers add up to, shown once the last question is answered.
  estimate: { intro: string; questions: Estimate[]; summary: { title: string; body: string } }
  first: BuildTask
  scale: BuildTask
  review: (placed: Placement, settings: Settings) => Review
}
