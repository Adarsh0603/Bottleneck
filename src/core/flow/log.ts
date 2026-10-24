import type { FlowNode } from './engine'

// An append-only log split into partitions, the heart of a stream. Events are
// appended to one partition and kept for `retention` ticks. Readers keep their
// own place (an offset) in each partition, so a slow or absent reader never
// holds anyone else up, and can pick up where it left off.

export interface LogEntry {
  seq: number // the order the event was published in
  product: number // what the event is about, e.g. which product
  at: number // tick it was appended
}

export class Log {
  readonly lanes: LogEntry[][]
  // Entries thrown away from the front of each lane. Offsets are absolute,
  // so a reader's place stays meaningful after old entries expire.
  readonly base: number[]
  retention: number // ticks

  constructor(partitions: number, retention: number) {
    this.lanes = Array.from({ length: partitions }, () => [])
    this.base = Array.from({ length: partitions }, () => 0)
    this.retention = retention
  }

  get partitions() {
    return this.lanes.length
  }

  append(partition: number, entry: LogEntry) {
    this.lanes[partition].push(entry)
  }

  // One past the last offset in a partition.
  end(partition: number) {
    return this.base[partition] + this.lanes[partition].length
  }

  at(partition: number, offset: number): LogEntry | undefined {
    return this.lanes[partition][offset - this.base[partition]]
  }

  // Throw away entries that are older than the retention.
  trim(tick: number) {
    this.lanes.forEach((lane, p) => {
      let cut = 0
      while (cut < lane.length && tick - lane[cut].at > this.retention) cut++
      if (cut > 0) {
        lane.splice(0, cut)
        this.base[p] += cut
      }
    })
  }
}

// One reader's place in every partition. `cursor` is what it has been handed;
// `committed` is what it has told the log it finished, and is where it starts
// again after a crash.
export class Reader {
  cursor: number[]
  committed: number[]

  constructor(partitions: number) {
    this.cursor = Array.from({ length: partitions }, () => 0)
    this.committed = Array.from({ length: partitions }, () => 0)
  }

  // Entries waiting for this reader, not counting those already expired.
  behind(log: Log): number {
    let n = 0
    for (let p = 0; p < log.partitions; p++) n += Math.max(0, log.end(p) - Math.max(this.cursor[p], log.base[p]))
    return n
  }

  rewind() {
    this.cursor = [...this.committed]
  }
}

// The log inside a node, if it has one (so a stream can be drawn from it).
export const logOf = (node?: FlowNode): Log | undefined => {
  const log = (node as { log?: unknown } | undefined)?.log
  return log instanceof Log ? log : undefined
}
