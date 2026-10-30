import { describe, expect, it } from 'vitest'
import type { ChartModel } from '@genoffice/pptx-engine'
import { buildChartNode } from '../src/build-chart'
import { HeuristicMetrics } from '../src/metrics'
import { makeViewport } from '../src/coords'
const box = {
  x: 0,
  y: 0,
  w: 1000,
  h: 600,
  rotationDeg: 0,
  centerX: 500,
  centerY: 300,
  flipH: false,
  flipV: false,
}
const vp = makeViewport({ cx: 9525000, cy: 5715000 }, 1000)
describe('authored scatter text placement', () => {
  it('positions the title and horizontal axis title using full-frame coordinates', () => {
    const model: ChartModel = {
      kind: 'scatter',
      categories: [],
      series: [{ name: 'S', xValues: [1, 2], values: [1, 2] }],
      title: 'Performance',
      titleLayout: { x: 0.3, y: 0.075, xMode: 'edge', yMode: 'edge' },
      plotLayout: { x: 0.1, y: 0.2, w: 0.75, h: 0.5 },
      catAxis: { title: 'Size', titleLayout: { x: 0.33, y: 0.88, xMode: 'edge', yMode: 'edge' } },
    }
    const node = buildChartNode('c', 'c', model, box, vp, new HeuristicMetrics())!
    expect(node.labels.find((x) => x.text === 'Performance')).toMatchObject({ x: 300, y: 45 })
    expect(node.labels.find((x) => x.text === 'Size')).toMatchObject({ x: 330, y: 528 })
  })
})

it('draws chart text with the measured substitute face, including explicit title styles', () => {
  const base = new HeuristicMetrics()
  const node = buildChartNode(
    'c',
    'c',
    {
      kind: 'scatter',
      categories: [],
      fontFamily: 'Unavailable font',
      title: 'Title',
      titleFontFamily: 'Unavailable heading',
      series: [{ name: 'Series', xValues: [1, 2], values: [1, 2] }],
      legendPos: 'r',
      valAxis: { title: 'Vertical title' },
    },
    box,
    vp,
    {
      measure: (text, style) => base.measure(text, style),
      metrics: (style) => base.metrics(style),
      displayFamily: (style) =>
        style.fontFamily === 'Unavailable heading' ? 'Heading substitute' : 'Body substitute',
    },
  )!
  expect(node.labels.find((label) => label.text === 'Title')?.fontFamily).toBe('Heading substitute')
  expect(node.labels.find((label) => label.text === 'Vertical title')?.fontFamily).toBe(
    'Body substitute',
  )
  expect(node.labels.find((label) => label.text === 'Series')?.fontFamily).toBe('Body substitute')
})
