import { TICKS_PER_SECOND } from '../../core/flow/time'
// Where things stand on the floor, left to right:
//
//   Server ══ network ══▶ Phone
//
// The server keeps the video. The network between them is a pipe whose width
// follows the connection speed. The phone keeps a buffer of video it has
// downloaded and not yet played.

export { TICKS_PER_SECOND }
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const SPOT = {
  server: { x: -6, z: 0 },
  phone: { x: 4.6, z: 0 },
}

export const SERVER = { w: 1.3, d: 2.4, h: 1.2 }
export const PHONE = { w: 0.8, d: 1, h: 1.2 }
