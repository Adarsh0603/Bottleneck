import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { autoscaling } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={autoscaling} index={chapter} startStep={step} {...rest} />
}
