import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Use pub/sub when one event matters to many independent services. The publisher does not know who listens, so you can add a subscriber without touching it.',
    'A queue shares work: each message goes to one consumer. A topic broadcasts: each subscriber gets its own copy. Many systems combine them, with a queue per subscriber behind a topic.',
    'A plain topic forgets. A subscriber that is offline or too slow misses messages. A stream (a log, such as Kafka or Kinesis) appends every event and keeps it for a retention period, so a consumer can fall behind, go offline, or replay from an earlier offset.',
    'Each consumer group tracks its own offset in every partition. Groups do not affect one another, and a new group can start from the beginning to rebuild a view of the data.',
    'A partition is the unit of parallelism and of order. Within a group, one consumer reads a partition at a time, so more consumers than partitions do nothing. Order holds only within a partition, so choose a key (the user, the order, the product) that sends related events to the same one.',
    'Delivery is at-least-once in practice. Commit the offset after the work is done, so a crash replays the event instead of losing it, and make the work idempotent (an event id, a dedupe table) so a replay does no harm. True exactly-once is built from these two.',
  ],
  cards: [
    {
      title: 'Queue vs topic vs stream',
      body: 'Queue: one consumer gets each message, and it is gone once handled. Topic: every subscriber gets a copy, and the message is not kept. Stream: an ordered log, kept for a while, and read by any number of consumers at their own pace.',
    },
    {
      title: 'Choosing a partition key',
      body: 'The key decides the partition, and a partition keeps order. Use the thing whose events must stay in order. A key with few values, or one value much hotter than the rest, leaves some partitions idle and others swamped.',
    },
    {
      title: 'Consumer groups',
      body: 'Consumers in one group split a topic’s partitions between them. Separate groups each get every event. To scale a group, add consumers up to the number of partitions, and add partitions before you need them, since changing the count later re-maps keys.',
    },
    {
      title: 'Retention and replay',
      body: 'Retention is a time or size limit on the log. Set it longer than your worst outage plus the time to catch up. Replay from an old offset to rebuild a cache, fix a bug in a consumer, or backfill a new service.',
    },
    {
      title: 'Backpressure and lag',
      body: 'Consumer lag (how far a group’s offset is behind the end of the log) is the number to alert on. A stream absorbs a slow consumer, but lag that keeps growing means add consumers, or the log will drop events when retention catches up.',
    },
    {
      title: 'Real-world setups',
      body: 'Apache Kafka, Amazon Kinesis and Redpanda are streams. Amazon SNS, Google Pub/Sub and Redis pub/sub are topics, and SNS with SQS gives a queue per subscriber. RabbitMQ has exchanges and queues for the same patterns.',
    },
  ],
}
