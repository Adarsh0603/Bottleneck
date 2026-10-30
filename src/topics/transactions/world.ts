import { TICKS_PER_SECOND } from '../../core/flow/time'
// Where things stand on the floor:
//
//                     ┌─▶ Stock
//   Orders ───────────┼─▶ Payment
//                     └─▶ Shipping
//
// A customer places an order. Orders (the coordinator) has to get Stock,
// Payment and Shipping, three separate services with their own databases,
// to all do their part, or none.

export type Part = 'stock' | 'pay' | 'ship'
export type Place = 'coord' | Part

export const PARTS: Part[] = ['stock', 'pay', 'ship']
export const PART_NAME: Record<Part, string> = { stock: 'Stock', pay: 'Payment', ship: 'Shipping' }

export { TICKS_PER_SECOND }
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const SPOT: Record<Place, { x: number; z: number }> = {
  coord: { x: -5, z: 0 },
  stock: { x: 2.2, z: -2.8 },
  pay: { x: 2.2, z: 0 },
  ship: { x: 2.2, z: 2.8 },
}

// The progress log a saga writes, beside Orders.
export const LOG_AT = { x: -5, z: 2.6 }
export const LOG = { w: 1.3, d: 0.9, h: 0.3 }

export const COORD = { w: 1.6, d: 1.6, h: 1.1 }
export const PART = { w: 1.5, d: 1.5, h: 0.8 }

const COLORS = ['var(--srv-1)', 'var(--srv-2)', 'var(--srv-3)', 'var(--srv-4)', 'var(--srv-5)']
// Each order keeps one colour from the first message to the last block.
export const orderColor = (order: number) => COLORS[(order - 1) % COLORS.length]
