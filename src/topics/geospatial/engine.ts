// Finding the nearest car on a map:
//
//   Rider ──▶ index ──▶ a few cars ──▶ nearest
//
// Cars sit at fixed places on a square map. A rider asks for the nearest car,
// and the method decides which cars get looked at:
//
//   scan:     every car.
//   grid:     the cars in the rider's cell, and in the eight around it if asked.
//   geohash:  the same as the grid. When the cells hold no car it can drop a
//             letter off the cell's name and look in the bigger cell instead.
//   quadtree: boxes that split in four wherever more than LEAF_CAP cars are
//             packed. Boxes are tried nearest first, and the search stops
//             when the next box is farther than the best car so far.
//
// Every ask is counted: how many cars were looked at, and whether the answer
// was the true nearest car. The same asks are replayed whenever a setting
// changes, so two methods can be compared on the same riders.

import type { GeoState } from './types'
import { TICKS_PER_SECOND } from './world'

export const LEAF_CAP = 8 // a quadtree box holds at most this many cars before it splits
const MAX_DEPTH = 9
export const MS_PER_ROW = 0.05 // reading one car's row from the database
const DOWNTOWN = { x: 0.5, y: 0.5, half: 0.1 }
const DOWNTOWN_SHARE = 0.6 // share of cars, and of riders, in the middle when the city is busy
const EDGE_TRIES = 80
const RECENT = 5 // asks in the running average
const LOAD_TICKS = 2 * TICKS_PER_SECOND // window for rows read a second

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Leaf {
  rect: Rect
  ids: number[]
}

export type Outcome = 'right' | 'wrong' | 'none'

// One ask, for the scene to draw.
export interface Lookup {
  rider: { x: number; y: number }
  checked: Set<number> // cars that were looked at
  found: number // the car it picked; -1 = none
  truth: number // the car that is really nearest
  rects: Rect[] // the areas that were searched
  cells: number // cells or boxes read
  widened: number // times a letter was dropped
  cell: string // name of the rider's cell, for the grid and geohash
  outcome: Outcome
  tick: number
}

export interface GeoMetrics {
  lookups: number
  checked: number // cars looked at by the last ask
  ms: number // time of the last ask
  outcome: Outcome | null
  misses: number // answers that were not the nearest car, or found no car
  avgChecked: number // cars looked at, averaged over the last few asks
  load: number // cars looked at a second, over the last two seconds
  cells: number
  widened: number
}

// A small seeded generator, so the cars and the riders are the same every run.
const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const MAP_RECT: Rect = { x0: 0, y0: 0, x1: 1, y1: 1 }

const cellOf = (v: number, res: number) => Math.min(res - 1, Math.floor(v * res))

// The name of a cell: one digit for each time the map was cut in four. A
// cell's name starts with the name of the bigger cell it sits in.
export function cellName(x: number, y: number, res: number) {
  let name = ''
  for (let k = 1; 2 ** k <= res; k++) {
    const bx = Math.floor(x * 2 ** k) % 2
    const by = Math.floor(y * 2 ** k) % 2
    name += bx + by * 2
  }
  return name
}

const rectDist2 = (r: Rect, x: number, y: number) => {
  const dx = Math.max(r.x0 - x, 0, x - r.x1)
  const dy = Math.max(r.y0 - y, 0, y - r.y1)
  return dx * dx + dy * dy
}

export class GeoSim {
  tick = 0
  xs: number[] = []
  ys: number[] = []
  leaves: Leaf[] = []
  last: Lookup | null = null

  private st: GeoState = {
    ask: 0,
    round: 0,
    method: 'scan',
    drivers: 400,
    city: 'even',
    res: 8,
    neighbours: false,
    widen: false,
    edge: false,
    rate: 0,
  }
  private popKey: string | null = null
  private cfgKey: string | null = null
  private asked = 0 // asks of the `ask` counter already answered
  private rand = seeded(23)
  private autoAcc = 0
  private grids = new Map<number, Map<number, number[]>>()
  private full: Leaf[] = [] // the boxes that hold a car
  private count = 0
  private misses = 0
  private recent: number[] = []
  private log: { tick: number; checked: number }[] = []

