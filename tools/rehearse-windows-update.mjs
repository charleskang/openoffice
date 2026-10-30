/* global window, location */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright-core')
const asar = require('@electron/asar')
const from = process.argv[2] ?? '0.13.0'
const to = process.argv[3] ?? '0.13.1'
if (process.platform !== 'win32' || !/^\d+\.\d+\.\d+$/.test(from) || !/^\d+\.\d+\.\d+$/.test(to))
  throw new Error('Windows rehearsal requires two numeric release versions')
const installed = join(process.env.LOCALAPPDATA, 'Programs/OfficeMax')
const executable = join(installed, 'OfficeMax.exe')
if (existsSync(executable) && !process.argv.includes('--use-existing-test-install')) {
  throw new Error(
    'OfficeMax is already installed. Refusing to overwrite an existing install during a first rehearsal.',
  )
}
const release = (version) => resolve(root, '../outputs/releases', version)
const installer = (version) => join(release(version), 'OfficeMax-Setup-' + version + '.exe')
assert(
  existsSync(installer(from)) && existsSync(installer(to)),
  'Build both release installers first',
)
const shortWork = resolve(root, '../../../work')
await mkdir(shortWork, { recursive: true })
const session = await mkdtemp(join(shortWork, 'officemax-update-'))
const profile = join(session, 'profile')
const documents = join(session, 'documents')
const reportPath = resolve(root, '../outputs/update-verification.json')
await mkdir(profile)
await mkdir(documents)
for (const name of ['main.tex', 'section.tex', 'figure.png']) {
  await copyFile(resolve(root, '../outputs/latex-example', name), join(documents, name))
}
const document = join(documents, 'main.tex')
const original = await readFile(document)
await writeFile(
  join(profile, 'app-settings.json'),
  JSON.stringify({
    onboardingSeen: true,
    language: 'ko',
    theme: 'dark',
    defaultSaveDir: documents,
    officeMaxUpdateRehearsal: session,
  }),
)
await writeFile(
  join(profile, 'ai-settings.json'),
  JSON.stringify({ providers: {}, subscriptionNoticeSeen: true }),
)
let offerTarget = false
const requests = []
const server = createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).slice(1)
  requests.push(name)
  if (name === 'latest.yml') {
    const version = offerTarget ? to : from
    const metadata =
      readFileSync(join(release(version), 'latest.yml'), 'utf8') +
      '\nreleaseNotes: "OfficeMax ' +
      to +
      ' 설치·업데이트 및 설정 보존 확인"\n'
    response.writeHead(200, { 'Content-Type': 'application/yaml', 'Cache-Control': 'no-cache' })
    response.end(metadata)
    return
  }
  const version = [from, to].find((value) => name === 'OfficeMax-Setup-' + value + '.exe')
  if (!version) {
    response.writeHead(404)
    response.end()
    return
  }
  const path = installer(version)
  const size = statSync(path).size
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
  const start = range ? Number(range[1]) : 0
  const end = range && range[2] ? Number(range[2]) : size - 1
  response.writeHead(range ? 206 : 200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + size } : {}),
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(path, { start, end }).pipe(response)
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const url = 'http://127.0.0.1:' + server.address().port + '/'
const configPath = join(installed, 'resources/app-update.yml')
let originalConfig
let application
const report = {
  from,
  to,
  installed,
  profile,
  session,
  mechanism: 'Real installed app, temporary loopback update feed',
  passed: false,
}
const env = { ...process.env, GENOFFICE_LANG: 'ko' }
for (const key of ['ELECTRON_RUN_AS_NODE', 'GENOFFICE_FAKE_UPDATE', 'GENOFFICE_USER_DATA'])
  delete env[key]
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function until(read, label, timeout = 90_000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try {
      const value = await read()
      if (value) return value
    } catch (error) {
      last = error
    }
    await sleep(200)
  }
  throw new Error('Timed out: ' + label + (last ? '; ' + last.message : ''))
}
async function launch() {
  const app = await electron.launch({
    executablePath: executable,
    args: ['--user-data-dir=' + profile, document],
    env,
  })
  await app.firstWindow()
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true)
  return app
}
async function pageFor(app, fragment) {
  return until(async () => {
    for (const page of app.windows()) {
      const href = page.url() || (await page.evaluate(() => location.href).catch(() => ''))
      if (href.includes(fragment)) return page
    }
  }, 'window ' + fragment)
}
async function close(app) {
  if (!app) return
  await app
    .evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    })
    .catch(() => {})
  await app.close().catch(() => {})
}
async function pdfSmoke(app) {
  const editor = await pageFor(app, '://markdown/')
  await editor.waitForSelector('[data-testid="latex-workspace"]')
  const result = await editor.evaluate(async () => {
    const path = await window.markdownApi.consumePending()
    const text = await window.markdownApi.readFile(path)
    const info = await window.markdownApi.latexEngine()
    const result = await window.markdownApi.compileLatex({ path, text })
    return {
      engine: info.available,
      ok: result.ok,
      bytes: result.ok ? result.pdf.length : 0,
      log: result.ok ? '' : result.log.slice(-2000),
    }
  })
  assert(
    result.engine && result.ok && result.bytes > 1000,
    'Packaged LaTeX engine failed: ' + result.log,
  )
  return editor
}
try {
  console.log('Installing OfficeMax ' + from + ' for the current Windows user: ' + installed)
  if (!process.argv.includes('--use-existing-test-install'))
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$taskProcess = Start-Process -FilePath $env:OFFICEMAX_TEST_INSTALLER -ArgumentList @("/S","/currentuser",("/D="+$env:OFFICEMAX_TEST_INSTALL_ROOT)) -WindowStyle Hidden -Wait -PassThru; exit $taskProcess.ExitCode',
      ],
      {
        env: {
          ...env,
          OFFICEMAX_TEST_INSTALLER: installer(from),
          OFFICEMAX_TEST_INSTALL_ROOT: installed,
        },
        stdio: 'inherit',
        windowsHide: true,
      },
    )
  await until(() => existsSync(executable), 'base installer')
  originalConfig = await readFile(configPath, 'utf8')
  assert(originalConfig.includes('charleskang'), 'Unexpected production update repository')
  await writeFile(
    configPath,
    'provider: generic\nurl: ' +
      url +
      '\nupdaterCacheDirName: officemax-rehearsal-' +
      Date.now() +
      '\n',
  )
  application = await launch()
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), from)
  await pdfSmoke(application)
  await close(application)
  application = null
  console.log('Base installed and bundled LaTeX compiled. Windows encryption key initialized.')
  application = await launch()
  console.log(
    'Installed renderer URLs: ' +
      application
        .windows()
        .map((page) => page.url())
        .join(', '),
  )
  const home = await pageFor(application, 'app.asar/out/renderer/index.html')
  await home.waitForFunction(() => window.aiOffice?.getAiSettings)
  await home.evaluate(async () => {
    const settings = await window.aiOffice.getAiSettings()
    settings.provider = 'openai'
    settings.providers.openai.apiKey = 'sk-officemax-update-rehearsal-not-a-real-key'
    await window.aiOffice.setAiSettings(settings)
  })
  const settingsBefore = JSON.parse(await readFile(join(profile, 'app-settings.json'), 'utf8'))
  const aiBefore = JSON.parse(await readFile(join(profile, 'ai-settings.json'), 'utf8'))
  assert(
    aiBefore.providers.openai.apiKey.startsWith('sealed:v1:'),
    'Test API key was not protected',
  )
  offerTarget = true
  console.log('Offering ' + to + ' through the temporary local feed.')
  const dialog = await pageFor(application, 'update.html')
  await dialog.waitForSelector('#action')
  await until(async () => {
    const state = await dialog.evaluate(() => window.aiOfficeUpdate.getState())
    return state?.version === to
  }, 'new version in update dialog')
  const screenshots = resolve(root, '../outputs')
  await dialog.screenshot({ path: join(screenshots, 'update-available.png') })
  await dialog.locator('#action').click()
  await until(
    async () => {
      const state = await dialog.evaluate(() => window.aiOfficeUpdate.getState())
      if (state?.phase === 'error' || state?.phase === 'manual')
        throw new Error('Update download failed')
      return state?.phase === 'downloaded'
    },
    'download and integrity verification',
    180_000,
  )
  report.downloadVerified = true
  await dialog.screenshot({ path: join(screenshots, 'update-downloaded.png') })
  console.log('Downloaded and verified. Running the real restart-and-install action.')
  const appClosed = application.waitForEvent('close', { timeout: 120_000 })
  await dialog
    .locator('#action')
    .click()
    .catch((error) => {
      if (!/closed|Target page/i.test(error.message)) throw error
    })
  await appClosed
  application = null
  await until(
    () => {
      const packageData = JSON.parse(
        asar.extractFile(join(installed, 'resources/app.asar'), 'package.json').toString('utf8'),
      )
      return packageData.version === to
    },
    'updated application files',
    180_000,
  )
  await sleep(5000)
  // Close only the installer-restarted OfficeMax, identified by its exact installed executable.
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:OFFICEMAX_TEST_EXE -and $_.CommandLine -notmatch "--type=" } | ForEach-Object { $taskApp = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($taskApp) { $taskApp.CloseMainWindow() | Out-Null; $taskApp.WaitForExit(20000) | Out-Null } }',
    ],
    { env: { ...env, OFFICEMAX_TEST_EXE: executable }, stdio: 'inherit', windowsHide: true },
  )
  application = await launch()
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), to)
  const afterHome = await pageFor(application, 'app.asar/out/renderer/index.html')
  const settingsAfter = JSON.parse(await readFile(join(profile, 'app-settings.json'), 'utf8'))
  assert.equal(settingsAfter.defaultSaveDir, settingsBefore.defaultSaveDir)
  assert.equal(settingsAfter.theme, settingsBefore.theme)
  assert.equal(settingsAfter.officeMaxUpdateRehearsal, session)
  const keyPreserved = await afterHome.evaluate(async () => {
    const settings = await window.aiOffice.getAiSettings()
    return (
      settings.provider === 'openai' &&
      settings.providers.openai.apiKey === 'sk-officemax-update-rehearsal-not-a-real-key'
    )
  })
  assert(keyPreserved, 'AI settings were not preserved')
  assert((await readFile(document)).equals(original), 'Source document changed during update')
  await pdfSmoke(application)
  const finalFeed = await readFile(configPath, 'utf8')
  assert(
    finalFeed.includes('charleskang') && !finalFeed.includes('127.0.0.1'),
    'Production update feed was not restored by the installer',
  )
  report.passed = true
  report.documentsPreserved = true
  report.preferencesPreserved = true
  report.apiKeyPreserved = true
  report.packagedLatexVerified = true
  report.productionFeedRestored = true
  report.installerSha256 = createHash('sha256')
    .update(await readFile(installer(to)))
    .digest('hex')
  console.log('Update rehearsal passed: ' + from + ' -> ' + to)
} catch (error) {
  report.error = error.message
  throw error
} finally {
  await close(application)
  if (
    originalConfig &&
    existsSync(configPath) &&
    (await readFile(configPath, 'utf8')).includes('127.0.0.1')
  ) {
    await writeFile(configPath, originalConfig)
  }
  server.close()
  report.requests = requests
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log('Verification report: ' + reportPath)
}
