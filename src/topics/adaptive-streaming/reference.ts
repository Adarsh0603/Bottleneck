import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Adaptive bitrate streaming (ABR) lets one video play on any connection. The server holds the video in several qualities, cut into short pieces. The player fetches one piece at a time and picks each piece’s quality from what it measures. A phone on a train and a TV on fibre watch the same video, each at the best quality it can sustain.',
    'Segments: cut the video into pieces of 2 to 10 seconds, commonly 4 to 6. Each piece is a plain file fetched over ordinary HTTP, so any web server or CDN can hold and cache it, and no special streaming server is needed. A manifest file lists the pieces and the qualities (HLS uses .m3u8 playlists, MPEG-DASH uses an .mpd file). Short pieces adapt faster; long pieces compress better and mean fewer requests.',
    'Bitrate ladder: the set of qualities, for example 240p at 0.4 Mbps up to 1080p at 5 Mbps, and 4K above that. Every piece exists once per rung, so the storage and the transcoding work are multiplied by the number of rungs. Rungs are spaced so one step is a visible change but not a jump. Services tune the ladder per title: a cartoon looks fine at a lower bitrate than a football match.',
    'The buffer: the video the phone holds ahead of the playhead, usually 10 to 30 seconds. Playing drains it and downloading fills it. When it reaches zero the picture freezes (a stall, or rebuffering). Stalls hurt viewing time far more than a lower picture does, so every choice below protects the buffer first.',
    'Throughput rule: after each piece, divide its size by the time it took to get the speed, and pick the best rung under that speed with a safety margin (around 80 to 90%). It reacts fast but reads noise as news, and it can choose a heavy piece just before the connection drops.',
    'Buffer rule: pick the rung from how much video is held. Low buffer, lowest rung; high buffer, best rung; steps in between. It needs no speed estimate and is steadier, but it can run down its own safety margin. Production players such as dash.js, Shaka and hls.js combine both and add smoothing.',
    'Flapping: switching quality every piece is tiring to watch. Smooth the speed estimate over several pieces, go down at once (a freeze is worse), and go up one rung at a time after a few good pieces with a healthy buffer. Some players also limit how often they may switch.',
    'Startup: the first piece is downloaded with no speed estimate. Start low so the first frame appears fast, then climb once the first piece has measured the connection. A long wait at the start makes people leave; a soft first few seconds does not.',
    'Delivery: the pieces are static files, so they are served from a CDN, and popular pieces are cached near the viewer. Upload goes through a transcoding pipeline that produces every rung for every piece, often as a queue of parallel jobs. Live streaming uses the same idea with pieces made as the event happens, so the player sits a few pieces behind the live edge.',
  ],
  cards: [
    {
      title: 'Segments',
      body: 'Cut the video into short pieces, each a plain file fetched over HTTP. Any web server or CDN can serve them, and the player can start, skip or retry any piece.',
    },
    {
      title: 'Bitrate ladder',
      body: 'The same video in several qualities, for example 240p, 480p, 720p, 1080p. Every piece exists once per rung, so storage and encoding work are multiplied by the rungs.',
    },
    {
      title: 'Buffer',
      body: 'Video downloaded ahead of the playhead. Playing drains it, downloading fills it. At zero the picture freezes, which viewers dislike more than a softer picture.',
    },
    {
      title: 'Throughput rule',
      body: 'Time the last piece, get the speed, pick the best rung under it with a margin. Reacts quickly, but noisy and blind to a sudden drop.',
    },
    {
      title: 'Buffer rule',
      body: 'Pick the rung from the video held: low buffer, low rung. Steady and simple, but a full buffer can tempt it into a heavy piece just before an outage.',
    },
    {
      title: 'Flapping',
      body: 'Switching quality every piece. Smooth the speed, drop fast, climb one rung at a time after a few good pieces.',
    },
    {
      title: 'Fast start',
      body: 'Begin on a low rung so the first frame appears at once, then climb. People forgive a soft start, not a long wait.',
    },
    {
      title: 'HLS and DASH',
      body: 'HLS (Apple) and MPEG-DASH are the two standards. Both use a manifest listing the pieces and qualities, and both work over plain HTTP.',
    },
  ],
}
