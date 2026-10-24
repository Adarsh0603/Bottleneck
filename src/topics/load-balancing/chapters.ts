import type { Ramp, Shot, V3 } from '../../core/types'
import { BLACK_FRIDAY } from './build'
import type { LoadBalancerSim, Server } from './engine'
import type { CourseState, LbChapter } from './types'
import { TICKS_PER_SECOND } from './useSim'
import { BASE, LB_X, scaleOf, SERVER_X, serverZ, STANDBY_Z } from './world'

const BASE_STATE: CourseState = {
  rps: 0,
  servers: [1],
  balancer: false,
  algorithm: 'round-robin',
  down: [],
  standby: false,
  failover: false,
}

const WIDE: Shot = { target: [-1.5, 0.6, 0], zoom: 1 }
const SERVER: Shot = { target: [SERVER_X, 1.1, 0], zoom: 1.8 }
const SERVER_TOP: Shot = { target: [SERVER_X, 1.9, 0], zoom: 2.3 }
const SERVER_MID: Shot = { target: [SERVER_X - 1, 1.2, 0], zoom: 1.35 }
const CEILING: Shot = { target: [SERVER_X - 0.5, 1.8, 0], zoom: 1.05 }
const QUEUE: Shot = { target: [1.5, 0.4, 0], zoom: 1.6 }
const FLEET: Shot = { target: [-0.5, 0.6, 0], zoom: 0.95, fit: true }
const LB: Shot = { target: [LB_X, 0.5, 0], zoom: 1.8 }
const LB_PAIR: Shot = { target: [LB_X, 0.5, STANDBY_Z / 2], zoom: 1.6 }
const onServer = (index: number, count: number): Shot => ({ target: [SERVER_X, 1, serverZ(index, count)], zoom: 1.7 })

// Tap targets above each server's roof, for in-scene questions.
const serverTargets = (speeds: number[]) =>
  speeds.map((speed, i) => ({
    label: `Server ${'ABCDEF'[i]}`,
    at: [SERVER_X, BASE.h * scaleOf(speed) + 0.4, serverZ(i, speeds.length)] as V3,
  }))

// Traffic climbs by 1 req/s every `everyMs` until it reaches `to`.
const trafficRamp = (to: number, everyMs: number): Ramp<CourseState> => ({
  everyMs,
  next: (st) => (st.rps >= to ? null : { ...st, rps: Math.floor(st.rps) + 1 }),
})

// Can this setup keep up with the traffic indefinitely, with 10% to spare?
// An overloaded system looks fine until its queues fill, so challenges check
// this as well as the live numbers. Turn-taking algorithms give every server
// an equal share, so the weakest server decides; load-aware ones pool capacity.
export function sustainable(sim: LoadBalancerSim, rps: number, margin = 0.9) {
  const avgWork = (sim.config.minWork + sim.config.maxWork) / 2
  const cap = (s: Server) => (s.slots * s.speed * TICKS_PER_SECOND) / avgWork
  const alive = sim.servers.filter((s) => s.alive)
  if (sim.algorithm === 'direct') {
    const first = sim.servers[0]
    return !!first?.alive && rps <= cap(first) * margin
  }
  if (alive.length === 0) return false
  if (sim.algorithm === 'round-robin' || sim.algorithm === 'random') {
    return alive.every((s) => rps / alive.length <= cap(s) * margin)
  }
  return rps <= alive.reduce((sum, s) => sum + cap(s), 0) * margin
}

const healthy = (sim: LoadBalancerSim, st: CourseState, dropRate: number) =>
  sustainable(sim, st.rps) && dropRate < 1 && sim.servers.every((s) => !s.alive || s.queue.length < 6)

export const SIZES = [
  { value: 1, label: 'Small', cost: 50 },
  { value: 2, label: 'Large', cost: 120 },
  { value: 4, label: 'XL', cost: 300 },
]

export function monthlyCost(st: CourseState) {
  return st.servers.reduce((sum, speed) => sum + (SIZES.find((s) => s.value === speed)?.cost ?? 50), 0)
}

