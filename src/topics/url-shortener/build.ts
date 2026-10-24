import { createElement } from 'react'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Review } from '../../core/capstone/types'
import { CACHE_SIZES, LIMITS, SCHEMES, SCOPES, SECOND, Shortener, type Load, type Profile } from './shortener'

// The design board: sources on the left, the front door, app servers, then
// cache and queue, and the database with its replicas on the right.
const USERS_AT = { x: -8.6, z: 0 }
const MAKERS_AT = { x: -8.6, z: -3.3 }
const BOT_AT = { x: -8.6, z: 3.3 }
const GATE_AT = { x: -6.1, z: 0 }
const LB_AT = { x: -3.8, z: 0 }
const APP_X = -1.2
const CACHE_AT = { x: 2.0, z: -2.8 }
const QUEUE_AT = { x: 2.0, z: 2.8 }
const DB_AT = { x: 5.8, z: 0 }
const REPLICA_Z = [-3.2, 3.2]

const APP_PADS = ['app-1', 'app-2']
const REPLICA_PADS = ['rep-0', 'rep-1']

// Load, by second. The first design runs a quiet service. Then it grows:
//   0-6s calm, 6-22s everyone is reading, 22-38s one link goes viral,
//   38-54s a bot floods the create button.
const T = (s: number) => s * SECOND
const QUIET: Load = { users: 3, makers: 1.5, bot: 0, hot: 0 }
export const FIRST_PROFILE: Profile = () => QUIET
export const SCALE_PROFILE: Profile = (tick) => {
  if (tick < T(6)) return { users: 4, makers: 1, bot: 0, hot: 0 }
  if (tick < T(22)) return { users: 20, makers: 1, bot: 0, hot: 0 }
  if (tick < T(38)) return { users: 36, makers: 1, bot: 0, hot: 0.55 }
  return { users: 12, makers: 1, bot: 30, hot: 0 }
}
export const FIRST_SETTLED = T(25)
export const SCALE_SETTLED = T(56)
const PHASES: [number, string][] = [
  [T(6), 'Calm'],
  [T(22), 'Everyone is reading'],
  [T(38), 'One link goes viral'],
  [Infinity, 'A bot floods create'],
]
const phaseAt = (tick: number) => PHASES.find(([end]) => tick < end)![1]

export const shortenerOf = new WeakMap<FlowSim, Shortener>()

// What the learner has chosen.
export function chosen(settings: Settings) {
  return {
    scheme: SCHEMES[settings.scheme ?? 0],
    cacheSize: CACHE_SIZES[settings.cache ?? 0],
    limit: LIMITS[settings.limit ?? 2],
    scope: SCOPES[settings.scope ?? 0],
  }
}

const placedApps = (placed: Placement) => ['app-0', ...APP_PADS.filter((p) => placed[p])]
const placedReplicas = (placed: Placement) => REPLICA_PADS.filter((p) => placed[p])

