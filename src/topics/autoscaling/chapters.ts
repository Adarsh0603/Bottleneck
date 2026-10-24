import type { Shot, V3 } from '../../core/types'
import { FLASH_SALE } from './build'
import type { AutoscaleChapter, AutoscaleState } from './types'
import { SERVER, SERVER_X, slotZ } from './world'

const BASE: AutoscaleState = {
  pattern: 'day',
  rps: 0,
  servers: 3,
  auto: false,
  target: 60,
  min: 2,
  bootSeconds: 2,
}

const WIDE: Shot = { target: [-1.4, 0.6, 0], zoom: 0.85 }
const FLEET: Shot = { target: [SERVER_X - 1, 0.8, 0], zoom: 1.15 }

// Tap targets for the boot-time question: a running server, and the empty
// spot where a new one will appear.
const TARGETS = {
  running: { label: 'Running servers', at: [SERVER_X, SERVER.h + 0.4, slotZ(0)] as V3 },
  fresh: { label: 'New servers', at: [SERVER_X, 0.4, slotZ(2)] as V3 },
}

export const CHAPTERS: AutoscaleChapter[] = [
  {
    title: 'Traffic changes',
    level: 'Beginner',
    initial: BASE,
    beats: [
      {
        caption: 'Traffic isn’t flat.',
        sub: 'Busy afternoons, quiet nights. Here, one second is one hour.',
        shot: WIDE,
        tags: ['users', 'lb'],
        hud: ['clock', 'traffic'],
      },
      {
        caption: 'Too few servers, and the afternoon drowns.',
        sub: 'Two servers are plenty at night, and nowhere near enough at noon.',
        set: { servers: 2 },
        shot: FLEET,
        tags: ['servers'],
        hud: ['clock', 'traffic', 'errors'],
      },
      {
        caption: 'Too many, and you pay for idle machines.',
        sub: 'Six servers never turn anyone away, but sit mostly empty all night.',
        set: { servers: 6 },
        shot: FLEET,
        tags: ['idle'],
        hud: ['clock', 'busy', 'cost'],
      },
    ],
  },
  {
    title: 'The autoscaler',
    level: 'Beginner',
    initial: { ...BASE, auto: true },
    beats: [
      {
        caption: 'Let a rule size the fleet.',
        sub: 'Every second, an autoscaler checks: servers busier than 60%? Add some. Much less? Remove one.',
        shot: WIDE,
        tags: ['autoscaler', 'servers'],
        hud: ['clock', 'traffic', 'servers', 'busy'],
      },
      {
        caption: 'The fleet follows the traffic.',
        sub: 'More servers in the afternoon, fewer at night. You pay for what runs.',
        shot: FLEET,
        tags: ['servers'],
        hud: ['clock', 'servers', 'cost', 'errors'],
      },
      {
        caption: 'Removing is slower on purpose.',
        sub: 'One server at a time, with a pause, so a short dip doesn’t throw away servers you’ll need a minute later.',
        shot: FLEET,
        tags: ['servers', 'idle'],
        hud: ['clock', 'servers', 'busy'],
      },
    ],
  },
  {
    title: 'Boot time',
    level: 'Intermediate',
    initial: { ...BASE, pattern: 'spike', auto: true, target: 70, bootSeconds: 8 },
    beats: [
      {
        caption: 'New servers aren’t instant.',
        sub: 'Each one boots for a few seconds before it can take a request.',
        predict: {
          clue: 'New servers take 8 seconds to boot. Until then they can’t take a request.', question: 'Traffic is about to triple. Where are requests turned away?',
          options: [TARGETS.running, TARGETS.fresh],
          answer: 0,
        },
        shot: FLEET,
        tags: ['servers', 'autoscaler'],
        hud: ['traffic', 'servers', 'errors'],
      },
      {
        caption: 'A sudden spike: errors while they boot.',
        sub: 'The autoscaler reacts right away. The servers it asks for arrive too late.',
        shot: FLEET,
        tags: ['servers'],
        hud: ['traffic', 'servers', 'errors'],
      },
      {
        sub: 'A lower target keeps spare servers running. Change it, then wait for the next spike.',
        shot: WIDE,
        tags: ['servers', 'autoscaler'],
        controls: ['target'],
        hud: ['traffic', 'servers', 'cost', 'errors'],
        challenge: {
          goal: 'Get through a whole spike with no errors.',
          win: 'Spare room takes the spike while new servers boot. You pay for it all day.',
          holdSeconds: 1,
          check: ({ m }) => m.spikeClean === true,
        },
      },
      {
        caption: 'Or scale before the rush.',
        sub: 'Scheduled scaling adds servers before a rush you know is coming. A higher minimum is the always-on version.',
        set: { target: 70, min: 4 },
        shot: FLEET,
        tags: ['servers'],
        hud: ['traffic', 'servers', 'cost', 'errors'],
      },
    ],
  },
  {
    title: 'Build it',
    level: 'Intermediate',
    initial: BASE,
    beats: [{ caption: FLASH_SALE.title }],
    build: FLASH_SALE,
  },
]
