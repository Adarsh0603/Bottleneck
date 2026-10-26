import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Fan-out is one event reaching many recipients. A news feed is the classic case: a post by one account must show up in the feed of every follower. The same idea sits behind push notifications, group chat, webhooks and pub/sub.',
    'Fan-out on read (pull) does nothing when a post is made. When a user opens the app, the server looks up the newest posts of every account they follow and merges them. Posting is one cheap write. Reading costs one lookup per followed account, so it gets slow as the follow count grows.',
    'Fan-out on write (push) copies each post into a feed or inbox for every follower when it is made, usually through a queue and a pool of workers. Reading is then one lookup in the reader’s own inbox, which is fast. Posting costs one write per follower. Since feeds are read far more often than they are written, this is the common choice.',
    'The celebrity problem breaks push. An account with millions of followers turns one post into millions of writes. The queue backs up and posts from everyone else are delayed behind it. Most of those followers are inactive, so much of the work is wasted.',
    'The usual answer is a hybrid. Push for accounts below a follower threshold, such as a few hundred thousand. For accounts above it, do not push. When a user opens the app, merge their inbox with a lookup of the celebrities they follow. This is how Twitter and Instagram are described to work.',
    'Practical details: cap each inbox at a few hundred to a few thousand entries and drop the oldest. Store post IDs in the inbox, not the posts, and fetch the posts from a cache. Sort by time or a ranking score on read, since copies can arrive out of order. Skip inboxes of inactive users and rebuild their feed by pull when they return.',
    'Choose by the ratio of reads to writes and by follower counts. Small system: pull is simplest. Many readers and moderate follower counts: push. A mix of normal and huge accounts: hybrid. Say what the read and write rates are, and where the follower threshold sits.',
  ],
  cards: [
    {
      title: 'Fan-out on read',
      body: 'Build the feed when it is opened: one lookup per followed account, then merge. Cheap to post, slow to read. Fine for small apps.',
    },
    {
      title: 'Fan-out on write',
      body: 'Copy each post into every follower’s inbox when it is made. Fast reads, one lookup. Costly posts: one write per follower, done through a queue and workers.',
    },
    {
      title: 'Celebrity problem',
      body: 'One post from an account with millions of followers means millions of writes. The queue backs up and everyone else’s posts are late. Most of those followers are idle anyway.',
    },
    {
      title: 'Hybrid',
      body: 'Push for normal accounts. For accounts over a follower threshold, skip the push and look them up on open, then merge with the inbox. Reads stay cheap and posts stay fast.',
    },
    {
      title: 'Keep inboxes small',
      body: 'Cap each inbox and drop the oldest. Store post IDs, not whole posts. Skip users who have been away, and build their feed by pull when they return. Sort by time on read.',
    },
    {
      title: 'In the real world',
      body: 'Twitter and Instagram are described as push for most accounts and pull for celebrities. The same pattern appears in notifications, group chat, webhooks and pub/sub.',
    },
  ],
}
