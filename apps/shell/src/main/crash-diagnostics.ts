import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { CrashMemory } from './crash-log'

export const DIAGNOSTICS_FOLDER = 'diagnostics'
export const MAX_DIAGNOSTIC_REPORTS = 40
const REPORT_NAME = /^error-\d+-[a-f0-9-]+\.json$/
const WORD = /^[A-Za-z0-9][A-Za-z0-9 _.:-]{0,95}$/
const KINDS = new Set([
  'main-exception',
  'main-rejection',
  'renderer',
  'child-process',
  'renderer-error',
  'preload-error',
  'unresponsive',
  'responsive',
  'previous-abnormal-exit',
])
const MEMORY = ['appMB', 'freeMB', 'totalMB', 'aiStreams', 'cliChildren'] as const

export interface DiagnosticEvent extends CrashMemory {
  kind: string
  reason?: string
  editor?: string
  process?: string
  exitCode?: number
  error?: unknown
  stack?: string
  source?: string
  line?: number
}

export interface DiagnosticOptions {
  directory: string
  codeRoots: Array<{ path: string; label: string }>
  appVersion: string
  platform: string
  arch: string
  osRelease: string
  versions: { electron?: string; chrome?: string; node?: string }
  now?: () => number
  maxReports?: number
}

function word(value: unknown): string | undefined {
  return typeof value === 'string' && WORD.test(value) ? value : undefined
}

function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return typeof error
  const name = [
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'URIError',
    'EvalError',
    'AggregateError',
  ].includes(error.name)
    ? error.name
    : 'Error'
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^(?:E[A-Z0-9_]{1,40}|ERR_[A-Z0-9_]{1,50})$/.test(code)
    ? `${name}:${code}`
    : name
}

function codePath(value: string): string {
  if (value.startsWith('file:')) {
    try {
      value = decodeURIComponent(new URL(value).pathname).replace(/^\/([A-Za-z]:)/, '$1')
    } catch {
      return ''
    }
  }
  return value.replace(/\\/g, '/').replace(/\/$/, '')
}

/** Keep application code locations only, never an error message or document URL. */
export function diagnosticFrames(stack: string, roots: DiagnosticOptions['codeRoots']): string[] {
  const frames: string[] = []
  for (const line of stack.slice(0, 32_768).split('\n').slice(0, 80)) {
    if (!/^\s*at /.test(line)) continue
    const match = /(?:^|\()([^()]+):(\d{1,8}):(\d{1,8})\)?$/.exec(line.replace(/^\s*at\s+/, ''))
    if (!match) continue
    const file = codePath(match[1].trim())
    let location: string | undefined
    if (/^node:[a-zA-Z0-9_./-]{1,160}$/.test(file)) location = file
    else if (file.startsWith('genoffice-app:')) {
      try {
        const url = new URL(file)
        if (
          /^(?:docs|sheets|slides|pdf|markdown|html|mindmap|hwp|epub|help)$/.test(url.hostname) &&
          /^\/assets\/[A-Za-z0-9_.-]{1,120}\.js$/.test(url.pathname)
        )
          location = `editors/${url.hostname}/renderer${url.pathname}`
      } catch {
        /* not a built-in renderer location */
      }
    } else
      for (const root of roots) {
        const base = codePath(root.path)
        const windows = /^[A-Za-z]:/.test(base)
        if (
          !(windows
            ? file.toLowerCase().startsWith(base.toLowerCase() + '/')
            : file.startsWith(base + '/'))
        )
          continue
        const relative = file.slice(base.length + 1)
        if (
          !/^[A-Za-z0-9_@./-]{1,180}\.(?:[cm]?js|tsx?)$/.test(relative) ||
          relative.split('/').some((part) => part === '..')
        )
          continue
        location = `${root.label}/${relative}`
        break
      }
    if (location) frames.push(`${location}:${match[2]}:${match[3]}`)
    if (frames.length === 16) break
  }
  return [...new Set(frames)]
}

