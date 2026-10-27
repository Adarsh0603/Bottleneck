import type { Shot, V3 } from '../../core/types'
import { CELEBRITY_LAUNCH } from './build'
import type { ShardingChapter, ShardingState } from './types'
import { aboveShard, DB_X } from './world'

const BASE: ShardingState = { rps: 4, shards: 1, key: 'name', celebrity: false, cached: false, down: null }

const WIDE: Shot = { target: [-1.6, 0.6, 0], zoom: 0.85 }
const SHARDS: Shot = { target: [DB_X - 0.8, 0.8, 0], zoom: 0.95 }
const ALL_SHARDS: Shot = { target: [DB_X - 1, 0.8, 0], zoom: 0.8 }

const shard = (i: number, n: number) => ({ label: `Shard ${i + 1}`, at: aboveShard(i, n, 0.5) as V3 })

export const CHAPTERS: ShardingChapter[] = [
  {
    title: 'One database',
    level: 'Beginner',
    initial: BASE,
    beats: [
      {
        caption: 'Your app keeps every user’s posts in one database.',
        sub: 'People write posts and read profiles. Solid packets are reads; outlined ones are writes.',
        shot: WIDE,
        tags: ['users', 'app', 'dbs'],
        hud: ['traffic', 'load'],
      },
      {
        caption: 'Replicas won’t save you this time.',
        sub: 'This app writes a lot, and every write must land on one primary. Then the traffic grows.',
        ramp: { everyMs: 600, next: (st) => (st.rps < 10 ? { ...st, rps: st.rps + 1 } : null) },
        shot: SHARDS,
        tags: ['dbs', 'load'],
        hud: ['traffic', 'load', 'errors'],
      },
    ],
  },
  {
    title: 'Split by user',
    level: 'Beginner',
    initial: { ...BASE, rps: 8 },
    beats: [
      {
        caption: 'Split the users across databases: shards.',
        sub: 'Users A–M on one, N–Z on the other. Each shard takes only its own users’ requests.',
        set: { shards: 2 },
        shot: SHARDS,
        tags: ['keys'],
        hud: ['load', 'errors'],
      },
      {
        caption: 'Each user lives on exactly one shard.',
        sub: 'The app reads the name and sends the request there. That rule is the shard key.',
        predict: {
          clue: 'Shard 1 holds users A–M. Shard 2 holds N–Z.',
          question: 'Zoe opens her profile. Which shard answers?',
          options: [shard(0, 2), shard(1, 2)],
          answer: 1,
        },
        shot: SHARDS,
        tags: ['keys'],
        hud: ['load', 'errors'],
      },
      {
        sub: 'Traffic is up again. Add shards until no one is turned away.',
        set: { rps: 14, shards: 1 },
        shot: ALL_SHARDS,
        tags: ['dbs', 'load'],
        controls: ['shards'],
        hud: ['shards', 'load', 'errors'],
        challenge: {
          goal: 'Serve 14 req/s with under 1% errors.',
          win: 'Each shard takes its own users’ reads and writes. Unlike replicas, shards share the writes too.',
          holdSeconds: 5,
          check: ({ m, sim }) => sim.settled && m.errorRate < 1,
        },
      },
    ],
  },
  {
    title: 'Hot spots',
    level: 'Intermediate',
    initial: { ...BASE, rps: 20, shards: 4, key: 'signup' },
    beats: [
      {
        caption: 'Another shard key: signup order.',
        sub: 'The first users to join go on shard 1, the newest on shard 4. And new users are the most active.',
        shot: ALL_SHARDS,
        tags: ['keys'],
        hud: ['spread'],
      },
      {
        caption: 'A hot spot.',
        sub: 'The newest users all land on one shard. It drowns while the others sit idle.',
        predict: {
          clue: 'Shard 4 holds the newest users, and new users are the busiest.',
          question: 'Which shard runs hot?',
          options: [0, 1, 2, 3].map((i) => shard(i, 4)),
          answer: 3,
        },
        shot: ALL_SHARDS,
        tags: ['dbs', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        caption: 'Names aren’t even either.',
        sub: 'Lots of names start with A, J, M or S. Hardly any with U, X or Z. Equal letter ranges hold very unequal crowds.',
        set: { key: 'name' },
        predict: {
          clue: 'Shard 4 holds names starting U to Z.',
          question: 'Split by name. Which shard sits nearly idle?',
          options: [0, 1, 2, 3].map((i) => shard(i, 4)),
          answer: 3,
        },
        shot: ALL_SHARDS,
        tags: ['keys'],
        hud: ['spread', 'errors'],
      },
      {
        sub: 'One more option: a hashed id. The app scrambles each user’s id into a random-looking number and splits on that.',
        shot: ALL_SHARDS,
        tags: ['keys'],
        controls: ['key'],
        hud: ['spread', 'errors'],
        challenge: {
          goal: 'No shard over 90% busy, and under 1% errors.',
          win: 'A hash spreads users evenly, whoever they are. That’s why real systems shard on a hashed key.',
          holdSeconds: 5,
          check: ({ m, sim }) => sim.settled && m.maxLoad < 0.9 && m.errorRate < 1,
        },
      },
    ],
  },
  {
    title: 'When one shard struggles',
    level: 'Advanced',
    initial: { ...BASE, rps: 14, shards: 4, key: 'hash' },
    beats: [
      {
        caption: 'Four shards, a hashed key, an even spread.',
        sub: 'Every shard does its share. Now for the cases a good key can’t fix.',
        shot: ALL_SHARDS,
        tags: ['dbs', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        caption: 'A celebrity joins.',
        sub: 'A third of all requests are now about one user, and one user lives on one shard. No shard key can split them.',
        set: { celebrity: true },
        shot: ALL_SHARDS,
        tags: ['celebrity', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        caption: 'Cache the hot user.',
        sub: 'The app servers keep the celebrity’s posts in memory. Their shard only sees the rare write.',
        set: { cached: true },
        shot: ALL_SHARDS,
        tags: ['app', 'celebrity', 'load'],
        hud: ['spread', 'errors'],
      },
      {
        caption: 'A shard dies.',
        sub: 'Its users get errors. Everyone else carries on. With shards, an outage hits some users, not all of them.',
        set: { celebrity: false, cached: false, down: 1 },
        shot: ALL_SHARDS,
        tags: ['dbs'],
        hud: ['errors'],
      },
    ],
  },
  {
    title: 'Build it',
    level: 'Advanced',
    initial: BASE,
    beats: [{ caption: CELEBRITY_LAUNCH.title }],
    build: CELEBRITY_LAUNCH,
  },
]
