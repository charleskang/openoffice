import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'
import type { LatexProjectFile, LatexProjectInfo, LatexProjectReference } from '../shared/latex'

export const LATEX_PROJECT_MARKER = '.officemax-latex-project.json'
export const PROJECT_LIMITS = {
  maxParts: 5000,
  maxPartBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
}
export const LATEX_PROJECT_SOURCE_RE = /\.(tex|ltx|bib|sty|cls|bst)$/i
const TEX_RE = /\.(tex|ltx)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|pdf|eps|svg|tiff?|webp)$/i

export function withinProject(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
}

export function latexWithoutComments(text: string): string {
  return text.replace(/(^|[^\\])((?:\\\\)*)%[^\r\n]*/g, '$1$2')
}

export function mainDocumentCandidates(files: ReadonlyMap<string, Uint8Array>): string[] {
  const candidates: string[] = []
  for (const [path, bytes] of files) {
    if (!TEX_RE.test(path)) continue
    const text = latexWithoutComments(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (/\\documentclass\s*(?:\[[^\]]*\])?\s*\{/.test(text) || /\\begin\s*\{document\}/.test(text))
      candidates.push(path)
  }
  return candidates.sort((a, b) => a.localeCompare(b))
}

function projectFile(root: string, path: string): LatexProjectFile {
  const rel = relative(root, path).split(sep).join('/')
  return {
    path,
    relativePath: rel,
    kind: /\.bib$/i.test(path)
      ? 'bibliography'
      : TEX_RE.test(path)
        ? 'source'
        : IMAGE_RE.test(path)
          ? 'image'
          : 'support',
    editable: LATEX_PROJECT_SOURCE_RE.test(path),
  }
}

/** Only regular files below the selected root belong to the project. Never follow links. */
export async function projectFiles(root: string): Promise<LatexProjectFile[]> {
  const files: LatexProjectFile[] = []
  let total = 0
  let entries = 0
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (++entries > PROJECT_LIMITS.maxParts * 2) throw new Error('Project has too many entries')
      if ([LATEX_PROJECT_MARKER, '__MACOSX', '.git', '.DS_Store'].includes(entry.name)) continue
      const path = join(dir, entry.name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) await walk(path)
      else if (info.isFile()) {
        total += info.size
        if (
          files.length >= PROJECT_LIMITS.maxParts ||
          info.size > PROJECT_LIMITS.maxPartBytes ||
          total > PROJECT_LIMITS.maxTotalBytes
        )
          throw new Error('Project exceeds size limits')
        files.push(projectFile(root, path))
      }
    }
  }
  await walk(root)
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

/** A literal-command index, not a TeX interpreter: macros and external commands are never run. */
export function projectReferences(
  root: string,
  mainPath: string,
  sources: ReadonlyMap<string, string>,
  files: readonly LatexProjectFile[],
): LatexProjectReference[] {
  const paths = new Set(files.map((file) => resolve(file.path)))
  const refs: LatexProjectReference[] = []
  const mainDir = dirname(mainPath)
  for (const [from, source] of sources) {
    const text = latexWithoutComments(source)
    const graphics = [...text.matchAll(/\\graphicspath\s*\{((?:\s*\{[^}]*\}\s*)+)\}/g)].flatMap(
      (match) => [...match[1].matchAll(/\{([^}]*)\}/g)].map((part) => part[1]),
    )
    for (const match of text.matchAll(
      /\\(input|include|subfile|bibliography|addbibresource|includegraphics)\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/g,
    )) {
      const kind = /bibliography|addbibresource/.test(match[1])
        ? 'bibliography'
        : match[1] === 'includegraphics'
          ? 'image'
          : 'source'
      const extensions =
        kind === 'bibliography'
          ? ['.bib']
          : kind === 'image'
            ? ['.pdf', '.png', '.jpg', '.jpeg', '.eps']
            : ['.tex', '.ltx']
      for (const value of match[2].split(kind === 'bibliography' ? ',' : /$^/)) {
        const reference = value.trim()
        // Dynamic file names cannot be resolved safely without executing TeX.
        if (!reference || /[\\#$]/.test(reference)) continue
        const dirs = [
          mainDir,
          dirname(from),
          ...(kind === 'image' ? graphics.map((dir) => resolve(mainDir, dir)) : []),
        ]
        const candidates = dirs.flatMap((dir) => [
          resolve(dir, reference),
          ...(!extname(reference) ? extensions.map((ext) => resolve(dir, reference + ext)) : []),
        ])
        const target =
          candidates.find((path) => withinProject(root, path) && paths.has(path)) ?? null
        refs.push({ from: relative(root, from).split(sep).join('/'), reference, target, kind })
      }
    }
  }
  return refs
}

