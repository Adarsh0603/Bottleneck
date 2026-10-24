import { describe, expect, it } from 'vitest'
import { Bus, TICKS_PER_SECOND, type Config, type Team } from './bus'

const seeded = (seed: number) => {
  let x = seed
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}
const seeds = [1, 2, 3, 4, 5]

function run(cfg: Partial<Config>, seconds: number, seed = 1) {
  const bus = new Bus(seeded(seed))
  bus.configure(cfg)
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) {
    bus.flow.step()
    bus.sample()
  }
  return bus
}

const each = (cfg: Partial<Config>, seconds: number, check: (bus: Bus) => void) => seeds.forEach((s) => check(run(cfg, seconds, s)))
const teams: Team[] = ['email', 'stats', 'stock']

describe('queue vs topic', () => {
  it('a queue gives each event to one consumer, so every team misses most of them', () => {
    each({ mode: 'queue', rps: 1.5 }, 30, (bus) => {
      for (const team of teams) expect(bus.tally.lost[team]).toBeGreaterThan(5)
    })
  })

  it('a topic copies every event to every team', () => {
    each({ mode: 'topic', rps: 1.5 }, 30, (bus) => {
      for (const team of teams) expect(bus.tally.lost[team]).toBe(0)
      for (const team of teams) expect(bus.tally.processed[team]).toBeGreaterThan(35)
    })
  })
})

describe('a slow subscriber', () => {
  it('overflows its own inbox in a topic, and more consumers fix it', () => {
    each({ mode: 'topic', rps: 4, counts: { email: 1, stats: 1, stock: 2 } }, 30, (bus) => {
      expect(bus.tally.lost.email).toBeGreaterThan(10)
      expect(bus.tally.lost.stats).toBe(0)
    })
    each({ mode: 'topic', rps: 4, counts: { email: 3, stats: 1, stock: 2 } }, 30, (bus) => {
      expect(bus.tally.lost.email).toBe(0)
    })
  })
})

describe('the log', () => {
  const outage = { start: 5 * TICKS_PER_SECOND, length: 6 * TICKS_PER_SECOND }

  it('a topic loses what is sent while a team is offline', () => {
    each({ mode: 'topic', rps: 1.5, outage }, 30, (bus) => {
      expect(bus.tally.lost.stats).toBeGreaterThan(5)
    })
  })

  it('a stream keeps it, and the team catches up from its offset', () => {
    each({ mode: 'stream', rps: 1.5, outage }, 40, (bus) => {
      expect(bus.tally.outages).toBe(1)
      expect(bus.tally.lost.stats).toBe(0)
      expect(bus.behind('stats')).toBeLessThan(3)
      expect(bus.tally.processed.stats).toBeGreaterThan(55)
    })
  })

  it('a log that forgets too soon loses the events anyway', () => {
    each({ mode: 'stream', rps: 1.5, outage, retention: 3 }, 40, (bus) => {
      expect(bus.tally.lost.stats).toBeGreaterThan(3)
    })
  })
})

describe('partitions and order', () => {
  const stock = (partitions: number, count: number, key: Config['key']): Partial<Config> => ({
    mode: 'stream',
    rps: 5,
    partitions,
    key,
    counts: { email: 1, stats: 1, stock: count },
    present: { email: false, stats: false, stock: true },
  })

  it('one partition is read by one consumer, however many there are', () => {
    each(stock(1, 3, 'none'), 30, (bus) => {
      expect(bus.behind('stock')).toBeGreaterThan(20)
      expect(bus.tally.disorder).toBe(0)
    })
  })

  it('spreading by order scrambles events for the same product', () => {
    each(stock(3, 3, 'order'), 30, (bus) => {
      expect(bus.tally.disorder).toBeGreaterThan(0)
    })
    each(stock(3, 3, 'none'), 30, (bus) => {
      expect(bus.tally.disorder).toBeGreaterThan(0)
    })
  })

  it('keying by product keeps order and keeps up', () => {
    each(stock(3, 3, 'product'), 40, (bus) => {
      expect(bus.tally.disorder).toBe(0)
      expect(bus.behind('stock')).toBeLessThan(6)
    })
  })

  it('more consumers than partitions leave the extra ones idle', () => {
    each(stock(2, 4, 'product'), 40, (bus) => {
      expect(bus.behind('stock')).toBeGreaterThan(15)
    })
  })
})

describe('crashes', () => {
  const crashy = (commit: Config['commit'], dedupe: boolean): Partial<Config> => ({
    mode: 'stream',
    rps: 2,
    crashy: true,
    commit,
    dedupe,
    present: { email: false, stats: false, stock: true },
  })

  it('committing before the work is done loses what was in hand', () => {
    each(crashy('before', false), 40, (bus) => {
      expect(bus.tally.crashes).toBeGreaterThan(2)
      expect(bus.tally.lost.stock).toBeGreaterThan(0)
    })
  })

  it('committing after loses nothing, but repeats some work', () => {
    each(crashy('after', false), 40, (bus) => {
      expect(bus.tally.lost.stock).toBe(0)
      expect(bus.tally.duplicates).toBeGreaterThan(0)
    })
  })

  it('remembering what was done turns the repeats into no-ops', () => {
    each(crashy('after', true), 40, (bus) => {
      expect(bus.tally.lost.stock).toBe(0)
      expect(bus.tally.duplicates).toBe(0)
      expect(bus.tally.ignored).toBeGreaterThan(0)
    })
  })
})
