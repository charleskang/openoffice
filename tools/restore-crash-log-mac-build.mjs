// Only the shell main changes; all editor and native outputs must match this base.
import { cpSync, copyFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const base = 'efb906ab5c14b5c91a867bbf60a4c61586ea9324'
const allowed = new Set([
  'apps/shell/src/main/index.ts',
  'apps/shell/src/main/crash-diagnostics.ts',
  'apps/shell/src/main/crash-diagnostics-runtime.ts',
  'apps/shell/tests/crash-diagnostics.test.ts',
  'apps/shell/tests/crash-diagnostics-runtime.test.ts',
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
  throw Error('Changed editors require a complete Mac build: ' + changes.join(', '))
const root = process.cwd()
const resources = join(resolve(process.argv[2]), 'Contents/Resources')
const unpack = resolve('candidate-source')
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
mkdirSync(join(root, 'apps/shell/build'), { recursive: true })
copyFileSync(
  join(resources, 'THIRD-PARTY-NOTICES.txt'),
  join(root, 'apps/shell/build/THIRD-PARTY-NOTICES.txt'),
)
console.log(
  JSON.stringify({ base, changedApplicationFiles: changes, rebuild: 'shell', restoredEditors: 9 }),
)
