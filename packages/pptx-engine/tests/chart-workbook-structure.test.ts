import { describe, expect, it } from 'vitest'
import { XMLValidator } from 'fast-xml-parser'
import {
  addChart,
  createBlankPptx,
  openPptx,
  savePptx,
  getEmbeddedChartWorkbook,
  prepareChartWorkbookUpdate,
  applyChartWorkbookUpdate,
  transformChartWorkbookStructure,
  type ChartWorkbookStructuralOp,
} from '../src/index'
import { chartWorkbookParts, storedZip } from '../src/chart-workbook'
const OFF = { x: 0, y: 0, cx: 4000000, cy: 3000000 }
async function fixture(kind: 'line' | 'scatter' = 'line') {
  const opened = await openPptx(await createBlankPptx())
  addChart(opened, 0, {
    kind,
    categories: kind === 'scatter' ? ['10', '20', '30'] : ['A', 'B', 'C'],
    series: [
      { name: 'North', values: [1, 2, 3] },
      { name: 'South', values: [4, 5, 6] },
    ],
    offset: OFF,
    colorScheme: ['#4472C4', '#ED7D31'],
  })
  const back = await openPptx(await savePptx(opened))
  const el = back.deck.slides[0]!.elements.find((e) => e.type === 'chart')!
  return { opened: back, id: el.id, binding: getEmbeddedChartWorkbook(back, 0, el.id)! }
}
const op = (
  kind: ChartWorkbookStructuralOp['kind'],
  index: number,
  count = 1,
): ChartWorkbookStructuralOp => ({ sheetName: 'Sheet1', kind, index, count })
async function savedChart(
  f: Awaited<ReturnType<typeof fixture>>,
  bytes: Uint8Array,
  ops: ChartWorkbookStructuralOp[],
) {
  const update = await prepareChartWorkbookUpdate(f.binding, bytes, ops)
  applyChartWorkbookUpdate(f.opened, 0, f.id, update)
  const back = await openPptx(await savePptx(f.opened))
  const chart = back.deck.slides[0]!.elements.find((e) => e.type === 'chart')!
  if (chart.type !== 'chart') throw Error('Missing chart')
  expect(XMLValidator.validate(back.archive.readText(f.binding.chartPath)!)).toBe(true)
  return { chart: chart.chart, update, back }
}
describe('chart row/column structure', () => {
  it('grows point ranges at the start, middle and end and shifts ranges before the table', async () => {
    const { binding } = await fixture()
    for (const index of [1, 2, 4])
      expect(
        transformChartWorkbookStructure(binding.chartXml, [op('insert-rows', index)]),
      ).toContain('Sheet1!$B$2:$B$5')
    const before = transformChartWorkbookStructure(binding.chartXml, [op('insert-rows', 0, 2)])
    expect(before).toContain('Sheet1!$B$4:$B$6')
    expect(before).toContain('Sheet1!$B$3</c:f>')
  })
  it('updates saved point data and preserves every unrelated PPTX part', async () => {
    const f = await fixture()
    const before = new Map(f.opened.archive.entries)
    const bytes = storedZip(
      chartWorkbookParts({
        categories: ['A', 'New', 'B', 'C'],
        series: [
          { name: 'North', values: [1, 9, 2, 3] },
          { name: 'South', values: [4, 8, 5, 6] },
        ],
      }),
    )
    const { chart, back } = await savedChart(f, bytes, [op('insert-rows', 2)])
    expect(chart.categories).toEqual(['A', 'New', 'B', 'C'])
    expect(chart.series[0]!.values).toEqual([1, 9, 2, 3])
    for (const [path, value] of before)
      if (path !== f.binding.chartPath && path !== f.binding.workbookPath)
        expect(Buffer.from(back.archive.readBytes(path)!), path).toEqual(Buffer.from(value))
  })
  it('adds a series between existing columns and preserves their style and order', async () => {
    const f = await fixture()
    const bytes = storedZip(
      chartWorkbookParts({
        categories: ['A', 'B', 'C'],
        series: [
          { name: 'North', values: [1, 2, 3] },
          { name: 'New', values: [7, 8, 9] },
          { name: 'South', values: [4, 5, 6] },
        ],
      }),
    )
    const { chart } = await savedChart(f, bytes, [op('insert-cols', 2)])
    expect(chart.series.map((s) => s.name)).toEqual(['North', 'New', 'South'])
    expect(chart.series.map((s) => s.values)).toEqual([
      [1, 2, 3],
      [7, 8, 9],
      [4, 5, 6],
    ])
    expect(chart.series[0]!.color).toBe('#4472C4')
    expect(chart.series[2]!.color).toBe('#ED7D31')
  })
  it('removes deleted series and shifts the surviving references', async () => {
    const f = await fixture()
    const bytes = storedZip(
      chartWorkbookParts({
        categories: ['A', 'B', 'C'],
        series: [{ name: 'South', values: [4, 5, 6] }],
      }),
    )
    const { chart, update } = await savedChart(f, bytes, [op('remove-cols', 1)])
    expect(chart.series.map((s) => s.name)).toEqual(['South'])
    expect(chart.series[0]!.color).toBe('#ED7D31')
    expect(update.chartXml).not.toContain('#REF!')
  })
  it('shrinks partial row deletions, removes point-specific overrides and reindexes the survivors', async () => {
    const { binding } = await fixture()
    const source = binding.chartXml.replace(
      '<c:cat>',
      '<c:dPt><c:idx val="1"/></c:dPt><c:dPt><c:idx val="2"/></c:dPt><c:cat>',
    )
    const result = transformChartWorkbookStructure(source, [op('remove-rows', 2)])
    expect(result).toContain('Sheet1!$B$2:$B$3')
    expect(result.match(/<c:dPt>/g) ?? []).toHaveLength(1)
    expect(result).toContain('<c:dPt><c:idx val="1"/></c:dPt>')
  })
  it('handles sequential edits and leaves charts on other sheets byte-identical', async () => {
    const { binding } = await fixture()
    const result = transformChartWorkbookStructure(binding.chartXml, [
      op('insert-rows', 2, 2),
      op('remove-rows', 3),
      op('insert-cols', 2),
    ])
    expect(result).toContain('Sheet1!$B$2:$B$5')
    expect(result).toContain('Sheet1!$D$2:$D$5')
    expect(
      transformChartWorkbookStructure(binding.chartXml, [
        { ...op('insert-rows', 2), sheetName: 'Other' },
      ]),
    ).toBe(binding.chartXml)
  })
  it('keeps an empty valid chart after deleting all data rows or every series', async () => {
    const { binding } = await fixture()
    for (const operations of [[op('remove-rows', 1, 3)], [op('remove-cols', 1, 2)]]) {
      const result = transformChartWorkbookStructure(binding.chartXml, operations)
      expect(result).not.toContain('#REF!')
      expect(XMLValidator.validate(result)).toBe(true)
    }
  })
  it('keeps scatter X/Y vectors aligned after inserting and deleting points', async () => {
    const f = await fixture('scatter')
    const bytes = storedZip(
      chartWorkbookParts({
        categories: ['10', '25', '30'],
        xValues: [10, 25, 30],
        series: [
          { name: 'North', values: [1, 8, 3] },
          { name: 'South', values: [4, 7, 6] },
        ],
      }),
    )
    const { chart } = await savedChart(f, bytes, [op('insert-rows', 2), op('remove-rows', 3)])
    expect(chart.series[0]!.xValues).toEqual([10, 25, 30])
    expect(chart.series[0]!.values).toEqual([1, 8, 3])
  })
  it('rejects structural XML changes that were not described by the save journal', async () => {
    const f = await fixture()
    const bytes = storedZip(
      chartWorkbookParts({
        categories: ['A', 'B', 'C', 'D'],
        series: [
          { name: 'North', values: [1, 2, 3, 4] },
          { name: 'South', values: [4, 5, 6, 7] },
        ],
      }),
    )
    const update = await prepareChartWorkbookUpdate(f.binding, bytes, [op('insert-rows', 4)])
    expect(() =>
      applyChartWorkbookUpdate(f.opened, 0, f.id, { ...update, structuralOps: [] }),
    ).toThrow('formatting')
  })
})

