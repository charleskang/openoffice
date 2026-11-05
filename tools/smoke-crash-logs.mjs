// Exercise only disposable app profiles. No user's open application is used.
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, writeFile, chmod } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const require = createRequire(import.meta.url)
const { _electron: electron, expect } = require('@playwright/test')
const target = process.argv[2] ?? 'dev'
const output = resolve(process.argv[3] ?? 'diagnostics-checks')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(join(tmpdir(), 'officemax-logs-smoke-'))
const windows = process.platform === 'win32'
const stub = join(profile, windows ? 'subscription-stub.cjs' : 'subscription-stub')
await writeFile(
  stub,
  windows
    ? 'console.log(process.argv.includes("--version")?"codex-cli 0.0.1":"Not logged in")\n'
    : '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.0.1"; else echo "Not logged in"; fi\n',
)
if (!windows) await chmod(stub, 0o700)
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
    language: 'en',
    theme: 'light',
    aiPanelOpenInNewDocs: false,
    aiPanelShowSidebar: false,
    defaultSaveDir: profile,
  }),
)
await writeFile(join(output, 'profile.json'), JSON.stringify({ profile }))
const environment = {
  ...process.env,
  GENOFFICE_USER_DATA: profile,
  GENOFFICE_LANG: 'en',
  GENOFFICE_NO_SPARE_VIEW: '1',
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
}
delete environment.ELECTRON_RUN_AS_NODE
const executablePath =
  target === 'dev'
    ? require('electron')
    : target.endsWith('.app')
      ? join(resolve(target), 'Contents/MacOS/OfficeMax')
      : resolve(target)
const args = [
  ...(target === 'dev' ? [resolve('apps/shell')] : []),
  '--user-data-dir=' + profile,
  '--proxy-server=http://127.0.0.1:9',
]
const directory = join(profile, 'diagnostics')
const reports = async () =>
  (await readdir(directory))
    .filter((name) => /^error-.*\.json$/.test(name))
    .sort()
    .map(async (name) => JSON.parse(await readFile(join(directory, name), 'utf8')))
const getReports = async () => Promise.all(await reports())
let instance
try {
  instance = await electron.launch({ executablePath, args, env: environment, timeout: 60_000 })
  await instance.firstWindow()
  await expect
    .poll(
      async () => {
        try {
          return JSON.parse(await readFile(join(directory, 'session.json'), 'utf8')).state
        } catch {
          return null
        }
      },
      { timeout: 30_000 },
    )
    .toBe('running')
  const menuCount = await instance.evaluate(({ Menu }) => {
    const visit = (items) =>
      items.flatMap((item) => [item, ...(item.submenu ? visit(item.submenu.items) : [])])
    return visit(Menu.getApplicationMenu()?.items ?? []).filter(
      (item) => item.id === 'officemax-error-logs',
    ).length
  })
  expect(menuCount).toBe(1)
  await instance.evaluate(({ app }) => {
    const error = Object.assign(
      new TypeError('DO_NOT_SAVE_SECRET sk-synthetic-key private-document.docx'),
      { code: 'EPIPE' },
    )
    error.stack = `TypeError: DO_NOT_SAVE_SECRET\n    at ${app.getAppPath()}/out/main/index.js:123:45`
    process.emit('uncaughtExceptionMonitor', error, 'uncaughtException')
  })
  await expect
    .poll(
      async () =>
        (await getReports()).some(
          (report) => report.kind === 'main-exception' && report.reason === 'TypeError:EPIPE',
        ),
      { timeout: 10_000 },
    )
    .toBe(true)
  expect((await getReports()).find((report) => report.kind === 'main-exception').frames).toContain(
    'app/out/main/index.js:123:45',
  )
  const page = instance.windows()[0]
  await page.evaluate(() =>
    console.error('DO_NOT_SAVE_SECRET sk-synthetic-key private-document.docx'),
  )
  await expect
    .poll(async () => (await getReports()).some((report) => report.kind === 'renderer-error'), {
      timeout: 10_000,
    })
    .toBe(true)
  await instance.evaluate(async ({ BrowserWindow }) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    global.__diagnosticSmokeWindow = win
    await win.loadURL('about:blank')
    win.webContents.forcefullyCrashRenderer()
  })
  await expect
    .poll(async () => (await getReports()).some((report) => report.kind === 'renderer'), {
      timeout: 20_000,
    })
    .toBe(true)
  const interrupted = instance.waitForEvent('close', { timeout: 20_000 })
  await instance.evaluate(({ app }) => app.exit(24)).catch(() => {})
  await interrupted
  instance = null
  instance = await electron.launch({ executablePath, args, env: environment, timeout: 60_000 })
  await instance.firstWindow()
  await expect
    .poll(
      async () => (await getReports()).some((report) => report.kind === 'previous-abnormal-exit'),
      { timeout: 20_000 },
    )
    .toBe(true)
  const saved = await getReports()
  expect(JSON.stringify(saved)).not.toMatch(/DO_NOT_SAVE_SECRET|sk-synthetic-key|private-document/)
  await writeFile(join(output, 'reports.json'), JSON.stringify(saved, null, 2))
  const closed = instance.waitForEvent('close', { timeout: 30_000 })
  await instance.evaluate(({ app }) => app.quit()).catch(() => {})
  await closed
  instance = null
  expect(JSON.parse(await readFile(join(directory, 'session.json'), 'utf8')).state).toBe('normal')
  const result = {
    platform: process.platform,
    architecture: process.arch,
    menu: true,
    mainError: true,
    rendererError: true,
    rendererCrash: true,
    abnormalExitAfterRelaunch: true,
    cleanExit: true,
    privateContentExcluded: true,
    reports: saved.length,
  }
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  if (instance) await instance.evaluate(({ app }) => app.exit(0)).catch(() => {})
}
