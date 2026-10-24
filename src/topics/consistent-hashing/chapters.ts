import type { Shot, V3 } from '../../core/types'
import { CRASH_DRILL } from './build'
import { assign, clock, KEY_COUNT, keySpot, nextPoint, pointSpot, ringPoints } from './ring'
import type { ConsistentChapter, ConsistentState } from './types'
import { aboveNode, onRing, RING } from './world'

const BASE: ConsistentState = { rps: 16, nodes: 4, mode: 'mod', points: 1, down: null }

const WIDE: Shot = { target: [-1.6, 0.6, 0], zoom: 0.55 }
const RING_SHOT: Shot = { target: [RING.x - 0.4, 0.6, 0], zoom: 0.72 }

const KEYS = Array.from({ length: KEY_COUNT }, (_, k) => k)
const nodesOf = (n: number) => Array.from({ length: n }, (_, i) => i)

// The item the first chapter follows: one that lands on a different server
// once a fifth is added.
const MOD4 = assign(nodesOf(4), 'mod', 1)
const MOD5 = assign(nodesOf(5), 'mod', 1)
const MOD_PICK = MOD4.findIndex((o, k) => o !== MOD5[k])

// The item the ring chapter points out: one with a clear gap to the next
// server clockwise, so the line it follows is easy to see.
const FOUR = ringPoints([0, 1, 2, 3], 1)
const FIVE = ringPoints([0, 1, 2, 3, 4], 1)
const PICK = KEYS.map((k) => ({ k, gap: (nextPoint(FOUR, k).at - keySpot(k) + 1) % 1 }))
  .filter((c) => c.gap > 0.12 && c.gap < 0.3)
  .sort((a, b) => b.gap - a.gap)[0].k

const PICK_AT = clock(keySpot(PICK))

// The fifth server's number on the ring.
const NEW_AT = clock(pointSpot(4, 0))

// The question when the fifth server joins: of three items, which one
// moves to it. The other two are on other servers, well apart.
const apart = (a: number, b: number) => Math.abs(clock(keySpot(a)) - clock(keySpot(b))) > 8
const MOVER = KEYS.find((k) => nextPoint(FIVE, k).node === 4)!
const STAYS = KEYS.filter((k) => nextPoint(FIVE, k).node !== 4 && apart(k, MOVER)).reduce<number[]>((got, k) => {
  const fresh = got.every((g) => apart(g, k) && nextPoint(FIVE, g).node !== nextPoint(FIVE, k).node)
  return got.length < 2 && fresh ? [...got, k] : got
}, [])
const CHOICES = [MOVER, ...STAYS].sort((a, b) => keySpot(a) - keySpot(b))

const server = (i: number, n: number) => ({ label: `Server ${i + 1}`, at: aboveNode(i, n, true) as V3 })

// When server 3 of 5 dies, which server inherits its items.
const SURVIVORS = [0, 1, 3, 4]
const HEIR = FIVE[(FIVE.findIndex((p) => p.node === 2) + 1) % FIVE.length].node

