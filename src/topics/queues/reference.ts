import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Use a queue when work is slow, bursty or can happen later. The app says “got it” at once and workers do the job in the background.',
    'A queue absorbs bursts, but it only delays the problem: if jobs arrive faster than workers finish them, the backlog grows until it is full. Watch queue depth and the age of the oldest message.',
    'Scale consumers to match the arrival rate. Add workers when the backlog grows, and remove them when it drains.',
    'Delivery is at-least-once: a failed or unacknowledged message is delivered again, so the same job can run twice. Make jobs idempotent.',
    'Retry with backoff, then park what keeps failing in a dead-letter queue. Alert on it and look at it, rather than losing messages silently.',
  ],
  cards: [
    {
      title: 'Queue vs pub/sub',
      body: 'A queue gives each message to one worker. Pub/sub gives every message to every subscriber. Use a queue to share work and pub/sub to broadcast events.',
    },
    {
      title: 'Ordering',
      body: 'A single queue with a single consumer keeps order. Many consumers do not. To keep related messages in order, route by a key so they always reach the same consumer (partitions in Kafka, message groups in SQS FIFO).',
    },
    {
      title: 'Backpressure',
      body: 'A bounded queue pushes back when full: reject new work, slow the producers, or shed load. An unbounded queue just moves the failure to memory or to very late answers.',
    },
    {
      title: 'Acknowledgements and visibility',
      body: 'A worker acknowledges a message only after the job succeeds. Until then the broker hides it, and if no acknowledgement comes in time it is delivered again. Set the timeout longer than the job.',
    },
    {
      title: 'Real-world setups',
      body: 'Amazon SQS, RabbitMQ, Google Pub/Sub and Apache Kafka. Background-job libraries such as Sidekiq, Celery and BullMQ build on a queue like these.',
    },
  ],
}
