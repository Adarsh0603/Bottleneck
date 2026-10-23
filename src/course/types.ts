import type { Algorithm, LoadBalancerSim } from '../simulators/loadBalancer/engine'
import type { V3 } from './world'

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

// Where the camera looks. `fit` zooms out further when there are many servers.
export interface Shot {
  target: V3
  zoom: number
  fit?: boolean
}

export interface Metrics {
  dropRate: number
  avgMs: number
  p95Ms: number
  throughput: number
}

export interface Challenge {
  goal: string
  win: string
  holdSeconds: number
  check: (ctx: { m: Metrics; st: CourseState; sim: LoadBalancerSim }) => boolean
}

// One step of a chapter: a single caption plus what the scene should do.
export interface Beat {
  caption: string
  sub?: string
  set?: Partial<CourseState>
  ramp?: { to: number; everyMs: number }
  shot?: Shot
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
  clickCrash?: boolean
  challenge?: Challenge
  ghost?: boolean
  pulses?: boolean
  sheet?: boolean
}

export interface Chapter {
  title: string
  level: 'Beginner' | 'Intermediate' | 'Advanced'
  initial: CourseState
  beats: Beat[]
}

export interface SceneProps {
  simRef: { current: LoadBalancerSim | null }
  lastTickAt: { current: number }
  st: CourseState
  beat: Beat
  shot: Shot
  shake: number
  onServerClick?: (index: number) => void
}
