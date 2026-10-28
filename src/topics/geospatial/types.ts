import type { BaseBeat, Chapter } from '../../core/types'
import type { GeoMetrics, GeoSim } from './engine'

// How the app finds the nearest car.
//   scan:     measure the distance to every car.
//   grid:     cut the map into square cells; look in the rider's cell.
//   geohash:  the same cells, each with a short name; an empty cell can be widened.
//   quadtree: boxes that split in four wherever the cars are crowded.
export type Method = 'scan' | 'grid' | 'geohash' | 'quadtree'

// Where the cars are: spread evenly, or packed into the middle of the map.
export type City = 'even' | 'downtown'

export interface GeoState {
  ask: number // goes up each time a rider asks for a car
  round: number // goes up to start the counts again from zero
  method: Method
  drivers: number // cars on the map
  city: City
  res: number // cells along one side of the grid (grid and geohash)
  neighbours: boolean // also look in the cells around the rider's
  widen: boolean // geohash: when the cells are empty, drop a letter and look in the bigger cell
  edge: boolean // riders stand beside a cell line, with the nearest car over it
  rate: number // asks a second that come by themselves; 0 = only when `ask` goes up
}

export type TagId = 'rider' | 'result' | 'cell' | 'crowd'
export type HudId = 'checked' | 'time' | 'result' | 'cells' | 'misses' | 'load' | 'widened'
export type ControlId = 'ask' | 'method' | 'drivers' | 'city' | 'res' | 'neighbours' | 'widen'

export interface Beat extends BaseBeat<GeoState, GeoSim, GeoMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
  methods?: Method[] // the choices shown by the `method` control
}

export type GeoChapter = Chapter<GeoState, Beat>
