import type { WorkbookSaveRequest } from '../shared/desktop-api'

/** Resolve the ordered UI journal against the pre-save worksheet names. */
export function embeddedChartRowColumnEdits(
  request: Pick<WorkbookSaveRequest, 'structuralOps' | 'sheetOps'>,
  names: ReadonlyMap<string, string>,
): Array<{
  sheetName: string
  kind: 'insert-rows' | 'remove-rows' | 'insert-cols' | 'remove-cols'
  index: number
  count: number
}> {
  if (
    request.structuralOps.some((op) => op.kind === 'move-rows') ||
    request.sheetOps.some((op) => op.kind === 'rename-sheet' || op.kind === 'remove-sheet')
  )
    throw new Error(
      '[embedded-chart] Keep the chart worksheet and its row order while editing its data. Save As can export a separate workbook.',
    )
  return request.structuralOps.flatMap((op) => {
    if (
      op.kind !== 'insert-rows' &&
      op.kind !== 'remove-rows' &&
      op.kind !== 'insert-cols' &&
      op.kind !== 'remove-cols'
    )
      return []
    const sheetName = names.get(op.sheetId)
    if (!sheetName) throw new Error('[embedded-chart] The chart worksheet is unavailable.')
    return [{ sheetName, kind: op.kind, index: op.index, count: op.count }]
  })
}
