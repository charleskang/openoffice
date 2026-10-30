// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPrintPreviewHost,
  handleExportPdf,
  type PageLayoutContext,
} from '../src/renderer/page-layout-actions'
import { createEditJournal } from '../src/renderer/edit-journal'
import { setModuleLang } from '../src/renderer/i18n/locale'
import type { LazyWorkbookState, UniverRuntime } from '../src/renderer/univer-state'
import { installedVisualFrames } from '../src/renderer/WorkbookVisuals'
import { snapshotPrintVisuals } from '../src/renderer/print-visuals'

vi.mock('../src/renderer/WorkbookVisuals', () => ({ installedVisualFrames: vi.fn(() => []) }))
vi.mock('../src/renderer/print-visuals', () => ({
  settleVisualNodes: vi.fn(async () => {}),
  snapshotPrintVisuals: vi.fn(() => ({ visuals: [], css: '' })),
}))

function fixture(visual = false) {
  const sheets = ['First', 'Second', 'Hidden'].map((name, i) => ({
    getSheetId: () => name,
    getSheetName: () => name,
    isSheetHidden: () => i === 2,
    getLastRow: () => 1,
    getLastColumn: () => 1,
    getRowHeight: () => 24,
    getColumnWidth: () => 120,
    getMergedRanges: () => [],
    getMaxRows: () => 10,
    getMaxColumns: () => 10,
    getRange: () => ({
      getValues: () => [[name]],
      getDisplayValues: () => [[name]],
      getCellStyleData: () => null,
    }),
  }))
  let active = sheets[1]!
  const activate = vi.fn((sheet: typeof active) => {
    active = sheet
  })
  const facade = () => ({
    getId: () => 'same-book',
    getActiveSheet: () => active,
    getActiveRange: () => null,
    getSheets: () => sheets,
    setActiveSheet: activate,
  })
  const state = {
    file: {
      name: 'book.xlsx',
      sessionId: 'session',
      sheets: sheets.map((s) => ({ id: s.getSheetId(), name: s.getSheetName() })),
      visuals: visual ? [{ id: 'chart', sheetId: 'First' }] : [],
    },
    flags: { preloadComplete: true },
    editJournal: createEditJournal(),
    sheetFilePageSetups: new Map([['Second', { orientation: 'landscape', paperSize: 9 }]]),
    sheetPageBreaks: new Map(),
    sheetProtections: new Map(sheets.map((s) => [s.getSheetId(), {}])),
    sheetProtectedRanges: new Map(),
  } as unknown as LazyWorkbookState
  const ctx: PageLayoutContext = {
    univerRef: {
      current: { univerAPI: { getActiveWorkbook: facade } } as unknown as UniverRuntime,
    },
    lazyWorkbookRef: { current: state },
    setMessage: vi.fn(),
    setPendingEdits: vi.fn(),
    requestVisualInstall: vi.fn(),
    runOps: vi.fn(),
  }
  return { ctx, state, sheets, active: () => active, activate }
}
describe('whole workbook PDF', () => {
  const exportPdf = vi.fn(async (_request: { html: string }) => ({
    canceled: false,
    path: 'output.pdf',
  }))
  beforeEach(() => {
    setModuleLang('en')
    vi.clearAllMocks()
    vi.stubGlobal('window', { desktopApi: { exportPdf } })
  })
  it('exports visible sheets in tab order with their individual page geometry and leaves the active sheet alone', async () => {
    const { ctx, active, activate, state } = fixture()
    expect(await handleExportPdf(ctx, undefined, 'workbook')).toBe(true)
    const request = exportPdf.mock.calls[0]![0] as unknown as { html: string }
    expect(request.html.indexOf('First')).toBeLessThan(request.html.indexOf('Second'))
    expect(request.html).not.toContain('Hidden')
    const host = createPrintPreviewHost(ctx)!
    const job = await host.buildJob('workbook', {})
    expect(job.documents).toHaveLength(2)
    expect(job.documents[0]!.paper.landscape).toBe(false)
    expect(job.documents[1]!.paper.landscape).toBe(true)
    expect(active().getSheetName()).toBe('Second')
    expect(activate).not.toHaveBeenCalled()
    expect(state.editJournal.structuralOps.size).toBe(0)
  })
  it('captures chart frames on another sheet and restores the original sheet', async () => {
    const { ctx, active, activate } = fixture(true)
    const frames = [{ visual: { id: 'chart' } }] as unknown as ReturnType<
      typeof installedVisualFrames
    >
    vi.mocked(installedVisualFrames).mockImplementation((id) => (id === 'First' ? frames : []))
    expect(await handleExportPdf(ctx, undefined, 'workbook')).toBe(true)
    expect(snapshotPrintVisuals).toHaveBeenCalledWith(document, frames)
    expect(activate.mock.calls.map(([s]) => s.getSheetName())).toEqual(['First', 'Second'])
    expect(active().getSheetName()).toBe('Second')
  })
  it('restores the starting sheet and writes no PDF when another sheet cannot be rendered', async () => {
    const { ctx, sheets, active } = fixture(true)
    sheets[0]!.getRange = () => {
      throw Error('Failed chart sheet')
    }
    expect(await handleExportPdf(ctx, undefined, 'workbook')).toBe(false)
    expect(exportPdf).not.toHaveBeenCalled()
    expect(active().getSheetName()).toBe('Second')
  })
})
