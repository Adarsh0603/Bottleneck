import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Add a cache when reads heavily outnumber writes and the same data is read again and again.',
    'Name the pattern: cache-aside (app reads cache, falls back to the database, then fills the cache) is the default.',
    'Say how entries leave: a TTL for freshness, LRU eviction for size.',
    'Plan for a cold or crashed cache: the database must survive the miss storm, or warm the cache first.',
    'Protect hot keys from stampedes: request coalescing, a lock per key, or refreshing early before expiry.',
  ],
  cards: [
    {
      title: 'Write strategies',
      body: 'Write-through updates cache and database together (consistent, slower writes). Write-back writes to the cache and flushes later (fast, can lose data). Write-around skips the cache on writes.',
    },
    {
      title: 'Invalidation',
      body: 'On a write, delete the cached item so the next read refetches it. Deleting is safer than updating in place, which can race with other writers.',
    },
    {
      title: 'Where caches live',
      body: 'In the browser, at a CDN, in the app process, or as a shared cache like Redis or Memcached. Each layer is faster but less shared than the next.',
    },
    {
      title: 'Eviction policies',
      body: 'LRU drops the least recently used. LFU drops the least frequently used, better when popularity is stable. TTL alone suits data that simply goes out of date.',
    },
    {
      title: 'Hot keys',
      body: 'One very popular key can overload a single cache node. Replicate it across nodes, or keep a small local copy in each app server.',
    },
  ],
}
