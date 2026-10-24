import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { bloomFilters } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={bloomFilters} index={chapter} startStep={step} {...rest} />
}
