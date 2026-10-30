import { beforeEach, expect, it } from 'vitest'
import { cacheChartFormulaResults } from '../src/renderer/embedded-chart-formulas'
import { clearVerifiedFormulaValues, verifiedFormulaValues } from '../src/renderer/formula-values'
beforeEach(clearVerifiedFormulaValues)
it('caches a newly entered chart formula using its numeric model value, including columns beyond Z', async () => {
  const read = () => ({
    B3: { value: -0.25, formula: '=-0.25' },
    AA2: { value: 7, formula: '=3+4' },
  })
  await cacheChartFormulaResults(
    [
      { sheetId: 's', row: 2, column: 1, formula: '=-0.25' },
      { sheetId: 's', row: 1, column: 26, formula: '=3+4' },
    ],
    read,
  )
  expect(verifiedFormulaValues(read)).toEqual([
    { sheetId: 's', row: 2, column: 1, value: -0.25 },
    { sheetId: 's', row: 1, column: 26, value: 7 },
  ])
})
