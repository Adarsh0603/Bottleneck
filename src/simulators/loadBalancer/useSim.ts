import { useCallback, useEffect, useRef, useState } from 'react'
import { LoadBalancerSim } from './engine'

export const TICKS_PER_SECOND = 20
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

// Rolling window for throughput and drop rate, so the numbers recover after
// you fix an overload instead of carrying the old failures forever.
const WINDOW_TICKS = TICKS_PER_SECOND * 3

export type SimHandle = ReturnType<typeof useSim>

// Requests per second a set of servers can sustain on average.
export function capacity(sim: LoadBalancerSim) {
  const avgWork = (sim.config.minWork + sim.config.maxWork) / 2
  return sim.servers
    .filter((s) => s.alive)
    .reduce((sum, s) => sum + (s.slots * s.speed * TICKS_PER_SECOND) / avgWork, 0)
}

// Owns one running simulation for a chapter. `setup` is re-run on reset, and
// always sees the chapter's latest state (algorithm, server size, ...).
export function useSim(setup: (sim: LoadBalancerSim) => void, initialRps: number) {
  const [rps, setRpsState] = useState(initialRps)
  const [running, setRunning] = useState(true)
  const [, setFrame] = useState(0)

  const setupRef = useRef(setup)
  setupRef.current = setup
  const rpsRef = useRef(rps)
  const simRef = useRef<LoadBalancerSim | null>(null)
  const history = useRef<{ completed: number; dropped: number }[]>([])

  const build = () => {
    const sim = new LoadBalancerSim({ requestsPerTick: rpsRef.current / TICKS_PER_SECOND })
    setupRef.current(sim)
    return sim
  }
  if (!simRef.current) simRef.current = build()

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const sim = simRef.current!
      sim.step()
      history.current.push({ completed: sim.stats.completed, dropped: sim.stats.dropped })
      if (history.current.length > WINDOW_TICKS + 1) history.current.shift()
      setFrame((f) => f + 1)
    }, MS_PER_TICK)
    return () => clearInterval(id)
  }, [running])

  const rerender = useCallback(() => setFrame((f) => f + 1), [])

  const setRps = useCallback((value: number) => {
    rpsRef.current = value
    setRpsState(value)
    simRef.current!.config.requestsPerTick = value / TICKS_PER_SECOND
  }, [])

  const reset = () => {
    simRef.current = build()
    history.current = []
    rerender()
  }

  const sim = simRef.current
  const h = history.current
  const first = h[0]
  const last = h[h.length - 1]
  const span = h.length - 1
  const completed = span > 0 ? last.completed - first.completed : 0
  const dropped = span > 0 ? last.dropped - first.dropped : 0

  return {
    sim,
    rps,
    setRps,
    running,
    setRunning,
    reset,
    rerender,
    throughput: span > 0 ? (completed * TICKS_PER_SECOND) / span : 0,
    dropRate: completed + dropped === 0 ? 0 : (dropped / (completed + dropped)) * 100,
    avgMs: sim.avgLatency() * MS_PER_TICK,
    p95Ms: sim.percentileLatency(95) * MS_PER_TICK,
  }
}
