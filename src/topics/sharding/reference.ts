import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Replicas scale reads; sharding scales writes and storage, by splitting the data across several databases.',
    'Choose the shard key from your access pattern: the queries you run most should hit one shard.',
    'A key that groups busy data (signup date, first letter, one big customer) makes a hot spot. Hash the key to spread it evenly.',
    'One very hot key (a celebrity) can’t be split by any shard key. Cache it, or split that key across shards.',
    'A dead shard takes down only its own users. Give each shard replicas so it can fail over.',
  ],
  cards: [
    {
      title: 'Range vs hash',
      body: 'Range sharding keeps nearby keys together, so range scans are cheap, but it invites hot spots. Hash sharding spreads load evenly but loses ordering.',
    },
    {
      title: 'Queries across shards',
      body: 'A query that isn’t by the shard key (say, search all posts) has to ask every shard and wait for the slowest. Keep those rare, or keep a separate index.',
    },
    {
      title: 'Adding a shard',
      body: 'With hash % N, changing N moves almost every key. Consistent hashing moves only the new shard’s share. That’s the next topic.',
    },
    {
      title: 'Work across shards',
      body: 'Alice on shard 1 pays Bob on shard 2: one database transaction can’t cover both. Keep related data together, or use distributed transactions and sagas.',
    },
    {
      title: 'Real-world setups',
      body: 'MongoDB sharded clusters, Vitess for MySQL, Citus for PostgreSQL, DynamoDB and Cassandra partition keys.',
    },
  ],
}
