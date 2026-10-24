import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { transactions } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={transactions} index={chapter} startStep={step} {...rest} />
}
