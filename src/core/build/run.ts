import type { FlowSim } from '../flow/engine'
import { Worker } from '../flow/nodes'
import type { BuildMetrics } from './types'

export const TICKS_PER_SECOND = 20
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND
const WINDOW = TICKS_PER_SECOND * 3

interface Sample {
  completed: number
  dropped: number
  busy: Record<string, number>
}

// A built system ticking along, with rolling numbers over the last few
// seconds so they recover once the build is fixed.
export class Running {
  readonly flow: FlowSim
  private history: Sample[] = []

  constructor(flow: FlowSim) {
    this.flow = flow
  }

  step() {
    this.flow.step()
    const busy: Record<string, number> = {}
    for (const node of this.flow.all()) {
      if (node instanceof Worker) busy[node.key] = node.alive ? node.active.length / node.slots : 0
    }
    this.history.push({ completed: this.flow.stats.completed, dropped: this.flow.stats.dropped, busy })
    if (this.history.length > WINDOW + 1) this.history.shift()
  }

  metrics(): BuildMetrics {
    const h = this.history
    if (h.length < 2) return { dropRate: 0, avgMs: 0, busy: {}, busiest: 0 }
    const completed = h[h.length - 1].completed - h[0].completed
    const dropped = h[h.length - 1].dropped - h[0].dropped
    const busy: Record<string, number> = {}
    for (const key of Object.keys(h[h.length - 1].busy)) {
      busy[key] = h.slice(1).reduce((sum, s) => sum + (s.busy[key] ?? 0), 0) / (h.length - 1)
    }
    return {
      dropRate: completed + dropped === 0 ? 0 : (dropped / (completed + dropped)) * 100,
      avgMs: this.flow.avgLatency() * MS_PER_TICK,
      busy,
      busiest: Math.max(0, ...Object.values(busy)),
    }
  }
}
