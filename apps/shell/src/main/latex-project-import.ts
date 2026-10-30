import JSZip from 'jszip'
import { assertZipInflatesWithinLimits } from '@genoffice/zip-gate'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { TextDecoder } from 'node:util'
import {
  LATEX_PROJECT_MARKER,
  PROJECT_LIMITS,
  mainDocumentCandidates,
  describeLatexProject,
  withinProject,
} from '../../../markdown/src/main/latex-project'
import type { LatexProjectInfo } from '../../../markdown/src/shared/latex'

export type LatexArchiveErrorCode = 'invalidArchive' | 'noMainDocument' | 'archiveTooLarge'
export class LatexArchiveError extends Error {
  constructor(readonly code: LatexArchiveErrorCode) {
    super(code)
  }
}

/** Portable paths make the same archive safe on both Windows and macOS. */
export function safeArchivePath(name: string): string {
  if (
    !name ||
    name.length > 1024 ||
    /[\\<>:"|?*\uFFFD]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    name.startsWith('/')
  )
    throw new LatexArchiveError('invalidArchive')
  const parts = name.replace(/\/$/, '').split('/')
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw new LatexArchiveError('invalidArchive')
  return parts.join('/')
}

/** Inspect raw names before JSZip can sanitize or coalesce them. The shared gate validated offsets. */
function archiveNames(bytes: Buffer): number {
  let end = bytes.length - 22
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0) throw new LatexArchiveError('invalidArchive')
  const count = bytes.readUInt16LE(end + 10)
  if (count > PROJECT_LIMITS.maxParts) throw new LatexArchiveError('archiveTooLarge')
  let offset = bytes.readUInt32LE(end + 16)
  const seen = new Set<string>()
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new LatexArchiveError('invalidArchive')
    const length = bytes.readUInt16LE(offset + 28)
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + length),
    )
    const portable = safeArchivePath(name).normalize('NFC').toLowerCase()
    if (seen.has(portable)) throw new LatexArchiveError('invalidArchive')
    seen.add(portable)
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
  }
  return count
}

export async function inspectLatexArchive(
  path: string,
): Promise<{ files: Map<string, Uint8Array>; candidates: string[] }> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.size > 64 * 1024 * 1024)
      throw new LatexArchiveError('archiveTooLarge')
    const bytes = await readFile(path)
    await assertZipInflatesWithinLimits(bytes, PROJECT_LIMITS)
    const count = archiveNames(bytes)
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false })
    if (Object.keys(zip.files).length !== count) throw new LatexArchiveError('invalidArchive')
    const files = new Map<string, Uint8Array>()
    let total = 0
    const seen = new Set<string>()
    for (const entry of Object.values(zip.files)) {
      const name = safeArchivePath(entry.name)
      const key = name.normalize('NFC').toLowerCase()
      if (seen.has(key)) throw new LatexArchiveError('invalidArchive')
      seen.add(key)
      const mode =
        typeof entry.unixPermissions === 'string'
          ? parseInt(entry.unixPermissions, 8)
          : (entry.unixPermissions ?? 0)
      const type = mode & 0o170000
      if (type && type !== 0o100000 && type !== 0o040000)
        throw new LatexArchiveError('invalidArchive')
      if (
        entry.dir ||
        name.startsWith('__MACOSX/') ||
        name.split('/').some((part) => part === '.DS_Store' || part === LATEX_PROJECT_MARKER)
      )
        continue
      const data = await entry.async('uint8array')
      total += data.length
      if (data.length > PROJECT_LIMITS.maxPartBytes || total > PROJECT_LIMITS.maxTotalBytes)
        throw new LatexArchiveError('archiveTooLarge')
      files.set(name, data)
    }
    const candidates = mainDocumentCandidates(files)
    if (!candidates.length) throw new LatexArchiveError('noMainDocument')
    return { files, candidates }
  } catch (error) {
    if (error instanceof LatexArchiveError) throw error
    throw new LatexArchiveError('invalidArchive')
  }
}

/** A fresh directory prevents importing twice from overwriting an existing working copy. */
export async function extractLatexProject(
  archivePath: string,
  parent: string,
  archive: Awaited<ReturnType<typeof inspectLatexArchive>>,
  main: string,
): Promise<LatexProjectInfo> {
  if (!archive.candidates.includes(main)) throw new LatexArchiveError('noMainDocument')
  const parentPath = resolve(parent)
  const base =
    basename(archivePath, '.zip')
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .slice(0, 70) || 'LaTeX'
  const root = await mkdtemp(join(parentPath, base + '-'))
  if (dirname(root) !== parentPath) throw new LatexArchiveError('invalidArchive')
  try {
    for (const [name, bytes] of archive.files) {
      const target = resolve(root, safeArchivePath(name))
      if (!withinProject(root, target)) throw new LatexArchiveError('invalidArchive')
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, bytes, { flag: 'wx' })
    }
    await writeFile(join(root, LATEX_PROJECT_MARKER), JSON.stringify({ version: 1, main }) + '\n', {
      flag: 'wx',
    })
    return await describeLatexProject(root, resolve(root, main))
  } catch (error) {
    // Only this newly-created child is owned by the import operation.
    if (dirname(root) === parentPath) await rm(root, { recursive: true, force: true })
    throw error
  }
}
