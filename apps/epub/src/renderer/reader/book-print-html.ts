import { buildChapterHtml } from './chapter-html'
import type { EpubChapterResult } from '../../shared/ipc'

/** Drawing copy only: the EPUB's source bytes are never serialized or saved. */
export function bookChapterPrintHtml(
  chapter: Extract<EpubChapterResult, { ok: true }>,
  baseUrl: string,
): string {
  let page = 'size: A4; margin: .6in'
  if (chapter.readOnly === 'fixed-layout-book' || chapter.readOnly === 'fixed-layout-chapter') {
    const parsed = new DOMParser().parseFromString(chapter.source, 'text/html')
    const viewport = parsed.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? ''
    const w = Number(/width\s*=\s*([\d.]+)/i.exec(viewport)?.[1])
    const h = Number(/height\s*=\s*([\d.]+)/i.exec(viewport)?.[1])
    if (w >= 96 && h >= 96 && w <= 9600 && h <= 9600)
      page = 'size: ' + w + 'px ' + h + 'px; margin: 0'
  }
  return buildChapterHtml({
    source: chapter.source,
    broken: chapter.broken,
    blocks: [],
    baseUrl,
    viewCss: `@page { ${page}; }
      html, body { color: #000; background: #fff; }
      body { margin: 0; overflow: visible; }
      img, svg { max-width: 100%; height: auto; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; }
      h1,h2,h3,h4 { break-after: avoid; }
      table,figure { break-inside: avoid; }
      a { color: inherit; }`,
  })
}
