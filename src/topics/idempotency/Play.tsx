import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { idempotency } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={idempotency} index={chapter} startStep={step} {...rest} />
}
