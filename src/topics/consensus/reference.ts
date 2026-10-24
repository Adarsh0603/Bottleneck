import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Consensus means several servers agree on one value or one order of events, even when some servers crash or messages are lost. It is what lets a cluster behave like a single reliable machine: one booking order, one owner of a lock, one current leader.',
    'The simplest way to get one order is a leader. Clients send writes to the leader, which puts them in a log and copies them to followers. A write counts as committed once a majority (a quorum) holds it. A single leader never disagrees with itself, so no seat is sold twice.',
    'A leader is a single point of failure, so followers watch for its heartbeat. Each follower has an election timeout. If no heartbeat arrives in time, it becomes a candidate, increments the term, votes for itself and asks the others for votes. A candidate with a majority of votes becomes the leader.',
    'Randomised election timeouts stop everyone standing at once. If every timer were equal, all followers would become candidates together, split the votes and repeat for ever. With random timers, one server usually wakes first and wins before the rest start. If votes still split, the term ends and a new round starts.',
    'A majority is what makes this safe. Any two majorities of the same cluster overlap in at least one server, and a server votes once per term, so two leaders can never win the same term. During a network partition only the side with a majority can elect a leader or commit writes. The minority side stalls instead of making a conflicting decision.',
    'Safety across leader changes comes from two rules. A write is committed only when a majority has it. A server grants its vote only to a candidate whose log is at least as up to date as its own. So any winner has every committed entry, and no confirmed write is lost. Writes not yet committed may be dropped, and clients retry them.',
    'Use an odd number of servers: 3 tolerates 1 failure, 5 tolerates 2. A fourth server adds cost but tolerates no more failures than three, since a majority of 4 is still 3. More servers also means slower writes, because the leader waits on more of them. Real clusters rarely go past 5 to 7 servers.',
  ],
  cards: [
    {
      title: 'The problem consensus solves',
      body: 'Without agreement, two servers can each accept the last seat, the same username or the same job. With one leader that orders every write, and a majority to confirm it, the cluster gives one answer even while servers fail.',
    },
    {
      title: 'Terms and elections',
      body: 'A term is a numbered period with at most one leader. A server that sees a higher term steps down at once. Election timeout is typically 150–300 ms in Raft, and a heartbeat much shorter than that. The timeout must be well above the network round trip, or healthy leaders get replaced.',
    },
    {
      title: 'Quorums and partitions',
      body: 'Quorum is a majority: floor(n / 2) + 1. A cluster of 5 survives 2 failures. On a partition, the larger side carries on and the smaller side cannot elect or commit, which is the C in CAP: consistency over availability. When the network heals, the small side catches up from the leader.',
    },
    {
      title: 'Leader stickiness and its cost',
      body: 'All writes go through one leader, so write throughput is limited by it. Reads from followers may be stale unless they ask the leader or use a lease. A flapping leader, from a slow network or a pause such as garbage collection, causes churn. Tune timeouts, and consider a pre-vote step so a cut-off server does not force needless elections.',
    },
    {
      title: 'Raft and Paxos',
      body: 'Raft was designed to be easy to understand: leader election, log replication and safety are separate pieces. Paxos solves the same problem and came first, but is famously harder to implement. Multi-Paxos in practice also uses a stable leader. Zab (ZooKeeper) is another close relative.',
    },
    {
      title: 'In the real world',
      body: 'etcd (the store behind Kubernetes), Consul and CockroachDB use Raft. ZooKeeper uses Zab. Kafka moved from ZooKeeper to its own Raft-based controller (KRaft). You rarely write consensus yourself: you use these as a building block for locks, leader election, configuration and metadata, and keep your own data path simpler.',
    },
  ],
}
