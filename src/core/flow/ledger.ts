import { FlowSim, type Job } from './engine'

// A FlowSim that keeps score by source (the kind of message): how many were
// made, answered, how many were answered too late, how many were lost, and where
// the lost ones were turned away. Projects read these for their checks.
export class Ledger extends FlowSim {
  made: Record<string, number> = {}
  done: Record<string, number> = {}
  late: Record<string, number> = {}
  lost: Record<string, number> = {}
  lostAt: Record<string, number> = {}
  // Ticks a source may take before its answer counts as late.
  deadline: Record<string, number> = {}

  newJob(work: number, key?: number, from?: string) {
    if (from) this.made[from] = (this.made[from] ?? 0) + 1
    return super.newJob(work, key, from)
  }

  complete(job: Job) {
    const from = job.from ?? '?'
    this.done[from] = (this.done[from] ?? 0) + 1
    const limit = this.deadline[from]
    if (limit !== undefined && this.tick - job.createdAt > limit) this.late[from] = (this.late[from] ?? 0) + 1
    super.complete(job)
  }

  drop(job: Job, node: string) {
    const from = job.from ?? '?'
    this.lost[from] = (this.lost[from] ?? 0) + 1
    this.lostAt[node] = (this.lostAt[node] ?? 0) + 1
    super.drop(job, node)
  }
}
