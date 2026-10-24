import { describe, expect, it } from 'vitest'
import { Running, TICKS_PER_SECOND } from '../../core/build/run'
import type { PieceKind, Placement, Settings } from '../../core/build/types'
import { ORDER_DESK as task } from './build'

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function wins(placed: Placement, settings: Settings, seed: number) {
  const run = new Running(task.assemble(placed, settings, mulberry(seed)))
  let streak = 0
  for (let t = 0; t < TICKS_PER_SECOND * 80; t++) {
    run.step()
    streak = task.check(run.metrics(), placed, settings, run.flow) ? streak + 1 : 0
    if (streak >= task.holdSeconds * TICKS_PER_SECOND) return true
  }
  return false
}

const seeds = [1, 2, 3, 4, 5]
const always = (p: Placement, s: Settings) => seeds.every((seed) => wins(p, s, seed))
const never = (p: Placement, s: Settings) => seeds.every((seed) => !wins(p, s, seed))

const build = (channel: PieceKind | undefined, email: number, stock: number): Placement => {
  const placed: Placement = {}
  if (channel) placed.channel = channel
  for (let i = 0; i < email; i++) placed[`email-${i}`] = 'server'
  for (let i = 0; i < stock; i++) placed[`stock-${i}`] = 'server'
  return placed
}

const PRODUCT = 2
const stream = (partitions: number, key: number, retention: number): Settings => ({ partitions, key, retention })

describe('order desk build', () => {
  it('wins with a stream keyed by product, three partitions, three consumers each, and a long enough log', () => {
    expect(always(build('stream', 3, 3), stream(3, PRODUCT, 1))).toBe(true)
    expect(always(build('stream', 3, 3), stream(3, PRODUCT, 2))).toBe(true)
    expect(always(build('stream', 3, 3), stream(4, PRODUCT, 1))).toBe(true)
  })

  it('never wins with no channel', () => {
    expect(never(build(undefined, 3, 3), {})).toBe(true)
  })

  it('never wins with a queue: each order reaches one team', () => {
    expect(never(build('queue', 3, 3), {})).toBe(true)
  })

  it('never wins with a topic: Analytics loses what is sent while it is offline', () => {
    expect(never(build('topic', 3, 3), {})).toBe(true)
    expect(never(build('topic', 4, 3), {})).toBe(true)
  })

  it('never wins with a log that forgets before Analytics is back', () => {
    expect(never(build('stream', 3, 3), stream(3, PRODUCT, 0))).toBe(true)
  })

  it('never wins without enough partitions for the consumers to share', () => {
    expect(never(build('stream', 3, 3), stream(1, PRODUCT, 1))).toBe(true)
    expect(never(build('stream', 3, 3), stream(2, PRODUCT, 1))).toBe(true)
  })

  it('never wins with the wrong key: Inventory sees a product out of order', () => {
    expect(never(build('stream', 3, 3), stream(3, 0, 1))).toBe(true)
    expect(never(build('stream', 3, 3), stream(3, 1, 1))).toBe(true)
  })

  it('never wins with too few consumers for Email or Inventory', () => {
    expect(never(build('stream', 2, 3), stream(3, PRODUCT, 1))).toBe(true)
    expect(never(build('stream', 3, 2), stream(3, PRODUCT, 1))).toBe(true)
    expect(never(build('stream', 0, 3), stream(3, PRODUCT, 1))).toBe(true)
  })

  it('a fourth consumer is a decoy: more consumers than busy partitions do nothing', () => {
    expect(never(build('stream', 4, 2), stream(4, PRODUCT, 1))).toBe(true)
    expect(always(build('stream', 4, 3), stream(3, PRODUCT, 1))).toBe(true)
  })
})
