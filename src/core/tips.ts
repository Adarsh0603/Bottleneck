import { useSyncExternalStore } from 'react'

// The first-visit tips the learner has already seen, so each shows once. Saved in this
// browser and synced with progress, so a signed-in learner never sees one twice.

const KEY = 'systemlands.tips.v1'

// Anything unexpected in storage is ignored rather than crashing the app.
export function parse(raw: string | null): string[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    return Array.isArray(data) ? [...new Set(data.filter((s): s is string => typeof s === 'string'))] : []
  } catch {
    return []
  }
}

// Two devices' tips, combined: a tip seen on either stays seen.
export const mergeTips = (a: string[], b: string[]) => [...new Set([...a, ...b])]

function read(): string[] {
  try {
    return parse(localStorage.getItem(KEY))
  } catch {
    return []
  }
}

let state = read()
const listeners = new Set<() => void>()

function commit(next: string[]) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage blocked or full: the tip is still hidden for this visit.
  }
  listeners.forEach((l) => l())
}

export function useSeenTips(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => state,
  )
}

export function markSeen(id: string) {
  if (!state.includes(id)) commit([...state, id])
}

export const currentTips = (): string[] => state

// For cloud sync: swap in merged tips, and hear about every change.
export const replaceTips = (next: string[]) => commit(mergeTips([], next))
export const resetTips = () => commit([])

export function onTipsChange(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
