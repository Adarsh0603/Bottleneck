// How requests in flight thin out when there are lots of them. A few look
// exactly as before; past CALM they shrink and fade smoothly towards a floor,
// so a flood reads as a soft stream instead of a solid mass of cubes.
const CALM = 6
const FULL = 40
const FLOOR = 0.55

export function crowd(inFlight: number): { scale: number; opacity: number } {
  const t = Math.min(1, Math.max(0, (inFlight - CALM) / (FULL - CALM)))
  const ease = t * t * (3 - 2 * t)
  const k = 1 - (1 - FLOOR) * ease
  return { scale: k, opacity: k }
}

// Eases a trip's progress so cubes leave and arrive gently instead of at a
// constant, mechanical speed. Half linear, half smoothstep: still brisk.
export function glide(p: number): number {
  return p * 0.5 + p * p * (3 - 2 * p) * 0.5
}

// 0 at either end of a trip, 1 through the middle, so cubes fade in and out
// instead of popping into or out of existence.
export function edge(p: number): number {
  return Math.min(1, p / 0.12, (1 - p) / 0.12)
}
