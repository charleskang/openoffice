import { test, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo, screenshotPath } from './helpers'

test('LaTeX live source and compiled PDF appear side by side with Korean, math and project input', async () => {
  test.setTimeout(240_000)
  const dir = await mkdtemp(join(tmpdir(), 'officemax-preview-'))
  const project = join(dir, '한글 작업 폴더')
  await mkdir(project)
  const path = join(project, 'main.tex')
  const text = [
    '\\documentclass[11pt]{article}',
    '\\usepackage{fontspec}',
    '\\usepackage{graphicx}',
    '\\IfFontExistsTF{Malgun Gothic}{\\setmainfont{Malgun Gothic}}{\\setmainfont{Apple SD Gothic Neo}}',
    '\\title{OfficeMax LaTeX}',
    '\\author{My Workspace}',
    '\\date{}',
    '\\begin{document}',
    '\\maketitle',
    '\\section{나만의 오피스}',
    '\\includegraphics[width=0.6cm]{figure.png}',
    '\\input{section}',
    '\\[ E = mc^2 \\qquad \\int_0^1 x^2\\,dx = \\frac{1}{3} \\]',
    '\\newpage',
    '\\section{두 번째 페이지}',
    'The preview supports multiple pages.',
    '\\end{document}',
  ].join('\r\n')
  await writeFile(path, '\uFEFF' + text)
  await writeFile(
    join(project, 'section.tex'),
    '한글 문서와 수식을 소스 옆에서 미리 볼 수 있습니다.',
  )
  await writeFile(
    join(project, 'figure.png'),
    await readFile(join(__dirname, '../apps/shell/src/renderer/src/assets/app-icon.png')),
  )
  const launched = await launchShell({
    onboardingSeen: true,
    recordVideo: false,
    lang: 'ko',
    videoDir: 'latex-preview',
    openFile: path,
  })
  try {
    const editor = await waitForPageWithUrl(launched.app, '://markdown/')
    const workspace = editor.getByTestId('latex-workspace')
    await expect(workspace).toBeVisible()
    await expect(
      workspace.getByRole('button', { name: '미리보기 갱신', exact: true }),
    ).toBeEnabled()
    await workspace.getByRole('button', { name: '미리보기 갱신', exact: true }).click()
    const canvas = workspace.getByTestId('latex-pdf-canvas')
    await expect(canvas).toHaveAttribute('data-rendered', 'true', { timeout: 180_000 })
    const layout = await workspace.evaluate((node) => {
      const source = node.querySelector('.latex-source-pane')!.getBoundingClientRect()
      const pdf = node.querySelector('.latex-preview-pane')!.getBoundingClientRect()
      return {
        sourceX: source.x,
        sourceWidth: source.width,
        previewX: pdf.x,
        previewWidth: pdf.width,
      }
    })
    expect(layout.sourceWidth).toBeGreaterThan(250)
    expect(layout.previewWidth).toBeGreaterThan(250)
    expect(layout.previewX).toBeGreaterThan(layout.sourceX + layout.sourceWidth - 1)
    await expect(workspace.locator('.latex-pdf-controls')).toContainText('1 / 2')
    await mkdir(dirname(screenshotPath('latex-split-preview')), { recursive: true })
    await editor.screenshot({ path: screenshotPath('latex-split-preview') })
    expect(await readFile(path, 'utf8')).toBe('\uFEFF' + text)
    await workspace.getByRole('button', { name: '다음 페이지', exact: true }).click()
    await expect(workspace.locator('.latex-pdf-controls')).toContainText('2 / 2')
    await expect(canvas).toHaveAttribute('data-rendered', 'true')

    // A new invalid live buffer must report an error while keeping the last good preview.
    const source = editor.locator('[data-source-mode="latex"] .cm-content')
    await source.click()
    await editor.keyboard.press('ControlOrMeta+a')
    await editor.keyboard.insertText(
      '\\documentclass{article}\n\\begin{document}\n\\invalidOfficeMaxCommand\n\\end{document}',
    )
    await expect(workspace.getByRole('status')).toContainText('소스가 변경됨')
    await workspace.getByRole('button', { name: '미리보기 갱신', exact: true }).click()
    await expect(workspace.locator('.latex-error')).toContainText('컴파일에 실패', {
      timeout: 30_000,
    })
    await expect(workspace.locator('.latex-build-log')).toHaveAttribute('open')
    await expect(workspace.getByRole('button', { name: '3줄', exact: true }).first()).toBeVisible()
    await expect(canvas).toBeVisible()
    expect(await readFile(path, 'utf8')).toBe('\uFEFF' + text)
    await workspace.getByRole('button', { name: '3줄', exact: true }).first().click()
    await expect(source).toBeFocused()

    // Auto preview recompiles a corrected buffer; changing the divider keeps both panes usable.
    await editor.keyboard.press('ControlOrMeta+a')
    await editor.keyboard.insertText(
      '\\documentclass{article}\\begin{document}Corrected live preview.\\end{document}',
    )
    await workspace.getByRole('checkbox', { name: '자동 미리보기' }).check()
    await expect(workspace.locator('.latex-error')).toBeHidden({ timeout: 30_000 })
    await expect(canvas).toHaveAttribute('data-rendered', 'true', { timeout: 30_000 })
    await expect(workspace.locator('.latex-pdf-controls')).toContainText('1 / 1')
    const divider = workspace.getByRole('separator')
    await divider.focus()
    await editor.keyboard.press('ArrowLeft')
    await expect(divider).toHaveAttribute('aria-valuenow', '45')
  } finally {
    await closeAndSaveVideo(launched, 'latex-preview')
  }
})
