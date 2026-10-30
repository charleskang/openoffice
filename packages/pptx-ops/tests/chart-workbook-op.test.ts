import JSZip from 'jszip'
import { materializeSlide, elementCNvPrId } from '@genoffice/pptx-engine'
import { expect, it } from 'vitest'
import {
  addChart,
  createBlankPptx,
  openPptx,
  savePptx,
  getEmbeddedChartWorkbook,
  prepareChartWorkbookUpdate,
} from '@genoffice/pptx-engine'
import { runTxn } from '../src/index'
it('applies a workbook update through the transaction executor and rejects a stale replay', async () => {
  const opened = await openPptx(await createBlankPptx())
  addChart(opened, 0, {
    kind: 'line',
    categories: ['A', 'B'],
    series: [{ name: 'S', values: [1, 2] }],
    offset: { x: 0, y: 0, cx: 4000000, cy: 3000000 },
  })
  const back = await openPptx(await savePptx(opened))
  const el = back.deck.slides[0]!.elements.find((e) => e.type === 'chart')!
  const binding = getEmbeddedChartWorkbook(back, 0, el.id)!
  const z = await JSZip.loadAsync(binding.workbook)
  z.file(
    'xl/worksheets/sheet1.xml',
    (await z.file('xl/worksheets/sheet1.xml')!.async('string')).replace(
      '<c r="B2"><v>1</v>',
      '<c r="B2"><v>7</v>',
    ),
  )
  const update = await prepareChartWorkbookUpdate(
    binding,
    await z.generateAsync({ type: 'uint8array' }),
  )
  const op = { op: 'setChartWorkbook', target: { slide: 0, el: el.id }, update }
  const before = back.archive.readText(binding.chartPath)
  expect(runTxn(back, { ops: [op], dryRun: true }).applied).toBe(false)
  expect(back.archive.readText(binding.chartPath)).toBe(before)
  expect(runTxn(back, { ops: [op] }).applied).toBe(true)
  expect(back.archive.readText(binding.chartPath)).toContain('<c:v>7</c:v>')
  const saved = back.archive.readText(binding.chartPath)
  expect(runTxn(back, { ops: [op] }).applied).toBe(false)
  expect(back.archive.readText(binding.chartPath)).toBe(saved)
})

it('keeps a chart data editor attached through identity hardening and successive reparses', async () => {
  const opened = await openPptx(await createBlankPptx())
  addChart(opened, 0, {
    kind: 'line',
    categories: ['A'],
    series: [{ name: 'S', values: [1] }],
    offset: { x: 0, y: 0, cx: 4000000, cy: 3000000 },
  })
  const back = await openPptx(await savePptx(opened))
  const el = back.deck.slides[0]!.elements.find((e) => e.type === 'chart')!
  const reference = elementCNvPrId(el)!
  for (const value of [7, 9]) {
    const binding = getEmbeddedChartWorkbook(back, 0, reference)!
    const z = await JSZip.loadAsync(binding.workbook)
    z.file(
      'xl/worksheets/sheet1.xml',
      (await z.file('xl/worksheets/sheet1.xml')!.async('string')).replace(
        /(<c r="B2"><v>)[^<]+/,
        '$1' + value,
      ),
    )
    const update = await prepareChartWorkbookUpdate(
      binding,
      await z.generateAsync({ type: 'uint8array' }),
    )
    expect(
      runTxn(back, {
        ops: [{ op: 'setChartWorkbook', target: { slide: 0, el: reference }, update }],
      }).applied,
    ).toBe(true)
    materializeSlide(back, 0)
    expect(getEmbeddedChartWorkbook(back, 0, reference)?.chartXml).toContain(
      '<c:v>' + value + '</c:v>',
    )
  }
})
