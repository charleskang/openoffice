import { test, expect } from '@playwright/test'
import JSZip from 'jszip'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchShell, closeAndSaveVideo, screenshotPath, waitForPageWithUrl } from './helpers'
import type { ElectronApplication } from '@playwright/test'

async function projectZip(root: string): Promise<string> {
  const zip = new JSZip()
  zip.file(
    'paper/main.tex',
    '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\section{Project}\n\\input{sections/body}\n\\includegraphics[width=1cm]{figures/chart.png}\n\\cite{demo}\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n',
  )
  zip.file('paper/sections/body.tex', 'Original child source.\n')
  zip.file(
    'paper/refs.bib',
    '@book{demo, author={Example Author}, title={Original title}, year={2026}, publisher={Example Press}}\n',
  )
  zip.file(
    'paper/figures/chart.png',
    await readFile(join(__dirname, '../apps/shell/src/renderer/src/assets/app-icon.png')),
  )
  const path = join(root, 'paper.zip')
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
  return path
}

async function mockImportDialogs(
  app: ElectronApplication,
  archive: string,
  parent: string,
): Promise<void> {
  await app.evaluate(
    ({ dialog }, { archive, parent }) => {
      dialog.showOpenDialog = (async (_window: unknown, options: { properties?: string[] }) => ({
        canceled: false,
        filePaths: options.properties?.includes('openDirectory') ? [parent] : [archive],
      })) as typeof dialog.showOpenDialog
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox
    },
    { archive, parent },
  )
}

test('ZIP import recognizes the main document, bibliography and figures and renders its PDF', async () => {
  test.setTimeout(360_000)
  const root = await mkdtemp(join(tmpdir(), 'officemax-project-e2e-'))
  const archive = await projectZip(root)
  const original = await readFile(archive)
  const parent = root
  await mkdir(parent, { recursive: true })
  const launched = await launchShell({
    onboardingSeen: true,
    recordVideo: false,
    lang: 'ko',
    videoDir: 'latex-project',
  })
  try {
    await mockImportDialogs(launched.app, archive, parent)
    await launched.page.locator('.workspace-actions button').click()
    const editor = await waitForPageWithUrl(launched.app, '://markdown/')
    const pane = editor.getByTestId('latex-project')
    await expect(pane).toBeVisible()
    const info = await editor.evaluate(() => window.markdownApi.latexProject())
    expect(info).not.toBeNull()
    expect(info!.files.some((file) => file.kind === 'bibliography')).toBe(true)
    expect(info!.files.some((file) => file.kind === 'image')).toBe(true)
    await expect(editor.locator('.latex-project-preview')).toContainText('main.tex')
    const compile = editor.getByRole('button', { name: '미리보기 갱신', exact: true })
    await expect(compile).toBeEnabled()
    await compile.click()
    await expect(editor.getByTestId('latex-pdf-canvas')).toHaveAttribute('data-rendered', 'true', {
      timeout: 280_000,
    })
    await expect(editor.locator('.latex-error')).toBeHidden()
    await mkdir(dirname(screenshotPath('latex-zip-project')), { recursive: true })
    await editor.screenshot({ path: screenshotPath('latex-zip-project') })
    expect(await readFile(archive)).toEqual(original)
  } finally {
    await closeAndSaveVideo(launched, 'latex-project')
  }
})

