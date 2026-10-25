import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: pages a month, how fresh they must be, which kinds of pages, whether to obey robots.txt, one machine or many.',
    'Estimate: 1 billion pages a month is about 400 a second. At 500 KB each that is about 200 MB a second and about 500 TB a month.',
    'Loop: seeds go into a frontier, fetchers download and parse, every link goes through a seen-set and back onto the frontier.',
    'Seen-set: a Bloom filter at about 12 bits per URL, since 20,000 checks a second must come from memory.',
    'Manners: one timer per site, so send every URL of a site to the same fetcher with consistent hashing. Read robots.txt first.',
    'Failures: keep an address on the frontier until its page is saved. Cap pages per site to escape endless sites.',
  ],
  cards: [
    { title: 'The numbers', body: '1 billion pages a month is about 400 a second. At 500 KB that is about 200 MB a second, and about 500 TB a month. Each page has about 50 links, so about 20,000 seen-checks a second.' },
    { title: 'The loop', body: 'Seeds → seen-set → frontier → fetcher → page store. Every link on a fetched page goes back through the seen-set. The crawl feeds itself.' },
    { title: 'Bloom filter', body: 'It may call a new page “seen”, never the other way round. A page skipped by mistake is usually found through another link. About 12 bits per URL keeps mistakes rare.' },
    { title: 'Be polite', body: 'Wait between visits to one site, read robots.txt, and give each site to one fetcher so one timer sees every visit. A hash ring keeps that true when a fetcher dies.' },
    { title: 'Traps and crashes', body: 'Endless sites invent pages forever, so cap pages per site. Fetchers die, so the frontier keeps an address until its page is saved.' },
  ],
}
