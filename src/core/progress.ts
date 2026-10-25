import { useSyncExternalStore } from 'react'
import { TOPICS } from '../topics/registry'

// Learner progress, saved in this browser only (localStorage). Everything
// that reads or writes progress goes through this file, so moving it to a
// server later only changes this file.

export interface TopicProgress {
  done: number[] // chapters seen through to their last step
  solved: string[] // challenges solved, as "chapter:step"
  last?: { chapter: number; step: number } // where the learner left off
  updatedAt: number
}

export type Progress = Record<string, TopicProgress>

const KEY = 'bottleneck.progress.v1'
const EMPTY: TopicProgress = { done: [], solved: [], updatedAt: 0 }

export const topicProgress = (p: Progress, topic: string): TopicProgress => p[topic] ?? EMPTY

// --- Pure updates (tested in progress.test.ts) -------------------------------

export function withStep(p: Progress, topic: string, chapter: number, step: number, isLastStep: boolean, now: number): Progress {
  const t = topicProgress(p, topic)
  const done = isLastStep && !t.done.includes(chapter) ? [...t.done, chapter].sort((a, b) => a - b) : t.done
  if (done === t.done && t.last?.chapter === chapter && t.last.step === step) return p
  return { ...p, [topic]: { ...t, done, last: { chapter, step }, updatedAt: now } }
}

export function withSolved(p: Progress, topic: string, chapter: number, step: number, now: number): Progress {
  const t = topicProgress(p, topic)
  const id = `${chapter}:${step}`
  if (t.solved.includes(id)) return p
  return { ...p, [topic]: { ...t, solved: [...t.solved, id], updatedAt: now } }
}

// The topic touched most recently that still has chapters left, if any.
export function continueTarget(p: Progress, chapterCounts: Record<string, number>) {
  let best: { topic: string; chapter: number; step: number; updatedAt: number } | undefined
  for (const [topic, t] of Object.entries(p)) {
    const total = chapterCounts[topic]
    if (!total || !t.last || t.done.length >= total) continue
    if (!best || t.updatedAt > best.updatedAt) best = { topic, ...t.last, updatedAt: t.updatedAt }
  }
  return best
}

// Drop progress for chapters and challenges a topic no longer has, e.g.
// after its chapters were reworked, so counts never read "5 / 4".
export function fitted(p: Progress, shapes: Record<string, { chapters: number; challenges: string[] }>): Progress {
  const out: Progress = {}
  for (const [topic, t] of Object.entries(p)) {
    const shape = shapes[topic]
    if (!shape) {
      out[topic] = t
      continue
    }
    out[topic] = {
      ...t,
      done: t.done.filter((n) => n < shape.chapters),
      solved: t.solved.filter((id) => shape.challenges.includes(id)),
      last: t.last && t.last.chapter < shape.chapters ? t.last : undefined,
    }
  }
  return out
}

const SHAPES = Object.fromEntries(
  TOPICS.filter((t) => t.chapters).map((t) => [t.id, { chapters: t.chapters!.length, challenges: t.challenges ?? [] }]),
)

// Anything unexpected in storage (old format, hand-edited) is ignored rather
// than crashing the app.
export function parse(raw: string | null): Progress {
  if (!raw) return {}
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object') return {}
    const out: Progress = {}
    for (const [topic, value] of Object.entries(data as Record<string, unknown>)) {
      const t = value as Partial<TopicProgress> | null
      if (!t || !Array.isArray(t.done) || !Array.isArray(t.solved)) continue
      out[topic] = {
        done: t.done.filter((n): n is number => typeof n === 'number'),
        solved: t.solved.filter((s): s is string => typeof s === 'string'),
        last:
          t.last && typeof t.last.chapter === 'number' && typeof t.last.step === 'number'
            ? { chapter: t.last.chapter, step: t.last.step }
            : undefined,
        updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : 0,
      }
    }
    return out
  } catch {
    return {}
  }
}

// --- Store -----------------------------------------------------------------

function read(): Progress {
  try {
    return fitted(parse(localStorage.getItem(KEY)), SHAPES)
  } catch {
    return {}
  }
}

let state: Progress = read()
const listeners = new Set<() => void>()

function commit(next: Progress) {
  if (next === state) return
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage blocked or full: progress still works for this visit.
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Keep tabs in sync when progress changes in another tab.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    state = read()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

// The progress as it is right now, for event handlers that are not components.
export const currentProgress = (): Progress => state

export function useProgress(): Progress {
  return useSyncExternalStore(subscribe, () => state)
}

export function recordStep(topic: string, chapter: number, step: number, isLastStep: boolean) {
  commit(withStep(state, topic, chapter, step, isLastStep, Date.now()))
}

export function recordSolved(topic: string, chapter: number, step: number) {
  commit(withSolved(state, topic, chapter, step, Date.now()))
}

export function resetProgress() {
  commit({})
}
