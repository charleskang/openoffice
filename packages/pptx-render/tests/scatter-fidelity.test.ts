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
const metrics = new HeuristicMetrics()
const model: ChartModel = {
  kind: 'scatter',
  categories: [],
  scatterStyle: 'lineMarker',
  series: [
    {
      name: 'VS',
      xValues: [17010, 33075, 54432, 252000],
      values: [0.016, 0.007, 0.01, -0.415],
      marker: true,
      lineWidthPt: 3,
    },
  ],
  title: 'Performance',
  legendPos: 'r',
  plotLayout: { x: 0.12, y: 0.2, w: 0.75, h: 0.55 },
  catAxis: {
    min: 15000,
    max: 300000,
    logBase: 10,
    tickLblHidden: true,
    lineColor: '#FF0000',
    lineDash: 'dash',
    lineWidthEmu: 19050,
    title: 'Problem size (log scale)',
  },
  valAxis: {
    min: -0.5,
    max: 0.1,
    numFmt: '0%',
    gridColor: '#CCCCCC',
    title: 'Relative difference (%)',
  },
}

describe('scatter chart axes and layout', () => {
  it('places points logarithmically inside the saved full-frame plot rectangle', () => {
    const node = buildChartNode('c', 'c', model, box, vp, metrics)!
    const points = node.polylines[0]!.points
    expect(points[0]).toBeCloseTo(120 + (750 * Math.log(17010 / 15000)) / Math.log(20), 5)
    expect(points[2]).toBeCloseTo(120 + (750 * Math.log(33075 / 15000)) / Math.log(20), 5)
    expect(points[1]).toBeCloseTo(120 + 330 * (1 - (0.016 + 0.5) / 0.6), 5)
    expect(node.polylines[0]!.widthPx).toBeCloseTo(4)
  })
  it('formats percentages and draws both axis titles and the zero crossing', () => {
    const node = buildChartNode('c', 'c', model, box, vp, metrics)!
    expect(node.labels.some((l) => l.text === '-50%')).toBe(true)
    expect(node.labels.some((l) => l.text === '10%')).toBe(true)
    expect(node.labels.some((l) => l.text === 'Problem size (log scale)')).toBe(true)
    expect(node.labels.find((l) => l.text === 'Relative difference (%)')?.rotationDeg).toBe(-90)
    const axis = node.axisLines.find((l) => l.color === '#FF0000')!
    expect(axis.y1).toBeCloseTo(120 + 330 / 6, 5)
    expect(axis.widthPx).toBeCloseTo(2)
    expect(axis.dash?.length).toBeGreaterThan(0)
    expect(node.labels.find((l) => l.text === 'VS')!.x).toBeLessThan(box.w)
  })
  it('supports a logarithmic vertical axis and omits nonpositive log points without NaN', () => {
    const log: ChartModel = {
      kind: 'scatter',
      categories: [],
      series: [{ xValues: [1, 10, 100], values: [1, 0, 100], marker: true }],
      catAxis: { min: 1, max: 100, logBase: 10 },
      valAxis: { min: 1, max: 100, logBase: 10 },
    }
    const node = buildChartNode('c', 'c', log, box, vp, metrics)!
    expect(node.markers).toHaveLength(2)
    expect(node.markers.every((m) => Number.isFinite(m.x) && Number.isFinite(m.y))).toBe(true)
  })
  it('keeps extremely wide logarithmic ranges finite', () => {
    const extreme: ChartModel = {
      kind: 'scatter',
      categories: [],
      series: [{ xValues: [1e-300, 1e300], values: [1e-300, 1e300], marker: true }],
      catAxis: { min: 1e-300, max: 1e300, logBase: 10 },
      valAxis: { min: 1e-300, max: 1e300, logBase: 10 },
    }
    const node = buildChartNode('c', 'c', extreme, box, vp, metrics)!
    expect(node.markers.every((m) => Number.isFinite(m.x) && Number.isFinite(m.y))).toBe(true)
    expect(node.gridLines.every((l) => [l.x1, l.y1, l.x2, l.y2].every(Number.isFinite))).toBe(true)
  })
})

it('honors multiplicative major units on log axes without changing data positions', () => {
  const base = { ...model, catAxis: { ...model.catAxis, majorUnit: 10, gridColor: '#AAAAAA' } }
  const sparse = { ...base, catAxis: { ...base.catAxis, majorUnit: 1000 } }
  const a = buildChartNode('a', 'a', base, box, vp, metrics)!
  const b = buildChartNode('b', 'b', sparse, box, vp, metrics)!
  expect(a.gridLines.filter((l) => l.x1 === l.x2)).toHaveLength(1)
  expect(b.gridLines.filter((l) => l.x1 === l.x2)).toHaveLength(0)
  expect(b.polylines[0]!.points).toEqual(a.polylines[0]!.points)
})
