import { createElement, useMemo } from 'react'
import BuildScene from '../build/BuildScene'
import { TICKS_PER_SECOND, startRun } from '../build/run'
import type { BuildTask } from '../build/types'
import { useTicker } from '../flow/useTicker'
import { Tag } from '../iso/primitives'

// A small working system on the iso board, with an optional pointer over one
// of its fixed pieces. Nothing here can be placed or dragged.
export default function Board({ task, at, label, danger, className = '' }: { task: BuildTask; at?: string; label?: string; danger?: boolean; className?: string }) {
  const { sim, lastTickAt } = useTicker(() => startRun(task, {}, {}), TICKS_PER_SECOND)
  const pointed = useMemo(() => {
    const piece = task.fixed.find((f) => f.id === at)
    return { ...task, decorate: piece ? () => createElement(Tag, { at: [piece.x, 2.3, piece.z], label: label ?? '', danger }) : undefined }
  }, [task, at, label, danger])
  return (
    <div className={`relative overflow-hidden bg-bg ${className}`}>
      <BuildScene task={pointed} run={sim} placed={{}} settings={{}} lastTickAt={lastTickAt} dragKind={null} hoverPad={null} onPadClick={() => {}} onPieceDown={() => {}} tight />
    </div>
  )
}
