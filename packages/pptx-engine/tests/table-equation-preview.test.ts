import { describe, expect, it } from 'vitest'
import { parseSlide } from '../src/parse'
import type { Theme } from '../src/theme'

const frame = (body: string) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Equation table"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="2628900" cy="1018286"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="2628900"/></a:tblGrid><a:tr h="1018286"><a:tc>${body}</a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
const choice = frame(
  '<a:txBody><a:bodyPr/><a:p><a14:m><m:oMath><m:r><m:t>1.25×10</m:t></m:r><m:sSup><m:sup><m:r><m:t>6</m:t></m:r></m:sup></m:sSup></m:oMath></a14:m></a:p></a:txBody><a:tcPr/>',
)
const fallback = frame(
  '<a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr><a:blipFill><a:blip r:embed="rIdPreview"/><a:stretch><a:fillRect t="-60185"/></a:stretch></a:blipFill></a:tcPr>',
)
const xml = `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r" xmlns:mc="mc" xmlns:a14="a14" xmlns:m="m"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><mc:AlternateContent><mc:Choice Requires="a14">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent></p:spTree></p:cSld></p:sld>`

describe('table equation compatibility previews', () => {
  it('keeps the equation choice and its original bytes while exposing the fallback fill for display', () => {
    const slide = parseSlide({
      path: 'ppt/slides/slide1.xml',
      slideXml: xml,
      ctx: {
        theme: { colors: {} } as Theme,
        mediaRels: new Map([['rIdPreview', 'ppt/media/equation.png']]),
      },
    })
    const table = slide.elements[0]!
    expect(table.type).toBe('table')
    if (table.type !== 'table') return
    expect(table.rows[0]![0]!.equationPreviewFill).toMatchObject({
      type: 'image',
      mediaRef: 'ppt/media/equation.png',
      fillRect: { t: -0.60185 },
    })
    expect(table.rows[0]![0]!.fill).toBeUndefined()
    expect(table.anchor.originalXml).toContain(choice)
    expect(table.anchor.originalXml).toContain(fallback)
    expect(table.dirty).toBeFalsy()
  })
  it('does not add an equation preview to an ordinary cell or a choice without a bitmap fallback', () => {
    for (const source of [
      xml.replace('<a14:m>', '<a:r>').replace('</a14:m>', '</a:r>'),
      xml.replace('r:embed="rIdPreview"', ''),
    ]) {
      const slide = parseSlide({
        path: 'ppt/slides/slide1.xml',
        slideXml: source,
        ctx: { theme: { colors: {} } as Theme },
      })
      const table = slide.elements[0]!
      expect(table.type === 'table' && table.rows[0]![0]!.equationPreviewFill).toBeFalsy()
    }
  })
})
