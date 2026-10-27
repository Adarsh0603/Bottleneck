import { describe, expect, it } from 'vitest'
import { FlowSim, REPLY_MEMORY_TICKS, type FlowNode, type Job } from './engine'

class Hold implements FlowNode {
  alive = true
  readonly key: string
  private onJob?: (job: Job, sim: FlowSim) => void
  constructor(key: string, onJob?: (job: Job, sim: FlowSim) => void) {
    this.key = key
    this.onJob = onJob
  }
  receive(job: Job, sim: FlowSim) {
    this.onJob?.(job, sim)
  }
}

describe('replies', () => {
  it('keeps the route of an answered request and gives it back reversed', () => {
    const sim = new FlowSim()
    sim.replying = () => true
    sim.add(new Hold('a'))
    sim.add(new Hold('b', (job, s) => s.forward(job, 'b', 'c')))
    sim.add(new Hold('c', (job, s) => s.complete(job)))
    sim.link('a', 'b', 2)
    sim.link('b', 'c', 2)
    sim.forward(sim.newJob(1), 'a', 'b')
    for (let i = 0; i < 8; i++) sim.step()
    expect(sim.replies.map((r) => r.path)).toEqual([['c', 'b', 'a']])
  })
  it('forgets a request that was turned away, and old answers', () => {
    const sim = new FlowSim()
    sim.replying = () => true
    sim.add(new Hold('a'))
    sim.add(new Hold('b', (job, s) => s.drop(job, 'b')))
    sim.link('a', 'b', 1)
    sim.forward(sim.newJob(1), 'a', 'b')
    for (let i = 0; i < 3; i++) sim.step()
    expect(sim.replies).toEqual([])
    const job = sim.newJob(1)
    sim.forward(job, 'a', 'b')
    sim.complete(job)
    expect(sim.replies.length).toBe(1)
    for (let i = 0; i < REPLY_MEMORY_TICKS + 2; i++) sim.step()
    expect(sim.replies).toEqual([])
  })
  it('records nothing unless asked', () => {
    const sim = new FlowSim()
    sim.add(new Hold('a'))
    sim.add(new Hold('b', (job, s) => s.complete(job)))
    sim.link('a', 'b', 1)
    sim.forward(sim.newJob(1), 'a', 'b')
    for (let i = 0; i < 3; i++) sim.step()
    expect(sim.replies).toEqual([])
  })
})
