import { describe, expect, it } from 'vitest'
import { parseSlide } from '../src/parse'
const xml =
  '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800"/><a:t>Heading</a:t></a:r><a:br><a:rPr sz="800"/></a:br><a:br><a:rPr sz="800"/></a:br><a:endParaRPr sz="600"/></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
describe('soft break run properties', () => {
  it('keeps each break style and the final paragraph mark without adding text runs', () => {
    const s = parseSlide({ path: 'ppt/slides/slide1.xml', slideXml: xml, ctx: {} })
    const e = s.elements[0]!
    if (e.type !== 'text' && e.type !== 'shape') throw new Error('Expected text')
    expect(e.text!.paragraphs[0]!.runs.map((r) => [r.text, r.fontSize])).toEqual([
      ['Heading', 18],
      ['\n', 8],
      ['\n', 8],
    ])
    expect(e.text!.paragraphs[0]!.endRun?.fontSize).toBe(6)
    expect(e.anchor.originalXml).toContain('<a:br><a:rPr sz="800"/></a:br>')
  })
})
