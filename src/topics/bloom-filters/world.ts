import { TICKS_PER_SECOND } from '../../core/flow/time'
// Where things stand on the floor, left to right:
//
//   Sign-up form ──▶ Filter ──▶ Database
//
// The form sends a name to the filter. A "definitely new" goes straight back to
// the form. A "maybe" goes on to the database, which is slow but always right.

export type Place = 'form' | 'filter' | 'db'

export { TICKS_PER_SECOND }
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const SPOT: Record<Place, { x: number; z: number }> = {
  form: { x: -6.8, z: 0 },
  filter: { x: 0, z: 0 },
  db: { x: 6.8, z: 0 },
}

export const FORM = { w: 0.9, d: 0.9, h: 1.1 }
export const DB = { r: 0.8, h: 1.1 }
export const SLAB_H = 0.3

const MAX_COLS = 16
const PITCH = 0.3

// The strip of switches: up to 16 across, then more rows.
export function layout(bits: number) {
  const cols = Math.min(MAX_COLS, bits)
  const rows = Math.ceil(bits / cols)
  return { cols, rows, w: cols * PITCH + 0.5, d: rows * PITCH + 0.5, cell: PITCH * 0.78 }
}

export function cellAt(i: number, bits: number) {
  const { cols, rows } = layout(bits)
  return {
    x: SPOT.filter.x + ((i % cols) - (cols - 1) / 2) * PITCH,
    z: (Math.floor(i / cols) - (rows - 1) / 2) * PITCH,
  }
}

const COLORS = ['var(--srv-1)', 'var(--srv-2)', 'var(--srv-3)', 'var(--srv-4)', 'var(--srv-5)']
// Each check keeps one colour from the form to the answer.
export const queryColor = (n: number) => COLORS[(n - 1) % COLORS.length]

const FIRST = ['sam', 'mia', 'leo', 'zoe', 'max', 'ava', 'kai', 'eve', 'ben', 'ivy', 'tom', 'amy', 'jay', 'uma', 'rex', 'lia']
// A readable username for a name id.
export const nameOf = (id: number) => `${FIRST[id % FIRST.length]}${10 + ((id * 7) % 90)}`
