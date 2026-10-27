import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Real-time messaging is getting an update to a client as soon as it happens, without the user asking. Chat, live scores, notifications, ride tracking and collaborative editing all need it. The core problem is that HTTP is request and response: a server can only answer, so something must make the client hear about an event.',
    'Polling: the client asks every N seconds. Simple and stateless, and it works anywhere, but average delay is about half the interval and most answers are empty. Faster polling lowers delay and raises load, which multiplies by the number of users. Fine for dashboards and job status.',
    'Long polling: the client asks and the server holds the request until it has data or a timeout (30 to 60 seconds), then the client asks again at once. Near-instant delivery over plain HTTP. Each client still costs a request per message and a held request on the server. A common fallback.',
    'Server-sent events (SSE): one long-lived HTTP response the server keeps writing to. One direction only, server to client. Browsers support it natively, with automatic reconnect and a last-event-id to resume. Good for notifications, live feeds and streamed model output. The client sends through ordinary requests.',
    'WebSocket: an HTTP request upgraded to a persistent two-way connection. Either side sends small frames at any time, with little overhead per message. The standard choice for chat, games and collaborative editing. Some proxies and corporate networks interfere with it, so systems often keep a long polling fallback.',
    'Connections cost memory. A server holds the state of every open connection, so capacity is measured in concurrent connections. One tuned server can hold hundreds of thousands, so a million users means several gateway servers. Keep the gateways thin: they hold connections and pass messages, and the logic lives behind them.',
    'The hard part of many gateways is routing: a message for user X must reach the gateway that holds X’s connection. Usual answers are a presence store mapping user to gateway, a pub/sub channel per user or per gateway, or consistent hashing of users to gateways. This is the core of a chat design.',
    'Plan for failure. Detect dead connections with heartbeats (ping and pong, drop after a few misses). Reconnect with exponential backoff and jitter, or a restart makes every client retry at once and the servers collapse under the storm. Give messages ids and let a returning client resume from the last id it saw, so nothing is lost while offline.',
    'Choose by need. Updates can wait seconds and scale is small: polling. Server pushes to many listeners: SSE. Both sides talk often: WebSocket. Say the number of concurrent connections, the message rate, and how you will route and resume.',
  ],
  cards: [
    {
      title: 'Polling',
      body: 'The client asks every N seconds. Simple and works everywhere. Delay is up to the interval and most answers are empty. Load grows with users and with how fast you poll.',
    },
    {
      title: 'Long polling',
      body: 'The server holds the request until it has news or times out, then the client asks again. Near-instant over plain HTTP, but a request per message and one held request per client.',
    },
    {
      title: 'Server-sent events',
      body: 'One response that never ends; the server writes into it. One way only, built into browsers, reconnects by itself and can resume from the last event id.',
    },
    {
      title: 'WebSocket',
      body: 'A request upgraded to a two-way connection. Small frames in both directions at any time. The usual choice for chat, games and shared editing.',
    },
    {
      title: 'Connections cost memory',
      body: 'Each open connection is held by the server. Capacity is concurrent connections per server, so many users means many gateway servers, and a way to find which one holds a given user.',
    },
    {
      title: 'Heartbeats',
      body: 'A phone in a tunnel never says goodbye. Ping on a timer and close connections that stop answering, or dead ones fill the server.',
    },
    {
      title: 'Reconnect storm',
      body: 'After a crash every client retries at once and the servers drown. Clients wait with exponential backoff plus random jitter, and resume from the last message id.',
    },
    {
      title: 'In the real world',
      body: 'Chat apps and games use WebSockets. Live scores, notifications and streamed model answers use server-sent events. Dashboards and job status use polling. Slack, WhatsApp and Discord run fleets of gateway servers that hold the connections.',
    },
  ],
}