export const CHAPTERS: ConsistentChapter[] = [
  {
    title: 'Spread by hash',
    level: 'Beginner',
    initial: BASE,
    beats: [
      {
        caption: 'Your app keeps popular data in cache servers.',
        sub: 'A cache server answers fast. The database is slow, so it should be asked rarely. Here the 60 popular items are spread over 4 cache servers.',
        shot: WIDE,
        tags: ['users', 'app', 'servers', 'items'],
        hud: ['traffic', 'servers'],
      },
      {
        caption: 'Each request must reach the server that holds its item.',
        sub: 'The app has no list of who holds what. When a request arrives, it must work out the server itself, and get the same answer every time.',
        pick: MOD_PICK,
        shot: WIDE,
        tags: ['servers', 'items'],
        hud: ['traffic', 'servers'],
      },
      {
        caption: 'The simple rule: calculate the server from the request.',
        sub: 'The app hashes the item’s name into a number, say 17, and divides by 4 servers. The remainder is 1, so the request goes to Server 2, where the item is cached.',
        pick: MOD_PICK,
        shot: WIDE,
        tags: ['servers', 'items'],
        hud: ['traffic', 'servers'],
      },
      {
        caption: 'Add a fifth server, and the same request is calculated again.',
        sub: 'The app now divides 17 by 5 servers. The remainder is 2, so the request goes to Server 3, which never had the item. Most items change server like this.',
        set: { nodes: 5 },
        pick: MOD_PICK,
        shot: WIDE,
        tags: ['servers', 'db', 'load'],
        hud: ['moved', 'db', 'errors'],
      },
      {
        caption: 'Problem: requests now reach servers that lack the item.',
        sub: 'Each one is a cache miss and goes to the database. Too many at once overloads it, and requests fail.',
        shot: WIDE,
        tags: ['servers', 'db', 'load'],
        hud: ['moved', 'db', 'errors'],
      },
    ],
  },
  {
    title: 'The ring',
    level: 'Beginner',
    initial: { ...BASE, rps: 10, mode: 'ring' },
    beats: [
      {
        caption: 'Goal: adding a server should move only a few items.',
        sub: 'The ring rule does this. Servers and items get a position from 0 to 99, and after 99 it wraps back to 0.',
        shot: RING_SHOT,
        ring: true,
        items: true,
        tags: ['servers'],
        hud: ['servers'],
      },
      {
        caption: 'An item goes to the next server clockwise.',
        sub: 'From the item’s position, move up. The first server you reach holds the item.',
        pick: PICK,
        ring: true,
        items: true,
        predict: {
          clue: 'Move up from the item. The first server reached holds it.',
          question: `Which server holds the item at ${PICK_AT}?`,
          options: [0, 1, 2, 3].map((i) => server(i, 4)),
          answer: nextPoint(FOUR, PICK).node,
        },
        shot: RING_SHOT,
        tags: ['servers'],
        hud: ['servers'],
      },
      {
        caption: 'Add a fifth server.',
        sub: 'It takes only the items just before it. Every other item keeps its server, so the database stays calm.',
        set: { nodes: 5 },
        ring: true,
        items: true,
        predict: {
          clue: `The new server is at ${NEW_AT}. It takes the items just before it.`,
          question: 'Which item moves to the new server?',
          options: CHOICES.map((k) => {
            const p = onRing(keySpot(k), RING.r - 0.5)
            return { label: `Item at ${clock(keySpot(k))}`, at: [p.x, 0.9, p.z] as V3 }
          }),
          answer: CHOICES.indexOf(MOVER),
        },
        shot: RING_SHOT,
        tags: ['servers', 'db'],
        hud: ['moved', 'db', 'errors'],
      },
    ],
  },
  {
    title: 'Even it out',
    level: 'Intermediate',
    initial: { ...BASE, rps: 22, nodes: 5, mode: 'ring' },
    beats: [
      {
        caption: 'Problem: with one position each, servers get uneven shares.',
        sub: 'A server serves every position between the server before it and itself. Server 1 is far from the one before it, so it gets almost half of all requests while the others sit idle.',
        shot: RING_SHOT,
        ring: true,
        tags: ['servers', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        caption: 'Solution: add virtual nodes to each server.',
        sub: 'A virtual node is an extra ring position for the same real server, shown in its colour. A request goes to the next position clockwise, and that position’s server handles it.',
        set: { points: 8 },
        virtual: true,
        shot: RING_SHOT,
        ring: true,
        tags: ['servers', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        caption: 'Why it helps: one unlucky position no longer decides the share.',
        sub: 'Hashed positions land unevenly. One unlucky position gave a server a huge stretch. Eight positions balance out, so each server gets about a fifth.',
        virtual: true,
        shot: RING_SHOT,
        ring: true,
        tags: ['servers', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        sub: 'Each server is back to 1 virtual node. Add virtual nodes per server until no server is overloaded.',
        set: { points: 1 },
        shot: RING_SHOT,
        ring: true,
        tags: ['servers', 'load'],
        controls: ['points'],
        hud: ['spread', 'errors'],
        challenge: {
          goal: 'No server over 85% busy, and under 1% errors.',
          win: 'More virtual nodes per server make the shares more even. Real systems use hundreds per server.',
          holdSeconds: 5,
          check: ({ m, sim }) => sim.settled && m.maxLoad < 0.85 && m.errorRate < 1,
        },
      },
    ],
  },
  {
    title: 'When a server dies',
    level: 'Advanced',
    initial: { ...BASE, rps: 20, nodes: 5, mode: 'ring' },
    beats: [
      {
        caption: 'Five servers, all healthy.',
        sub: 'Traffic is comfortable. Next, Server 3 crashes.',
        shot: RING_SHOT,
        ring: true,
        tags: ['servers', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        caption: 'Server 3 crashes.',
        sub: 'Server 3 held everything between the server before it and itself. Now those numbers count up to the next server instead, which gets all of them and carries double.',
        set: { down: 2 },
        predict: {
          clue: 'Its items now count up to the next server clockwise, all of them.',
          question: 'Which server takes over Server 3’s items?',
          options: SURVIVORS.map((i) => server(i, 5)),
          answer: SURVIVORS.indexOf(HEIR),
        },
        shot: RING_SHOT,
        ring: true,
        tags: ['servers', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        caption: 'Bring it back, with 8 virtual nodes each.',
        sub: 'Same five servers, but each one now has 8 positions on the ring.',
        set: { down: null, points: 8 },
        shot: RING_SHOT,
        ring: true,
        tags: ['servers', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        caption: 'Server 3 crashes again, and the load is shared.',
        sub: 'Its 8 stretches each count up to a different neighbour, so the items scatter across all four survivors and nobody is swamped.',
        set: { down: 2 },
        shot: RING_SHOT,
        ring: true,
        tags: ['servers', 'load'],
        hud: ['spread', 'errors'],
      },
    ],
  },
  {
    title: 'Build it',
    level: 'Advanced',
    initial: BASE,
    beats: [{ caption: CRASH_DRILL.title }],
    build: CRASH_DRILL,
  },
]
