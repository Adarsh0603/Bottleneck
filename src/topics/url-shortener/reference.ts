import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: new links per day, redirects per link, how long codes live, whether links expire, whether clicks are counted.',
    'Estimate: 1M new links a day is about 12 a second. At 100 reads per write that is about 1,200 redirects a second. Five years is around 1 TB.',
    'Codes: give each app server its own range, so two servers never hand out the same code. A hash works too, with a check.',
    'Reads: a cache in front of the database, because a few links get most of the traffic. Then read replicas for what misses.',
    'Clicks: put them on a queue so a redirect never waits to be counted.',
    'Abuse: rate limit link creation per client, never redirects.',
  ],
  cards: [
    { title: 'The numbers', body: '1M new links a day is about 12 a second. 100 reads per write is about 1,200 redirects a second. Five years at 500 bytes is about 1 TB.' },
    { title: 'Unique codes', body: 'A shared counter clashes across servers. Give each server its own key range, or use a random hash and check it is free first.' },
    { title: '301 or 302', body: 'A 301 is cached by browsers, so fewer requests reach you but you cannot count clicks. A 302 reaches you every time.' },
    { title: 'Scaling order', body: 'Cache first, then app servers behind a balancer, then read replicas, and shard by code only when the data outgrows one machine.' },
  ],
}
