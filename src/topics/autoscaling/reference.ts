import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Put app servers in an autoscaling group behind a load balancer. Keep them stateless, so any one can be added or removed.',
    'Name the metric you scale on: CPU, requests per server, or queue length. Target tracking keeps it near a value, e.g. 60% CPU.',
    'New servers take time to boot. Keep headroom with a lower target or a minimum fleet size.',
    'Scale out fast and scale in slowly, with a cooldown, so the fleet doesn’t flap up and down.',
    'Drain a server before removing it: stop sending it requests, let it finish, then shut it down.',
  ],
  cards: [
    {
      title: 'Stateless servers',
      body: 'Keep sessions and uploads in a shared store (Redis, a database, object storage), not on the server, so removing one loses nothing.',
    },
    {
      title: 'Scheduled and predictive scaling',
      body: 'Add servers before a rush you can see coming: a daily peak, a sale, a big launch.',
    },
    {
      title: 'Faster boots',
      body: 'Pre-built machine images, containers and warm pools of stopped servers cut minutes of boot time to seconds.',
    },
    {
      title: 'Scaling on a queue',
      body: 'Background workers scale on how many jobs are waiting, not on CPU.',
    },
    {
      title: 'Real-world autoscalers',
      body: 'AWS Auto Scaling groups, Kubernetes Horizontal Pod Autoscaler, Google Cloud managed instance groups, Azure scale sets.',
    },
  ],
}
