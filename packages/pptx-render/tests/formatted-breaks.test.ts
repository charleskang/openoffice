import { describe, expect, it } from 'vitest'
import { layoutText } from '../src/text-layout'
import { HeuristicMetrics } from '../src/metrics'
import { makeViewport } from '../src/coords'
const vp = makeViewport({ cx: 9525000, cy: 9525000 }, 1000)
const metrics = new HeuristicMetrics()
describe('formatted soft-break lines', () => {
  it('uses the break formatting for an empty line and the paragraph mark after a trailing break', () => {
    const t = layoutText({
      body: {
        insets: { l: 0, t: 0, r: 0, b: 0 },
        paragraphs: [
          {
            runs: [
              { text: 'Heading', fontSize: 18 },
              { text: '\n', fontSize: 8 },
              { text: '\n', fontSize: 8 },
            ],
            endRun: { text: '', fontSize: 6 },
          },
        ],
      },
      boxWidthPx: 800,
      boxHeightPx: 500,
      metrics,
      vp,
    })
    expect(t.lines).toHaveLength(3)
    expect(t.lines[1]!.height).toBeLessThan(t.lines[0]!.height)
    expect(t.lines[2]!.height).toBeLessThan(t.lines[1]!.height)
  })
})
