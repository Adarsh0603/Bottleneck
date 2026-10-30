import { TICKS_PER_SECOND } from '../../core/flow/time'
// Where things stand on the floor, left to right:
//
//   People you follow ──▶ Post store ◀──▶ Feed server ◀──▶ You
//                              │               ▲
//                              └──▶ Inboxes ───┘
//
// The people post into the store. When you open the app, the server builds
// your feed, either by asking the store for each person's newest posts, or by
// reading your inbox, which a worker filled when those people posted.

export type AuthorPlace = 'a0' | 'a1' | 'a2' | 'a3'
export type Place = AuthorPlace | 'store' | 'server' | 'reader' | 'inbox'

export { TICKS_PER_SECOND }
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

// People shown on the floor. The last spot is the celebrity, when there is one.
export const AUTHORS = 4

export const SPOT: Record<Place, { x: number; z: number }> = {
  a0: { x: -7.2, z: -2.1 },
  a1: { x: -7.2, z: -0.7 },
  a2: { x: -7.2, z: 0.7 },
  a3: { x: -7.2, z: 2.1 },
  store: { x: -3, z: 0 },
  server: { x: 1.6, z: 0 },
  reader: { x: 6.2, z: 0 },
  inbox: { x: 1.6, z: -3 },
}

export const AUTHOR = { w: 1.1, d: 1.1, h: 0.7 }
export const STORE = { r: 0.8, h: 1.1 }
export const SERVER = { w: 1, d: 1, h: 1.1 }
export const READER = { w: 0.7, d: 0.9, h: 1.2 }
export const INBOX = { w: 1.9, d: 1.2, h: 0.5 }

export const authorPlace = (i: number): AuthorPlace => `a${i}` as AuthorPlace
