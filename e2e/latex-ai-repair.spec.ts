import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchShell, waitForPageWithUrl, closeAndSaveVideo, screenshotPath } from './helpers'

const broken =
  '\\documentclass{article}\n\\begin{document}\n\\\\\nHello from the repaired document.\n\\end{document}\n'
const fixed = broken.replace('\\begin{document}\n\\\\\n', '\\begin{document}\n')
const proposal = {
  summary: '불필요한 단독 줄바꿈 명령을 제거합니다.',
  edits: [{ oldText: '\\begin{document}\n\\\\\n', newText: '\\begin{document}\n' }],
}
async function start(configured = true) {
  const dir = await mkdtemp(join(tmpdir(), 'officemax-ai-fix-'))
  const path = join(dir, 'main.tex')
  const raw = '\uFEFF' + broken.replace(/\n/g, '\r\n')
  await writeFile(path, raw)
  const launched = await launchShell({
    onboardingSeen: true,
    recordVideo: false,
    lang: 'ko',
    videoDir: 'latex-ai',
    openFile: path,
  })
  const editor = await waitForPageWithUrl(launched.app, '://markdown/')
  const settings = await editor.evaluate(() => window.markdownApi.getAiSettings())
  settings.provider = 'claude-code'
  settings.providers.openai.apiKey = configured ? 'sk-local-fake-not-a-real-key' : ''
  await launched.app.evaluate(
    ({ ipcMain }, { settings, reply }) => {
      const state = globalThis as typeof globalThis & {
        repairRequests: unknown[]
        repairReply: string | null
        repairCancels: number
      }
      state.repairRequests = []
      state.repairReply = reply
      state.repairCancels = 0
      ipcMain.removeHandler('ai:get-settings')
      ipcMain.handle('ai:get-settings', () => settings)
      ipcMain.removeHandler('ai:stream')
      ipcMain.handle('ai:stream', (event, request) => {
        state.repairRequests.push(request)
        if (state.repairReply !== null) {
          event.sender.send('ai:stream-chunk', {
            requestId: request.requestId,
            type: 'delta',
            text: state.repairReply,
          })
          event.sender.send('ai:stream-chunk', {
            requestId: request.requestId,
            type: 'done',
            stopReason: 'end_turn',
          })
        }
      })
      ipcMain.removeHandler('ai:stream-cancel')
      ipcMain.handle('ai:stream-cancel', () => {
        state.repairCancels++
      })
    },
    { settings, reply: JSON.stringify(proposal) },
  )
  await editor.getByRole('button', { name: '미리보기 갱신', exact: true }).click()
  await expect(editor.locator('.latex-error')).toBeVisible({ timeout: 60_000 })
  await editor.getByRole('button', { name: 'AI로 오류 수정', exact: true }).click()
  await expect(editor.getByTestId('latex-ai-repair')).toBeVisible()
  return { launched, editor, path, raw }
}
test('GPT proposal is reviewed, applied as an undoable edit, compiled and saved with the original encoding', async () => {
  test.setTimeout(180_000)
  const { launched, editor, path, raw } = await start()
  try {
    const panel = editor.getByTestId('latex-ai-repair')
    await panel.getByRole('button', { name: 'GPT 수정안 받기', exact: true }).click()
    await expect(panel.getByTestId('latex-ai-proposal')).toBeVisible()
    expect(await readFile(path, 'utf8')).toBe(raw)
    await mkdir(dirname(screenshotPath('latex-ai-repair')), { recursive: true })
    await editor.screenshot({ path: screenshotPath('latex-ai-repair') })
    await panel.getByRole('button', { name: '적용하고 미리보기 갱신', exact: true }).click()
    await expect(editor.getByTestId('latex-pdf-canvas')).toHaveAttribute('data-rendered', 'true', {
      timeout: 90_000,
    })
    expect(await readFile(path, 'utf8')).toBe(raw)
    const source = editor.locator('.source-editor .cm-content')
    await source.click()
    await editor.keyboard.press('ControlOrMeta+z')
    await expect(source).toContainText('\\\\')
    await editor.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
    await editor.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(path, 'utf8')).toBe('\uFEFF' + fixed.replace(/\n/g, '\r\n'))
    const requests = await launched.app.evaluate(() => (globalThis as any).repairRequests)
    expect(requests).toHaveLength(1)
    expect(requests[0].settings.provider).toBe('openai')
    expect(requests[0].tools).toEqual([])
    expect(JSON.parse(requests[0].messages[0].text).source).toBe(broken)
  } finally {
    await closeAndSaveVideo(launched, 'latex-ai-repair')
  }
})
test('missing OpenAI credentials never falls back to the selected Claude provider', async () => {
  const { launched, editor } = await start(false)
  try {
    const panel = editor.getByTestId('latex-ai-repair')
    await expect(panel).toContainText('OpenAI API 연결이 필요합니다.')
    await expect(panel.getByRole('button', { name: 'GPT 수정안 받기', exact: true })).toBeDisabled()
    expect(await launched.app.evaluate(() => (globalThis as any).repairRequests.length)).toBe(0)
  } finally {
    await closeAndSaveVideo(launched, 'latex-ai-no-key')
  }
})
test('stale, malformed and canceled proposals cannot change the source', async () => {
  test.setTimeout(150_000)
  const { launched, editor, path, raw } = await start()
  try {
    const panel = editor.getByTestId('latex-ai-repair')
    await panel.getByRole('button', { name: 'GPT 수정안 받기', exact: true }).click()
    await expect(panel.getByTestId('latex-ai-proposal')).toBeVisible()
    const source = editor.locator('.source-editor .cm-content')
    await source.click()
    await editor.keyboard.press('ControlOrMeta+End')
    await editor.keyboard.insertText('% edited while reviewing')
    await expect(
      panel.getByRole('button', { name: '적용하고 미리보기 갱신', exact: true }),
    ).toBeDisabled()
    await expect(panel).toContainText('소스가 바뀌었습니다.')
    await editor.getByRole('button', { name: '미리보기 갱신', exact: true }).click()
    await expect(editor.locator('.latex-error')).toBeVisible()
    await launched.app.evaluate(() => {
      ;(globalThis as any).repairReply =
        '{"summary":"Bad match","edits":[{"oldText":"missing text","newText":"changed"}]}'
    })
    await panel.getByRole('button', { name: 'GPT 수정안 받기', exact: true }).click()
    await expect(panel).toContainText('수정안을 안전하게 적용할 수 없습니다.')
    await launched.app.evaluate(() => {
      ;(globalThis as any).repairReply = null
    })
    await panel.getByRole('button', { name: 'GPT 수정안 받기', exact: true }).click()
    await panel.getByRole('button', { name: '취소', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'GPT 수정안 받기', exact: true })).toBeEnabled()
    expect(await readFile(path, 'utf8')).toBe(raw)
    expect(await launched.app.evaluate(() => (globalThis as any).repairCancels)).toBeGreaterThan(0)
  } finally {
    await closeAndSaveVideo(launched, 'latex-ai-invalid')
  }
})
