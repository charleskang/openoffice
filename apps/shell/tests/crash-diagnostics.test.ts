import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createCrashDiagnostics,
  diagnosticFrames,
  MAX_DIAGNOSTIC_REPORTS,
} from '../src/main/crash-diagnostics'

const roots = [
  { path: 'C:\\Programs\\OfficeMax\\resources\\app.asar', label: 'app' },
  { path: '/Applications/OfficeMax.app/Contents/Resources/modules', label: 'editors' },
]
const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'officemax-diagnostics-'))
  folders.push(directory)
  let clock = 1_800_000_000_000
  const options = {
    directory,
    codeRoots: roots,
    appVersion: '0.13.3',
    platform: 'win32',
    arch: 'x64',
    osRelease: '10.0',
    versions: { electron: '43.7.6' },
    now: () => clock,
  }
  return {
    directory,
    options,
    store: createCrashDiagnostics(options),
    advance: (ms: number) => {
      clock += ms
    },
  }
}
function reports(directory: string) {
  return readdirSync(directory)
    .filter((name) => /^error-.*\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')))
}

describe('code-only diagnostic stack frames', () => {
  it('keeps built-in editor code locations and drops their URL parameters', () => {
    expect(
      diagnosticFrames(
        'Error\n at genoffice-app://sheets/assets/index-abcd.js?file=private.xlsx:20:5\n at genoffice-app://unknown/assets/index.js:1:1',
        roots,
      ),
    ).toEqual(['editors/sheets/renderer/assets/index-abcd.js:20:5'])
  })
  it('keeps Windows and Mac application call sites and Node frames', () => {
    expect(
      diagnosticFrames(
        'Error: C:\\Users\\Alice\\private.xlsx sk-private\n at doWork (C:\\Programs\\OfficeMax\\resources\\app.asar\\out\\main\\index.js:42:8)\n at file:///Applications/OfficeMax.app/Contents/Resources/modules/sheets/renderer/assets/view.js:18:3\n at node:internal/process/task_queues:105:5',
        roots,
      ),
    ).toEqual([
      'app/out/main/index.js:42:8',
      'editors/sheets/renderer/assets/view.js:18:3',
      'node:internal/process/task_queues:105:5',
    ])
  })
  it('drops document names, external URLs, traversal, query strings and error text', () => {
    const frames = diagnosticFrames(
      'secret message\n at C:\\Users\\Alice\\plan.js:1:2\n at https://example.test/sk-key.js:1:2\n at /Applications/OfficeMax.app/Contents/Resources/modules/../../private.js:1:2\n at file:///Applications/OfficeMax.app/Contents/Resources/modules/docs/main.js?api_key=private:3:4',
      roots,
    )
    expect(frames).toEqual(['editors/docs/main.js:3:4'])
    expect(JSON.stringify(frames)).not.toMatch(/private|Alice|plan|api_key|https/)
  })
})

describe('persistent diagnostic reports', () => {
  it('writes error code and code positions without message or arbitrary object data', () => {
    const { store, directory } = setup()
    const error = Object.assign(new TypeError('sk-secret C:\\Users\\Alice\\salary.xlsx'), {
      code: 'EPIPE',
      stack:
        'TypeError: sk-secret\n at C:\\Programs\\OfficeMax\\resources\\app.asar\\out\\main\\index.js:10:4',
    })
    store.record({
      kind: 'main-exception',
      error,
      appMB: 512,
      freeMB: 700,
      token: 'sk-secret',
    } as never)
    expect(reports(directory)[0]).toMatchObject({
      kind: 'main-exception',
      reason: 'TypeError:EPIPE',
      appVersion: '0.13.3',
      appMB: 512,
      frames: ['app/out/main/index.js:10:4'],
    })
    expect(JSON.stringify(reports(directory))).not.toMatch(/sk-secret|Alice|salary|token/)
  })
  it('does not copy secrets from custom error names or error codes', () => {
    const { store, directory } = setup()
    store.record({
      kind: 'main-exception',
      error: Object.assign(new Error('secret'), { name: 'sk-private', code: 'secret-code' }),
    })
    expect(reports(directory)[0].reason).toBe('Error')
  })
  it('bounds report count and size and throttles recurring errors', () => {
    const { store, directory, advance } = setup()
    for (let i = 0; i < 1000; i++)
      store.record({ kind: 'main-exception', error: new Error('secret') })
    expect(reports(directory)).toHaveLength(1)
    for (let i = 0; i < 55; i++) {
      advance(60_001)
      store.record({ kind: 'main-exception', error: new Error('secret') })
    }
    expect(reports(directory)).toHaveLength(MAX_DIAGNOSTIC_REPORTS)
    for (const file of readdirSync(directory))
      expect(statSync(join(directory, file)).size).toBeLessThanOrEqual(8192)
  })
  it('records an interrupted run on the next launch but does not copy unknown marker fields', () => {
    const { store, directory, options, advance } = setup()
    store.startSession()
    advance(30_000)
    store.checkpoint()
    const marker = join(directory, 'session.json')
    writeFileSync(
      marker,
      JSON.stringify({
        ...JSON.parse(readFileSync(marker, 'utf8')),
        document: 'private.xlsx',
        apiKey: 'sk-secret',
      }),
    )
    const next = createCrashDiagnostics(options)
    next.startSession()
    expect(reports(directory)[0]).toMatchObject({
      kind: 'previous-abnormal-exit',
      reason: 'missing-clean-exit',
      previous: { appVersion: '0.13.3' },
    })
    expect(JSON.stringify(reports(directory))).not.toMatch(/private|apiKey|sk-secret/)
    next.startSession()
    expect(reports(directory)).toHaveLength(1)
  })
  it.each(['normal', 'os-shutdown'] as const)(
    'does not report a normal %s exit or invent a previous crash on first run',
    (reason) => {
      const { store, directory, options } = setup()
      store.startSession()
      expect(reports(directory)).toHaveLength(0)
      store.finish(reason)
      createCrashDiagnostics(options).startSession()
      expect(reports(directory)).toHaveLength(0)
    },
  )
  it('ignores malformed markers and logging failures', () => {
    const { store, directory, options } = setup()
    writeFileSync(join(directory, 'session.json'), '{broken')
    expect(() => store.startSession()).not.toThrow()
    const unwritable = createCrashDiagnostics({
      ...options,
      directory: join(directory, 'session.json', 'bad'),
    })
    expect(() => unwritable.record({ kind: 'renderer', reason: 'crashed' })).not.toThrow()
    expect(() => unwritable.startSession()).not.toThrow()
  })
})
