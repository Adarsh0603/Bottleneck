import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: one to one or groups, how big the groups, message history, media, encryption, and whether to show who is online.',
    'Estimate: 100 million people sending 40 messages a day is about 46,000 messages a second. 20 million open connections at 100,000 per gateway is about 200 gateways.',
    'Shape: phones hold a WebSocket to a gateway. The chat service numbers and stores each message, then a pub/sub topic carries it to the recipient’s gateway. An inbox holds it for someone who is away.',
    'Group messages: store once for the group and let members read from it, not a copy per member.',
    'Failures: a crashed gateway sends its phones to the others, so keep spare capacity and have phones retry with a growing wait. A lost ack means a retry, so a message id lets the server ignore repeats.',
  ],
  cards: [
    { title: 'The numbers', body: '100 million people × 40 messages a day is about 46,000 messages a second. 20 million open connections at 100,000 per gateway is about 200 gateways. 4 billion messages of 100 bytes is about 400 GB a day.' },
    { title: 'Gateways and connections', body: 'A phone keeps one open connection to a gateway. A gateway holds only so many, so the load is the number of phones, not messages. Keep one gateway’s worth of spare capacity, so that a crash does not leave phones with nowhere to go.' },
    { title: 'Finding the recipient', body: 'The sender and the recipient are on different gateways. The chat service publishes the message on a topic, and the gateway that holds the recipient delivers it. Nobody has to look up where each phone is.' },
    { title: 'Away, lost acks, order', body: 'A message for someone who is away waits in an inbox. When an ack is lost the phone sends again, so a message id lets the server ignore the repeat. Messages take different routes, so a number in each chat keeps them in order.' },
    { title: 'Big groups and reconnect storms', body: 'A message to a huge group is stored once, not once per member. After a crash, phones that retry at once keep the gateways too busy to let anyone in. A growing, random wait spreads them out.' },
  ],
}