export function createCrashDiagnostics(options: DiagnosticOptions) {
  const now = options.now ?? Date.now
  const sessionId = randomUUID()
  const marker = join(options.directory, 'session.json')
  const recent = new Map<string, number>()
  let startedAt: number | undefined
  let finished = false
  const metadata = {
    appVersion: word(options.appVersion),
    platform: word(options.platform),
    arch: word(options.arch),
    osRelease: word(options.osRelease),
    electron: word(options.versions.electron),
    chrome: word(options.versions.chrome),
    node: word(options.versions.node),
  }
  function writeJson(file: string, value: unknown): void {
    const data = JSON.stringify(value, null, 2) + '\n'
    if (Buffer.byteLength(data) > 8192) return
    mkdirSync(options.directory, { recursive: true })
    const temporary = file + '.' + sessionId + '.tmp'
    try {
      writeFileSync(temporary, data, { mode: 0o600 })
      renameSync(temporary, file)
    } finally {
      try {
        rmSync(temporary, { force: true })
      } catch {
        /* best effort */
      }
    }
  }
  function record(event: DiagnosticEvent, previous?: Record<string, unknown>): void {
    try {
      if (!KINDS.has(event.kind)) return
      const at = now()
      const rawStack = event.stack ?? (event.error instanceof Error ? event.error.stack : '') ?? ''
      const source =
        event.source && Number.isInteger(event.line) && event.line! > 0
          ? `\n    at ${event.source}:${event.line}:1`
          : ''
      const frames = diagnosticFrames(rawStack + source, options.codeRoots)
      const reason =
        word(event.reason) ?? (event.error === undefined ? undefined : reasonOf(event.error))
      const fingerprint = JSON.stringify([
        event.kind,
        reason,
        event.editor,
        event.process,
        frames[0],
      ])
      if (at - (recent.get(fingerprint) ?? -Infinity) < 60_000) return
      recent.set(fingerprint, at)
      if (recent.size > 128) recent.delete(recent.keys().next().value!)
      const report: Record<string, unknown> = {
        schema: 1,
        at: new Date(at).toISOString(),
        sessionId,
        ...metadata,
        kind: event.kind,
        reason,
        editor: word(event.editor),
        process: word(event.process),
        frames,
      }
      if (Number.isInteger(event.exitCode)) report.exitCode = event.exitCode
      for (const key of MEMORY)
        if (Number.isInteger(event[key]) && event[key]! >= 0) report[key] = event[key]
      if (previous) report.previous = previous
      writeJson(join(options.directory, `error-${at}-${randomUUID()}.json`), report)
      const files = readdirSync(options.directory, { withFileTypes: true })
        .filter((item) => item.isFile() && REPORT_NAME.test(item.name))
        .map((item) => item.name)
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
      const limit = Math.max(
        1,
        Math.min(MAX_DIAGNOSTIC_REPORTS, options.maxReports ?? MAX_DIAGNOSTIC_REPORTS),
      )
      for (const file of files.slice(limit)) rmSync(join(options.directory, file), { force: true })
    } catch {
      /* diagnostic recording must never interrupt the application */
    }
  }
  function checkpoint(): void {
    if (startedAt === undefined || finished) return
    try {
      writeJson(marker, {
        schema: 1,
        sessionId,
        state: 'running',
        startedAt,
        lastSeenAt: now(),
        ...metadata,
      })
    } catch {
      /* best effort */
    }
  }
  return {
    record,
    startSession(): void {
      if (startedAt !== undefined) return
      try {
        const data = readFileSync(marker)
        if (data.length < 8192) {
          const previous = JSON.parse(data.toString('utf8'))
          if (
            previous.schema === 1 &&
            previous.state === 'running' &&
            typeof previous.sessionId === 'string' &&
            /^[a-f0-9-]{36}$/.test(previous.sessionId) &&
            Number.isFinite(previous.startedAt) &&
            Number.isFinite(previous.lastSeenAt)
          ) {
            record(
              { kind: 'previous-abnormal-exit', reason: 'missing-clean-exit' },
              {
                sessionId: previous.sessionId,
                startedAt: previous.startedAt,
                lastSeenAt: previous.lastSeenAt,
                appVersion: word(previous.appVersion),
              },
            )
          }
        }
      } catch {
        /* first run or invalid previous marker */
      }
      startedAt = now()
      checkpoint()
    },
    checkpoint,
    finish(reason: 'normal' | 'os-shutdown' = 'normal'): void {
      if (startedAt === undefined || finished) return
      finished = true
      try {
        writeJson(marker, {
          schema: 1,
          sessionId,
          state: reason,
          startedAt,
          lastSeenAt: now(),
          ...metadata,
        })
      } catch {
        /* best effort */
      }
    },
  }
}
