import { describe, expect, it } from 'vitest'
import { parseSlide } from '../src/parse'
import type { Theme } from '../src/theme'
const theme = {
  colors: { accent2: '#4B7F6B', lt1: '#FFFFFF', bg1: '#FFFFFF' },
  fillStyles: [{ 'a:solidFill': { 'a:schemeClr': { '@_val': 'phClr' } } }],
} as unknown as Theme
const style =
  '<a:tblStyleLst xmlns:a="a"><a:tblStyle styleId="custom"><a:wholeTbl><a:tcStyle><a:fill><a:noFill/></a:fill></a:tcStyle></a:wholeTbl><a:firstRow><a:tcTxStyle b="on"><a:schemeClr val="bg1"/></a:tcTxStyle><a:tcStyle><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef></a:tcStyle></a:firstRow></a:tblStyle></a:tblStyleLst>'
const cell = (props = '') =>
  `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>T1</a:t></a:r></a:p></a:txBody><a:tcPr>${props}</a:tcPr></a:tc>`
const xml = (props = '') =>
  `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Header"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"><a:tableStyleId>custom</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="1000000"/></a:tblGrid><a:tr h="500000">${cell(props)}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`
describe('table region theme fill references', () => {
  it('resolves the header fillRef with its own placeholder color over whole-table noFill', () => {
    const s = parseSlide({
      path: 'ppt/slides/slide1.xml',
      slideXml: xml(),
      ctx: { theme, tableStyles: style },
    })
    const t = s.elements[0]!
    expect(t.type === 'table' && t.rows[0]![0]!.fill).toEqual({ type: 'solid', color: '#4B7F6B' })
  })
  it('keeps an explicit cell noFill instead of inheriting the region fill', () => {
    const s = parseSlide({
      path: 'ppt/slides/slide1.xml',
      slideXml: xml('<a:noFill/>'),
      ctx: { theme, tableStyles: style },
    })
    const t = s.elements[0]!
    expect(t.type === 'table' && t.rows[0]![0]!.fill).toBeUndefined()
  })
})
