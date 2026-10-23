import type { BaseBeat, Chapter } from '../../core/types'
import type { Algorithm, LoadBalancerSim } from './engine'

// Everything a beat or a control can change about the system on screen.
export interface CourseState {
  rps: number
  servers: number[] // speed of each server, in order
  balancer: boolean
  algorithm: Algorithm // used when the balancer is on
  down: number[] // indexes of crashed servers
  standby: boolean // a passive second load balancer is shown
  failover: boolean // the active load balancer died; the standby took over
}

export interface Metrics {
  dropRate: number
  avgMs: number
  p95Ms: number
  throughput: number
}

export type TagId =
  | 'server'
  | 'workers'
  | 'queue'
  | 'dropped'
  | 'users'
  | 'lb'
  | 'idle'
  | 'slow'
  | 'spof'
  | 'lbspof'
  | 'standby'
  | 'ceiling'

export type HudId = 'traffic' | 'latency' | 'queue' | 'dropped' | 'capacity' | 'cost' | 'healthy'

export type ControlId = 'traffic' | 'size' | 'servers' | 'balancer' | 'algorithm'

// A load-balancing beat: the shared beat plus what this topic's scene,
// stats and controls understand.
export interface Beat extends BaseBeat<CourseState, LoadBalancerSim, Metrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
  clickCrash?: boolean
  ghost?: boolean
  pulses?: boolean
}

export type LbChapter = Chapter<CourseState, Beat>
