import type { BuildTask, PieceKind, Placement } from './types'

// The rules for moving pieces between the toolbox and the pads.

// How many of each piece are still in the toolbox.
export function remaining(task: BuildTask, placed: Placement): Partial<Record<PieceKind, number>> {
  const left: Partial<Record<PieceKind, number>> = {}
  for (const { kind, count } of task.toolbox) left[kind] = count
  for (const kind of Object.values(placed)) if (left[kind] !== undefined) left[kind]! -= 1
  return left
}

const accepts = (task: BuildTask, padId: string, kind: PieceKind) =>
  !!task.pads.find((p) => p.id === padId)?.accepts.includes(kind)

// Can `kind` go on `padId`, either from the toolbox or moved from `fromPad`?
export function canDrop(task: BuildTask, placed: Placement, padId: string, kind: PieceKind, fromPad?: string) {
  if (!accepts(task, padId, kind)) return false
  if (fromPad !== undefined || placed[padId] === kind) return true
  return (remaining(task, placed)[kind] ?? 0) > 0
}

// Put `kind` on `padId`. Whatever was there goes back to the toolbox, or
// swaps over to `fromPad` when a piece is being moved and it fits there.
export function drop(task: BuildTask, placed: Placement, padId: string, kind: PieceKind, fromPad?: string): Placement {
  if (!canDrop(task, placed, padId, kind, fromPad)) return placed
  const next = { ...placed }
  const occupant = next[padId]
  if (fromPad !== undefined) {
    delete next[fromPad]
    if (occupant && fromPad !== padId && accepts(task, fromPad, occupant)) next[fromPad] = occupant
  }
  next[padId] = kind
  return next
}

// Take a piece off its pad, back into the toolbox.
export function lift(placed: Placement, padId: string): Placement {
  const next = { ...placed }
  delete next[padId]
  return next
}
