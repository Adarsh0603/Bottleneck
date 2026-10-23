import type { LoadBalancerSim } from '../simulators/loadBalancer/engine'
import type { Beat } from './types'
import { isIdle, isOverloaded } from './world'

export interface TagSpec {
  label: string
  danger?: boolean
  at?: 'top' | 'queue' | 'end' // above the server, over its queue, past the queue's end
}

// Which labels to pin where, for the current beat. Both renderers use this.
export function buildTags(sim: LoadBalancerSim, beat: Beat) {
  const on = new Set(beat.tags ?? [])
  const limit = sim.config.queueLimit
  const firstOverloaded = sim.servers.findIndex((s) => isOverloaded(s, limit))

  const servers = sim.servers.map((server, i) => {
    const tags: TagSpec[] = []
    if (!server.alive) tags.push({ label: 'Down', danger: true })
    if (i === 0 && on.has('server')) tags.push({ label: 'Server' })
    if (i === 0 && on.has('workers')) tags.push({ label: `${server.slots} workers` })
    if (i === 0 && on.has('spof')) tags.push({ label: 'Single point of failure', danger: true })
    if (on.has('slow') && server.speed < 1) tags.push({ label: 'Half speed' })
    if (on.has('idle') && isIdle(sim, server)) tags.push({ label: 'Idle' })
    if (i === 0 && on.has('queue')) {
      tags.push({ label: `Queue · ${server.queue.length}/${limit}`, danger: isOverloaded(server, limit), at: 'queue' })
    }
    if (i === firstOverloaded && on.has('dropped')) tags.push({ label: 'Dropped', danger: true, at: 'end' })
    return tags
  })

  return {
    users: on.has('users'),
    lb: on.has('lbspof')
      ? { label: 'Single point of failure', danger: true }
      : on.has('lb')
        ? { label: 'Load balancer' }
        : undefined,
    standby: on.has('standby') ? { label: 'Standby' } : undefined,
    servers,
  }
}