  apply(st: GeoState) {
    this.st = st
    const pop = `${st.drivers}|${st.city}|${st.round}`
    if (pop !== this.popKey) {
      this.popKey = pop
      this.populate()
    }
    // Any change that alters an answer starts the counts again, and the asks
    // so far are replayed with the new setting.
    const cfg = `${pop}|${st.method}|${st.res}|${st.neighbours}|${st.widen}|${st.edge}`
    if (cfg !== this.cfgKey) {
      this.cfgKey = cfg
      this.restart()
    }
    while (this.asked < st.ask) {
      this.asked++
      this.lookup()
    }
  }

  private restart() {
    this.asked = 0
    this.rand = seeded(23)
    this.autoAcc = 0
    this.count = 0
    this.misses = 0
    this.recent = []
    this.log = []
    this.last = null
  }

  private populate() {
    const { drivers, city } = this.st
    const r = seeded(11)
    const crowd = city === 'downtown' ? Math.round(drivers * DOWNTOWN_SHARE) : 0
    this.xs = []
    this.ys = []
    for (let i = 0; i < drivers; i++) {
      if (i < crowd) {
        this.xs.push(DOWNTOWN.x + (r() * 2 - 1) * DOWNTOWN.half)
        this.ys.push(DOWNTOWN.y + (r() * 2 - 1) * DOWNTOWN.half)
      } else {
        this.xs.push(r())
        this.ys.push(r())
      }
    }
    this.grids.clear()
    this.leaves = []
    this.split(
      this.xs.map((_, i) => i),
      MAP_RECT,
      0,
    )
    this.full = this.leaves.filter((l) => l.ids.length > 0)
  }

  // A box that holds too many cars splits into four.
  private split(ids: number[], r: Rect, depth: number) {
    if (ids.length <= LEAF_CAP || depth >= MAX_DEPTH) {
      this.leaves.push({ rect: r, ids })
      return
    }
    const mx = (r.x0 + r.x1) / 2
    const my = (r.y0 + r.y1) / 2
    const parts: number[][] = [[], [], [], []]
    for (const i of ids) parts[(this.xs[i] >= mx ? 1 : 0) + (this.ys[i] >= my ? 2 : 0)].push(i)
    const rects: Rect[] = [
      { x0: r.x0, y0: r.y0, x1: mx, y1: my },
      { x0: mx, y0: r.y0, x1: r.x1, y1: my },
      { x0: r.x0, y0: my, x1: mx, y1: r.y1 },
      { x0: mx, y0: my, x1: r.x1, y1: r.y1 },
    ]
    parts.forEach((p, k) => this.split(p, rects[k], depth + 1))
  }

  // The cars in each cell of a grid with `res` cells along a side.
  private gridOf(res: number) {
    let g = this.grids.get(res)
    if (!g) {
      g = new Map()
      this.xs.forEach((x, i) => {
        const key = cellOf(this.ys[i], res) * res + cellOf(x, res)
        const list = g!.get(key)
        if (list) list.push(i)
        else g!.set(key, [i])
      })
      this.grids.set(res, g)
    }
    return g
  }

  private dist2(i: number, x: number, y: number) {
    const dx = this.xs[i] - x
    const dy = this.ys[i] - y
    return dx * dx + dy * dy
  }

