import type { V3 } from '../types'

// Isometric projection shared by every topic's scene. y is up; a larger
// (z − x) is closer to the viewer, so scenes paint in that order.
export const S = 40
const COS = Math.cos(Math.PI / 6)

export function project([x, y, z]: V3): [number, number] {
  return [(x + z) * COS * S, ((z - x) * 0.5 - y) * S]
}

export const points = (vs: V3[]) => vs.map((v) => project(v).join(',')).join(' ')

export const depth = (x: number, z: number) => z - x
