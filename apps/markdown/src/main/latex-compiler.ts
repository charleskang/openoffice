import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import type { LatexCompileResult, LatexDiagnostic } from '../shared/latex'
import { MAX_LATEX_SOURCE_BYTES } from '../shared/latex'

const MAX_LOG_CHARS = 128 * 1024
const MAX_PDF_BYTES = 50 * 1024 * 1024
export interface LatexEngineLocations {
  platform: NodeJS.Platform
  arch: string
  repoRoot: string
  resourcesPath: string
  env: NodeJS.ProcessEnv
}

/** GUI-launched Mac apps may not inherit the terminal's Homebrew PATH. */
export function latexEngineCandidates(options: LatexEngineLocations): string[] {
  const { platform, arch, repoRoot, resourcesPath, env } = options
  const binary = platform === 'win32' ? 'tectonic.exe' : 'tectonic'
  return [
    ...(env.GENOFFICE_TECTONIC_PATH && isAbsolute(env.GENOFFICE_TECTONIC_PATH)
      ? [env.GENOFFICE_TECTONIC_PATH]
      : []),
    join(resourcesPath, 'latex', binary),
    join(repoRoot, '.local/latex', platform + '-' + (platform === 'win32' ? 'x64' : arch), binary),
    ...(platform === 'darwin' ? ['/opt/homebrew/bin/tectonic', '/usr/local/bin/tectonic'] : []),
    ...(env.PATH ?? env.Path ?? '')
      .split(platform === 'win32' ? ';' : delimiter)
      .filter((entry) => entry && isAbsolute(entry))
      .map((entry) => join(entry, binary)),
  ]
}

export async function findLatexEngine(options: LatexEngineLocations): Promise<string | null> {
  for (const candidate of latexEngineCandidates(options)) {
    try {
      if (!(await stat(candidate)).isFile()) continue
      await access(candidate, options.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return candidate
    } catch {}
  }
  return null
}

/** Both Tectonic's file:line errors and TeX's classic l.123 log entries. */
export function latexDiagnostics(log: string): LatexDiagnostic[] {
  const diagnostics: LatexDiagnostic[] = []
  for (const line of log.split(/\r?\n/)) {
    const match = /^(?:error|warning):\s+(.*?):(\d+):\s*(.*)/i.exec(line)
    if (match) {
      diagnostics.push({ file: match[1], line: Number(match[2]), message: match[3] || line })
    } else if (/^!|^error:/i.test(line)) {
      diagnostics.push({ message: line.replace(/^!\s*|^error:\s*/i, '') })
    } else {
      const location = /^l\.(\d+)\s?(.*)/.exec(line)
      if (location && diagnostics.length && !diagnostics.at(-1)!.line) {
        diagnostics.at(-1)!.line = Number(location[1])
      }
    }
  }
  return diagnostics.slice(0, 40)
}

/** stdin compiles the live buffer; cwd resolves project assets without overwriting the .tex. */
export async function compileLatex(options: {
  engine: string
  path: string
  text: string
  signal: AbortSignal
  timeoutMs?: number
}): Promise<LatexCompileResult> {
  if (Buffer.byteLength(options.text, 'utf8') > MAX_LATEX_SOURCE_BYTES) {
    return { ok: false, kind: 'invalid-request', log: '', diagnostics: [] }
  }
  if (options.signal.aborted) return { ok: false, kind: 'canceled', log: '', diagnostics: [] }
  const tempRoot = resolve(tmpdir())
  const work = await mkdtemp(join(tempRoot, 'officemax-latex-'))
  // The only recursively removed path is a fresh child of the OS temporary directory.
  if (dirname(work) !== tempRoot) throw new Error('Unexpected LaTeX workspace')
  let log = ''
  let timedOut = false
  try {
    const exitCode = await new Promise<number | null>((done) => {
      const child = spawn(
        options.engine,
        ['-X', 'compile', '--untrusted', '--keep-logs', '--outdir', work, '-'],
        {
          cwd: dirname(options.path),
          shell: false,
          windowsHide: true,
          env: { ...process.env, TECTONIC_UNTRUSTED_MODE: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
      const stop = () => {
        child.kill('SIGKILL')
      }
      const timer = setTimeout(() => {
        timedOut = true
        stop()
      }, options.timeoutMs ?? 240_000)
      options.signal.addEventListener('abort', stop, { once: true })
      if (options.signal.aborted) stop()
      const collect = (data: Buffer) => {
        log = (log + data.toString('utf8')).slice(-MAX_LOG_CHARS)
      }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      child.stdin.on('error', () => {})
      child.on('error', (error) => {
        collect(Buffer.from(error.message))
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        options.signal.removeEventListener('abort', stop)
        done(code)
      })
      child.stdin.end(options.text.replace(/^\uFEFF/, ''), 'utf8')
    })
    try {
      const file = await open(join(work, 'texput.log'), 'r')
      try {
        const info = await file.stat()
        const tail = Buffer.alloc(Math.min(info.size, MAX_LOG_CHARS))
        await file.read(tail, 0, tail.length, Math.max(0, info.size - tail.length))
        log = (log + '\n' + tail.toString('utf8')).slice(-MAX_LOG_CHARS)
      } finally {
        await file.close()
      }
    } catch {}
    const diagnostics = latexDiagnostics(log)
    if (options.signal.aborted) return { ok: false, kind: 'canceled', log, diagnostics }
    if (timedOut) return { ok: false, kind: 'timeout', log, diagnostics }
    const pdfPath = join(work, 'texput.pdf')
    const pdfInfo = await stat(pdfPath).catch(() => null)
    if (exitCode === 0 && pdfInfo && pdfInfo.size <= MAX_PDF_BYTES) {
      const pdf = await readFile(pdfPath)
      if (pdf.subarray(0, 5).toString() === '%PDF-') {
        return { ok: true, pdf: new Uint8Array(pdf), log, diagnostics }
      }
    }
    return { ok: false, kind: 'compile-error', log, diagnostics }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