  private nearestOf(ids: Iterable<number>, x: number, y: number) {
    let best = -1
    let bd = Infinity
    for (const i of ids) {
      const d = this.dist2(i, x, y)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }

  private everyCar() {
    return this.xs.map((_, i) => i)
  }

  private draw() {
    const r = this.rand
    if (this.st.city === 'downtown' && r() < DOWNTOWN_SHARE) {
      return { x: DOWNTOWN.x + (r() * 2 - 1) * DOWNTOWN.half, y: DOWNTOWN.y + (r() * 2 - 1) * DOWNTOWN.half }
    }
    return { x: r(), y: r() }
  }

  // A rider. With `edge`, one whose nearest car is in another cell than their own.
  private pickRider() {
    let p = this.draw()
    if (!this.st.edge || this.xs.length === 0) return p
    const { res } = this.st
    const all = this.everyCar()
    for (let n = 0; n < EDGE_TRIES; n++) {
      const t = this.nearestOf(all, p.x, p.y)
      if (cellOf(this.xs[t], res) !== cellOf(p.x, res) || cellOf(this.ys[t], res) !== cellOf(p.y, res)) return p
      p = this.draw()
    }
    return p
  }

  // The cars in the rider's cell, and the eight around it when asked.
  private block(p: { x: number; y: number }, res: number) {
    const reach = this.st.neighbours ? 1 : 0
    const cx = cellOf(p.x, res)
    const cy = cellOf(p.y, res)
    const g = this.gridOf(res)
    const ids: number[] = []
    const rects: Rect[] = []
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= res || y >= res) continue
        rects.push({ x0: x / res, y0: y / res, x1: (x + 1) / res, y1: (y + 1) / res })
        const list = g.get(y * res + x)
        if (list) ids.push(...list)
      }
    }
    return { ids, rects }
  }

  private search(p: { x: number; y: number }) {
    const { method, widen } = this.st
    if (method === 'scan') return { ids: this.everyCar(), rects: [MAP_RECT], cells: 0, widened: 0, cell: '' }
    if (method === 'quadtree') {
      const order = this.full.map((l) => ({ l, d: rectDist2(l.rect, p.x, p.y) })).sort((a, b) => a.d - b.d)
      const ids: number[] = []
      const rects: Rect[] = []
      let bd = Infinity
      for (const { l, d } of order) {
        if (d >= bd) break
        rects.push(l.rect)
        for (const i of l.ids) {
          ids.push(i)
          bd = Math.min(bd, this.dist2(i, p.x, p.y))
        }
      }
      return { ids, rects, cells: rects.length, widened: 0, cell: '' }
    }
    let res = this.st.res
    let widened = 0
    for (;;) {
      const { ids, rects } = this.block(p, res)
      if (ids.length > 0 || method !== 'geohash' || !widen || res <= 1) {
        return { ids, rects, cells: rects.length, widened, cell: method === 'geohash' ? cellName(p.x, p.y, res) : `${cellOf(p.x, res) + 1}, ${cellOf(p.y, res) + 1}` }
      }
      res /= 2
      widened++
    }
  }

  private lookup() {
    const rider = this.pickRider()
    const truth = this.nearestOf(this.everyCar(), rider.x, rider.y)
    const { ids, rects, cells, widened, cell } = this.search(rider)
    const found = this.nearestOf(ids, rider.x, rider.y)
    const outcome: Outcome = found < 0 ? 'none' : found === truth ? 'right' : 'wrong'
    this.count++
    if (outcome !== 'right') this.misses++
    this.recent.push(ids.length)
    if (this.recent.length > RECENT) this.recent.shift()
    this.log.push({ tick: this.tick, checked: ids.length })
    this.last = { rider, checked: new Set(ids), found, truth, rects, cells, widened, cell, outcome, tick: this.tick }
  }

  step() {
    this.tick++
    if (this.st.rate > 0) {
      this.autoAcc += this.st.rate / TICKS_PER_SECOND
      while (this.autoAcc >= 1) {
        this.autoAcc--
        this.lookup()
      }
    }
    while (this.log.length && this.log[0].tick <= this.tick - LOAD_TICKS) this.log.shift()
  }

  get metrics(): GeoMetrics {
    const l = this.last
    const window = this.log.filter((e) => e.tick > this.tick - LOAD_TICKS)
    const sum = (a: number[]) => a.reduce((s, n) => s + n, 0)
    return {
      lookups: this.count,
      checked: l ? l.checked.size : 0,
      ms: l ? l.checked.size * MS_PER_ROW : 0,
      outcome: l ? l.outcome : null,
      misses: this.misses,
      avgChecked: this.recent.length ? sum(this.recent) / this.recent.length : 0,
      load: sum(window.map((e) => e.checked)) / (LOAD_TICKS / TICKS_PER_SECOND),
      cells: l ? l.cells : 0,
      widened: l ? l.widened : 0,
    }
  }
}
