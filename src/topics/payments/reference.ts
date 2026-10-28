import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: orders per day and at the peak, which providers, refunds and partial payments, what a double charge costs, how long a shopper may wait.',
    'Estimate: 500,000 orders in a flash-sale hour is about 140 a second. At 300 ms a charge, about 40 calls are in flight. A 10 second outage piles up 1,400.',
    'Give every order one idempotency key, and keep a store of the keys that were charged. A double click, a retry and a replay are then the same charge.',
    'Wrap the provider call in a short timeout, up to 3 tries and a circuit breaker. While the breaker is open, queue the order and charge it later.',
    'Write the order down before charging. After a crash, finish what was written down. A reconciliation sweep compares charges with orders.',
    'Failures: a slow provider fills your slots, an unknown outcome must be asked about by key and never charged again, and a crash between the charge and the order is money with no order.',
  ],
  cards: [
    { title: 'The numbers', body: '500,000 orders an hour is about 140 a second. At 300 ms a charge, about 40 calls are open at once. If the provider takes 10 seconds, 1,400 are. One order in ten sent twice is 14 double charges a second.' },
    { title: 'Idempotency key', body: 'One key for the whole order, sent with every charge. The provider, or a store in front of it, remembers which keys were charged and answers a repeat without charging again. A key made for each click or try recognises nothing useful.' },
    { title: 'Timeout, retry, breaker', body: 'A short timeout stops one slow call from holding a slot. Retries fix blips, and are safe with a key. When calls keep failing, a breaker stops calling at once and tests the road now and then.' },
    { title: 'The order queue', body: 'While the provider cannot be reached, take the order, tell the shopper it is received, and charge it when the road opens. Nothing is lost, and checkout never waits on a dead provider.' },
    { title: 'A crash in the middle', body: 'The charge went through and checkout died before saving the order. Write the order down first, so the restart can finish it, and let the key make the second charge a no-op. Or refund charges with no order: the money is straight, the sale is lost.' },
  ],
}
