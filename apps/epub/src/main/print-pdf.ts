import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, session } from 'electron'
import { PDFDocument } from 'pdf-lib'
import { serveEpubAsset, type AssetBookLookup } from './asset-protocol'

/** Each chapter keeps its own stylesheet and starts on a fresh PDF page. */
export async function printBookPdf(
  chapters: readonly string[],
  token: string,
  lookup: AssetBookLookup,
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-epub-pdf-'))
  const partition = session.fromPartition('genoffice-epub-pdf-' + randomUUID())
  const target = join(dir, 'chapter.html')
  const targetUrl = pathToFileURL(target).href
  partition.protocol.handle('epub-asset', (request) => serveEpubAsset(request, lookup))
  partition.webRequest.onBeforeRequest((details, answer) => {
    const url = new URL(details.url)
    const permitted =
      details.url === targetUrl ||
      url.protocol === 'data:' ||
      (url.protocol === 'epub-asset:' && url.hostname === token)
    answer({ cancel: !permitted })
  })
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: partition,
      sandbox: true,
      javascript: false,
      backgroundThrottling: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    const merged = await PDFDocument.create()
    for (const html of chapters) {
      await writeFile(target, html, 'utf8')
      await win.loadFile(target)
      const bytes = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })
      const chapter = await PDFDocument.load(bytes)
      const pages = await merged.copyPages(chapter, chapter.getPageIndices())
      pages.forEach((page) => merged.addPage(page))
    }
    if (!merged.getPageCount()) throw new Error('The book has no printable pages.')
    return Buffer.from(await merged.save())
  } finally {
    win.destroy()
    partition.protocol.unhandle('epub-asset')
    await partition.closeAllConnections()
    await rm(dir, { recursive: true, force: true })
  }
}
