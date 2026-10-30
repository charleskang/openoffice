import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** PDF.js needs local CID mappings even when the PDF embeds its font program. */
export function preparePdfjsAssets(publicDir: string): string {
  const require = createRequire(import.meta.url)
  const source = dirname(require.resolve('pdfjs-dist/package.json'))
  const target = join(publicDir, 'pdfjs')
  mkdirSync(target, { recursive: true })
  for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    if (!existsSync(join(source, name))) throw new Error('PDF.js asset directory missing: ' + name)
    cpSync(join(source, name), join(target, name), { recursive: true })
  }
  cpSync(join(source, 'LICENSE'), join(target, 'LICENSE'))
  return publicDir
}
