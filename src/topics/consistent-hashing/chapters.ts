import type { Shot, V3 } from '../../core/types'
import { CRASH_DRILL } from './build'
import { clock, KEY_COUNT, keySpot, nextPoint, pointSpot, ringPoints } from './ring'
import type { ConsistentChapter, ConsistentState } from './types'
import { aboveNode, RING } from './world'

const BASE: ConsistentState = { rps: 16, nodes: 4, mode: 'mod', points: 1, down: null }

const WIDE: Shot = { target: [-1.6, 0.6, 0], zoom: 0.55 }
const RING_SHOT: Shot = { target: [RING.x - 0.4, 0.6, 0], zoom: 0.72 }

// The item the ring chapter points out: one with a clear gap to the next
// server clockwise, so the line it follows is easy to see.
const FOUR = ringPoints([0, 1, 2, 3], 1)
const PICK = Array.from({ length: KEY_COUNT }, (_, k) => k)
  .map((k) => ({ k, gap: (nextPoint(FOUR, k).at - keySpot(k) + 1) % 1 }))
  .filter((c) => c.gap > 0.12 && c.gap < 0.3)
  .sort((a, b) => b.gap - a.gap)[0].k

const PICK_AT = clock(keySpot(PICK))

// The fifth server's number, the server it sits behind, and who it takes from.
const NEW_AT = clock(pointSpot(4, 0))
const BEFORE = (FOUR.filter((p) => p.at < pointSpot(4, 0)).pop() ?? FOUR[FOUR.length - 1]).at
const GIVER = (FOUR.find((p) => p.at > pointSpot(4, 0)) ?? FOUR[0]).node

const server = (i: number, n: number) => ({ label: `Server ${i + 1}`, at: aboveNode(i, n, true) as V3 })

// When server 3 of 5 dies, which server inherits its items.
const FIVE = ringPoints([0, 1, 2, 3, 4], 1)
const SURVIVORS = [0, 1, 3, 4]
const HEIR = FIVE[(FIVE.findIndex((p) => p.node === 2) + 1) % FIVE.length].node

export const CHAPTERS: ConsistentChapter[] = [
  {
    title: 'Spread by hash',
    level: 'Beginner',
    initial: BASE,
    beats: [
      {
        caption: 'Your app keeps 60 popular items in cache, spread over 4 servers.',
        sub: 'Each item gets a number from its name. Divide that number by 4 and the remainder picks the server. Example: an item numbered 17 leaves 1 when divided by 4, so it lives on Server 2.',
        shot: WIDE,
        tags: ['users', 'app', 'servers', 'items'],
        hud: ['traffic', 'servers'],
      },
      {
        caption: 'Traffic grows, so you add a fifth server.',
        sub: 'Now you divide by 5 instead of 4. That same item 17 leaves 2 when divided by 5, so it moves to Server 3. Most other items change servers too.',
        set: { nodes: 5 },
        shot: WIDE,
        tags: ['servers', 'db', 'load'],
        hud: ['moved', 'db', 'errors'],
      },
      {
        caption: 'A moved item isn’t on its new server yet.',
        sub: 'Red items are missing from the server they now belong to. Each one must be fetched from the database again. The database can’t handle that many at once, so requests fail.',
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
        caption: 'Put the servers on a clock face.',
        sub: 'Picture a clock numbered 0 to 99. Each server’s name becomes a number, and the server stands at that number. Items get numbers too (the small marks). A server’s label shows which numbers it holds.',
        shot: RING_SHOT,
        ring: true,
        tags: ['servers'],
        hud: ['servers'],
      },
      {
        caption: 'An item goes to the first server clockwise.',
        sub: 'Start at the item’s number and count upward: 17, 18, 19… The first server you reach holds the item. Past 99 you wrap around to 0.',
        pick: PICK,
        ring: true,
        predict: {
          clue: 'Count up from the item’s number. The first server you reach holds it.',
          question: `Which server holds the item at ${PICK_AT}?`,
          options: [0, 1, 2, 3].map((i) => server(i, 4)),
          answer: nextPoint(FOUR, PICK).node,
        },
        shot: RING_SHOT,
        tags: ['servers'],
        hud: ['servers'],
      },
      {
        caption: 'Add a fifth server: only a few items move.',
        sub: `The new server stands at ${NEW_AT}. It takes only the items numbered ${clock(BEFORE) + 1} to ${NEW_AT}, from Server ${GIVER + 1}. Every other item keeps its server, so the database stays calm.`,
        set: { nodes: 5 },
        ring: true,
        shot: RING_SHOT,
        tags: ['servers', 'db'],
        hud: ['moved', 'db', 'errors'],
      },
      {
        caption: 'Your turn.',
        sub: 'You start with 4 servers using hash % N. Add servers up to 6 and watch “Items moved”. Then switch to the hash ring and compare.',
        set: { rps: 16, nodes: 4, mode: 'mod', points: 8 },
        shot: RING_SHOT,
        tags: ['servers'],
        controls: ['mode', 'nodes'],
        hud: ['servers', 'moved', 'db', 'errors'],
        challenge: {
          goal: 'Grow to 6 servers, and never move more than 40% of the items in one change.',
          win: 'Hash % N moves most items on every change. The ring moves only the new server’s share.',
          holdSeconds: 5,
          check: ({ m, st, sim }) => st.nodes >= 6 && sim.settled && m.moved < 0.4 && m.errorRate < 1,
        },
      },
    ],
  },
  {
    title: 'Even it out',
    level: 'Intermediate',
    initial: { ...BASE, rps: 22, nodes: 5, mode: 'ring' },
    beats: [
      {
        caption: 'With one spot each, the slices are uneven.',
        sub: 'A server holds everything between the server before it and itself. Server 1 stands far from the one before it, so it holds almost half the clock. It gets overloaded while the others sit idle.',
        shot: RING_SHOT,
        ring: true,
        tags: ['servers', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        caption: 'Give each server several spots.',
        sub: 'Each server now stands at 8 different numbers on the clock (called virtual nodes). Many small stretches add up to a fairer share for everyone.',
        set: { points: 8 },
        shot: RING_SHOT,
        ring: true,
        tags: ['servers', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        caption: 'Your turn.',
        sub: 'Servers are back to 1 spot each. Add spots until no server is overloaded.',
        set: { points: 1 },
        shot: RING_SHOT,
        ring: true,
        tags: ['servers', 'load'],
        controls: ['points'],
        hud: ['spread', 'errors'],
        challenge: {
          goal: 'No server over 85% busy, and under 1% errors.',
          win: 'More spots per server make the slices more even. Real systems use hundreds of spots per server.',
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
        caption: 'Bring it back, with 8 spots each.',
        sub: 'Same five servers, but each one now stands at 8 numbers on the clock.',
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
      { caption: 'Ready for the interview.', sub: 'The consistent hashing points that come up most.', sheet: true, shot: RING_SHOT },
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
