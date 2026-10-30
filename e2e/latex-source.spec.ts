import { test, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo, screenshotPath } from './helpers'

test('Korean home displays the OfficeMax name and icon', async () => {
  const launched = await launchShell({
    onboardingSeen: true,
    recordVideo: false,
    lang: 'ko',
    videoDir: 'officemax-home',
  })
  try {
    await expect(launched.page.locator('.workspace-brand-name')).toHaveText('오피스Max')
    await expect(launched.page.getByTestId('workspace-start')).toBeVisible()
    const icon = launched.page.locator('.workspace-brand-icon')
    await expect(icon).toBeVisible()
    expect(await icon.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(
      true,
    )
    await mkdir(dirname(screenshotPath('officemax-home')), { recursive: true })
    await launched.page.screenshot({ path: screenshotPath('officemax-home') })
  } finally {
    await closeAndSaveVideo(launched, 'officemax-home')
  }
})

test('LaTeX source survives editing, saving and Save As without Markdown asset rewriting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'office-latex-'))
  const sourceDir = join(dir, '작업 폴더')
  const exportDir = join(dir, 'exports')
  await mkdir(sourceDir)
  await mkdir(exportDir)
  const path = join(sourceDir, 'main.tex')
  const copy = join(exportDir, 'copy.ltx')
  const raw =
    '\uFEFF\\documentclass{article}\r\n% ![literal](figure.png)\r\n\\begin{document}\r\n한글 $x_1^2$ \\% \\input{part}\r\n\\end{document}'
  await writeFile(path, raw)
  await writeFile(join(sourceDir, 'figure.png'), 'not an image: referenced only in a TeX comment')
  const launched = await launchShell({
    onboardingSeen: true,
    recordVideo: false,
    videoDir: 'latex-source',
    openFile: path,
    settings: { defaultSaveDir: dir },
  })
  try {
    const editor = await waitForPageWithUrl(launched.app, '://markdown/')
    const source = editor.locator('[data-source-mode="latex"] .cm-content')
    await expect(source).toBeVisible()
    await expect(source).toContainText('\\documentclass{article}')
    await expect(editor.locator('.ai-dock')).toBeHidden()
    expect(await readFile(path, 'utf8')).toBe(raw)
    await source.click()
    await editor.keyboard.press('ControlOrMeta+End')
    await editor.keyboard.insertText('\n% local edit')
    await editor.keyboard.press('ControlOrMeta+s')
    const edited = raw + '\r\n% local edit'
    await expect.poll(() => readFile(path, 'utf8')).toBe(edited)

    await launched.app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
    }, copy)
    await editor.keyboard.press('ControlOrMeta+Shift+s')
    await expect.poll(() => readFile(copy, 'utf8').catch(() => '')).toBe(edited)
    expect(existsSync(join(exportDir, 'assets'))).toBe(false)
    expect(await readFile(path, 'utf8')).toBe(edited)
    await mkdir(dirname(screenshotPath('latex-source-editor')), { recursive: true })
    await editor.screenshot({ path: screenshotPath('latex-source-editor') })
  } finally {
    await closeAndSaveVideo(launched, 'latex-source')
  }
})

test('home offers workspace tasks before the full format catalogue', async () => {
  const launched = await launchShell({
    onboardingSeen: true,
    recordVideo: false,
    videoDir: 'workspace-home',
  })
  try {
    await expect(launched.page.locator('.workspace-brand-name')).toHaveText('OfficeMax')
    expect(await launched.app.evaluate(({ app }) => app.getName())).toBe('OfficeMax')
    await expect(launched.page.getByTestId('workspace-start')).toBeVisible()
    await expect(launched.page.getByRole('heading', { name: 'My workspace' })).toBeVisible()
    await expect(launched.page.locator('.workspace-actions button')).toHaveCount(1)
    await expect(launched.page.getByRole('button', { name: 'Open LaTeX / ZIP' })).not.toBeVisible()
    await expect(launched.page.locator('.workspace-create')).not.toHaveAttribute('open')
    await mkdir(dirname(screenshotPath('workspace-home')), { recursive: true })
    await launched.page.screenshot({ path: screenshotPath('workspace-home') })
    await launched.page.locator('.workspace-create summary').click()
    await expect(launched.page.locator('.workspace-create .quick-cards')).toBeVisible()
    await expect(launched.page.getByTestId('open-latex-card')).toBeVisible()
    await expect(launched.page.getByTestId('open-latex-card')).toHaveClass('quick-card')
    const dir = await mkdtemp(join(tmpdir(), 'office-ltx-'))
    const path = join(dir, 'note.ltx')
    const raw = '\\section{Source only}\n% LF without BOM\n'
    await writeFile(path, raw)
    await launched.app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, path)
    await launched.page.getByRole('button', { name: 'Open LaTeX / ZIP' }).click()
    const editor = await waitForPageWithUrl(launched.app, '://markdown/')
    await expect(editor.locator('[data-source-mode="latex"] .cm-content')).toBeVisible()
    expect(await readFile(path, 'utf8')).toBe(raw)
  } finally {
    await closeAndSaveVideo(launched, 'workspace-home')
  }
})
