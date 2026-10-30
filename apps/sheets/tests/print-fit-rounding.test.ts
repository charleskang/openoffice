import { expect, it } from 'vitest'
import { bandIndices } from '../src/renderer/print-paginate'
it('keeps a fitted row of fractional-width cells on one page', () => {
  expect(bandIndices([0, 1], (i) => [0.1, 0.2][i]!, 0.3, new Set())).toEqual([{ start: 0, end: 1 }])
})
it('still starts another page for a real width overflow', () => {
  expect(bandIndices([0, 1], (i) => [10, 10.01][i]!, 20, new Set())).toHaveLength(2)
})
