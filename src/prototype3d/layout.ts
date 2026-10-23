// World layout on the grid floor (y = 0 is the floor, x runs users → server).

export const USERS_X = -5
export const SERVER_X = 3
export const BOX = { w: 1.6, h: 2.2, d: 1.6 }

export const CUBE = 0.26
export const FLY_Y = 0.6
export const QUEUE_GAP = 0.4

export const SERVER_FRONT = SERVER_X - BOX.w / 2
export const PATH_START = USERS_X + 1

// Spot `i` in the line of waiting requests, standing in front of the server.
export function queueSpot(i: number): [number, number, number] {
  return [SERVER_FRONT - 0.35 - i * QUEUE_GAP, CUBE / 2, 0]
}