it('supports row-based series and column-based data points', async () => {
  const { binding } = await fixture()
  const horizontal = binding.chartXml
    .replaceAll('Sheet1!$B$1', 'Sheet1!$A$2')
    .replaceAll('Sheet1!$C$1', 'Sheet1!$A$3')
    .replaceAll('Sheet1!$A$2:$A$4', 'Sheet1!$B$1:$D$1')
    .replaceAll('Sheet1!$B$2:$B$4', 'Sheet1!$B$2:$D$2')
    .replaceAll('Sheet1!$C$2:$C$4', 'Sheet1!$B$3:$D$3')
  const morePoints = transformChartWorkbookStructure(horizontal, [op('insert-cols', 2)])
  expect(morePoints).toContain('Sheet1!$B$2:$E$2')
  const moreSeries = transformChartWorkbookStructure(horizontal, [op('insert-rows', 2)])
  expect(moreSeries.match(/<c:ser>/g) ?? []).toHaveLength(3)
  expect(moreSeries).toContain('Sheet1!$A$3</c:f>')
  expect(moreSeries).toContain('Sheet1!$B$4:$D$4')
})
it('preserves legend overrides for the same series after inserting before the first series', async () => {
  const { binding } = await fixture()
  const withLegend = binding.chartXml.replace(
    '<c:legend>',
    '<c:legend><c:legendEntry><c:idx val="1"/><c:delete val="1"/></c:legendEntry>',
  )
  const updated = transformChartWorkbookStructure(withLegend, [op('insert-cols', 1)])
  expect(updated).toContain('<c:legendEntry><c:idx val="2"/><c:delete val="1"/></c:legendEntry>')
})
it('updates every chart sharing an embedded workbook in the same atomic edit', async () => {
  const f = await fixture()
  addChart(f.opened, 0, {
    kind: 'bar',
    categories: ['A', 'B', 'C'],
    series: [
      { name: 'North', values: [1, 2, 3] },
      { name: 'South', values: [4, 5, 6] },
    ],
    offset: OFF,
  })
  const second = [...f.opened.archive.entries.keys()].find((p) =>
    /ppt\/charts\/chart2.xml$/.test(p),
  )!
  const rel = second.replace(/([^/]+)$/, '_rels/$1.rels')
  f.opened.archive.entries.set(
    rel,
    Buffer.from(
      f.opened.archive
        .readText(rel)!
        .replace('Microsoft_Excel_Worksheet2.xlsx', 'Microsoft_Excel_Worksheet1.xlsx'),
    ),
  )
  const opened = await openPptx(await savePptx(f.opened)),
    el = opened.deck.slides[0]!.elements.find((e) => e.type === 'chart')!
  const binding = getEmbeddedChartWorkbook(opened, 0, el.id)!
  const bytes = storedZip(
    chartWorkbookParts({
      categories: ['A', 'B', 'C', 'D'],
      series: [
        { name: 'North', values: [1, 2, 3, 9] },
        { name: 'South', values: [4, 5, 6, 8] },
      ],
    }),
  )
  const update = await prepareChartWorkbookUpdate(binding, bytes, [op('insert-rows', 4)], opened)
  expect(update.relatedCharts).toHaveLength(1)
  expect(() =>
    applyChartWorkbookUpdate(opened, 0, el.id, { ...update, relatedCharts: [] }),
  ).toThrow('every linked chart')
  applyChartWorkbookUpdate(opened, 0, el.id, update)
  const back = await openPptx(await savePptx(opened))
  for (const chart of back.deck.slides[0]!.elements.filter((e) => e.type === 'chart'))
    if (chart.type === 'chart') expect(chart.chart.series[0]!.values).toEqual([1, 2, 3, 9])
})
it('updates point-indexed pie legend entries and does not manufacture extra pie series', async () => {
  const opened = await openPptx(await createBlankPptx())
  addChart(opened, 0, {
    kind: 'pie',
    categories: ['A', 'B', 'C'],
    series: [{ name: 'S', values: [1, 2, 3] }],
    offset: OFF,
    legendPos: 'r',
  })
  const back = await openPptx(await savePptx(opened)),
    el = back.deck.slides[0]!.elements.find((e) => e.type === 'chart')!
  const binding = getEmbeddedChartWorkbook(back, 0, el.id)!
  const source = binding.chartXml.replace(
    '<c:legend>',
    '<c:legend><c:legendEntry><c:idx val="2"/><c:delete val="1"/></c:legendEntry>',
  )
  expect(transformChartWorkbookStructure(source, [op('remove-rows', 2)])).toContain(
    '<c:legendEntry><c:idx val="1"/><c:delete val="1"/></c:legendEntry>',
  )
  expect(
    transformChartWorkbookStructure(source, [op('insert-cols', 2)]).match(/<c:ser>/g) ?? [],
  ).toHaveLength(1)
})

