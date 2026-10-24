import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'An operation is idempotent if doing it several times has the same effect as doing it once. It matters because networks lose messages. A client that gets no answer cannot tell whether the request was lost or only the reply was, so it must retry. Retries are only safe if repeats are harmless.',
    'Some operations are naturally idempotent: setting a value, deleting a row, PUT. Others are not: adding to a balance, sending an email, POST that creates something. For those, make the call idempotent with an idempotency key.',
    'The client generates a unique key for each logical operation, for example a UUID, and sends it with every try, retries included. The server stores the key with the result. When a request arrives with a known key, the server returns the stored result and does no work.',
    'Checking the key and then doing the work is not enough. Two identical requests can both pass the check before either saves the key. Claim the key in one atomic step before doing the work, for example with a unique constraint in the database. A request that loses the claim waits for the result or is told the first one is in progress.',
    'The work and the saved key must not come apart. If the server crashes between them, a retry either repeats the work or never finishes. Write the effect and the key in one transaction. If the effect lives in another system, pass the key on to it, so that system can deduplicate too.',
    'Exactly-once delivery is not possible over an unreliable network. What systems offer is at-least-once delivery plus idempotent processing, which has the same effect as exactly-once. Message queues redeliver until acknowledged, so a consumer should deduplicate by message id.',
    'Keep keys for long enough to cover every retry, often 24 hours, then expire them. Reject a reused key that arrives with a different request body, because it is almost always a bug. Return the original response, status code included, on a repeat.',
  ],
  cards: [
    {
      title: 'Why retries cannot be avoided',
      body: 'A timeout means “I do not know”, not “it failed”. The request may never have arrived, or may have run and lost its reply. Give up and you may drop work. Retry blindly and you may do it twice. Idempotency removes the dilemma.',
    },
    {
      title: 'Idempotency keys',
      body: 'One key per logical operation, created by the client, sent on every try. The server stores key → result. A repeat returns the stored result. Stripe, PayPal and AWS APIs use an Idempotency-Key header like this.',
    },
    {
      title: 'Check-then-act is a race',
      body: 'Looking up the key and saving it later leaves a gap that two parallel requests can both use. Claim the key atomically first: an insert into a table with a unique key, or a Redis SET with NX. Only one request wins.',
    },
    {
      title: 'Crashes between steps',
      body: 'A crash after the effect but before the key is saved breaks the guarantee. Save both in one transaction. A claim left “in progress” by a dead worker needs a timeout, so a retry can take it over.',
    },
    {
      title: 'Natural idempotency',
      body: 'Prefer operations that are safe by design: “set status to paid” rather than “add 50”, versioned writes, upserts. Use a key only where you cannot.',
    },
    {
      title: 'In the real world',
      body: 'Payment APIs, order systems and webhooks all deduplicate on a key or event id. Kafka offers idempotent producers and transactions, and SQS offers deduplication ids on FIFO queues. Either way, the consumer’s own writes still need to be idempotent.',
    },
  ],
}
