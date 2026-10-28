import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: drivers online, rides per day and at the peak, how fresh the map must be, one city or many, pooled rides, what a wrong match costs.',
    'Estimate: 500,000 drivers pinging every 4 seconds is 125,000 writes a second. 20 million rides a day is about 230 a second, 3 to 5 times that at the peak.',
    'Keep the latest position of every driver in memory, cut into cells by geohash or quadtree. A ping replaces the last one, and a driver whose pings stop expires.',
    'Dispatch asks the cell and its neighbours for free cars, claims the nearest one so no other rider can, offers the ride, and saves the trip in a database.',
    'Cut the map by how many cars an area holds, not by its size, so a busy centre is split into small cells and a quiet suburb into one large one.',
    'Failures: a hot city centre (split finer), two riders for one car (claim first), a dispatch crash (write the request to a log first), a driver app that goes quiet (time its car out).',
  ],
  cards: [
    { title: 'The numbers', body: '500,000 drivers pinging every 4 s is 125,000 writes a second, far more than the 230 rides a second. The location stream is the real load.' },
    { title: 'The live map', body: 'Only the last position matters, so keep it in memory and let each ping replace the one before. A database would need dozens of machines to hold values that are worthless in seconds.' },
    { title: 'A hot corner', body: 'Cut by fixed cells, a concert puts every request on one shard. Cut by how busy an area is, the centre is split finer and the load spreads. A quadtree does exactly this.' },
    { title: 'Claim the car first', body: 'An offer takes a second to be answered. Until it is, every rider nearby sees the same car as nearest. Claim the car before offering it, and the next rider sees the next car.' },
    { title: 'A crash in the middle', body: 'Dispatch holds the rides it is matching in memory. Write each request to a log before matching it, and the restart can match them again. The claim makes a second match harmless.' },
  ],
}
