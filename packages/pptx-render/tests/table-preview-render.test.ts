import { describe, expect, it } from 'vitest'
import type { Slide, TableElement } from '@genoffice/pptx-engine'
import type { TableRenderNode } from '../src/render-tree'
import { buildRenderSlide } from '../src/index'

describe('table equation preview rendering', () => {
  const table = {
    type: 'table',
    id: 't',
    name: 'equation table',
    anchor: { spIndex: 0, originalXml: '', range: [0, 0] },
    transform: {
      offset: { x: 0, y: 0, cx: 2628900, cy: 1018286 },
      rot: 0,
      flipH: false,
      flipV: false,
    },
    colWidths: [2628900],
    rowHeights: [1018286],
    rows: [
      [
        {
          text: { paragraphs: [{ runs: [] }] },
          equationPreviewFill: {
            type: 'image',
            mediaRef: 'preview.png',
            fillRect: { l: 0, t: -0.6, r: 0, b: 0 },
          },
        },
      ],
    ],
  } as unknown as TableElement
  const slide = { path: 'ppt/slides/slide1.xml', elements: [table] } as Slide
  const size = { cx: 9144000, cy: 6858000 }
  it('uses the compatibility image and its crop in an empty equation cell', () => {
    const node = buildRenderSlide(slide, size, {
      fitWidthPx: 960,
      media: () => 'data:image/png;base64,AA==',
    }).nodes[0] as TableRenderNode
    expect(node.cells[0]!.fill).toMatchObject({ kind: 'image', fillRect: { t: -0.6 } })
  })
  it('stops using the preview when the user replaces the cell with text', () => {
    const cell = {
      ...table.rows[0]![0]!,
      text: { paragraphs: [{ runs: [{ text: 'new value' }] }] },
    }
    const edited = { ...table, rows: [[cell]] }
    const node = buildRenderSlide({ ...slide, elements: [edited] }, size, {
      fitWidthPx: 960,
      media: () => 'data:image/png;base64,AA==',
    }).nodes[0] as TableRenderNode
    expect(node.cells[0]!.fill.kind).toBe('none')
  })
})
