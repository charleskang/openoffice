// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { preparePdfjsAssets } from '../pdfjs-assets'

it('ships the Korean CID map, fallback fonts and decoders needed by real PDFs without a network request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'officemax-pdfjs-assets-'))
  try {
    expect(preparePdfjsAssets(root)).toBe(root)
    expect((await stat(join(root, 'pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap'))).size).toBeGreaterThan(
      20000,
    )
    expect((await stat(join(root, 'pdfjs/standard_fonts/FoxitDingbats.pfb'))).size).toBeGreaterThan(
      0,
    )
    expect((await stat(join(root, 'pdfjs/wasm/openjpeg.wasm'))).size).toBeGreaterThan(0)
    expect(await readFile(join(root, 'pdfjs/LICENSE'), 'utf8')).toContain('Apache')
  } finally {
    if (
      dirname(resolve(root)) === resolve(tmpdir()) &&
      basename(root).startsWith('officemax-pdfjs-assets-')
    )
      await rm(root, { recursive: true, force: true })
  }
})
