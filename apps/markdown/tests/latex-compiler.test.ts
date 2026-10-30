// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  compileLatex,
  findLatexEngine,
  latexDiagnostics,
  latexEngineCandidates,
} from '../src/main/latex-compiler'
import { MAX_LATEX_SOURCE_BYTES } from '../src/shared/latex'

const root = resolve(import.meta.dirname, '../../..')
const locations = {
  platform: process.platform,
  arch: process.arch,
  repoRoot: root,
  resourcesPath: join(root, 'missing-resources'),
  env: process.env,
}
const engine = await findLatexEngine(locations)
const scratch: string[] = []
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'latex-compiler-test-'))
  scratch.push(dir)
  return dir
}
afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('LaTeX engine discovery and diagnostics', () => {
  it('finds a Windows engine installed without modifying the global PATH', async () => {
    const repoRoot = await directory()
    const dir = join(repoRoot, '.local/latex/win32-x64')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'tectonic.exe'), 'fixture')
    expect(await findLatexEngine({ ...locations, repoRoot, platform: 'win32', env: {} })).toBe(
      join(dir, 'tectonic.exe'),
    )
  })
  it.each(['arm64', 'x64'])(
    'finds bundled and local Mac engines for %s, including GUI Homebrew installs',
    (arch) => {
      const candidates = latexEngineCandidates({ ...locations, platform: 'darwin', arch, env: {} })
      expect(candidates).toContain(join(root, '.local/latex', 'darwin-' + arch, 'tectonic'))
      expect(candidates).toContain(join(locations.resourcesPath, 'latex/tectonic'))
      expect(candidates).toContain('/opt/homebrew/bin/tectonic')
      expect(candidates).toContain('/usr/local/bin/tectonic')
    },
  )
  it('extracts clickable source lines from both engine diagnostics and classic TeX logs', () => {
    expect(latexDiagnostics('error: texput.tex:7: Undefined control sequence')).toEqual([
      { file: 'texput.tex', line: 7, message: 'Undefined control sequence' },
    ])
    expect(latexDiagnostics('! Missing $ inserted.\nl.12 text')).toEqual([
      { line: 12, message: 'Missing $ inserted.' },
    ])
  })
})

describe.runIf(engine !== null)('real Tectonic compiler', () => {
  it('compiles an unsaved buffer with project-relative input without writing the source', async () => {
    const dir = await directory()
    const path = join(dir, 'document.ltx')
    await writeFile(path, 'original disk bytes')
    await writeFile(join(dir, 'part.tex'), 'Project-relative input works. $E=mc^2$.')
    const result = await compileLatex({
      engine: engine!,
      path,
      text: '\\documentclass{article}\n\\begin{document}\n\\input{part}\nUnsaved buffer.\n\\end{document}',
      signal: new AbortController().signal,
    })
    expect(result.ok, result.log).toBe(true)
    if (result.ok) expect(Buffer.from(result.pdf).subarray(0, 5).toString()).toBe('%PDF-')
    expect(await readFile(path, 'utf8')).toBe('original disk bytes')
  }, 120_000)
  it('returns compiler errors and the failing line for invalid TeX', async () => {
    const dir = await directory()
    const result = await compileLatex({
      engine: engine!,
      path: join(dir, 'bad.tex'),
      text: '\\documentclass{article}\n\\begin{document}\n\\thisCommandDoesNotExist\n\\end{document}',
      signal: new AbortController().signal,
    })
    expect(result.ok).toBe(false)
    expect(
      result.diagnostics.some((item) => item.line === 3),
      result.log,
    ).toBe(true)
  })
  it('stops a runaway TeX loop on timeout', async () => {
    const dir = await directory()
    const result = await compileLatex({
      engine: engine!,
      path: join(dir, 'loop.tex'),
      text: '\\loop\\iftrue\\repeat',
      signal: new AbortController().signal,
      timeoutMs: 200,
    })
    expect(result).toMatchObject({ ok: false, kind: 'timeout' })
  })
  it('honors cancellation before starting and rejects oversized input', async () => {
    const dir = await directory()
    const controller = new AbortController()
    controller.abort()
    expect(
      await compileLatex({
        engine: engine!,
        path: join(dir, 'a.tex'),
        text: '',
        signal: controller.signal,
      }),
    ).toMatchObject({ kind: 'canceled' })
    expect(
      await compileLatex({
        engine: engine!,
        path: join(dir, 'a.tex'),
        text: 'x'.repeat(MAX_LATEX_SOURCE_BYTES + 1),
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ kind: 'invalid-request' })
  })
})
