import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { geospatial } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={geospatial} index={chapter} startStep={step} {...rest} />
}
