import { useMemo } from 'react'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import type { LoadBalancerSim } from './engine'
import { ADVANCED, INTERVIEW } from './reference'
import Scene from './Scene'
import Stats from './Stats'
import { syncSim } from './sync'
import type { Beat, CourseState, Metrics } from './types'
import { useSim } from './useSim'

function useRuntime(stRef: { current: CourseState }, paused: boolean): Runtime<LoadBalancerSim, Metrics> {
  const s = useSim((sim) => syncSim(sim, stRef.current), stRef.current.rps, paused)
  const { dropRate, avgMs, p95Ms, throughput } = s
  const metrics = useMemo(() => ({ dropRate, avgMs, p95Ms, throughput }), [dropRate, avgMs, p95Ms, throughput])
  return { sim: s.sim, simRef: s.simRef, lastTickAt: s.lastTickAt, metrics, tick: s.sim.tick }
}

export const loadBalancing: TopicSpec<CourseState, LoadBalancerSim, Metrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: syncSim,
  Scene,
  Stats,
  Controls,
  feedback: (prev, next) => ({
    crash: next.down.length > prev.down.length || (next.failover && !prev.failover),
    rise: next.servers.length > prev.servers.length || (next.balancer && !prev.balancer) || (next.standby && !prev.standby),
  }),
  dropCount: (sim) => sim.stats.dropped,
  reference: { interview: INTERVIEW, cards: ADVANCED },
}
