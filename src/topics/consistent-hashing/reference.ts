import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'hash(key) % N works until N changes: then almost every key maps to a new server, and a cache goes cold all at once.',
    'Consistent hashing puts servers and keys on a ring. A key belongs to the first server clockwise, so adding or removing a server moves only about 1/N of the keys.',
    'With one spot per server the slices are uneven. Give each server many virtual nodes (100+) so the load averages out.',
    'Virtual nodes also spread a dead server’s keys across all the survivors, not just its one neighbour.',
    'You can weight servers: a bigger machine takes more virtual nodes.',
  ],
  cards: [
    {
      title: 'Why a cold cache hurts',
      body: 'Moved keys miss the cache and hit the database together. A big enough stampede can take the database down, which is the real cost of reshuffling.',
    },
    {
      title: 'Replicas on the ring',
      body: 'To survive a loss, store each key on the next few servers clockwise. Dynamo and Cassandra do this.',
    },
    {
      title: 'Rendezvous hashing',
      body: 'Another way to move few keys: every server scores each key, and the highest score wins. No ring, but each lookup checks every server.',
    },
    {
      title: 'Jump hash',
      body: 'A tiny function that maps a key to one of N numbered buckets and moves few keys when N grows. It can only add or remove the last bucket.',
    },
    {
      title: 'Real-world setups',
      body: 'Amazon Dynamo, Cassandra, Memcached client libraries, Envoy’s ring hash load balancing, and Akamai’s original CDN.',
    },
  ],
}