test('an optional real project preserves its sources and shows either the PDF or its source diagnostic', async () => {
  test.skip(!process.env.OFFICEMAX_LATEX_ZIP || !process.env.OFFICEMAX_LATEX_DEST)
  test.setTimeout(360_000)
  const archive = process.env.OFFICEMAX_LATEX_ZIP!
  const parent = process.env.OFFICEMAX_LATEX_DEST!
  const original = await readFile(archive)
  const launched = await launchShell({
    onboardingSeen: true,
    recordVideo: false,
    lang: 'ko',
    videoDir: 'latex-real-project',
  })
  try {
    await mockImportDialogs(launched.app, archive, parent)
    await launched.page.locator('.workspace-actions button').click()
    const editor = await waitForPageWithUrl(launched.app, '://markdown/')
    await expect(editor.getByTestId('latex-project')).toBeVisible()
    const info = await editor.evaluate(() => window.markdownApi.latexProject())
    const saved = await readFile(info!.mainPath)
    await writeFile(join(parent, 'project-inspection.json'), JSON.stringify(info, null, 2) + '\n')
    await editor.getByRole('button', { name: '미리보기 갱신', exact: true }).click()
    await expect
      .poll(
        async () => {
          if (await editor.locator('.latex-error').isVisible()) return true
          return (
            (await editor
              .getByTestId('latex-pdf-canvas')
              .getAttribute('data-rendered')
              .catch(() => null)) === 'true'
          )
        },
        { timeout: 280_000 },
      )
      .toBe(true)
    const errorLine = process.env.OFFICEMAX_EXPECT_LATEX_ERROR
    if (errorLine) {
      await expect(editor.locator('.latex-error')).toBeVisible()
      await editor
        .getByRole('button', { name: errorLine + '줄', exact: true })
        .first()
        .click()
      await expect(editor.locator('.source-editor .cm-content')).toBeFocused()
    } else
      await expect(editor.getByTestId('latex-pdf-canvas')).toHaveAttribute('data-rendered', 'true')
    await editor.screenshot({ path: screenshotPath('latex-real-project') })
    expect(await readFile(info!.mainPath)).toEqual(saved)
    expect(await readFile(archive)).toEqual(original)
  } finally {
    await closeAndSaveVideo(launched, 'latex-real-project')
  }
})

test('project navigation edits a bibliography and previews an unsaved child through the main document', async () => {
  test.setTimeout(300_000)
  const root = await mkdtemp(join(tmpdir(), 'officemax-project-nav-'))
  const archive = await projectZip(root)
  const launched = await launchShell({
    onboardingSeen: true,
    recordVideo: false,
    lang: 'ko',
    videoDir: 'latex-project-nav',
  })
  try {
    await mockImportDialogs(launched.app, archive, root)
    await launched.page.locator('.workspace-actions button').click()
    const main = await waitForPageWithUrl(launched.app, '://markdown/')
    await expect(main.getByTestId('latex-project')).toBeVisible()
    const info = await main.evaluate(() => window.markdownApi.latexProject())
    const bibliography = info!.files.find((file) => file.kind === 'bibliography')!
    await main.getByRole('button', { name: bibliography.relativePath, exact: true }).click()
    let bib = main
    await expect
      .poll(async () => {
        for (const page of launched.app.windows()) {
          if (!page.url().includes('://markdown/')) continue
          if (
            (await page.evaluate(() => window.markdownApi.consumePending()).catch(() => null)) ===
            bibliography.path
          ) {
            bib = page
            return true
          }
        }
        return false
      })
      .toBe(true)
    await expect(bib.getByTestId('latex-project')).toBeVisible()
    const updated =
      '@book{demo, author={Example Author}, title={Updated title}, year={2026}, publisher={Example Press}}'
    const source = bib.locator('.source-editor .cm-content')
    await source.click()
    await bib.keyboard.press('ControlOrMeta+a')
    await bib.keyboard.insertText(updated)
    await bib.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(bibliography.path, 'utf8')).toContain(updated)
    const child = info!.files.find((file) => file.relativePath.endsWith('body.tex'))!
    await bib.getByRole('button', { name: child.relativePath, exact: true }).click()
    let childPage = bib
    await expect
      .poll(async () => {
        for (const page of launched.app.windows()) {
          if (!page.url().includes('://markdown/')) continue
          if (
            (await page.evaluate(() => window.markdownApi.consumePending()).catch(() => null)) ===
            child.path
          ) {
            childPage = page
            return true
          }
        }
        return false
      })
      .toBe(true)
    await expect(childPage.getByTestId('latex-project')).toBeVisible()
    await childPage.locator('.source-editor .cm-content').click()
    await childPage.keyboard.press('ControlOrMeta+a')
    await childPage.keyboard.insertText('Unsaved child buffer included in the main PDF.')
    await expect(childPage.locator('.latex-project-preview')).toContainText('paper/main.tex')
    await childPage.getByRole('button', { name: '미리보기 갱신', exact: true }).click()
    await expect(childPage.getByTestId('latex-pdf-canvas')).toHaveAttribute(
      'data-rendered',
      'true',
      { timeout: 240_000 },
    )
    expect(await readFile(child.path, 'utf8')).toBe('Original child source.\n')
  } finally {
    await closeAndSaveVideo(launched, 'latex-project-nav')
  }
})
