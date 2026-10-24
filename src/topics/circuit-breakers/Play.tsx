import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { circuitBreakers } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={circuitBreakers} index={chapter} startStep={step} {...rest} />
}
