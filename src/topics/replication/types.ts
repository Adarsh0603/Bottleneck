import type { BaseBeat, Chapter } from '../../core/types'
import type { ReplicationMetrics, ReplicationSim } from './engine'

export type ReadFrom = 'replicas' | 'own' | 'primary'

export interface ReplicationState {
  rps: number
  replicas: number // read copies, 0–4
  lag: number // seconds for a change to reach the replicas
  // Where reads go: any replica; the primary when you read back your own
  // write (read-your-own-writes); or always the primary.
  readFrom: ReadFrom
  failed: boolean // the primary has died
  promoted: boolean // a replica has taken over as primary
}

export type TagId = 'users' | 'app' | 'dbs' | 'load' | 'stale' | 'lag'
export type HudId = 'mix' | 'load' | 'errors' | 'stale' | 'own' | 'lag' | 'replicas' | 'lost'
export type ControlId = 'replicas' | 'readFrom'

export interface Beat extends BaseBeat<ReplicationState, ReplicationSim, ReplicationMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type ReplicationChapter = Chapter<ReplicationState, Beat>
