import type { Shot, V3 } from '../../core/types'
import { PAYDAY_CRASH } from './build'
import type { ReplicationChapter, ReplicationState } from './types'
import { above, APP, DB_X, HOT, PRIMARY_KEY, replicaKey } from './world'

const BASE: ReplicationState = { rps: 4, replicas: 0, lag: 0.3, readFrom: 'replicas', failed: false, promoted: false }

const WIDE: Shot = { target: [-1.6, 0.6, 0], zoom: 0.85 }
const DBS: Shot = { target: [DB_X - 0.8, 0.8, 0], zoom: 1 }
const ALL_DBS: Shot = { target: [DB_X - 1, 0.8, 0], zoom: 0.8 }

const TARGETS = {
  app: { label: 'App servers', at: [APP.x, APP.h + 0.5, APP.z] as V3 },
  primary: { label: 'Primary', at: above(PRIMARY_KEY, 0.5) },
  replica1: { label: 'Replica 1', at: above(replicaKey(0), 0.5) },
  replica2: { label: 'Replica 2', at: above(replicaKey(1), 0.5) },
  writes: { label: 'Writes', at: above(PRIMARY_KEY, 0.5) },
  reads: { label: 'Reads', at: above(replicaKey(0), 0.5) },
}

export const CHAPTERS: ReplicationChapter[] = [
  {
    title: 'One database',
    level: 'Beginner',
    initial: BASE,
    beats: [
      {
        caption: 'Your app keeps its data in one database.',
        sub: 'Every request ends up here.',
        shot: WIDE,
        tags: ['users', 'app', 'dbs'],
        hud: ['mix'],
      },
      {
        caption: 'Most requests are reads.',
        sub: 'Feeds, profiles, search. Solid cubes are reads; outlined ones are writes, about 1 in 10.',
        shot: DBS,
        tags: ['dbs', 'load'],
        hud: ['mix', 'load'],
      },
      {
        caption: 'Then the app gets popular.',
        sub: 'Reads pile up, and the database starts turning people away.',
        predict: { clue: 'Most requests are reads, and every one goes to the one database.', question: 'Traffic more than doubles. What gives out first?', options: [TARGETS.app, TARGETS.primary], answer: 1 },
        ramp: { everyMs: 600, next: (st) => (st.rps < 10 ? { ...st, rps: st.rps + 1 } : null) },
        shot: DBS,
        tags: ['dbs', 'load'],
        hud: ['load', 'errors'],
      },
    ],
  },
  {
    title: 'Read replicas',
    level: 'Beginner',
    initial: { ...BASE, rps: 10 },
    beats: [
      {
        caption: 'Add copies: read replicas.',
        sub: 'Reads now go to the copies. The primary is left with the writes.',
        set: { replicas: 2 },
        shot: DBS,
        tags: ['dbs', 'load'],
        hud: ['load', 'errors'],
      },
      {
        caption: 'The primary keeps them up to date.',
        sub: 'Every write lands on the primary first. Then it ships the change to each replica.',
        shot: DBS,
        tags: ['dbs', 'lag'],
        hud: ['mix', 'load'],
      },
      {
        caption: 'Your turn.',
        sub: 'Traffic is up again. Add replicas until no one is turned away.',
        set: { rps: 14, replicas: 0 },
        shot: ALL_DBS,
        tags: ['dbs', 'load'],
        controls: ['replicas'],
        hud: ['replicas', 'load', 'errors'],
        challenge: {
          goal: 'Serve 14 req/s with under 1% errors.',
          win: 'Each replica adds read capacity. Writes still all go to one primary.',
          holdSeconds: 5,
          check: ({ m }) => m.readsPerSec > 0 && m.errorRate < 1,
        },
      },
    ],
  },
  {
    title: 'Replication lag',
    level: 'Intermediate',
    initial: { ...BASE, rps: 8, replicas: 2 },
    beats: [
      {
        caption: 'Copies take a moment.',
        sub: 'A change reaches the replicas a little after the primary. That gap is replication lag.',
        shot: DBS,
        tags: ['dbs', 'lag'],
        hud: ['lag', 'stale'],
      },
      {
        caption: 'Now the replicas fall 3 seconds behind.',
        sub: 'A busy replica or a slow network. You post, then refresh at once.',
        set: { lag: 3 },
        predict: { clue: 'Every change lands on the primary first, and reaches the replicas 3 seconds later.', question: 'You just posted. Which database has your post right now?', options: [TARGETS.replica1, TARGETS.primary, TARGETS.replica2], answer: 1 },
        shot: DBS,
        tags: ['dbs', 'lag'],
        hud: ['lag', 'stale'],
      },
      {
        caption: 'Stale reads.',
        sub: 'Your refresh is a read, so a replica answers it, with the old page. The post shows up seconds later.',
        shot: DBS,
        tags: ['dbs', 'stale'],
        hud: ['lag', 'stale', 'own'],
      },
    ],
  },
  {
    title: 'Read your own writes',
    level: 'Intermediate',
    initial: { ...BASE, rps: 10, replicas: 2, lag: 3 },
    beats: [
      {
        caption: 'Old data hurts most right after you write.',
        sub: 'Nobody notices someone else’s post arriving 3 seconds late. You notice yours missing.',
        shot: DBS,
        tags: ['dbs', 'stale'],
        hud: ['stale', 'own'],
      },
      {
        caption: 'Your turn.',
        sub: 'Choose where reads go. Keep everyone’s own posts visible, without turning anyone away.',
        shot: DBS,
        tags: ['dbs', 'load', 'stale'],
        controls: ['readFrom'],
        hud: ['own', 'load', 'errors'],
        challenge: {
          goal: 'No one misses their own post, and under 1% errors.',
          win: 'Read your own writes: only the reads that need fresh data pay for the primary.',
          holdSeconds: 5,
          check: ({ m, st, sim }) => st.readFrom !== 'replicas' && !(m.ownStaleRate > 0) && m.errorRate < 1 && m.load[sim.leaderKey] < HOT,
        },
      },
    ],
  },
  {
    title: 'Failover',
    level: 'Intermediate',
    initial: { ...BASE, rps: 8, replicas: 3, lag: 2 },
    beats: [
      {
        caption: 'Three replicas, all following the primary.',
        sub: 'Each is a moment behind it.',
        shot: ALL_DBS,
        tags: ['dbs', 'lag'],
        hud: ['errors'],
      },
      {
        caption: 'The primary dies.',
        sub: 'The replicas keep answering reads. Writes have nowhere to go.',
        set: { failed: true },
        predict: { clue: 'Only the primary takes writes. Replicas answer reads.', question: 'The primary is gone. Which requests fail?', options: [TARGETS.reads, TARGETS.writes], answer: 1 },
        shot: ALL_DBS,
        tags: ['dbs'],
        hud: ['errors'],
      },
      {
        caption: 'Promote a replica.',
        sub: 'It becomes the new primary, and the others copy from it. Changes the old primary hadn’t shipped are gone.',
        set: { promoted: true },
        shot: ALL_DBS,
        tags: ['dbs', 'lag'],
        hud: ['errors', 'lost'],
      },
      { caption: 'Ready for the interview.', sub: 'The replication details that come up most.', sheet: true, shot: ALL_DBS },
    ],
  },
  {
    title: 'Build it',
    level: 'Advanced',
    initial: BASE,
    beats: [{ caption: PAYDAY_CRASH.title }],
    build: PAYDAY_CRASH,
  },
]