function assemble(placed: Placement, settings: Settings, profile: Profile, rng?: () => number) {
  const { scheme, cacheSize, limit, scope } = chosen(settings)
  const s = new Shortener(rng ?? (() => 0.5), {
    apps: placedApps(placed),
    balancer: !!placed.lb,
    gate: placed.gate ? { limit, scope } : undefined,
    cacheSize: placed.cache ? cacheSize : undefined,
    replicas: placedReplicas(placed),
    queue: !!placed.queue,
    scheme,
    profile,
  })
  shortenerOf.set(s.flow, s)
  return s.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const noDupes: Requirement = {
  label: 'Codes',
  read: (flow) => {
    const d = shortenerOf.get(flow)?.tally.dupes ?? 0
    return { text: d === 0 ? 'all unique' : `${d} repeated`, ok: d === 0 }
  },
}
const redirectsWork = (limit: number): Requirement => ({
  label: 'Redirects',
  read: (flow) => {
    const f = shortenerOf.get(flow)?.redirectsFailed() ?? 0
    return { text: `${f} lost`, ok: f <= limit }
  },
})
const redirectsFast: Requirement = {
  label: 'Speed',
  read: (_flow, m) => {
    const ms = m.latency.users ?? 0
    return { text: `${(ms / 1000).toFixed(1)}s`, ok: ms < 1600 }
  },
}
const newLinks: Requirement = {
  label: 'New links',
  read: (flow) => {
    const f = shortenerOf.get(flow)?.makersFailed() ?? 0
    return { text: `${f} lost`, ok: f <= 2 }
  },
}
const clicksKept: Requirement = {
  label: 'Clicks',
  read: (flow) => {
    const f = shortenerOf.get(flow)?.clicksLost() ?? 0
    return { text: `${f} lost`, ok: f <= 20 }
  },
}

const BRIEF = {
  title: 'The brief',
  lines: [
    'Long links are a pain. They break across lines in messages, eat the character limit in a post, and make a QR code too dense to scan. A short link fixes that, and it lets the owner count how many people clicked.',
    'Build a link shortener. Someone pastes a long link and gets a short one. Anyone opening the short link lands on the long one, fast.',
    'Plan for 1M new links a day, and about 100 redirects for every new link. Each redirect also counts a click.',
    'A redirect that takes over 2 seconds counts as lost.',
  ],
}

const FIXED = [
  { id: 'users', kind: 'users' as const, ...USERS_AT },
  { id: 'makers', kind: 'users' as const, ...MAKERS_AT },
  { id: 'bot', kind: 'users' as const, ...BOT_AT },
  { id: 'app-0', kind: 'app' as const, x: APP_X, z: 0 },
  { id: 'db', kind: 'database' as const, ...DB_AT },
]
const LABELS = [
  { at: [USERS_AT.x, 1.6, USERS_AT.z] as [number, number, number], text: 'Visitors' },
  { at: [MAKERS_AT.x, 1.6, MAKERS_AT.z] as [number, number, number], text: 'Link makers' },
  { at: [BOT_AT.x, 1.6, BOT_AT.z] as [number, number, number], text: 'Bot' },
]
const SETTINGS = [
  { id: 'scheme', label: 'new codes', when: 'app' as const, min: 0, max: 2, step: 1, initial: 0, options: ['One shared counter', 'Own key range per server', 'Random hash, check first'] },
  { id: 'cache', label: 'holds', when: 'cache' as const, min: 0, max: CACHE_SIZES.length - 1, step: 1, initial: 0, options: CACHE_SIZES.map((n) => `${n} links`) },
  { id: 'scope', label: 'counts', when: 'limiter' as const, min: 0, max: 1, step: 1, initial: 0, options: ['All requests together', 'Creates, per client'] },
  { id: 'limit', label: 'limit', when: 'limiter' as const, min: 0, max: LIMITS.length - 1, step: 1, initial: 2, options: LIMITS.map((n) => `${n} / second`) },
]

function decorate(flow: FlowSim, placed: Placement) {
  const s = shortenerOf.get(flow)
  if (!s) return null
  const out = [createElement(Tag, { key: 'phase', at: [USERS_AT.x, 2.4, USERS_AT.z], label: phaseAt(flow.tick), danger: flow.tick >= T(38) && flow.tick < SCALE_SETTLED })]
  if (placed.cache) out.push(createElement(Tag, { key: 'cache', at: [CACHE_AT.x, 1.6, CACHE_AT.z], label: `${Math.round(s.hitRate() * 100)}% from memory` }))
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    rps: 4,
    shot: { target: [-1.4, 0.8, 0], zoom: 0.56 },
    fixed: FIXED,
    labels: LABELS,
    decorate,
  }
}

// Stage 2: a quiet service, and one new idea: handing out codes.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: two servers, one code each.',
  sub: 'Add a second app server and a balancer, then choose how new codes are made.',
  goal: 'Run on two app servers and never hand out the same short code twice.',
  goalShort: 'Two servers · no repeated codes',
  win: 'Two servers can no longer clash: each makes codes from its own range, or checks before it uses one.',
  holdSeconds: 4,
  testSeconds: 30,
  pads: [
    { id: 'lb', ...LB_AT, accepts: ['balancer'] },
    ...APP_PADS.map((id, i) => ({ id, x: APP_X, z: i === 0 ? -2.8 : 2.8, accepts: ['app' as const] })),
  ],
  toolbox: [
    { kind: 'balancer', count: 1 },
    { kind: 'app', count: 2 },
  ],
  settings: [SETTINGS[0]],
  requirements: [noDupes, redirectsWork(3), redirectsFast],
  assemble: (placed, settings, rng) => assemble(placed, settings, FIRST_PROFILE, rng),
  problem(_m, placed, settings, flow) {
    const s = shortenerOf.get(flow)
    if (!s) return null
    const { scheme } = chosen(settings)
    if (s.tally.dupes > 0 && scheme === 'counter') return 'Two different links were given the same short code. Both servers count from one shared counter, and each reads it before the other has written.'
    if (!placed.lb && placedApps(placed).length > 1) return 'All visitors land on the first server. The others get no traffic.'
    if (s.redirectsFailed() > 3) return 'Redirects are being lost.'
    return null
  },
  check(_m, placed, _settings, flow) {
    const s = flow && shortenerOf.get(flow)
    if (!s || !placed.lb || placedApps(placed).length < 2) return false
    return flow.tick >= FIRST_SETTLED && s.tally.dupes === 0 && s.redirectsFailed() <= 3 && s.makersFailed() <= 2
  },
}

