import { app, shell, webContents } from 'electron'
import type { WebContents } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { release } from 'node:os'
import { createI18n } from '@genoffice/i18n'
import {
  createCrashDiagnostics,
  DIAGNOSTICS_FOLDER,
  type DiagnosticEvent,
} from './crash-diagnostics'
import type { CrashMemory } from './crash-log'
import { wasReleasedRenderer } from './renderer-disposal'

const labels = createI18n({
  zh: { open: '打开错误日志文件夹' },
  en: { open: 'Open Error Logs Folder' },
  vi: { open: 'Mở thư mục nhật ký lỗi' },
  ja: { open: 'エラーログのフォルダーを開く' },
  ko: { open: '오류 로그 폴더 열기' },
  fr: { open: 'Ouvrir le dossier des journaux d’erreurs' },
  de: { open: 'Fehlerprotokollordner öffnen' },
  es: { open: 'Abrir carpeta de registros de errores' },
  pt: { open: 'Abrir pasta de registros de erros' },
  ru: { open: 'Открыть папку журналов ошибок' },
  th: { open: 'เปิดโฟลเดอร์บันทึกข้อผิดพลาด' },
  id: { open: 'Buka folder log kesalahan' },
  hi: { open: 'त्रुटि लॉग फ़ोल्डर खोलें' },
  ar: { open: 'فتح مجلد سجلات الأخطاء' },
  it: { open: 'Apri cartella dei registri degli errori' },
  cs: { open: 'Otevřít složku protokolů chyb' },
  nl: { open: 'Map met foutenlogboeken openen' },
  pl: { open: 'Otwórz folder dzienników błędów' },
  ms: { open: 'Buka folder log ralat' },
  he: { open: 'פתיחת תיקיית יומני השגיאות' },
  'zh-TW': { open: '開啟錯誤記錄資料夾' },
})

export function diagnosticLogsLabel(lang: Parameters<typeof labels>[0]): string {
  return labels(lang, 'open')
}
export function diagnosticLogsDirectory(): string {
  return join(app.getPath('userData'), DIAGNOSTICS_FOLDER)
}
export function openDiagnosticLogs(): void {
  try {
    mkdirSync(diagnosticLogsDirectory(), { recursive: true })
    void shell.openPath(diagnosticLogsDirectory()).catch(() => {})
  } catch {
    /* the app still works with an unwritable profile */
  }
}

export function installCrashDiagnostics(options: {
  editorOf: (wc: WebContents) => string
  memory: () => CrashMemory
}) {
  const store = createCrashDiagnostics({
    directory: diagnosticLogsDirectory(),
    codeRoots: [
      { path: app.getAppPath(), label: 'app' },
      { path: join(process.resourcesPath, 'modules'), label: 'editors' },
      ...(!app.isPackaged ? [{ path: join(app.getAppPath(), '..'), label: 'apps' }] : []),
    ],
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    versions: process.versions,
  })
  const editorOf = (wc: WebContents) => {
    try {
      return options.editorOf(wc)
    } catch {
      return 'other'
    }
  }
  const record = (event: DiagnosticEvent) => {
    let memory: CrashMemory = {}
    try {
      if (app.isReady()) memory = options.memory()
    } catch {
      /* record without memory */
    }
    store.record({ ...memory, ...event })
  }
  process.on('uncaughtExceptionMonitor', (error) => record({ kind: 'main-exception', error }))
  app.on('child-process-gone', (_event, details) => {
    if (
      details.reason === 'clean-exit' ||
      (details.reason === 'killed' && details.type === 'Utility')
    )
      return
    record({
      kind: 'child-process',
      process: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })
  app.on('render-process-gone', (_event, wc, details) => {
    if (details.reason === 'clean-exit' || wasReleasedRenderer(wc.id)) return
    record({
      kind: 'renderer',
      editor: editorOf(wc),
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })
  const hung = new Set<number>()
  const attach = (wc: WebContents) => {
    wc.on('preload-error', (_event, _path, error) =>
      record({ kind: 'preload-error', editor: editorOf(wc), error }),
    )
    wc.on('console-message', (details) => {
      if (details.level !== 'error') return
      record({
        kind: 'renderer-error',
        editor: editorOf(wc),
        reason: 'console-error',
        stack: details.message,
        source: details.sourceId,
        line: details.lineNumber,
      })
    })
    wc.on('unresponsive', () => {
      hung.add(wc.id)
      record({ kind: 'unresponsive', editor: editorOf(wc), reason: 'renderer-unresponsive' })
    })
    wc.on('responsive', () => {
      if (hung.delete(wc.id))
        record({ kind: 'responsive', editor: editorOf(wc), reason: 'renderer-responsive' })
    })
    wc.once('destroyed', () => hung.delete(wc.id))
  }
  app.on('web-contents-created', (_event, wc) => attach(wc))
  if (app.isReady()) for (const wc of webContents.getAllWebContents()) attach(wc)
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let observingRejections = false
  app.on('will-quit', () => {
    clearInterval(heartbeat)
    store.finish()
  })
  return {
    startSession(): void {
      store.startSession()
      heartbeat ??= setInterval(store.checkpoint, 30_000)
      heartbeat.unref()
    },
    observeRejections(): void {
      // The existing watcher owns rejection behavior. Subscribe only after it
      // has installed its handler, so startup failures keep Node's defaults.
      if (observingRejections) return
      observingRejections = true
      process.on('unhandledRejection', (error) => record({ kind: 'main-rejection', error }))
    },
    finish(reason: 'normal' | 'os-shutdown'): void {
      clearInterval(heartbeat)
      store.finish(reason)
    },
  }
}
