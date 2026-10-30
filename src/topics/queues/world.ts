// Where things stand on the floor. Users and the app on the left, a queue
// in the middle and a column of workers on the right, with a dead-letter box
// off to the side of the queue:
//
//                                         worker 1
//                                         worker 2
//   users   app server   ▭▭▭ queue ▭▭▭    worker 3
//                          ▢ dead-letter  worker 4
//                                         worker 5
//                                         worker 6

import type { V3 } from '../../core/types'
import { TICKS_PER_SECOND } from '../../core/flow/time'

export const USERS = { x: -9, z: 0 }
export const APP = { x: -5.8, z: 0, w: 1.5, h: 1.5 }
export const QUEUE = { x: -1.4, z: 0, len: 4.4, wid: 1.3, h: 0.5 }
export const DEAD = { x: -1.4, z: 3.6, size: 1.1, h: 0.6 }
export const WORKER_X = 4
export const WORKER = { w: 1.1, h: 1.5 }
export const MAX_WORKERS = 6
const WORKER_Z = [-5.5, -3.3, -1.1, 1.1, 3.3, 5.5]

export { TICKS_PER_SECOND }
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const workerKey = (i: number) => `worker-${i}`
export const workerIndex = (key: string) => (key.startsWith('worker-') ? Number(key.slice(7)) : -1)
export const workerSpot = (i: number) => ({ x: WORKER_X, z: WORKER_Z[i] })

// The queue is a long trough: jobs go in at one end and leave at the other.
export const QUEUE_IN = { x: QUEUE.x - QUEUE.len / 2, z: QUEUE.z }
export const QUEUE_OUT = { x: QUEUE.x + QUEUE.len / 2, z: QUEUE.z }

// Where a request leaves one node and arrives at the next.
export function spotOf(key: string, side: 'in' | 'out' = 'in'): { x: number; z: number } | undefined {
  if (key === 'users') return USERS
  if (key === 'app') return APP
  if (key === 'queue') return side === 'in' ? QUEUE_IN : QUEUE_OUT
  const i = workerIndex(key)
  return i >= 0 ? workerSpot(i) : undefined
}

export const aboveWorker = (i: number, dy = 0.6): V3 => [WORKER_X, WORKER.h + dy, WORKER_Z[i]]

// Busier than this, and a worker turns red.
export const HOT = 0.85
