import type { Shot, V3 } from '../../core/types'
import { GO_GLOBAL } from './build'
import type { CdnChapter, CdnState } from './types'
import { edgeSpot, ORIGIN, SLOW_MS } from './world'

const NO_EDGES = { us: false, eu: false, asia: false }
const BASE: CdnState = { rps: 4, edges: NO_EDGES, purge: 0 }

const WIDE: Shot = { target: [-0.9, 0.6, -0.2], zoom: 0.8 }
const ON_ORIGIN: Shot = { target: [ORIGIN.x - 0.6, 1, ORIGIN.z], zoom: 1.7 }
const ASIA: Shot = { target: [-4.6, 0.6, 0.9], zoom: 1.3 }

const asiaEdge = edgeSpot('asia')
const TARGETS = {
  asiaEdge: { label: 'Asia edge', at: [asiaEdge.x, 1.1, asiaEdge.z] as V3 },
  origin: { label: 'Origin', at: [ORIGIN.x, 2.6, ORIGIN.z] as V3 },
}

export const CHAPTERS: CdnChapter[] = [
  {
    title: 'One server, whole world',
    level: 'Beginner',
    initial: { ...BASE, rps: 0 },
    beats: [
      { caption: 'Your server lives in one place.', sub: 'Every file your app serves comes from here.', shot: ON_ORIGIN, tags: ['origin'] },
      {
        caption: 'Your users don’t.',
        sub: 'They’re spread across the world.',
        set: { rps: 4 },
        shot: WIDE,
        tags: ['origin', 'regions'],
        hud: ['latency'],
      },
      {
        caption: 'Far away means slow.',
        sub: 'Every request from Asia crosses the world before it’s answered.',
        shot: ASIA,
        tags: ['regions'],
        hud: ['latency'],
      },
    ],
  },
  {
    title: 'Edge servers',
    level: 'Beginner',
    initial: BASE,
    beats: [
      {
        caption: 'Put a copy near the users.',
        sub: 'An edge server is a cache close to them. A network of them is a CDN.',
        set: { edges: { ...NO_EDGES, asia: true } },
        predict: { clue: 'An edge server is a cache, and it starts empty.', question: 'Asia’s first request. Where does the answer come from?', options: [TARGETS.asiaEdge, TARGETS.origin], answer: 1 },
        shot: ASIA,
        tags: ['regions', 'edges'],
        hud: ['latency', 'hitrate'],
      },
      {
        caption: 'After that, answered next door.',
        sub: 'Popular files stay at the edge. Asia’s wait drops from over a second.',
        shot: ASIA,
        tags: ['regions', 'edges'],
        hud: ['latency', 'hitrate'],
      },
      {
        caption: 'Your turn.',
        sub: 'Edges cost money. Put them where they matter.',
        set: { edges: NO_EDGES },
        shot: WIDE,
        tags: ['regions', 'edges'],
        controls: ['edges'],
        hud: ['latency', 'edges'],
        challenge: {
          goal: `Get every region under ${SLOW_MS / 1000}s, using at most 2 edges.`,
          win: 'Edges where users are far. The nearby region didn’t need one.',
          holdSeconds: 5,
          check: ({ m, st }) =>
            Object.values(st.edges).filter(Boolean).length <= 2 && Object.values(m.latency).every((ms) => ms > 0 && ms < SLOW_MS),
        },
      },
    ],
  },
  {
    title: 'Updating files',
    level: 'Intermediate',
    initial: { ...BASE, edges: { us: true, eu: true, asia: true } },
    beats: [
      {
        caption: 'You change a file on your server.',
        sub: 'Every edge still has the old copy, and keeps serving it.',
        shot: WIDE,
        tags: ['edges'],
        hud: ['hitrate', 'origin'],
      },
      {
        caption: 'Purge it.',
        sub: 'Tell every edge to forget. The next requests go all the way back to the origin.',
        set: { purge: 1 },
        shot: WIDE,
        tags: ['origin', 'edges'],
        hud: ['hitrate', 'origin'],
      },
      { caption: 'Ready for the interview.', sub: 'The CDN details that come up most.', sheet: true, shot: WIDE },
    ],
  },
  {
    title: 'Build it',
    level: 'Intermediate',
    initial: BASE,
    beats: [{ caption: GO_GLOBAL.title }],
    build: GO_GLOBAL,
  },
]
