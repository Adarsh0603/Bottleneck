import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: upload length and size, live or recorded, qualities and devices, regions, how soon an upload must be watchable, recommendations, and the storage bill.',
    'Estimate: 500 hours uploaded a minute is about 720,000 hours a day. At 5 qualities and real-time transcoding that is about 150,000 machines busy all day. A billion hours watched a day at 4 Mbps is about 170 Tbps, and about 1.4 PB of new storage a day.',
    'Shape: an upload goes to object storage. A queue feeds transcoders that cut it into short segments in several qualities. Edges serve the segments, and the player picks the quality its network can take. Videos nobody watches move to cold storage.',
    'Scale: autoscale transcoders on the queue length, put a shared cache between the edges and the origin, and keep the popular and the trending videos on the edges.',
    'Failures: a crashed transcoder gives its task back to the queue. A viral video is a thundering herd on a cold cache, so collapse requests for the same video. A trend of old videos hits cold storage, so promote them to hot while they are asked for.',
  ],
  cards: [
    { title: 'The numbers', body: '500 hours of video a minute is 720,000 a day, kept in 5 qualities at about 2 GB an hour: 1.4 PB a day. Transcoding takes about 150,000 machines all day. A billion hours watched a day at 4 Mbps is about 170 Tbps.' },
    { title: 'Qualities and segments', body: 'Every video is made in several qualities, cut into segments a few seconds long. The player downloads one segment at a time and picks the quality by how fast the last one arrived. Few qualities and a slow phone stalls. Too many and transcoding and storage cost too much. Short segments start fast and cost more requests; long ones are cheaper and slower to start.' },
    { title: 'The upload pipeline', body: 'Upload to object storage, put a task on a queue, let transcoders take tasks and write the result back. The queue absorbs bursts and returns the task of a crashed transcoder. An autoscaler adds transcoders while the queue is long, and removes them when it is empty.' },
    { title: 'Hot and cold storage', body: 'A few videos get nearly all the plays. Keep those on fast, costly storage and move the rest to cold storage, which costs a fraction and is slow to read. When old videos trend, the cold tier is read all at once: let the edges and a shared cache hold them, and promote them to hot while they are asked for.' },
    { title: 'Viral videos', body: 'A new video that millions want is on no edge. If every edge asks the origin at once, the origin and one shard of the store get the same read thousands of times. A shared cache between the edges and the origin asks once and hands the answer to all. Giving the edges room to keep what is watched helps the same way.' },
  ],
}
