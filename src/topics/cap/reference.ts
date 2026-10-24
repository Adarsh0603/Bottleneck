import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'CAP: when the network partitions, a replicated system must choose between consistency (refuse or wait) and availability (answer, maybe with old data). Partitions will happen, so the real choice is only what to give up while one lasts.',
    'Without a partition you can have both. The trade-off is only forced during one, so say what each part of your system does then.',
    'Pick per use case: money and inventory lean consistent (a wrong balance is worse than an error); feeds, likes and carts lean available (an old page is better than none).',
    'Consistent here means linearizable: every read sees the latest write. Available means every request to a working node gets an answer, not necessarily the latest.',
    'After a partition heals, available systems must reconcile conflicting writes: last write wins, merge, or ask the user.',
  ],
  cards: [
    {
      title: 'CP vs AP',
      body: 'CP systems (ZooKeeper, etcd, HBase, most single-leader SQL setups) refuse requests on the cut-off side. AP systems (Cassandra, DynamoDB defaults, Riak) keep answering and reconcile later.',
    },
    {
      title: 'PACELC',
      body: 'Even with no partition there is a trade-off: lower latency or stronger consistency. Waiting for every replica to confirm is safe and slow.',
    },
    {
      title: 'Conflict resolution',
      body: 'Last write wins (simple, can lose data), version vectors (detect concurrent writes), CRDTs (merge automatically), or application logic.',
    },
    {
      title: 'Tunable consistency',
      body: 'Quorum reads and writes (R + W > N) let a system pick its place on the spectrum per request. A later topic covers them.',
    },
    {
      title: 'Common mistake',
      body: '“CA” systems do not exist across a network. A single node is trivially consistent and available, until it fails.',
    },
  ],
}
