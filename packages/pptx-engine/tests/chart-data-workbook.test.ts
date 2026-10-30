import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  addChart,
  createBlankPptx,
  openPptx,
  savePptx,
  getEmbeddedChartWorkbook,
  prepareChartWorkbookUpdate,
  applyChartWorkbookUpdate,
  validateChartWorkbookUpdate,
} from '../src/index'

async function fixture() {
  const opened = await openPptx(await createBlankPptx())
  addChart(opened, 0, {
    kind: 'scatter',
    categories: ['10', '100'],
    series: [{ name: 'Measured', values: [0.1, -0.3] }],
    offset: { x: 100, y: 200, cx: 4000000, cy: 3000000 },
  })
  const back = await openPptx(await savePptx(opened))
  const el = back.deck.slides[0]!.elements.find((e) => e.type === 'chart')!
  return { opened: back, id: el.id, binding: getEmbeddedChartWorkbook(back, 0, el.id)! }
}
async function editWorkbook(bytes: Uint8Array, edit: (s: string) => string) {
  const z = await JSZip.loadAsync(bytes)
  z.file(
    'xl/worksheets/sheet1.xml',
    edit(await z.file('xl/worksheets/sheet1.xml')!.async('string')),
  )
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
describe('embedded chart data-only edits', () => {
  it('updates X and Y caches and the embedded workbook while preserving all other parts and chart formatting', async () => {
    const { opened, id, binding } = await fixture()
    const before = new Map(opened.archive.entries)
    const bytes = await editWorkbook(binding.workbook, (s) =>
      s
        .replace('<c r="A2"><v>10</v>', '<c r="A2"><v>25</v>')
        .replace('<c r="B2"><v>0.1</v>', '<c r="B2"><v>-0.45</v>'),
    )
    const update = await prepareChartWorkbookUpdate(binding, bytes)
    applyChartWorkbookUpdate(opened, 0, id, update)
    const back = await openPptx(await savePptx(opened))
    const chart = back.deck.slides[0]!.elements.find((e) => e.type === 'chart')!
    if (chart.type !== 'chart') throw Error('Missing chart')
    expect(chart.chart.series[0]!.xValues).toEqual([25, 100])
    expect(chart.chart.series[0]!.values).toEqual([-0.45, -0.3])
    expect(Buffer.from(back.archive.readBytes(binding.workbookPath)!)).toEqual(Buffer.from(bytes))
    for (const [path, old] of before)
      if (path !== binding.chartPath && path !== binding.workbookPath)
        expect(Buffer.from(back.archive.readBytes(path)!), path).toEqual(Buffer.from(old))
    const strip = (s: string) =>
      s.replace(/<c:(?:numCache|strCache)\b[^>]*>[\s\S]*?<\/c:(?:numCache|strCache)>/g, '')
    expect(strip(update.chartXml)).toBe(strip(binding.chartXml))
  })
  it('rejects stale updates and changes outside chart caches without mutating the archive', async () => {
    const { opened, id, binding } = await fixture()
    const update = await prepareChartWorkbookUpdate(binding, binding.workbook)
    expect(() =>
      validateChartWorkbookUpdate(binding, {
        ...update,
        chartXml: update.chartXml.replace('<c:chart>', '<c:chart hacked="1">'),
      }),
    ).toThrow('formatting')
    const changed = { ...binding, chartHash: 'different' }
    expect(() => validateChartWorkbookUpdate(changed, update)).toThrow('changed')
    expect(() =>
      applyChartWorkbookUpdate(opened, 0, id, { ...update, workbookHash: 'stale' }),
    ).toThrow('changed')
    expect(opened.archive.readText(binding.chartPath)).toBe(binding.chartXml)
  })
  it('rejects missing sheets, uncalculated formulas and text in numeric ranges', async () => {
    const { binding } = await fixture()
    await expect(
      prepareChartWorkbookUpdate(
        { ...binding, chartXml: binding.chartXml.replaceAll('Sheet1!', 'Missing!') },
        binding.workbook,
      ),
    ).rejects.toThrow('removed or renamed')
    const missing = await editWorkbook(binding.workbook, (s) =>
      s.replace('<c r="B2"><v>0.1</v>', '<c r="B2"><f>1+2</f>'),
    )
    await expect(prepareChartWorkbookUpdate(binding, missing)).rejects.toThrow('calculated value')
    const bad = await editWorkbook(binding.workbook, (s) =>
      s.replace('<c r="B2"><v>0.1</v>', '<c r="B2" t="str"><v>text</v>'),
    )
    await expect(prepareChartWorkbookUpdate(binding, bad)).rejects.toThrow('contains text')
  })
  it('reads quoted worksheet names, shared text, empty cells and prefixed worksheet XML', async () => {
    const { binding } = await fixture()
    const z = await JSZip.loadAsync(binding.workbook)
    z.file(
      'xl/workbook.xml',
      (await z.file('xl/workbook.xml')!.async('string')).replace(
        'name="Sheet1"',
        'name="Team&apos;s data"',
      ),
    )
    const sheet = await z.file('xl/worksheets/sheet1.xml')!.async('string')
    z.file(
      'xl/worksheets/sheet1.xml',
      sheet
        .replace(/<(\/?)(worksheet|sheetData|row|c|v)(?=[\s>])/g, '<$1x:$2')
        .replace('xmlns=', 'xmlns:x=')
        .replace('<x:c r="B3"><x:v>-0.3</x:v></x:c>', ''),
    )
    const updated = await prepareChartWorkbookUpdate(
      { ...binding, chartXml: binding.chartXml.replaceAll('Sheet1!', "'Team''s data'!") },
      await z.generateAsync({ type: 'uint8array' }),
    )
    expect(updated.chartXml).toContain('<c:v>Measured</c:v>')
    expect(updated.chartXml).toContain('<c:ptCount val="2"/>')
    expect(updated.chartXml).not.toContain('<c:v>-0.3</c:v>')
  })
  it('does not follow an external chart workbook relationship', async () => {
    const { opened, id, binding } = await fixture()
    const path = binding.chartPath.replace(/([^/]+)$/, '_rels/$1.rels')
    opened.archive.entries.set(
      path,
      Buffer.from(
        opened.archive
          .readText(path)!
          .replace(
            'Target="../embeddings/',
            'TargetMode="External" Target="https://example.invalid/',
          ),
      ),
    )
    expect(getEmbeddedChartWorkbook(opened, 0, id)).toBeNull()
  })
})

it('supports Office filtered-series formulaRef references and preserves text-valued auxiliary caches', async () => {
  const { binding } = await fixture()
  const extended = {
    ...binding,
    chartXml: binding.chartXml.replace(
      /<c:f>([\s\S]*?)<\/c:f>/g,
      '<c:extLst><c:ext uri="test"><c15:formulaRef><c15:sqref>$1</c15:sqref></c15:formulaRef></c:ext></c:extLst>',
    ),
  }
  const update = await prepareChartWorkbookUpdate(extended, binding.workbook)
  expect(update.chartXml).toContain('<c15:sqref>Sheet1!$B$2:$B$3</c15:sqref>')
  const textual = {
    ...binding,
    chartXml: binding.chartXml.replace('<c:v>0.1</c:v>', '<c:v>Label</c:v>'),
  }
  const bytes = await editWorkbook(binding.workbook, (s) =>
    s.replace('<c r="B2"><v>0.1</v>', '<c r="B2" t="str"><v>Updated label</v>'),
  )
  expect((await prepareChartWorkbookUpdate(textual, bytes)).chartXml).toContain(
    '<c:v>Updated label</c:v>',
  )
})
