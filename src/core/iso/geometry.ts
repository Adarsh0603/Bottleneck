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

// Every camera shot is framed for this reference area (scene units at zoom 1).
export const VIEW_W = 900
export const VIEW_H = 620

// How many screen pixels one scene unit gets. On screens at least as wide
// (for their height) as the reference area, the whole area fits. On narrower
// ones, like a phone held upright, fitting it would shrink everything to a
// sliver, so meet halfway between fitting it and filling the screen: the
// subject gets bigger and the far edges are cropped (they can still be
// panned to).
export function frameScale(width: number, height: number) {
  const fit = Math.min(width / VIEW_W, height / VIEW_H)
  const fill = Math.max(width / VIEW_W, height / VIEW_H)
  return width / height >= VIEW_W / VIEW_H ? fit : Math.sqrt(fit * fill)
}
