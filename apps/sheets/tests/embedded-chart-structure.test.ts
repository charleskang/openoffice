import { expect, it } from 'vitest'
import { embeddedChartRowColumnEdits } from '../src/main/embedded-chart-structure'
it('keeps the exact operation order and resolves stable sheet IDs to workbook names', () => {
  const request: Parameters<typeof embeddedChartRowColumnEdits>[0] = {
    sheetOps: [],
    structuralOps: [
      { sheetId: 's', kind: 'insert-rows', index: 2, count: 2 },
      { sheetId: 's', kind: 'remove-cols', index: 1, count: 1 },
      { sheetId: 's', kind: 'set-row-size', start: 1, end: 3, size: 25 },
    ],
  }
  expect(embeddedChartRowColumnEdits(request, new Map([['s', 'Research']]))).toEqual([
    { sheetName: 'Research', kind: 'insert-rows', index: 2, count: 2 },
    { sheetName: 'Research', kind: 'remove-cols', index: 1, count: 1 },
  ])
})
it('refuses an unresolved worksheet instead of applying a shift to a different sheet', () => {
  expect(() =>
    embeddedChartRowColumnEdits(
      {
        sheetOps: [],
        structuralOps: [{ sheetId: 'missing', kind: 'insert-cols', index: 1, count: 1 }],
      },
      new Map(),
    ),
  ).toThrow('[embedded-chart]')
})