// Stage 3: the same board, growing load. Each phase breaks something new.
export const SCALE_UP: BuildTask = {
  ...common(),
  title: 'Where it breaks: grow it.',
  sub: 'The load grows in steps. Watch what turns red, then fix it. Changing anything restarts the run.',
  goal: 'Get through every step of growth with no lost redirects, no repeated codes and no lost new links.',
  goalShort: 'Survive every step of growth',
  win: 'Cache for the popular links, enough servers behind a balancer, clicks on a queue, and creates limited per client: every step of growth held.',
  holdSeconds: 4,
  testSeconds: 60,
  pads: [
    { id: 'gate', ...GATE_AT, accepts: ['limiter'] },
    { id: 'lb', ...LB_AT, accepts: ['balancer'] },
    ...APP_PADS.map((id, i) => ({ id, x: APP_X, z: i === 0 ? -2.8 : 2.8, accepts: ['app' as const] })),
    { id: 'cache', ...CACHE_AT, accepts: ['cache'] },
    { id: 'queue', ...QUEUE_AT, accepts: ['queue'] },
    ...REPLICA_PADS.map((id, i) => ({ id, x: DB_AT.x, z: REPLICA_Z[i], accepts: ['replica' as const] })),
  ],
  toolbox: [
    { kind: 'limiter', count: 1 },
    { kind: 'balancer', count: 1 },
    { kind: 'app', count: 2 },
    { kind: 'cache', count: 1 },
    { kind: 'queue', count: 1 },
    { kind: 'replica', count: 2 },
  ],
  settings: SETTINGS,
  watch: [{ kind: 'busy', key: 'db', label: 'Database busy' }],
  requirements: [redirectsWork(8), redirectsFast, noDupes, newLinks, clicksKept],
  assemble: (placed, settings, rng) => assemble(placed, settings, SCALE_PROFILE, rng),
  problem(m, placed, settings, flow) {
    const s = shortenerOf.get(flow)
    if (!s) return null
    const t = s.tally
    const tick = flow.tick
    const { scope, limit } = chosen(settings)
    const apps = placedApps(placed).length
    const dbBusy = m.busy.db ?? 0

    if (t.dupes > 0) return 'Two links were given the same short code. The servers share one counter.'
    if (placed.gate && scope === 'all' && (t.limited.users ?? 0) > 0) return 'Visitors are being turned away. The limiter counts every request together, redirects too.'
    if (placed.gate && scope === 'creates' && (t.limited.makers ?? 0) > 2) return `Real link makers are being turned away. The limit is ${limit} a second.`
    if (s.redirectsFailed() > 8) {
      if (!placed.cache && tick >= T(6)) return 'Every redirect asks the database, which can only look up about 8 links a second. Most visitors want the same few links.'
      if (placed.cache && s.hitRate() < 0.6 && tick >= T(10)) return `Only ${Math.round(s.hitRate() * 100)}% of redirects are answered from memory. The rest reach the database.`
      if ((!placed.lb || apps < 2) && tick >= T(10)) return 'One app server handles about 20 requests a second, and more than that are arriving.'
      if (!placed.queue && dbBusy > 0.8) return 'Every redirect writes a click to the database before it finishes. That is more writing than the database can take.'
      if (!placedReplicas(placed).length && dbBusy > 0.8) return 'Cache misses and new links all land on one database, and it cannot keep up.'
    }
    if (tick >= T(38) && (s.makersFailed() > 2 || dbBusy > 0.9)) {
      if (!placed.gate) return 'A bot is creating links as fast as it can. Every new link is a database write, and real people are being crowded out.'
      if (scope === 'creates' && limit >= 8) return `The bot still gets ${limit} new links a second through. That is too many writes.`
    }
    if (!placed.queue && dbBusy > 0.9) return 'The database is overloaded. Each redirect still writes a click straight to it.'
    return null
  },
  check(_m, _placed, _settings, flow) {
    const s = flow && shortenerOf.get(flow)
    if (!s || flow.tick < SCALE_SETTLED) return false
    return s.redirectsFailed() <= 8 && s.tally.dupes === 0 && s.makersFailed() <= 2 && s.clicksLost() <= 20
  },
}

