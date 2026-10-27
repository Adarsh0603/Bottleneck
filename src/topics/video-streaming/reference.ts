import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: upload size and length, live or recorded, qualities and devices, regions, how soon an upload must be watchable, and whether there are recommendations.',
    'Estimate: 100 million people watching an hour a day at 3 Mbps is about 12 Tbps at once. A million 10-minute videos a day, in 5 qualities, is about 35,000 transcoders busy all day.',
    'Shape: an upload goes to object storage. A queue feeds transcoders that cut it into short segments in several qualities. A CDN serves the segments, and the player picks the quality its network can take.',
    'Scale: autoscale transcoders on the queue length, cut long videos so many transcoders share one, and put a shared cache between the CDN edges and the origin.',
    'Failures: a crashed transcoder gives its task back to the queue. A premiere is a thundering herd on a cold cache, so collapse requests for the same video or warm the caches first.',
  ],
  cards: [
    { title: 'The numbers', body: '100 million people watching an hour a day at 3 Mbps is about 12 Tbps. A million videos a day at 100 MB is about 100 TB, and about 300 TB with the qualities made from each. Transcoding 5 qualities of a 10-minute video takes about 35,000 transcoders all day.' },
    { title: 'The upload pipeline', body: 'Upload to object storage, put a task on a queue, let transcoders take tasks and write the result back. The queue absorbs bursts and returns the task of a crashed transcoder. An autoscaler adds transcoders while the queue is long.' },
    { title: 'Segments and qualities', body: 'Cut a video into segments a few seconds long, and make each in several qualities. Transcoders share one long film, and the player downloads one segment at a time, choosing a quality for each by how fast the last one arrived. A manifest file lists the segments.' },
    { title: 'The CDN', body: 'Edges near the viewers keep the segments people watch. Most plays are answered there, and the origin sees only the rest. An edge has little room, so keep what is watched again soon, not every rare video.' },
    { title: 'Premieres and shields', body: 'A new video that millions want is on no cache. If every edge asks the origin at once, the origin is flooded with the same request. A shared cache between the edges and the origin asks once and hands the answer to all. Warming the caches before the premiere works too.' },
  ],
}
