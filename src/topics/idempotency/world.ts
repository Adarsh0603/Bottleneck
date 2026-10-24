// Where things stand on the floor, left to right:
//
//   Phone ──▶ Payments ──▶ Ledger
//
// The phone asks Payments to charge, Payments writes the charge in the ledger
// and sends an answer back to the phone.

export type Place = 'phone' | 'server' | 'ledger'

export const TICKS_PER_SECOND = 20
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const SPOT: Record<Place, { x: number; z: number }> = {
  phone: { x: -6.4, z: 0 },
  server: { x: 0, z: 0 },
  ledger: { x: 6.4, z: 0 },
}

export const SERVER = { w: 1.6, d: 1.6, h: 1.1 }
export const LEDGER = { w: 2.8, d: 1.1, h: 0.6 }
export const PHONE = { w: 0.7, d: 0.7, h: 1.3 }

const COLORS = ['var(--srv-1)', 'var(--srv-2)', 'var(--srv-3)', 'var(--srv-4)', 'var(--srv-5)']
// Each payment keeps one colour from the tap to the ledger, so a repeat is easy to spot.
export const orderColor = (order: number) => COLORS[(order - 1) % COLORS.length]
