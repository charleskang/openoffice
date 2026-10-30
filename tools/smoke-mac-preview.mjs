/* global window */
// Run against a packaged preview with disposable documents and settings only.
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile, chmod, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const { _electron: electron, expect } = require('@playwright/test')
const JSZip = require('jszip')
const { PDFDocument } = require('pdf-lib')
const bundle = resolve(process.argv[2])
const out = resolve(process.argv[3] ?? 'preview-checks')
const executable = join(bundle, 'Contents/MacOS/OfficeMax')
const resources = join(bundle, 'Contents/Resources')
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon host required')
await mkdir(out, { recursive: true })
const scratch = await mkdtemp(join(tmpdir(), 'officemax-mac-preview-'))
const profile = join(scratch, 'profile')
await mkdir(profile)
const stub = join(scratch, 'subscription-stub')
await writeFile(
  stub,
  '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.0.1"; else echo "Not logged in"; fi\n',
)
await chmod(stub, 0o755)
await writeFile(
  join(profile, 'ai-settings.json'),
  JSON.stringify({
    providers: { codex: { cliPath: stub }, 'claude-code': { cliPath: stub } },
    subscriptionNoticeSeen: true,
  }),
)
await writeFile(
  join(profile, 'app-settings.json'),
  JSON.stringify({
    onboardingSeen: true,
    theme: 'light',
    language: 'en',
    aiPanelOpenInNewDocs: false,
    aiPanelShowSidebar: false,
    defaultSaveDir: scratch,
  }),
)
const env = {
  ...process.env,
  GENOFFICE_USER_DATA: profile,
  GENOFFICE_NO_SPARE_VIEW: '1',
  GENOFFICE_DEBUG_HOOKS: '1',
  GENOFFICE_LANG: 'en',
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
}
delete env.ELECTRON_RUN_AS_NODE
delete env.GENOFFICE_TECTONIC_PATH
for (const path of ['native/xlsx-sidecar', 'latex/tectonic', 'ocr/vision-ocr'])
  await stat(join(resources, path))
