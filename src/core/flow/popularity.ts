// Popularity follows a Zipf curve: item k is asked for ~1/(k+1) as often as
// the most popular one. Precomputed as a cumulative table.
export function zipfTable(n: number) {
  const weights = Array.from({ length: n }, (_, k) => 1 / (k + 1))
  const total = weights.reduce((a, b) => a + b, 0)
  let sum = 0
  return weights.map((w) => (sum += w / total))
}

// The index a random number r (0–1) lands on in a cumulative table.
export const pick = (table: number[], r: number) => {
  const i = table.findIndex((c) => r < c)
  return i < 0 ? table.length - 1 : i
}
