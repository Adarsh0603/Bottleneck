import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { ReplicationMetrics, ReplicationSim } from './engine'
import type { Beat, ReplicationState } from './types'
import { HOT, LAG_OK } from './world'

const pct = (n: number) => (Number.isNaN(n) ? '—' : `${n < 10 && n > 0 ? n.toFixed(1) : Math.round(n)}%`)

export default function Stats({ beat, st, sim, m }: PanelProps<ReplicationState, ReplicationSim, ReplicationMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  const leaderLoad = sim.leaderUp ? m.load[sim.leaderKey] : NaN
  const followers = sim.followers
  const replicaLoad = followers.length === 0 ? NaN : followers.reduce((sum, k) => sum + m.load[k], 0) / followers.length
  return (
    <>
      {hud.has('mix') && (
        <>
          <Chip icon={<ArrowIcon />} title="Reads" value={`${m.readsPerSec.toFixed(1)} /s`} />
          <Chip icon={<ArrowIcon />} title="Writes" value={`${m.writesPerSec.toFixed(1)} /s`} />
        </>
      )}
      {hud.has('replicas') && <Chip icon={<StackIcon />} title="Replicas" value={`${st.replicas}`} />}
      {hud.has('load') && (
        <>
          <Chip icon={<GaugeIcon />} title="Primary busy" value={sim.leaderUp ? pct(leaderLoad * 100) : 'Down'} bad={!sim.leaderUp || leaderLoad > HOT} />
          {followers.length > 0 && <Chip icon={<GaugeIcon />} title="Replicas busy" value={pct(replicaLoad * 100)} bad={replicaLoad > HOT} />}
        </>
      )}
      {hud.has('errors') && <Chip icon={<CrossIcon />} title="Errors" value={pct(m.errorRate)} bad={m.errorRate >= 1} />}
      {hud.has('lag') && <Chip icon={<ClockIcon />} title="Replication lag" value={`${st.lag}s`} bad={st.lag > LAG_OK} />}
      {hud.has('stale') && <Chip icon={<ClockIcon />} title="Stale reads" value={pct(m.staleRate)} bad={m.staleRate >= 5} />}
      {hud.has('own') && <Chip icon={<CrossIcon />} title="Own post missing" value={pct(m.ownStaleRate)} bad={m.ownStaleRate > 0} />}
      {hud.has('lost') && <Chip icon={<CrossIcon />} title="Lost writes" value={`${m.lostWrites}`} bad={m.lostWrites > 0} />}
    </>
  )
}
