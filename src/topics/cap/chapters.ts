import type { Shot } from '../../core/types'
import { PARTITION_CALL } from './build'
import type { CapChapter, CapState } from './types'
import { above } from './world'

const BASE: CapState = { rps: 6, partitioned: false, mode: 'available' }

const WIDE: Shot = { target: [-3, 0.8, 0], zoom: 0.62 }
const CLOSE: Shot = { target: [-2.5, 0.8, 0], zoom: 0.75 }

const TARGETS = {
  west: { label: 'West database', at: above('west', 0.5) },
  east: { label: 'East database', at: above('east', 0.5) },
}

export const CHAPTERS: CapChapter[] = [
  {
    title: 'Two regions',
    level: 'Beginner',
    initial: BASE,
    beats: [
      {
        caption: 'Your app runs in two regions.',
        sub: 'Each has its own users and its own copy of the data, so everyone gets a fast answer from nearby.',
        shot: WIDE,
        tags: ['users', 'dbs'],
        hud: ['mix'],
      },
      {
        caption: 'Every write is copied across.',
        sub: 'Outlined cubes are writes. The small cubes arcing over are the copies, sent to the other region.',
        shot: WIDE,
        tags: ['dbs', 'link'],
        hud: ['mix', 'link'],
      },
      {
        caption: 'So both copies agree.',
        sub: 'Reads are fast and fresh. Nobody is turned away.',
        predict: {
          clue: 'Each region answers its own users from its own copy.',
          question: 'A user in the East reads their feed. Which database answers?',
          options: [TARGETS.west, TARGETS.east],
          answer: 1,
        },
        shot: WIDE,
        tags: ['dbs'],
        hud: ['errors', 'stale'],
      },
    ],
  },
  {
    title: 'The link breaks',
    level: 'Beginner',
    initial: BASE,
    beats: [
      {
        caption: 'Then the link between them is cut.',
        sub: 'A cable, a bad deploy, a data-centre outage. Each region is fine. They just can’t reach each other. That’s a partition.',
        set: { partitioned: true },
        shot: WIDE,
        tags: ['dbs', 'link'],
        hud: ['link', 'errors'],
      },
      {
        caption: 'Writes stop crossing.',
        sub: 'The copies no longer arrive. A post made in the West is missing in the East.',
        predict: {
          clue: 'Writes are copied across the link. The link is cut.',
          question: 'A West user posts. Which database has the post now?',
          options: [TARGETS.west, TARGETS.east],
          answer: 0,
        },
        shot: WIDE,
        tags: ['dbs', 'link'],
        hud: ['link', 'stale'],
      },
      {
        caption: 'East has a choice to make.',
        sub: 'Answer from its old copy, or refuse until the link is back. It can’t do both. That’s the CAP trade-off.',
        shot: WIDE,
        tags: ['dbs', 'stale'],
        hud: ['link', 'stale', 'errors'],
        controls: ['partition'],
      },
    ],
  },
  {
    title: 'Choose consistency',
    level: 'Intermediate',
    initial: { ...BASE, partitioned: true, mode: 'available' },
    beats: [
      {
        caption: 'Consistent means never wrong.',
        sub: 'East refuses requests it can’t confirm, so no one ever sees old data. The cost: its users get errors.',
        set: { mode: 'consistent' },
        predict: {
          clue: 'The primary is in the West. East can’t reach it, so it can’t confirm what is current.',
          question: 'The link is cut and the system chooses consistency. Which side turns users away?',
          options: [TARGETS.west, TARGETS.east],
          answer: 1,
        },
        shot: CLOSE,
        tags: ['dbs', 'stale'],
        hud: ['stale', 'errors'],
      },
      {
        sub: 'The link is cut. Choose how East behaves, so that no one is shown old data.',
        set: { mode: 'available' },
        shot: CLOSE,
        tags: ['dbs', 'stale'],
        controls: ['mode'],
        hud: ['stale', 'errors'],
        challenge: {
          goal: 'Cut link, and East shows no one old data.',
          win: 'Consistent: East refused what it couldn’t confirm. Nothing was wrong, but its users saw errors. Use this for money, stock and anything where wrong is worse than down.',
          holdSeconds: 5,
          check: ({ m, st }) => st.partitioned && !(m.eastStaleRate > 0),
        },
      },
    ],
  },
  {
    title: 'Choose availability',
    level: 'Intermediate',
    initial: { ...BASE, partitioned: true, mode: 'consistent' },
    beats: [
      {
        caption: 'Available means always answering.',
        sub: 'East keeps serving from its own copy. Nobody is turned away. The cost: some of what it shows is old.',
        set: { mode: 'available' },
        shot: CLOSE,
        tags: ['dbs', 'stale'],
        hud: ['stale', 'errors'],
      },
      {
        sub: 'The link is cut. Choose how East behaves, so that no one is turned away.',
        set: { mode: 'consistent' },
        shot: CLOSE,
        tags: ['dbs', 'stale'],
        controls: ['mode'],
        hud: ['stale', 'errors'],
        challenge: {
          goal: 'Cut link, and East turns away under 1% of requests.',
          win: 'Available: East kept answering, a little behind. Use this for feeds, likes and anything where an old answer beats no answer.',
          holdSeconds: 5,
          check: ({ m, st }) => st.partitioned && m.eastErrorRate < 1,
        },
      },
    ],
  },
  {
    title: 'Healing',
    level: 'Advanced',
    initial: { ...BASE, partitioned: true, mode: 'available', rps: 8 },
    beats: [
      {
        caption: 'Both sides keep taking writes.',
        sub: 'Two copies drift apart. If both change the same item, there are now two versions of it.',
        shot: WIDE,
        tags: ['dbs', 'conflict'],
        hud: ['conflicts', 'stale'],
      },
      {
        caption: 'The link comes back.',
        sub: 'The regions compare notes. For each conflict they must pick a winner: often the latest write, or a merge. One of the two changes may be lost.',
        set: { partitioned: false },
        shot: WIDE,
        tags: ['dbs', 'link', 'conflict'],
        hud: ['conflicts', 'link'],
      },
      {
        caption: 'A consistent system skips all this.',
        sub: 'Since East refused writes, there is nothing to reconcile. It just carries on. That’s what the refusals bought.',
        set: { mode: 'consistent', partitioned: true },
        shot: WIDE,
        tags: ['dbs', 'conflict'],
        hud: ['conflicts', 'errors'],
      },
    ],
  },
  {
    title: 'Build it',
    level: 'Advanced',
    initial: BASE,
    beats: [{ caption: PARTITION_CALL.title }],
    build: PARTITION_CALL,
  },
]
