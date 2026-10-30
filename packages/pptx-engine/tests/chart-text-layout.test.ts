import { describe, expect, it } from 'vitest'
import { parseChartXml } from '../src/chart'
const xml =
  '<c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart><c:title><c:tx><c:rich><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr><a:r><a:rPr sz="2000"><a:latin typeface="+mj-lt"/></a:rPr><a:t>Performance</a:t></a:r></a:p></c:rich></c:tx><c:layout><c:manualLayout><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0.3"/><c:y val="0.075"/></c:manualLayout></c:layout><c:txPr><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr></a:p></c:txPr></c:title><c:plotArea><c:scatterChart><c:ser><c:xVal><c:numLit><c:pt idx="0"><c:v>1</c:v></c:pt></c:numLit></c:xVal><c:yVal><c:numLit><c:pt idx="0"><c:v>2</c:v></c:pt></c:numLit></c:yVal></c:ser></c:scatterChart><c:valAx><c:axId val="1"/><c:axPos val="b"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Size</a:t></a:r></a:p></c:rich></c:tx><c:layout><c:manualLayout><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0.33"/><c:y val="0.88"/></c:manualLayout></c:layout></c:title></c:valAx><c:valAx><c:axId val="2"/><c:axPos val="l"/><c:scaling><c:min val="0"/><c:max val="10"/></c:scaling></c:valAx></c:plotArea></c:chart></c:chartSpace>'
describe('authored chart title layouts', () => {
  it('retains title and axis-title positions and uses an explicit run size over the default', () => {
    const chart = parseChartXml(xml)!
    expect(chart.titlePt).toBe(20)
    expect(chart.titleLayout).toMatchObject({ x: 0.3, y: 0.075, xMode: 'edge', yMode: 'edge' })
    expect(chart.catAxis?.titleLayout).toMatchObject({ x: 0.33, y: 0.88 })
  })
})
