import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'A Bloom filter answers “is this item in the set?” using very little memory. It is an array of m bits, all zero at the start, and k hash functions. To add an item, hash it k times and set those k bits. To check an item, hash it the same way. If any bit is 0, the item is definitely not in the set. If all k bits are 1, it is probably in the set.',
    'It has false positives but never false negatives. A “yes” may be wrong, because other items can have set the same bits. A “no” is always right, because an added item always leaves its own bits set. The false-positive rate depends on m, k and n, the number of items added.',
    'The rate is about (1 − e^(−kn/m))^k. For a target rate p, the best size is m ≈ −n·ln(p) / (ln 2)² bits, and the best number of hashes is k ≈ (m/n)·ln 2. In practice that is about 10 bits per item and 7 hashes for a 1% rate, and about 15 bits per item for 0.1%. Each extra 4.8 bits per item cuts the rate by ten.',
    'Size it for the number of items you expect. A well-tuned filter has about half its bits set when full, and past that the rate climbs quickly. A filter that outgrows its size must be rebuilt bigger, or replaced by a scalable Bloom filter that chains filters together.',
    'You cannot delete from a plain Bloom filter, because clearing an item’s bits can clear bits other items share and create false negatives. A counting Bloom filter keeps a small counter per position instead of a bit: add increments, delete decrements. It costs about four times the memory. The usual alternative is to rebuild the filter on a schedule.',
    'A Bloom filter does not store the items, so you cannot list them or read them back. Use it as a cheap first check in front of something slower and exact. A “no” skips the slow call. A “maybe” goes to the real store, so correctness never depends on the filter.',
    'It pays off when most lookups are for items that are absent, the real check is expensive, and the set mostly grows. It does not help when most lookups are for items that exist, since nearly every check ends in “maybe”. Cuckoo filters and XOR filters are alternatives that support deletion or use less space.',
  ],
  cards: [
    {
      title: 'The idea',
      body: 'A row of bits and a few hash functions. Add: set k bits. Check: are all k bits set? Any zero means definitely not. All ones means maybe.',
    },
    {
      title: 'One-sided errors',
      body: 'Never a false negative, sometimes a false positive. So “no” can be trusted and “yes” needs confirming. Always put the real store behind it.',
    },
    {
      title: 'Sizing',
      body: 'About 10 bits per item and 7 hashes gives about 1% false positives. 15 bits per item gives about 0.1%. Too few bits and the filter fills up and says “maybe” to everything.',
    },
    {
      title: 'No deleting',
      body: 'Clearing bits breaks other items that share them. Use a counting filter (counters instead of bits, about 4x the memory), or rebuild on a schedule, or choose a cuckoo filter.',
    },
    {
      title: 'Cost',
      body: 'A billion items at a 1% rate fit in about 1.2 GB. Checks and adds take k hash computations and k memory reads, so they are fast and do not depend on how many items are stored.',
    },
    {
      title: 'In the real world',
      body: 'LSM-tree databases such as Cassandra, HBase and RocksDB keep a filter per file to skip disk reads. Browsers check links against bad-site lists. Crawlers track visited URLs. CDNs avoid caching one-hit wonders. Sign-up forms check usernames. Medium used one to skip articles a reader had already seen.',
    },
  ],
}