export async function describeLatexProject(
  root: string,
  mainPath: string,
): Promise<LatexProjectInfo> {
  const files = await projectFiles(root)
  if (!files.some((file) => file.path === mainPath && TEX_RE.test(file.path)))
    throw new Error('Project main document is missing')
  const sources = new Map<string, string>()
  for (const file of files) {
    if (!TEX_RE.test(file.path)) continue
    const info = await lstat(file.path)
    if (info.size > 8 * 1024 * 1024) throw new Error('LaTeX source is too large')
    sources.set(
      file.path,
      new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file.path)),
    )
  }
  const references = projectReferences(root, mainPath, sources, files)
  const reachable = new Set([mainPath])
  for (let pass = 0; pass < sources.size; pass++) {
    for (const ref of references)
      if (ref.kind === 'source' && ref.target && reachable.has(resolve(root, ref.from)))
        reachable.add(ref.target)
  }
  const sections: LatexProjectInfo['sections'] = []
  for (const [path, source] of [...sources].sort(([a], [b]) =>
    a === mainPath ? -1 : b === mainPath ? 1 : a.localeCompare(b),
  )) {
    if (!reachable.has(path)) continue
    const text = latexWithoutComments(source)
    for (const match of text.matchAll(
      /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\]\s*)?\{/g,
    )) {
      if (sections.length >= 500) break
      const start = match.index + match[0].length
      let end = start
      let depth = 1
      for (; end < Math.min(text.length, start + 2000) && depth; end++) {
        if (text[end] === '\\') {
          end++
          continue
        }
        if (text[end] === '{') depth++
        if (text[end] === '}') depth--
      }
      if (depth) continue
      const title = text
        .slice(start, end - 1)
        .replace(/\\[a-zA-Z]+\*?/g, '')
        .replace(/[{}]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240)
      const level = [
        'part',
        'chapter',
        'section',
        'subsection',
        'subsubsection',
        'paragraph',
        'subparagraph',
      ].indexOf(match[1])
      sections.push({ path, line: text.slice(0, match.index).split('\n').length, level, title })
    }
  }
  return { root, name: basename(root), mainPath, files, references, sections }
}

/** Metadata can name a main document, never an engine, command, or external path. */
export async function findLatexProject(path: string): Promise<LatexProjectInfo | null> {
  if (!LATEX_PROJECT_SOURCE_RE.test(path)) return null
  const actual = await realpath(path)
  let dir = dirname(actual)
  for (let depth = 0; depth < 16; depth++) {
    const marker = join(dir, LATEX_PROJECT_MARKER)
    const info = await lstat(marker).catch(() => null)
    if (info) {
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) return null
      const data = JSON.parse(await readFile(marker, 'utf8'))
      if (
        data.version !== 1 ||
        typeof data.main !== 'string' ||
        isAbsolute(data.main) ||
        data.main.includes('\\')
      )
        return null
      const mainPath = resolve(dir, data.main)
      if (!withinProject(dir, actual) || !withinProject(dir, mainPath)) return null
      const mainActual = await realpath(mainPath)
      if (!withinProject(dir, mainActual) || mainActual !== mainPath) return null
      return describeLatexProject(dir, mainPath)
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** Compile a private snapshot so the current live source can be a child .tex or .bib. */
export async function withLatexProjectSnapshot<T>(
  project: LatexProjectInfo,
  currentPath: string,
  text: string,
  signal: AbortSignal,
  action: (mainPath: string, mainText: string) => Promise<T>,
): Promise<T> {
  const root = await realpath(project.root)
  const current = await realpath(currentPath)
  const main = await realpath(project.mainPath)
  if (!withinProject(root, current) || !withinProject(root, main))
    throw new Error('Project file is outside its limits')
  const parent = await realpath(tmpdir())
  const work = await mkdtemp(join(parent, 'officemax-project-'))
  if (dirname(work) !== parent) throw new Error('Unexpected project snapshot directory')
  try {
    let total = 0
    for (const file of project.files) {
      if (signal.aborted) throw new Error('Project compilation canceled')
      const actual = await realpath(file.path)
      const info = await lstat(file.path)
      total += info.size
      if (
        !withinProject(root, actual) ||
        info.isSymbolicLink() ||
        !info.isFile() ||
        info.size > PROJECT_LIMITS.maxPartBytes ||
        total > PROJECT_LIMITS.maxTotalBytes
      )
        throw new Error('Project file is outside its limits')
      const target = resolve(work, file.relativePath)
      if (!withinProject(work, target)) throw new Error('Invalid project file path')
      await mkdir(dirname(target), { recursive: true })
      if (actual === current) await writeFile(target, text, { flag: 'wx' })
      else await copyFile(file.path, target)
    }
    const mainPath = resolve(work, relative(root, main))
    const mainText = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(mainPath))
    return await action(mainPath, mainText)
  } finally {
    // The temporary child was created by this invocation; the user's project is never removed.
    if (dirname(work) === parent) await rm(work, { recursive: true, force: true })
  }
}
