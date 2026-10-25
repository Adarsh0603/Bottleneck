import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: which channels, how many messages a day, which kinds are urgent, whether a message may be sent twice, whether users can opt out.',
    'Estimate: 10M users at 3 a day is about 350 a second. A blast to everyone in an hour is about 2,800 a second, and that sets the design.',
    'Intake: validate, put the message on a queue, answer at once. The send happens later, so a slow provider never slows the caller.',
    'Priority: a lane per kind, urgent first. A login code never waits behind a campaign.',
    'Providers: pace sends under each provider’s rate limit. Retry failures with growing pauses, park what runs out of tries in a dead-letter queue.',
    'Repeats: give each message an id and remember what has been sent, so a retry after a lost answer never sends twice.',
  ],
  cards: [
    { title: 'The numbers', body: '10M users at 3 messages a day is about 350 a second. A one-hour blast to all of them is about 2,800 a second. Size for the blast.' },
    { title: 'Lanes', body: 'Give each kind of message its own lane and serve the urgent lane first. Cap each lane so it cannot starve the rest forever.' },
    { title: 'Retry safely', body: 'Retry with pauses that double. A retry after a lost answer sends twice, so pair retries with a dedupe store or an idempotency key.' },
    { title: 'Dead letters', body: 'When the tries run out, park the message in a dead-letter queue. It can be inspected and replayed once the provider is back.' },
  ],
}
