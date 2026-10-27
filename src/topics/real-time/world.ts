// Where things stand on the floor, left to right:
//
//   Friend ──▶ Server ◀──▶ Phone
//
// The friend sends messages to the server. The phone has to find out about
// them. With many phones, the right-hand side becomes a crowd and the server
// becomes a row of servers, each holding a share of the connections.

export type Place = 'friend' | 'server' | 'phone'

export const TICKS_PER_SECOND = 20
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const SPOT: Record<Place, { x: number; z: number }> = {
  friend: { x: -7, z: 0 },
  server: { x: -1.4, z: 0 },
  phone: { x: 5, z: 0 },
}

export const FRIEND = { w: 1.1, d: 1.1, h: 0.7 }
export const SERVER = { w: 1.1, d: 1.1, h: 1.2 }
export const PHONE = { w: 0.7, d: 0.9, h: 1.2 }
