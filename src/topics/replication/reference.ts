import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Most apps read far more than they write. Add read replicas to scale reads; every write still goes to one primary.',
    'Replication is usually asynchronous, so replicas lag. Say which reads can be slightly stale and which can’t.',
    'Read your own writes: send a user’s reads to the primary (or a caught-up replica) for a short time after they write.',
    'Failover: detect the dead primary, promote the most caught-up replica, point writes at it. Unshipped writes can be lost.',
    'Replicas don’t help with write load. For that, you shard: split the data across several primaries.',
  ],
  cards: [
    {
      title: 'Synchronous vs asynchronous',
      body: 'Synchronous: the primary waits for a replica to confirm before saying “saved”. No lost writes, but slower and blocked if the replica is down. Many systems keep one synchronous replica and the rest async.',
    },
    {
      title: 'Monotonic reads',
      body: 'Pin each user to one replica, so they never see data jump backward by hitting a replica that is further behind.',
    },
    {
      title: 'Split brain',
      body: 'If the old primary comes back still thinking it’s in charge, two primaries accept writes. Fencing and consensus prevent this.',
    },
    {
      title: 'Multi-leader and leaderless',
      body: 'Several nodes accept writes (across regions, or Dynamo-style quorums). Faster local writes, but conflicting writes must be resolved.',
    },
    {
      title: 'Real-world setups',
      body: 'PostgreSQL streaming replication, MySQL replicas, Amazon RDS and Aurora read replicas, MongoDB replica sets.',
    },
  ],
}
