import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: readers and posts per day, how fresh a feed must be, how it is ordered, whether there are celebrities, images or video.',
    'Estimate: 500 million readers opening 10 times a day is about 58,000 opens a second. 100 million posts a day is about 1,200 a second.',
    'Two ways to build a feed: look up every followed account when it opens (12 million lookups a second), or copy each post into its followers’ inboxes (240,000 writes a second).',
    'Copy for normal accounts. For a celebrity, copy nothing and look the account up when the feed opens. This is the hybrid.',
    'Shape: post service, queue, fan-out workers, a sharded feed store, a feed cache, and a feed server that merges inbox and celebrities.',
    'Failures: a cold cache floods the store. A queue absorbs bursts of posts. Skipping idle followers saves writes but slows their return.',
  ],
  cards: [
    { title: 'The numbers', body: '500 million readers × 10 opens a day is about 58,000 opens a second. 100 million posts a day is about 1,200 a second. With 200 followers each, copying costs about 240,000 writes a second. Looking up 200 accounts per open costs 12 million lookups a second.' },
    { title: 'Fan-out on write', body: 'When a post is made, copy it into each follower’s inbox. Opening the app is then one lookup. Posts are slower to arrive, but reads vastly outnumber posts, so this wins.' },
    { title: 'Fan-out on read', body: 'Copy nothing. When a feed opens, look up every account the reader follows and merge. Posts show at once, but every open is expensive. It suits rare readers and celebrities.' },
    { title: 'The celebrity problem', body: 'One post by someone with 50 million followers is 50 million writes. Everyone behind that post waits. So copy normal accounts, and look celebrities up when a feed opens. Where to draw the line is a choice: look up too many accounts and every open is costly, copy too many and the workers drown.' },
    { title: 'Queue and cache', body: 'A queue holds posts while workers catch up, so none is lost in a burst. A cache answers most opens without the store, and hides the rush. When it dies, every open lands on the store at once.' },
  ],
}
