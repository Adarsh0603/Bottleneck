import type { LoadBalancerSim } from './engine'
import { TICKS_PER_SECOND } from './useSim'
import type { CourseState } from './types'

// Make the simulation match the state the current beat and controls describe.
export function syncSim(sim: LoadBalancerSim, st: CourseState) {
  while (sim.servers.length > st.servers.length) sim.removeServer(sim.servers[sim.servers.length - 1].id)
  st.servers.forEach((speed, i) => {
    const server = sim.servers[i] ?? sim.addServer(speed)
    server.speed = speed
  })
  sim.algorithm = st.balancer ? st.algorithm : 'direct'
  sim.servers.forEach((s, i) => sim.setAlive(s.id, !st.down.includes(i)))
  sim.config.requestsPerTick = st.rps / TICKS_PER_SECOND
}
