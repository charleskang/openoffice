import { describe, expect, it } from 'vitest'
import { bookChapterPrintHtml } from '../src/renderer/reader/book-print-html'
import type { EpubChapterResult } from '../src/shared/ipc'
const base = 'epub-asset://abc/OEBPS/text/one.xhtml'
const chapter = (source: string): Extract<EpubChapterResult, { ok: true }> => ({
  ok: true,
  source,
  path: 'OEBPS/text/one.xhtml',
  spineIndex: 0,
  version: 0,
  broken: false,
  blocks: [],
  readOnly: null,
})
describe('whole-book PDF drawing copies', () => {
  it('preserves chapter styles and local images without running book code or dark-view styles', () => {
    const html = bookChapterPrintHtml(
      chapter(
        '<html><head><style>h1 {color: green}</style><link rel="stylesheet" href="../book.css"/><script>bad()</script></head><body><h1 onclick="bad()">Title</h1><img src="../images/pic.png"/><p>한글 수식</p></body></html>',
      ),
      base,
    )
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('base')?.href).toBe(base)
    expect(doc.querySelector('h1')?.textContent).toBe('Title')
    expect(doc.querySelector('link')?.getAttribute('href')).toBe('../book.css')
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('../images/pic.png')
    expect(doc.querySelector('script')).toBeNull()
    expect(doc.querySelector('[onclick]')).toBeNull()
    expect(html).toContain("script-src 'none'")
    expect(html).toContain('background: #fff')
    expect(html).toContain('size: A4')
  })
  it('keeps a bounded fixed-layout page size rather than cropping it to A4', () => {
    const item = chapter(
      '<html><head><meta name="viewport" content="width=1200,height=900"/></head><body><p>Wide book</p></body></html>',
    )
    item.readOnly = 'fixed-layout-book'
    expect(bookChapterPrintHtml(item, base)).toContain('size: 1200px 900px; margin: 0')
    item.source = item.source.replace('1200', '9999999')
    expect(bookChapterPrintHtml(item, base)).toContain('size: A4')
  })
})
