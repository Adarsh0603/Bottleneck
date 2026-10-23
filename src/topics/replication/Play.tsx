import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { replication } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={replication} index={chapter} startStep={step} {...rest} />
}
