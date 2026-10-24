import type { Shot } from '../../core/types'
import { above } from './world'
import type { ConsensusChapter, ConsensusState } from './types'

const BASE: ConsensusState = {
  size: 3,
  pace: 0,
  manual: true,
  again: 0,
  rule: 'anyone',
  elections: false,
  down: [],
  split: 0,
  timeout: 3,
  spread: 3,
}

const WIDE: Shot = { target: [-2.4, 0.8, 0], zoom: 0.58 }

const TARGETS = {
  ana: { label: 'Only Ana gets it', at: [-8.2, 2, -1.6] as [number, number, number] },
  ben: { label: 'Only Ben gets it', at: [-8.2, 2, 1.6] as [number, number, number] },
  both: { label: 'Both are told yes', at: [0, 2.2, 0] as [number, number, number] },
  followers: { label: 'The other servers take over', at: above(1, 3, 0.6) },
  nobody: { label: 'Nobody. Bookings wait', at: [0, 2.2, 0] as [number, number, number] },
}

export const CHAPTERS: ConsensusChapter[] = [
  {
    title: 'The last seat',
    level: 'Beginner',
    initial: BASE,
    beats: [
      {
        caption: 'A seat booking app.',
        sub: 'Three servers share the work. Each keeps its own list of who has booked which seat, drawn as small blocks on top. Customers can reach any server.',
        shot: WIDE,
        tags: ['clients', 'nodes'],
        hud: ['confirmed'],
      },
      {
        caption: 'One seat is left.',
        sub: 'Ana and Ben both want it, and will press book at almost the same moment. Their taps will land on two different servers.',
        shot: WIDE,
        tags: ['clients', 'nodes'],
        hud: ['confirmed'],
      },
      {
        caption: 'Each server checks its own list.',
        sub: 'It sees the seat is free, so it says yes. Neither server has heard about the other booking yet.',
        predict: {
          clue: 'A server answers from its own list. Messages between servers take a moment to arrive.',
          question: 'Ana and Ben both book the last seat. What happens?',
          options: [TARGETS.ana, TARGETS.both, TARGETS.ben],
          answer: 1,
        },
        set: { again: 1 },
        shot: WIDE,
        tags: ['clients', 'nodes'],
        hud: ['confirmed', 'clashes'],
      },
      {
        caption: 'Both are told yes.',
        sub: 'Then the servers tell each other, and find out. One seat is now sold to two people. The red blocks show it. Someone will arrive at a seat that is not theirs.',
        shot: WIDE,
        tags: ['clients', 'clash'],
        hud: ['confirmed', 'clashes'],
      },
      {
        caption: 'Why not use just one server?',
        sub: 'One server never disagrees with itself. But when it crashes, nobody can book at all. So we want several servers that still behave like one.',
        shot: WIDE,
        tags: ['clients', 'nodes'],
        hud: ['confirmed', 'clashes'],
      },
      {
        caption: 'They must agree.',
        sub: 'Several servers have to agree on one order of events: who asked first, and who gets the seat. Getting servers to agree, even when some fail, is called consensus.',
        shot: WIDE,
        tags: ['clients', 'clash'],
        hud: ['confirmed', 'clashes'],
      },
    ],
  },
  {
    title: 'One leader',
    level: 'Beginner',
    initial: { ...BASE, rule: 'leader' },
    beats: [
      {
        caption: 'Pick one leader.',
        sub: 'One server wears the crown. Customers can still talk to any server, but a follower passes every booking on to the leader.',
        shot: WIDE,
        tags: ['clients', 'nodes', 'leader'],
        hud: ['confirmed', 'clashes'],
      },
      {
        caption: 'The leader decides.',
        sub: 'It checks its list. If the seat is free, it writes the booking down. If not, it says no. Only one server ever says yes, so only one person gets the seat. Ana and Ben race for the last seat.',
        set: { again: 1 },
        shot: WIDE,
        tags: ['clients', 'nodes', 'leader'],
        hud: ['confirmed', 'clashes'],
      },
      {
        caption: 'Then it copies the booking out.',
        set: { manual: false, pace: 0.6 },
        sub: 'More customers keep booking. The leader sends each booking to the followers, who copy the leader’s list in the same order. A faded block is a booking that the leader has not yet been able to confirm.',
        shot: WIDE,
        tags: ['nodes', 'leader'],
        hud: ['confirmed', 'clashes'],
      },
      {
        caption: 'Confirmed once most servers have it.',
        set: { manual: true, pace: 0, again: 3 },
        sub: 'The leader waits until most of the servers (2 out of 3) hold the booking, then tells the customer. That way a confirmed booking survives if one server is lost.',
        shot: WIDE,
        tags: ['clients', 'nodes', 'leader'],
        hud: ['confirmed', 'clashes'],
      },
      {
        sub: 'Right now any server can confirm, so the last seat gets sold twice. Switch to one leader and watch the last seat.',
        set: { rule: 'anyone', again: 4 },
        shot: WIDE,
        tags: ['clients', 'nodes', 'leader'],
        controls: ['rule'],
        hud: ['confirmed', 'clashes'],
        challenge: {
          goal: 'Switch to one leader: exactly one person gets the last seat.',
          win: 'One leader means one order. A seat can’t be sold twice, because only one server ever says yes. The price: everything now depends on that leader.',
          holdSeconds: 2,
          check: ({ m, st }) => st.rule === 'leader' && m.confirmed === 1 && m.waiting === 0,
        },
      },
    ],
  },
  {
    title: 'The leader disappears',
    level: 'Beginner',
    initial: { ...BASE, rule: 'leader' },
    beats: [
      {
        caption: 'Followers listen for a heartbeat.',
        sub: 'The leader sends a small pulse to every follower, again and again. It is the small grey cube travelling from the leader to each follower, and it means: I am still here. Each follower answers with an even smaller one.',
        shot: WIDE,
        tags: ['nodes', 'leader', 'heartbeat'],
        hud: ['leader', 'confirmed'],
      },
      {
        caption: 'Then the leader crashes.',
        sub: 'A power cut, a bad deploy, a full disk. The pulse stops.',
        set: { down: [0], again: 1 },
        predict: {
          clue: 'Only the leader may confirm bookings. It is the one that crashed.',
          question: 'The leader has crashed. Whose bookings get answered now?',
          options: [TARGETS.followers, TARGETS.nobody],
          answer: 1,
        },
        shot: WIDE,
        tags: ['nodes', 'leader'],
        hud: ['leader', 'waiting', 'confirmed'],
      },
      {
        caption: 'No leader, no bookings.',
        sub: 'The followers are healthy, but they only pass bookings along. Nobody is allowed to confirm, so customers wait and wait. Nothing fixes itself.',
        shot: WIDE,
        tags: ['clients', 'nodes', 'leader'],
        hud: ['stall', 'waiting', 'confirmed'],
      },
      {
        caption: 'Why not let any follower take over?',
        sub: 'If two followers both decide to lead, we are back to two servers confirming the same seat. We need a fair way to pick exactly one new leader. That is next.',
        shot: WIDE,
        tags: ['nodes', 'leader'],
        hud: ['stall', 'waiting'],
      },
      {
        sub: 'Crash the leader, and see how long the app stays stuck.',
        set: { down: [] },
        shot: WIDE,
        tags: ['nodes', 'leader'],
        controls: ['crash'],
        hud: ['stall', 'waiting', 'confirmed'],
        challenge: {
          goal: 'Crash the leader and go 8 seconds with no leader.',
          win: 'Nothing recovers on its own: the whole app is stuck until someone restarts that one server. Next, the other servers learn to choose a new leader themselves.',
          holdSeconds: 0.5,
          check: ({ m }) => m.stall >= 8,
        },
      },
    ],
  },
]
