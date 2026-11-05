import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LANGS } from '@genoffice/i18n'

const fake = vi.hoisted(() => ({
  directory: '',
  ready: false,
  app: {} as EventEmitter,
  openPath: vi.fn(async () => ''),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  fake.app = new EventEmitter()
  Object.assign(fake.app, {
    isReady: () => fake.ready,
    getPath: () => fake.directory,
    getAppPath: () => '/Applications/OfficeMax.app/Contents/Resources/app.asar',
    getVersion: () => '0.13.3',
    isPackaged: true,
  })
  return {
    app: fake.app,
    shell: { openPath: fake.openPath },
    webContents: { getAllWebContents: () => [] },
  }
})
vi.mock('../src/main/renderer-disposal', () => ({ wasReleasedRenderer: (id: number) => id === 99 }))
import {
  installCrashDiagnostics,
  diagnosticLogsLabel,
  openDiagnosticLogs,
} from '../src/main/crash-diagnostics-runtime'

let monitors: ReturnType<typeof process.listeners>
let rejections: ReturnType<typeof process.listeners>
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
beforeEach(() => {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: '/Applications/OfficeMax.app/Contents/Resources',
  })
  fake.directory = mkdtempSync(join(tmpdir(), 'officemax-runtime-logs-'))
  fake.ready = false
  fake.app.removeAllListeners()
  fake.openPath.mockClear()
  monitors = process.listeners('uncaughtExceptionMonitor')
  rejections = process.listeners('unhandledRejection')
  vi.useFakeTimers()
})
afterEach(() => {
  fake.app.emit('will-quit')
  for (const listener of process.listeners('uncaughtExceptionMonitor'))
    if (!monitors.includes(listener)) process.removeListener('uncaughtExceptionMonitor', listener)
  for (const listener of process.listeners('unhandledRejection'))
    if (!rejections.includes(listener)) process.removeListener('unhandledRejection', listener)
  vi.useRealTimers()
  if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
  else Reflect.deleteProperty(process, 'resourcesPath')
  rmSync(fake.directory, { recursive: true, force: true })
})
const install = () =>
  installCrashDiagnostics({ editorOf: () => 'sheets', memory: () => ({ appMB: 512 }) })
const reports = () => {
  const folder = join(fake.directory, 'diagnostics')
  return existsSync(folder)
    ? readdirSync(folder)
        .filter((name) => /^error-.*\.json$/.test(name))
        .map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')))
    : []
}

describe('application crash diagnostic hooks', () => {
  it('captures startup errors without replacing fatal handlers or silencing promise rejections', () => {
    const before = process.listenerCount('unhandledRejection')
    install()
    expect(process.listenerCount('unhandledRejection')).toBe(before)
    process.emit('uncaughtExceptionMonitor', new TypeError('private document'), 'uncaughtException')
    expect(reports()[0]).toMatchObject({ kind: 'main-exception', reason: 'TypeError' })
    expect(JSON.stringify(reports())).not.toContain('private document')
  })
  it('records renderer errors, preload failure and a hang/recovery cycle without recording content', () => {
    install()
    fake.ready = true
    const wc = Object.assign(new EventEmitter(), { id: 7 })
    fake.app.emit('web-contents-created', {}, wc)
    wc.emit('responsive')
    expect(reports()).toHaveLength(0)
    wc.emit('console-message', {
      level: 'error',
      message: 'private text sk-secret',
      sourceId: 'genoffice-app://sheets/assets/index-abcd.js?file=private.xlsx',
      lineNumber: 12,
    })
    wc.emit('preload-error', {}, 'private.docx', new Error('sk-secret'))
    wc.emit('unresponsive')
    wc.emit('responsive')
    expect(
      reports()
        .map((item) => item.kind)
        .sort(),
    ).toEqual(['preload-error', 'renderer-error', 'responsive', 'unresponsive'])
    expect(reports().find((item) => item.kind === 'renderer-error').frames).toEqual([
      'editors/sheets/renderer/assets/index-abcd.js:12:1',
    ])
    expect(JSON.stringify(reports())).not.toMatch(/sk-secret|private/)
  })
  it('records GPU and renderer crashes but omits deliberately released processes', () => {
    install()
    fake.app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 3 })
    fake.app.emit('child-process-gone', {}, { type: 'Utility', reason: 'killed', exitCode: 1 })
    fake.app.emit('render-process-gone', {}, { id: 99 }, { reason: 'killed', exitCode: 1 })
    fake.app.emit('render-process-gone', {}, { id: 2 }, { reason: 'oom', exitCode: -1 })
    expect(
      reports()
        .map((item) => item.kind)
        .sort(),
    ).toEqual(['child-process', 'renderer'])
  })
  it('starts session tracking only after acquiring the lock and finishes cleanly on quit', () => {
    const hooks = install()
    const marker = join(fake.directory, 'diagnostics/session.json')
    fake.app.emit('will-quit')
    expect(existsSync(marker)).toBe(false)
    hooks.startSession()
    expect(JSON.parse(readFileSync(marker, 'utf8')).state).toBe('running')
    vi.advanceTimersByTime(30_000)
    fake.app.emit('will-quit')
    expect(JSON.parse(readFileSync(marker, 'utf8')).state).toBe('normal')
  })
  it('opens the local report folder and supplies every supported menu language', () => {
    openDiagnosticLogs()
    expect(fake.openPath).toHaveBeenCalledWith(join(fake.directory, 'diagnostics'))
    for (const lang of LANGS) expect(diagnosticLogsLabel(lang)).toBeTruthy()
    expect(diagnosticLogsLabel('ko')).toBe('오류 로그 폴더 열기')
  })
})
