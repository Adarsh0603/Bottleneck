import { ArrowIcon, Chip, ClockIcon, CoinIcon, CrossIcon, GaugeIcon, HeartIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import { monthlyCost } from './chapters'
import type { LoadBalancerSim } from './engine'
import type { Beat, CourseState, HudId, Metrics } from './types'
import { capacity } from './useSim'

export default function Stats({ beat, st, sim, m }: PanelProps<CourseState, LoadBalancerSim, Metrics, Beat>) {
  return (
    <>
      {(beat.hud ?? []).map((id) => (
        <Stat key={id} id={id} st={st} sim={sim} m={m} />
      ))}
    </>
  )
}

function Stat({ id, st, sim, m }: { id: HudId; st: CourseState; sim: LoadBalancerSim; m: Metrics }) {
  const limit = sim.config.queueLimit
  switch (id) {
    case 'traffic':
      return <Chip icon={<ArrowIcon />} title="Traffic" value={`${st.rps} req/s`} />
    case 'latency':
      return <Chip icon={<ClockIcon />} title="Response time" value={`${(m.avgMs / 1000).toFixed(1)}s`} bad={m.avgMs > 2500} />
    case 'queue': {
      const longest = Math.max(0, ...sim.servers.map((s) => s.queue.length))
      return <Chip icon={<StackIcon />} title="Queue" value={`${longest} / ${limit}`} bad={longest >= limit * 0.75} />
    }
    case 'dropped':
      return <Chip icon={<CrossIcon />} title="Errors" value={`${m.dropRate.toFixed(0)}%`} bad={m.dropRate > 1} />
    case 'capacity': {
      const cap = capacity(sim)
      return <Chip icon={<GaugeIcon />} title="Capacity" value={`${cap.toFixed(1)} req/s`} bad={cap < st.rps} />
    }
    case 'cost':
      return <Chip icon={<CoinIcon />} title="Cost" value={`$${monthlyCost(st)}/mo`} />
    case 'healthy': {
      const alive = sim.servers.filter((s) => s.alive).length
      return (
        <Chip icon={<HeartIcon />} title="Healthy servers" value={`${alive} / ${sim.servers.length}`} bad={alive < sim.servers.length} />
      )
    }
  }
}
