// The floor is a square map seen from above, drawn in isometric. A place on it
// is (u, v), each from 0 to 1, and cars and riders stand on it.

import type { V3 } from '../../core/types'

export const TICKS_PER_SECOND = 20
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const MAP = 9 // side of the floor, in scene units
export const FLOOR = 0.07 // height of the floor top, where flat things are drawn

export const at = (u: number, v: number, y = 0): V3 => [(u - 0.5) * MAP, y, (v - 0.5) * MAP]
