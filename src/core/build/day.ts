// A seeded random stream, and the helpers for a task whose day changes a little every run.

export const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// A new stream for each run.
export const freshRng = () => seeded(Math.floor(Math.random() * 4294967296))

// `base` plus a random share of `spread`: jitter(rng, 1, 0.2) is between 1 and 1.2.
export const jitter = (rng: () => number, base: number, spread: number) => base + rng() * spread

// Failed runs in a row before a task's hint shows.
export const HINT_AFTER = 4
