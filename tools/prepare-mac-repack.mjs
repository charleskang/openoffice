// Restore outputs whose application source is unchanged; rebuild Markdown separately.
import { cpSync, copyFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
const require = createRequire(import.meta.url),
  asar = require('@electron/asar'),
  root = process.cwd()
const base = '616ff2fd9c9cb32b71e06edf407f1ee8bb5bd7e4'
const allowed = new Set([
  'apps/markdown/pdfjs-assets.ts',
  'apps/markdown/electron.vite.config.ts',
  'apps/markdown/vite.renderer.config.ts',
  'apps/markdown/src/renderer/latex/PdfPreview.tsx',
  'apps/markdown/tests/pdfjs-assets.test.ts',
])
const changes = execFileSync(
  'git',
  [
    'diff',
    '--name-only',
    base,
    'HEAD',
    '--',
    'apps',
    'packages',
    'package.json',
    'package-lock.json',
  ],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean)
if (changes.some((file) => !allowed.has(file)))
  throw Error('Changed application code cannot reuse the base build: ' + changes.join(', '))
const app = resolve(process.argv[2]),
  resources = join(app, 'Contents/Resources'),
  unpack = resolve('candidate-source')
asar.extractAll(join(resources, 'app.asar'), unpack)
cpSync(join(unpack, 'out'), join(root, 'apps/shell/out'), { recursive: true })
for (const name of [
  'docs',
  'sheets',
  'slides',
  'pdf',
  'markdown',
  'html',
  'mindmap',
  'hwp',
  'epub',
])
  cpSync(join(resources, 'modules', name), join(root, 'apps', name, 'out'), { recursive: true })
cpSync(join(resources, 'cli'), join(root, 'packages/cli/dist'), { recursive: true })
const sidecar = join(root, 'apps/sheets/native/xlsx-engine/target/release/xlsx-sidecar')
mkdirSync(join(sidecar, '..'), { recursive: true })
copyFileSync(join(resources, 'native/xlsx-sidecar'), sidecar)
copyFileSync(
  join(resources, 'ocr/vision-ocr'),
  join(root, 'packages/pdf2docx/ocr-helper/vision-ocr'),
)
copyFileSync(
  join(resources, 'THIRD-PARTY-NOTICES.txt'),
  join(root, 'apps/shell/build/THIRD-PARTY-NOTICES.txt'),
)
console.log(
  JSON.stringify({
    base,
    changedApplicationFiles: changes,
    rebuild: 'markdown',
    restoredEditors: 9,
  }),
)