const engine = spawnSync(join(resources, 'latex/tectonic'), ['--version'], { encoding: 'utf8' })
if (engine.status !== 0) throw Error('Bundled Tectonic cannot run: ' + engine.stderr)
// Populate Tectonic's support-file cache before isolating the GUI's network.
// Only the local compiler runs here; no source is sent to an AI provider.
const warmup = join(scratch, 'warmup.tex')
await writeFile(
  warmup,
  '\\documentclass{article}\\usepackage{fontspec}\\setmainfont{Apple SD Gothic Neo}\\begin{document}Local compile. 한글 확인.\\[ E=mc^2 \\]\\end{document}',
)
const warm = spawnSync(
  join(resources, 'latex/tectonic'),
  ['-X', 'compile', '--untrusted', '--outdir', scratch, warmup],
  { encoding: 'utf8', timeout: 300000, env: { ...process.env, TECTONIC_UNTRUSTED_MODE: '1' } },
)
await writeFile(join(out, 'latex-warmup.log'), (warm.stdout ?? '') + (warm.stderr ?? ''))
if (warm.status !== 0) throw Error('Bundled local LaTeX compile failed')
const checks = {
  architecture: process.arch,
  os: process.platform,
  latexEngine: engine.stdout.trim(),
  headless: [],
  wholeWorkbookPdf: false,
  latexZipPreview: false,
  sourceUnchanged: false,
}
for (const [name, text] of [
  ['note.md', '# OfficeMax Mac\n\nPackaged app check.'],
  ['table.csv', 'name,value\nAlpha,125\nBeta,250\n'],
]) {
  const input = join(scratch, name),
    target = join(out, name + '.pdf')
  await writeFile(input, text)
  const run = spawnSync(
    executable,
    [
      '--user-data-dir=' + profile,
      '--headless-export',
      input,
      '--to',
      'pdf',
      '--out',
      target,
      '--json',
    ],
    { env, encoding: 'utf8', timeout: 180000 },
  )
  await writeFile(join(out, name + '.log'), run.stdout + run.stderr)
  if (run.status !== 0) throw Error('Headless export failed for ' + name)
  const pdf = await PDFDocument.load(await readFile(target))
  if (pdf.getPageCount() < 1) throw Error('Empty PDF for ' + name)
  checks.headless.push(name)
}
const zip = new JSZip()
zip.file(
  '[Content_Types].xml',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
)
zip.file(
  '_rels/.rels',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
)
zip.file(
  'xl/workbook.xml',
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="First" sheetId="1" r:id="rId1"/><sheet name="Second" sheetId="2" r:id="rId2"/></sheets></workbook>',
)
zip.file(
  'xl/_rels/workbook.xml.rels',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
)
for (let i = 1; i <= 2; i++)
  zip.file(
    `xl/worksheets/sheet${i}.xml`,
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Sheet ${i}</t></is></c><c r="B1"><v>${i * 125}</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Mac preview</t></is></c></row></sheetData><pageSetup paperSize="9" orientation="${i === 1 ? 'portrait' : 'landscape'}"/></worksheet>`,
  )
const workbook = join(scratch, 'two-sheets.xlsx')
await writeFile(workbook, await zip.generateAsync({ type: 'nodebuffer' }))
const project = new JSZip()
project.file(
  'paper/main.tex',
  '\\documentclass{article}\n\\usepackage{fontspec}\n\\setmainfont{Apple SD Gothic Neo}\n\\begin{document}\nOfficeMax M5 preview.\n\\input{section}\n\\[ E=mc^2 \\]\n\\end{document}',
)
project.file('paper/section.tex', 'Mac LaTeX project input. 한글 문서 확인.')
project.file(
  'paper/references.bib',
  '@article{preview,title={Preview},author={OfficeMax},year={2026}}',
)
const archive = join(scratch, 'latex-project.zip')
await writeFile(archive, await project.generateAsync({ type: 'nodebuffer' }))
const sha = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
const before = [await sha(workbook), await sha(archive)]
const app = await electron.launch({
  executablePath: executable,
  args: ['--user-data-dir=' + profile, '--proxy-server=http://127.0.0.1:9', workbook],
  env,
  timeout: 60000,
})
try {
  await app.firstWindow()
  let shell, sheet
  await expect
    .poll(
      () => {
        shell = app
          .windows()
          .find((p) => p.url().startsWith('file:') && p.url().includes('/renderer/index.html'))
        return !!shell
      },
      { timeout: 60000 },
    )
    .toBe(true)
  await shell.waitForFunction(() => !!window.aiOffice?.openPath)
  await app.evaluate(({ BrowserWindow, dialog }, parent) => {
    BrowserWindow.getAllWindows()[0].setSize(1600, 1000)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parent] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: global.__macPdfTarget })
  }, scratch)
  await expect
    .poll(
      () => {
        sheet = app.windows().find((p) => p.url().includes('://sheets/'))
        return !!sheet
      },
      { timeout: 60000 },
    )
    .toBe(true)
  await expect(sheet.locator('.workbook-opening-screen')).toBeHidden({ timeout: 60000 })
  await sheet.waitForFunction(() => !!window.__genofficeDebug?.univerAPI?.getActiveWorkbook())
  const exportScope = async (scope, name, count) => {
    const target = join(out, name + '.pdf')
    await app.evaluate((_, path) => {
      global.__macPdfTarget = path
    }, target)
    await app.evaluate(({ Menu }) => {
      const visit = (items) =>
        items.flatMap((i) => [i, ...(i.submenu ? visit(i.submenu.items) : [])])
      const item = visit(Menu.getApplicationMenu().items).find((i) =>
        /^Export (?:(?:as|to) )?PDF/.test(i.label),
      )
      if (!item) throw Error('PDF menu missing')
      item.click()
    })
    const modal = sheet.getByTestId('pdf-export-dialog')
    await expect(modal).toBeVisible()
    await modal.getByRole('radio', { name: scope, exact: true }).check()
    await modal.getByRole('button', { name: 'Print to PDF', exact: true }).click()
    await expect
      .poll(async () => (existsSync(target) ? (await stat(target)).size : 0), { timeout: 90000 })
      .toBeGreaterThan(1000)
    await expect(modal).toBeHidden()
    const pdf = await PDFDocument.load(await readFile(target))
    expect(pdf.getPageCount()).toBe(count)
    return pdf
  }
  await exportScope('Active sheet', 'current-sheet', 1)
  const all = await exportScope('Entire workbook', 'whole-workbook', 2)
  expect(all.getPages()[0].getWidth()).toBeLessThan(all.getPages()[0].getHeight())
  expect(all.getPages()[1].getWidth()).toBeGreaterThan(all.getPages()[1].getHeight())
  checks.wholeWorkbookPdf = true
  await sheet.screenshot({ path: join(out, 'sheets.png') })
  await shell.evaluate((path) => window.aiOffice.openPath(path), archive)
  let latex
  await expect
    .poll(
      () => {
        latex = app.windows().find((p) => p.url().includes('://markdown/'))
        return !!latex
      },
      { timeout: 60000 },
    )
    .toBe(true)
  const workspace = latex.getByTestId('latex-workspace')
  await expect(workspace).toBeVisible()
  await expect(latex.locator('.latex-project-preview')).toContainText('main.tex')
  await workspace.getByRole('button', { name: 'Update preview', exact: true }).click()
  await expect(workspace.getByTestId('latex-pdf-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 300000,
  })
  await expect(workspace.locator('.latex-error')).toBeHidden()
  await latex.screenshot({ path: join(out, 'latex-zip.png') })
  checks.latexZipPreview = true
  expect([await sha(workbook), await sha(archive)]).toEqual(before)
  checks.sourceUnchanged = true
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
}
await writeFile(join(out, 'result.json'), JSON.stringify(checks, null, 2))
console.log(JSON.stringify(checks))