export const CHAPTERS: LbChapter[] = [
  {
    title: 'One server',
    level: 'Beginner',
    initial: BASE_STATE,
    beats: [
      { caption: 'This is a server.', sub: 'A computer that answers your app’s requests.', shot: SERVER, tags: ['server'] },
      {
        caption: 'Users send it requests.',
        sub: 'Each cube is one request.',
        set: { rps: 1 },
        shot: WIDE,
        tags: ['users'],
        hud: ['traffic'],
      },
      {
        caption: 'Each request takes a worker.',
        sub: 'This server has 4. Lit means busy.',
        set: { rps: 2 },
        shot: SERVER_TOP,
        tags: ['workers'],
        hud: ['traffic', 'latency'],
      },
      {
        caption: 'All busy? Requests wait in line.',
        sub: 'That line is the queue. Waiting makes your app slow.',
        set: { rps: 3.5 },
        shot: QUEUE,
        tags: ['queue'],
        hud: ['traffic', 'latency', 'queue'],
      },
    ],
  },
  {
    title: 'Traffic grows',
    level: 'Beginner',
    initial: { ...BASE_STATE, rps: 2 },
    beats: [
      {
        caption: 'Your app gets popular.',
        sub: 'Load is measured in requests per second.',
        shot: WIDE,
        tags: ['users'],
        hud: ['traffic', 'latency'],
      },
      {
        caption: 'Line full? Users get errors.',
        sub: 'Red cubes are requests turned away.',
        set: { rps: 3 },
        ramp: trafficRamp(12, 900),
        shot: QUEUE,
        tags: ['queue', 'dropped'],
        hud: ['traffic', 'latency', 'queue', 'dropped'],
      },
      {
        caption: 'Every server has a limit.',
        sub: 'Slide to find this one’s.',
        set: { rps: 6 },
        shot: WIDE,
        controls: ['traffic'],
        hud: ['traffic', 'capacity', 'latency', 'dropped'],
      },
    ],
  },
  {
    title: 'Scale up',
    level: 'Beginner',
    initial: { ...BASE_STATE, rps: 5 },
    beats: [
      {
        caption: 'Fix #1: buy a bigger machine.',
        sub: 'This is vertical scaling.',
        shot: SERVER_MID,
        controls: ['size'],
        hud: ['cost', 'latency', 'dropped'],
        challenge: {
          goal: 'Handle 5 req/s with no errors. Spend as little as you can.',
          win: 'A bigger box fixed it, with no code changes.',
          holdSeconds: 4,
          check: ({ m, st, sim }) => healthy(sim, st, m.dropRate),
        },
      },
      {
        caption: 'But there’s a ceiling.',
        sub: 'You can’t buy a bigger box than the biggest one.',
        set: { servers: [4], rps: 16 },
        ghost: true,
        shot: CEILING,
        tags: ['ceiling'],
        hud: ['cost', 'capacity', 'dropped'],
      },
      {
        caption: 'And it’s still one machine.',
        sub: 'When it dies, your whole app dies. Click it to restart.',
        set: { down: [0], rps: 6 },
        shot: SERVER_MID,
        tags: ['spof'],
        hud: ['dropped'],
        clickCrash: true,
      },
    ],
  },
  {
    title: 'Scale out',
    level: 'Intermediate',
    initial: { ...BASE_STATE, rps: 7 },
    beats: [
      {
        caption: 'Fix #2: add more servers.',
        predict: {
          clue: 'Server A is the one you already had. There’s no load balancer, so users still send to the one address they know.', question: 'Two new servers. Which one will get the traffic?',
          options: serverTargets([1, 1, 1]),
          answer: 0,
        },
        sub: 'This is horizontal scaling.',
        set: { servers: [1, 1, 1] },
        shot: FLEET,
        hud: ['latency', 'dropped'],
      },
      {
        caption: 'But users only know one address.',
        sub: 'Everyone still goes to the first server.',
        shot: FLEET,
        tags: ['idle', 'queue'],
        hud: ['latency', 'dropped'],
      },
      {
        caption: 'Enter the load balancer.',
        sub: 'It owns the address and spreads requests out.',
        set: { balancer: true },
        shot: LB,
        tags: ['lb'],
        hud: ['latency', 'dropped'],
      },
      {
        caption: 'Launch day.',
        sub: 'Your tools: servers and a load balancer.',
        set: { servers: [1], balancer: false, rps: 10 },
        shot: FLEET,
        controls: ['servers', 'balancer'],
        hud: ['traffic', 'capacity', 'dropped'],
        challenge: {
          goal: 'Serve 10 req/s with under 1% errors.',
          win: 'A load balancer plus enough servers: that’s scaling out.',
          holdSeconds: 4,
          check: ({ m, st, sim }) => st.balancer && healthy(sim, st, m.dropRate),
        },
      },
    ],
  },
  {
    title: 'Algorithms',
    level: 'Intermediate',
    initial: { ...BASE_STATE, servers: [1, 1, 1, 0.5], balancer: true, rps: 9 },
    beats: [
      {
        caption: 'Who gets the next request?',
        predict: {
          clue: 'Server D is half as fast as the others.', question: 'Round robin gives everyone turns. Which server falls behind?',
          options: serverTargets([1, 1, 1, 0.5]),
          answer: 3,
        },
        sub: 'Round robin: everyone takes turns.',
        shot: FLEET,
        tags: ['lb'],
        hud: ['dropped'],
      },
      {
        caption: 'One server is slower.',
        sub: 'Round robin doesn’t notice. It falls behind.',
        shot: onServer(3, 4),
        tags: ['slow', 'dropped'],
        hud: ['latency', 'dropped'],
      },
      {
        caption: 'Least connections: pick the least busy.',
        sub: 'Slow servers stay busy longer, so they get less.',
        set: { algorithm: 'least-connections' },
        shot: FLEET,
        tags: ['slow'],
        hud: ['latency', 'dropped'],
      },
      {
        sub: 'Same servers, same traffic. Pick an algorithm.',
        set: { algorithm: 'round-robin' },
        shot: FLEET,
        controls: ['algorithm'],
        hud: ['latency', 'dropped'],
        challenge: {
          goal: 'Get errors under 1% without adding servers.',
          win: 'Pick servers by how busy they are, not by turns.',
          holdSeconds: 4,
          check: ({ m, st, sim }) => healthy(sim, st, m.dropRate),
        },
      },
    ],
  },
  {
    title: 'Failures',
    level: 'Intermediate',
    initial: { ...BASE_STATE, servers: [1, 1, 1, 1], balancer: true, algorithm: 'least-connections', rps: 7 },
    beats: [
      {
        caption: 'Servers crash. Often.',
        sub: 'So the load balancer checks each one, every second.',
        pulses: true,
        shot: FLEET,
        tags: ['lb'],
        hud: ['healthy', 'dropped'],
      },
      {
        caption: 'No reply? Out of rotation.',
        sub: 'Its requests are lost. The others take over.',
        set: { down: [1] },
        pulses: true,
        shot: onServer(1, 4),
        hud: ['healthy', 'dropped'],
      },
      {
        caption: 'Back online? Back in rotation.',
        sub: 'Click any server to crash or restart it.',
        set: { down: [] },
        pulses: true,
        clickCrash: true,
        shot: FLEET,
        hud: ['healthy', 'dropped'],
      },
      {
        caption: 'The first server just died.',
        sub: 'Three servers left for 7 req/s.',
        set: { servers: [1, 1, 1], down: [0] },
        pulses: true,
        shot: FLEET,
        controls: ['servers'],
        hud: ['healthy', 'capacity', 'dropped'],
        challenge: {
          goal: 'Get errors under 1% while it’s down.',
          win: 'That’s N+1: spare capacity, so one failure doesn’t hurt.',
          holdSeconds: 4,
          check: ({ m, st, sim }) => st.down.length > 0 && healthy(sim, st, m.dropRate),
        },
      },
    ],
  },
  {
    title: 'Advanced',
    level: 'Advanced',
    initial: { ...BASE_STATE, servers: [1, 1, 1, 1], balancer: true, algorithm: 'least-connections', rps: 6 },
    beats: [
      { caption: 'Now the load balancer is the weak spot.', sub: 'One box in front of everything.', shot: LB, tags: ['lbspof'] },
      {
        caption: 'So run two.',
        sub: 'A standby waits, ready to take over the address.',
        set: { standby: true },
        shot: LB_PAIR,
        tags: ['standby'],
      },
      {
        caption: 'Active fails. Standby takes over.',
        sub: 'Users never notice.',
        set: { failover: true },
        shot: LB_PAIR,
        hud: ['dropped'],
      },
      {
        caption: 'Power of two choices.',
        sub: 'Pick 2 random servers, send to the less busy one.',
        set: { algorithm: 'power-of-two' },
        shot: FLEET,
        hud: ['latency', 'dropped'],
      },
    ],
  },
  {
    title: 'Build it',
    level: 'Intermediate',
    initial: BASE_STATE,
    beats: [{ caption: BLACK_FRIDAY.title }],
    build: BLACK_FRIDAY,
  },
]
