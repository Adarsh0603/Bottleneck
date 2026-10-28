import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Geospatial indexing answers “what is near this point?” fast. Ride sharing, food delivery, maps, store finders and dating apps all need it. The core problem is that a place has two numbers, latitude and longitude, and an ordinary index sorts by one. Near on a map means near in both at once.',
    'Scanning every item is correct but costs one check per item. At a million drivers it is far too slow for one rider, never mind thousands. Every geospatial index is a way to skip most items without looking at them.',
    'Grid: cut the map into equal cells and keep a list of items per cell. A lookup reads the rider’s cell. Cell size trades speed for risk: big cells hold many items, so lookups read a lot; small cells can be empty. Cars are cheap to move: take one off a list and add it to another.',
    'Cell edges: the nearest item may sit in the next cell over, so reading only the rider’s cell can return a worse answer without any error. Read the cell and its eight neighbours, or search outward ring by ring until the next ring is farther than the best item found.',
    'Geohash: a string naming a cell. Each character cuts the cell into smaller ones (32 in real geohash), so names that share a prefix sit in the same bigger cell. A prefix search is a range scan on an ordinary sorted index, so SQL, Redis sorted sets and most key-value stores can do it. If a cell is empty, drop a character and search the bigger cell. Beware cells that are close on the map but share no prefix: always check the neighbours.',
    'Quadtree: a box splits into four when it holds more than a set number of items, and only then. Crowded areas get small boxes and empty areas stay large, so each lookup reads about the same number of items. Find the nearest by trying boxes in order of distance and stopping when the next box is farther than the best item so far. It is stored in memory and must be updated when items move.',
    'Other indexes: R-trees (PostGIS, many databases) group nearby items in bounding rectangles; S2 (Google) and H3 (Uber) map the globe onto cells, with H3 using hexagons whose neighbours are all the same distance away. The idea is the same: turn two numbers into a cell, then search the cell and its neighbours.',
    'Moving items change the design. A million drivers reporting every few seconds is hundreds of thousands of updates a second. Keep the live index in memory (Redis, or a purpose-built service split by region), not in a disk-backed table, and update it only when a driver crosses into another cell. Keep a slower store for history and trips.',
    'Choose by data. Spread evenly and simple wins: grid or geohash. Density varies a lot: quadtree, or a grid with small cells downtown. Need it inside a general database: geohash or an R-tree. Say how the index is sharded, usually by region or cell prefix, and what happens at the border between two shards.',
  ],
  cards: [
    {
      title: 'Scan',
      body: 'Check every item. Always right, one check per item. Fine for hundreds, hopeless for millions.',
    },
    {
      title: 'Grid',
      body: 'Equal cells with a list of items each. A lookup reads one cell. Big cells read a lot, small cells go empty. Cheap to update when items move.',
    },
    {
      title: 'Cell edges',
      body: 'The nearest item can be over the line. Read the cell and its eight neighbours, or widen the search ring by ring until the next ring is farther than the best item found.',
    },
    {
      title: 'Geohash',
      body: 'A cell’s name as a string. Names that start the same sit in the same bigger cell, so a prefix search works on any sorted index. Empty cell: drop a character.',
    },
    {
      title: 'Quadtree',
      body: 'A box splits in four when it holds too many items. Small boxes where it is busy, big where it is quiet, so every lookup reads about the same.',
    },
    {
      title: 'R-tree, S2, H3',
      body: 'R-tree: nested bounding rectangles, used in PostGIS. S2: cells on a sphere, from Google. H3: hexagon cells, from Uber, where every neighbour is equally near.',
    },
    {
      title: 'Items that move',
      body: 'Drivers report every few seconds. Keep the live index in memory and move an item only when it crosses into another cell. Keep history somewhere slower.',
    },
    {
      title: 'In the real world',
      body: 'Ride sharing and delivery apps match drivers by cell. Redis geo commands use geohash. PostGIS and MongoDB index shapes and points. Maps and store finders do “near me” the same way.',
    },
  ],
}
