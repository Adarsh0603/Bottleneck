import type { Shot, V3 } from '../../core/types'
import { FLASH_SALE } from './build'
import type { QueueChapter, QueueState } from './types'
import { aboveWorker, APP, DEAD, QUEUE } from './world'

const BASE: QueueState = { rps: 3, queued: false, workers: 3, flaky: false, retries: 0, deadLetter: false }

const WIDE: Shot = { target: [-2.5, 0.8, 0], zoom: 0.58 }
const MIDDLE: Shot = { target: [-1.5, 0.8, 0], zoom: 0.68 }
const ALL: Shot = { target: [-2.5, 0.8, 1], zoom: 0.55 }

const TARGETS = {
  app: { label: 'App server', at: [APP.x, APP.h + 0.5, APP.z] as V3 },
  workers: { label: 'Workers', at: aboveWorker(2, 0.5) },
  queue: { label: 'Queue', at: [QUEUE.x, QUEUE.h + 0.5, QUEUE.z] as V3 },
  dead: { label: 'Dead-letter box', at: [DEAD.x, DEAD.h + 0.5, DEAD.z] as V3 },
}

export const CHAPTERS: QueueChapter[] = [
  {
    title: 'Slow work',
    level: 'Beginner',
    initial: BASE,
    beats: [
      {
        caption: 'Your app does slow work for each request.',
        sub: 'Charging a card, sending an email, resizing a photo. Each job takes about a second.',
        shot: WIDE,
        tags: ['users', 'app', 'workers'],
        hud: ['response'],
      },
      {
        caption: 'The user waits for it.',
        sub: 'The app hands the job to a worker and can only answer once it is done.',
        shot: WIDE,
        tags: ['workers', 'load'],
        hud: ['response', 'load'],
      },
      {
        caption: 'Then a spike hits.',
        sub: 'Every worker is busy, and new jobs are turned away.',
        predict: {
          clue: 'A worker finishes about 2 jobs a second. The spike is 12 a second.',
          question: 'Traffic quadruples. What gives out first?',
          options: [TARGETS.app, TARGETS.workers],
          answer: 1,
        },
        ramp: { everyMs: 500, next: (st) => (st.rps < 12 ? { ...st, rps: st.rps + 1 } : null) },
        shot: WIDE,
        tags: ['workers', 'load'],
        hud: ['errors', 'response', 'load'],
      },
    ],
  },
  {
    title: 'Add a queue',
    level: 'Beginner',
    initial: { ...BASE, rps: 12, workers: 4 },
    beats: [
      {
        caption: 'Put a queue in the middle.',
        sub: 'The app drops the job in the queue and tells the user “got it” at once. Workers take jobs when they are free.',
        set: { queued: true },
        shot: MIDDLE,
        tags: ['queue', 'workers'],
        hud: ['response', 'backlog'],
      },
      {
        caption: 'The spike has somewhere to go.',
        sub: 'Jobs wait in the queue instead of being turned away.',
        shot: MIDDLE,
        tags: ['queue'],
        hud: ['errors', 'backlog'],
      },
      {
        sub: 'Traffic is at 12 jobs a second. Switch between no queue and a queue.',
        set: { queued: false },
        shot: MIDDLE,
        tags: ['queue', 'workers'],
        controls: ['queue'],
        hud: ['errors', 'response', 'backlog'],
        challenge: {
          goal: 'Take 12 jobs a second with under 1% turned away.',
          win: 'The queue held the spike. Users got an instant answer, and nothing was turned away.',
          holdSeconds: 6,
          check: ({ m, st }) => st.queued && m.errorRate < 1,
        },
      },
    ],
  },
  {
    title: 'The backlog',
    level: 'Intermediate',
    initial: { ...BASE, rps: 10, queued: true, workers: 2 },
    beats: [
      {
        caption: 'The queue hides a problem.',
        sub: 'Nobody is turned away, yet the jobs keep piling up, and each one waits longer.',
        shot: MIDDLE,
        tags: ['queue'],
        hud: ['backlog', 'wait', 'done'],
      },
      {
        caption: 'A queue only delays the problem.',
        sub: 'If jobs arrive faster than the workers finish them, the queue keeps growing, until it is full.',
        predict: {
          clue: 'Two workers finish about 4 jobs a second. Jobs arrive at 10 a second.',
          question: 'Jobs arrive faster than they finish. Where do they pile up?',
          options: [TARGETS.app, TARGETS.queue, TARGETS.workers],
          answer: 1,
        },
        shot: MIDDLE,
        tags: ['queue', 'workers'],
        hud: ['backlog', 'wait', 'errors'],
      },
      {
        sub: 'Add workers until they finish jobs as fast as they arrive.',
        shot: ALL,
        tags: ['queue', 'workers'],
        controls: ['workers'],
        hud: ['done', 'backlog', 'wait'],
        challenge: {
          goal: 'Finish 10 jobs a second.',
          win: 'Workers now keep up with arrivals, so the queue drains. Add consumers when the backlog grows.',
          holdSeconds: 5,
          check: ({ m }) => m.doneRate >= 9,
        },
      },
    ],
  },
  {
    title: 'When jobs fail',
    level: 'Intermediate',
    initial: { ...BASE, rps: 6, queued: true, workers: 4, flaky: true },
    beats: [
      {
        caption: 'Some jobs fail.',
        sub: 'The email service hiccups. A few jobs fail once or twice, then work. Some never will.',
        shot: ALL,
        tags: ['queue', 'workers'],
        hud: ['lost', 'done'],
      },
      {
        caption: 'Try again.',
        sub: 'A failed job goes back on the queue after a short wait. Most work the second or third time.',
        set: { retries: 3 },
        predict: {
          clue: 'Some jobs are bad, and fail every time.',
          question: 'A job keeps failing. Where should it end up?',
          options: [TARGETS.workers, TARGETS.queue, TARGETS.dead],
          answer: 2,
        },
        shot: ALL,
        tags: ['queue', 'workers'],
        hud: ['lost', 'done'],
      },
      {
        caption: 'But some jobs never work.',
        sub: 'After the last try they are thrown away, and nobody knows. A dead-letter box keeps them, so you can look.',
        set: { deadLetter: true },
        shot: ALL,
        tags: ['dead', 'queue'],
        hud: ['lost', 'stuck'],
      },
      {
        sub: 'Choose how many retries, and whether to keep a dead-letter box.',
        set: { retries: 0, deadLetter: false },
        shot: ALL,
        tags: ['dead', 'queue'],
        controls: ['retries', 'deadLetter'],
        hud: ['lost', 'stuck'],
        challenge: {
          goal: 'Lose no job, and park only jobs that can never work.',
          win: 'Retries rescue the jobs that hiccup. The dead-letter box catches the bad ones, so nothing disappears silently.',
          holdSeconds: 8,
          check: ({ m, st }) => st.deadLetter && m.lost === 0 && m.stuck === 0,
        },
      },
    ],
  },
  {
    title: 'Build it',
    level: 'Advanced',
    initial: BASE,
    beats: [{ caption: FLASH_SALE.title }],
    build: FLASH_SALE,
  },
]
