import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: readers and tweets per day, how fresh a timeline must be, how it is ordered, whether tweets can be edited or deleted, whether there are celebrities.',
    'Estimate: 300 million readers opening 10 times a day is about 35,000 opens a second. 500 million tweets a day is about 5,800 a second. With 200 followers each, that is about 1.2 million timeline writes a second.',
    'Two ways to build a timeline: look up every followed account when it opens, or write each tweet into its followers’ timelines when it is sent. Reads outnumber tweets, so write.',
    'Write for normal accounts. For a celebrity, write nothing and look the account up when the timeline opens, then merge. This is the hybrid.',
    'Timelines hold only tweet ids, in memory, sharded by reader: about 800 ids of 8 bytes each is 6.4 KB a reader, or about 1.9 TB for 300 million. The tweets themselves live in a tweet store.',
    'Edits and deletes change the tweet in one place. Every timeline shows the change the next time it is opened, because it only points at the tweet.',
    'Failures: a restarted cache is empty. Rebuild each lost timeline once, however many opens ask, and back off when the store is full.',
  ],
  cards: [
    { title: 'The numbers', body: '300 million readers × 10 opens a day is about 35,000 opens a second. 500 million tweets a day is about 5,800 a second. With 200 followers each, writing into timelines costs about 1.2 million writes a second. Timelines of 800 ids for every reader fit in about 1.9 TB of memory.' },
    { title: 'Two paths, one cache', body: 'A tweet is written into the timelines of its followers. A reader opens their own timeline. Both touch the same cache, so a burst of tweets slows the opens, and a burst of opens slows the writes. Size the cache for both together.' },
    { title: 'Ids, not copies', body: 'If a timeline holds a full copy of each tweet, an edit or a delete must find and rewrite every copy: one write per follower. If it holds only the id, the tweet changes in one place. The price is that every open fetches the tweets it shows.' },
    { title: 'The celebrity merge', body: 'One tweet by someone with 50 million followers is 50 million writes. So write normal accounts into timelines and look celebrities up when a timeline opens, then merge the two. Where to draw the line is a setting to tune.' },
    { title: 'The restart cascade', body: 'A cache machine restarts empty. Every reader it served now misses, and each miss reads the store to rebuild. If every open rebuilds on its own, the store is flooded, some lookups are turned away, readers try again at once, and the retries flood it more. Rebuild each timeline once and let the other opens wait for it. Spread the timelines over more caches, and a restart loses less.' },
  ],
}
