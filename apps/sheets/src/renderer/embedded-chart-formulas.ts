/** A linked chart needs the computed values of newly entered formulas on this save. */
import type { CellState } from '@genoffice/xlsx-gateway/domain/workbook.types'
import { awaitFormulaValues, rememberFormulaValue } from './formula-values'

export async function cacheChartFormulaResults(
  edits: readonly { sheetId: string; row: number; column: number; formula?: string | undefined }[],
  read: (addresses: readonly string[], sheetId: string) => Record<string, CellState>,
): Promise<void> {
  const columnName = (n: number): string =>
    n >= 0 ? columnName(Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26)) : ''
  const targets = edits
    .filter((e) => typeof e.formula === 'string' && e.formula.startsWith('='))
    .map((e) => ({ sheetId: e.sheetId, address: columnName(e.column) + (e.row + 1) }))
  for (const cell of await awaitFormulaValues(targets, read)) {
    if (cell.formula) rememberFormulaValue(cell.sheetId, cell.address, { formula: cell.formula })
  }
}
