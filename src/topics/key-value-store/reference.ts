import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: value size, reads against writes, how fresh a read must be, whether a write may ever be lost, and whether range queries are needed.',
    'Estimate: 100,000 operations a second at 10,000 per node is about 10 nodes. A billion 1 KB values is 1 TB, and 3 TB with three copies.',
    'Shape: a hash ring places every key on three nodes. Any node can coordinate. A write waits for 2 of 3 answers and a read asks 2 of 3, so they overlap and a read meets the latest write.',
    'Scale: many small ring slices per node keep the load even and make adding a node cheap. A cache or extra copies carry a hot key.',
    'Failures: stand-in nodes hold writes for a node that is down, reads repair old copies, and a version number or vector orders writes where clocks cannot.',
  ],
  cards: [
    { title: 'The numbers', body: '100,000 operations a second at 10,000 per node is about 10 nodes. A billion keys of 1 KB is 1 TB, and 3 TB with three copies. Copying 1 TB to a new node at 100 MB/s takes about 3 hours.' },
    { title: 'The ring', body: 'Turn each key into a spot on a circle. Each node owns slices of the circle, and a key belongs to the next nodes clockwise. A node that joins or leaves moves only the keys next to it. Many small slices per node keep the load even.' },
    { title: 'Copies and quorums', body: 'Keep each key on N nodes. A write waits for W answers and a read asks R nodes. If R + W > N, a read always meets a node with the latest write. Lower numbers are faster and stay up longer, but can return old values.' },
    { title: 'When a node is down', body: 'A stand-in node holds the write and hands it over when the node returns. A read that finds an old copy can fix it. Together they heal a node that missed writes, without a slow full copy.' },
    { title: 'Versions and clocks', body: 'Clocks on different machines disagree, so a write stamped by a fast clock can win over a later one and be silently lost. A counter that goes up is safe. Real stores use version vectors to keep both values when two writes cannot be ordered.' },
  ],
}
