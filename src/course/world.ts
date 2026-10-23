// Where everything stands on the grid floor. Shared by the 3D and isometric
// renderers so both show exactly the same world.
//
// x runs users → load balancer → servers, y is up, z spreads servers apart.

import type { LoadBalancerSim, Server, Transit } from '../simulators/loadBalancer/engine'

export type V3 = [number, number, number]

export const USERS_X = -6.5
export const LB_X = -2
export const SERVER_X = 3.5
export const STANDBY_Z = 1.9

export const BASE = { w: 1.5, h: 2, d: 1.5 }
export const LB_SIZE = { w: 1.4, h: 0.5, d: 1.4 }
export const CUBE = 0.24
export const SLOT = 0.34
export const FLY_Y = 0.6
export const QUEUE_GAP = 0.32
export const SPACING = 2.3
export const PATH_START = USERS_X + 1.1
export const FALL_SECONDS = 1.4

// A machine twice as powerful is drawn with twice the volume.
export const scaleOf = (speed: number) => Math.cbrt(speed)

export const serverZ = (index: number, count: number) => (index - (count - 1) / 2) * SPACING

export const serverFront = (speed: number) => SERVER_X - (BASE.w * scaleOf(speed)) / 2

export const lbZ = (failover: boolean) => (failover ? STANDBY_Z : 0)

// Spot `k` in the line of requests waiting in front of server `index`.
export function queueSpot(speed: number, index: number, count: number, k: number): V3 {
  return [serverFront(speed) - 0.3 - k * QUEUE_GAP, CUBE / 2, serverZ(index, count)]
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const hop = (t: number) => FLY_Y + Math.sin(t * Math.PI) * 0.3

// Where a request in flight is, `p` of the way through its journey.
export function transitPoint(sim: LoadBalancerSim, t: Transit, p: number, lbz: number): V3 | null {
  const count = sim.servers.length
  const index = sim.servers.findIndex((s) => s.id === t.serverId)
  if (index < 0) return null
  const endX = serverFront(sim.servers[index].speed) - 0.15
  const endZ = serverZ(index, count)
  const jitter = (((t.job.id * 37) % 7) - 3) * 0.05

  if (sim.algorithm === 'direct') {
    return [lerp(PATH_START, endX, p), hop(p), lerp(jitter, endZ + jitter, p)]
  }
  if (p < 0.5) {
    const q = p * 2
    return [lerp(PATH_START, LB_X - LB_SIZE.w / 2, q), hop(q), lerp(jitter, lbz, q)]
  }
  const q = (p - 0.5) * 2
  return [lerp(LB_X + LB_SIZE.w / 2, endX, q), hop(q), lerp(lbz, endZ + jitter, q)]
}

// Where a dropped request starts falling from: the end of its server's line,
// or the users if no server would take it.
export function dropOrigin(sim: LoadBalancerSim, serverId: number | undefined): V3 {
  const index = serverId === undefined ? -1 : sim.servers.findIndex((s) => s.id === serverId)
  if (index < 0) return [PATH_START, FLY_Y, 0]
  const [x, , z] = queueSpot(sim.servers[index].speed, index, sim.servers.length, sim.config.queueLimit)
  return [x, FLY_Y, z]
}

export function dropPoint(origin: V3, age: number, jobId: number): V3 {
  const side = jobId % 2 === 0 ? 1 : -1
  return [origin[0] - age * 0.6, origin[1] + age * 1.2 - 5 * age * age, origin[2] + side * (0.15 + age * 0.9)]
}

export const isOverloaded = (server: Server, queueLimit: number) =>
  server.alive && server.queue.length >= queueLimit * 0.75

export const isIdle = (sim: LoadBalancerSim, server: Server) =>
  server.alive &&
  server.active.length + server.queue.length === 0 &&
  !sim.inTransit.some((t) => t.serverId === server.id)
