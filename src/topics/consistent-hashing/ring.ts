// Which cache server holds which item, two ways:
//   - mod: hash(item) % number of servers.
//   - ring: servers and items both sit on a circle, by hash. An item belongs to
//     the first server point clockwise from it. A server can appear at several
//     points ("virtual nodes") to even out its slice.
// Also the bookkeeping for what each change costs: items that change server
// are cold on the new one until they've been fetched from the database again.

export type Mode = 'mod' | 'ring'

export const KEY_COUNT = 60
export const MAX_NODES = 6
export const MAX_POINTS = 16

// A well-mixed hash (murmur3's finaliser), as a 32-bit unsigned number.
export function hash32(n: number) {
  let h = n + 1
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

// A number scrambled into a position on the ring, in [0, 1). Different salts
// give unrelated positions.
export const spot = (n: number, salt: number) => hash32(n * 31 + salt) / 2 ** 32

// Where an item sits on the ring.
export const keySpot = (key: number) => spot(key, 3)

// A spot on the ring as a clock number, 0–99.
export const clock = (at: number) => Math.min(99, Math.floor(at * 100))

// Where a server's j-th point sits on the ring.
export const pointSpot = (node: number, j: number) => hash32(node * 64 + j + 36013 * 977) / 2 ** 32

export interface RingPoint {
  at: number
  node: number
}

// Every point of the given servers, in clockwise order.
export function ringPoints(nodes: number[], points: number): RingPoint[] {
  return nodes.flatMap((node) => Array.from({ length: points }, (_, j) => ({ at: pointSpot(node, j), node }))).sort((a, b) => a.at - b.at)
}

// The clock numbers a server owns when it has one point: everything after
// the server before it, up to itself. E.g. "18–30", or "90–99 and 0–12".
export function ownedRange(ring: RingPoint[], node: number): string | null {
  const i = ring.findIndex((p) => p.node === node)
  if (i < 0) return null
  const from = clock(ring[(i - 1 + ring.length) % ring.length].at) + 1
  const to = clock(ring[i].at)
  if (ring.length === 1) return '0–99'
  return from <= to ? `${from}–${to}` : `${from}–99 and 0–${to}`
}

// The first point clockwise from an item: where it belongs on the ring.
export function nextPoint(ring: RingPoint[], key: number): RingPoint {
  const at = keySpot(key)
  return ring.find((p) => p.at >= at) ?? ring[0]
}

// The server that holds each item (by item number), given the servers alive.
export function assign(nodes: number[], mode: Mode, points: number): number[] {
  if (nodes.length === 0) return Array(KEY_COUNT).fill(-1)
  if (mode === 'mod') return Array.from({ length: KEY_COUNT }, (_, k) => nodes[hash32(k) % nodes.length])
  const ring = ringPoints(nodes, points)
  return Array.from({ length: KEY_COUNT }, (_, k) => nextPoint(ring, k).node)
}

// Items per server, for the servers given.
export const shares = (owner: number[], nodes: number[]) => nodes.map((n) => owner.filter((o) => o === n).length / KEY_COUNT)

// Tracks who holds what, and which items are cold after a change.
export class Assigner {
  owner: number[] = Array(KEY_COUNT).fill(-1)
  warm: boolean[] = Array(KEY_COUNT).fill(true)
  moved = 0 // share of items the last change moved, 0–1
  private nodes: number[] = []
  private mode: Mode | null = null
  private points = 0

  get ready() {
    return this.mode !== null
  }

  // Apply a new set of servers. The first call starts everything warm; later
  // calls turn the items that changed server cold.
  update(nodes: number[], mode: Mode, points: number) {
    const same = this.mode === mode && this.points === points && this.nodes.length === nodes.length && this.nodes.every((n, i) => n === nodes[i])
    if (same) return false
    const next = assign(nodes, mode, points)
    if (this.mode === null) {
      this.moved = 0
    } else {
      let moved = 0
      for (let k = 0; k < KEY_COUNT; k++) {
        if (next[k] !== this.owner[k]) {
          this.warm[k] = false
          moved++
        }
      }
      this.moved = moved / KEY_COUNT
    }
    this.owner = next
    this.nodes = nodes
    this.mode = mode
    this.points = points
    return true
  }
}
