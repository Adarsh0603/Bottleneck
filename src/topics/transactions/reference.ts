import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'A transaction is all or nothing. Inside one database that is easy: commit or roll back. Once the work spans several services, each with its own database, no single rollback reaches them all. A distributed transaction is the attempt to keep the all-or-nothing promise anyway.',
    'Two-phase commit (2PC) uses a coordinator. Phase 1: it asks every participant to prepare. Each one does the work, locks what it touched and votes yes or no. Phase 2: if all voted yes, the coordinator tells everyone to commit, otherwise to abort. A participant that voted yes must wait for the verdict, and cannot change its mind.',
    'The weakness of 2PC is blocking. If the coordinator crashes after the votes but before the verdict, the participants stay locked until it returns, because they cannot know what the others voted. Locks are also held across network round trips, so throughput drops and a slow participant slows everyone. Three-phase commit and consensus-based commit (Paxos Commit, Spanner) reduce this at the cost of complexity.',
    'A saga replaces one big transaction with a chain of local transactions. Each step commits at once. If a step fails, the saga runs a compensating action for every step already done, in reverse order: refund the payment, release the stock. There are no cross-service locks.',
    'A compensation is not a rollback. The original change was visible to others, and the undo is a new change. A saga therefore gives eventual all-or-nothing but not isolation: other requests can see the in-between state. Design for it, for example by marking an order “pending” until the saga finishes.',
    'Sagas come in two styles. Orchestration: a central coordinator tells each service what to do and tracks progress, which is easy to follow and monitor. Choreography: services react to each other’s events with no central owner, which is loosely coupled but harder to trace as it grows.',
    'The saga runner must survive crashes: persist its progress before each step (a workflow log or engine such as Temporal or AWS Step Functions) and resume after a restart. Since a step may be sent twice, every step and every compensation must be idempotent. Order steps so that the ones that cannot be undone (sending an email, shipping) come last.',
  ],
  cards: [
    {
      title: 'Why a normal transaction is not enough',
      body: 'One database can commit or roll back as a unit. Separate services own separate data, so “charge the card” and “reserve the item” can succeed or fail independently, leaving the order half done.',
    },
    {
      title: 'Two-phase commit',
      body: 'Prepare: everyone locks and votes. Commit or abort: the coordinator announces one verdict. Strong all-or-nothing, but locks are held across the network and a crashed coordinator leaves participants blocked.',
    },
    {
      title: 'Saga',
      body: 'A sequence of local transactions with a compensation for each. On failure, run the compensations in reverse. No locks, always making progress, but the in-between state is visible.',
    },
    {
      title: 'Compensations',
      body: 'Refund, release, cancel. They are new actions, can fail, and must be retried, so they must be idempotent. Put steps that cannot be undone last.',
    },
    {
      title: 'Orchestration vs choreography',
      body: 'Orchestration: one coordinator drives the steps. Choreography: services publish events and react to each other. Start with orchestration when the flow has many steps or needs clear monitoring.',
    },
    {
      title: 'Outbox pattern',
      body: 'To change your database and publish an event atomically, write the event to an outbox table in the same local transaction, and have a relay publish it. It gives at-least-once delivery without 2PC between the database and the broker.',
    },
    {
      title: 'In the real world',
      body: 'Banks and databases use 2PC inside tight clusters (XA, Spanner). E-commerce, travel booking and payments use sagas, often through a workflow engine like Temporal, Camunda or AWS Step Functions.',
    },
  ],
}