const has = (placed: Placement, id: string) => !!placed[id]

function review(placed: Placement, settings: Settings): Review {
  const { scheme, scope } = chosen(settings)
  const apps = placedApps(placed).length
  const replicas = placedReplicas(placed).length
  return {
    lines: [
      { label: 'New codes', yours: ['One shared counter', 'Key range per server', 'Random hash'][SCHEMES.indexOf(scheme)], reference: 'Key range per server', why: 'No clash and no extra check. A hash also works, but about 1 in 8 needs a second write.', ok: scheme !== 'counter' },
      { label: 'Front door', yours: has(placed, 'lb') ? `Balancer, ${apps} app servers` : `${apps} app server`, reference: 'Balancer, 3 app servers', why: 'App servers keep no state, so you add more behind a balancer, or let an autoscaler do it.', ok: has(placed, 'lb') && apps >= 3 },
      { label: 'Reads', yours: has(placed, 'cache') ? 'Cache' : 'Straight to the database', reference: 'Cache for popular links', why: 'About 100 reads for every write, and a few links get most of them.', ok: has(placed, 'cache') },
      { label: 'Clicks', yours: has(placed, 'queue') ? 'Queue, written later' : 'Written before redirecting', reference: 'Queue, written later', why: 'A redirect should not wait for a click to be counted.', ok: has(placed, 'queue') },
      { label: 'Database', yours: replicas ? `${replicas} read replica${replicas > 1 ? 's' : ''}` : 'One database', reference: 'One primary, read replicas', why: 'Replicas share the reads that miss the cache. Writes stay on the primary.', ok: replicas > 0 },
      { label: 'Abuse', yours: has(placed, 'gate') ? (scope === 'creates' ? 'Creates limited per client' : 'One count for all requests') : 'Nothing', reference: 'Creates limited per client', why: 'Limit the expensive action, per client. A global count turns away real visitors.', ok: has(placed, 'gate') && scope === 'creates' },
    ],
    tradeoffs: [
      '301 or 302? A 301 is cached by browsers, so fewer visits reach you, but you cannot count clicks. A 302 reaches you every time.',
      'Counting clicks on a queue means a crash can lose a few. Counting in the redirect never loses one, but slows every redirect.',
      'A cache can show a link that has since been deleted or changed, until it expires. Short links rarely change, so a long expiry is fine.',
    ],
    interview: [
      'Clarify: how many new links and redirects a day, how long are codes kept, do links expire, do we need click counts.',
      'Estimate: about 12 new links a second, about 1,200 redirects a second, around 1 TB over five years.',
      'Design: a code from a key range per server, a stateless app tier behind a balancer, a database keyed by code with read replicas, and a cache in front for hot links.',
      'Scale: cache first, then replicas, then shard by code. Clicks go on a queue. Rate limit creates per client.',
    ],
  }
}

export const URL_SHORTENER: Capstone = {
  id: 'url-shortener',
  title: 'URL shortener',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    questions: [
      { question: '1 million new links a day. About how many new links a second is that?', options: ['About 1', 'About 12', 'About 120'], answer: 1, why: 'A day has about 86,000 seconds. 1,000,000 ÷ 86,000 is about 12.' },
      { question: 'There are about 100 redirects for every new link. About how many redirects a second?', options: ['About 120', 'About 1,200', 'About 12,000'], answer: 1, why: '12 new links a second × 100 is about 1,200 redirects a second. Reading dominates.' },
      { question: 'Keep every link for 5 years, about 500 bytes each. About how much storage is that?', options: ['About 1 GB', 'About 1 TB', 'About 1 PB'], answer: 1, why: '1M a day × 365 × 5 is about 1.8 billion links. At 500 bytes each that is close to 1 TB: one big database, not a fleet.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
