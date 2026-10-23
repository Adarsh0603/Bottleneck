import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Put static files (images, video, JS, CSS) on a CDN so users fetch them from a nearby edge.',
    'Say how content gets there: pull (edges fetch on the first miss) or push (you upload ahead of time).',
    'Cover freshness: cache headers and TTLs, versioned file names, and purging when something must change now.',
    'Mention that a CDN also takes load off your origin and absorbs traffic spikes.',
    'Dynamic, per-user responses usually skip the CDN, or get very short TTLs.',
  ],
  cards: [
    {
      title: 'Versioned file names',
      body: 'Name files by their content (app.3f9a.js). A new version gets a new name, so you can cache forever and never need a purge.',
    },
    {
      title: 'Anycast and GeoDNS',
      body: 'Users reach the nearest edge because DNS or the network routes them there by location.',
    },
    {
      title: 'Origin shield',
      body: 'A middle cache layer between edges and the origin, so a burst of edge misses becomes one request to the origin.',
    },
    {
      title: 'Edge compute',
      body: 'Some CDNs run small bits of code at the edge: redirects, auth checks, A/B tests, close to the user.',
    },
    {
      title: 'Real-world CDNs',
      body: 'Cloudflare, Akamai, Fastly, Amazon CloudFront, Google Cloud CDN.',
    },
  ],
}