it('moves filtered Office series too and never reuses their identity for a new visible series', async () => {
  const { binding } = await fixture()
  const first = /<c:ser\b[^>]*>[\s\S]*?<\/c:ser>/.exec(binding.chartXml)![0]
  const hidden = first
    .replace(/<c:ser/g, '<c15:ser')
    .replace(/<\/c:ser>/g, '</c15:ser>')
    .replace('<c:idx val="0"', '<c:idx val="2"')
    .replace('<c:order val="0"', '<c:order val="2"')
    .replaceAll('$B$', '$D$')
    .replaceAll('<c:f>', '<c15:formulaRef><c15:sqref>')
    .replaceAll('</c:f>', '</c15:sqref></c15:formulaRef>')
  const xml = binding.chartXml.replace(
    '</c:chartSpace>',
    '<c:extLst xmlns:c15="http://schemas.microsoft.com/office/drawing/2012/chart"><c:ext uri="test"><c15:filteredLineSeries>' +
      hidden +
      '</c15:filteredLineSeries></c:ext></c:extLst></c:chartSpace>',
  )
  const after = transformChartWorkbookStructure(xml, [op('insert-cols', 2)])
  const ids = [...after.matchAll(/<c:idx\b[^>]*val="(\d+)"/g)].map((m) => m[1])
  const orders = [...after.matchAll(/<c:order\b[^>]*val="(\d+)"/g)].map((m) => m[1])
  expect(new Set(ids).size).toBe(4)
  expect(new Set(orders).size).toBe(4)
  expect(after).toContain('Sheet1!$E$2:$E$4')
  expect(transformChartWorkbookStructure(xml, [op('remove-cols', 3)])).not.toContain(
    '<c15:filteredLineSeries>',
  )
})
