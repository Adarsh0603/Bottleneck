import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { sharding } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={sharding} index={chapter} startStep={step} {...rest} />
}
