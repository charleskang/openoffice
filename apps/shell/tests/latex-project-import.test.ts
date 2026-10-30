import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  extractLatexProject,
  inspectLatexArchive,
  safeArchivePath,
} from '../src/main/latex-project-import'
import {
  findLatexProject,
  LATEX_PROJECT_MARKER,
  withLatexProjectSnapshot,
} from '../../markdown/src/main/latex-project'

const roots: string[] = []
async function fixture(
  files: Record<string, string | Uint8Array>,
  platform: 'UNIX' | 'DOS' = 'DOS',
) {
  const root = await mkdtemp(join(tmpdir(), 'officemax-zip-test-'))
  roots.push(root)
  const zip = new JSZip()
  for (const [name, data] of Object.entries(files)) zip.file(name, data, { createFolders: false })
  const path = join(root, 'paper.zip')
  await writeFile(
    path,
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform }),
  )
  return { root, path, zip }
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(root) === resolve(tmpdir())) await rm(root, { recursive: true, force: true })
  }
})
const main =
  '\\documentclass{article}\n\\begin{document}\n\\input{sections/body}\n\\bibliography{mybib}\n\\includegraphics{figures/chart.png}\n\\end{document}\n'

describe('LaTeX archive import', () => {
  it('recognizes a wrapped project, preserves every source byte and discovers assets and missing references', async () => {
    const body = '\uFEFFBody\r\n\\input{missing}\r\n'
    const { root, path } = await fixture({
      'paper/main.tex': main,
      'paper/sections/body.tex': body,
      'paper/mybib.bib': '@book{x,title={Example}}',
      'paper/figures/chart.png': new Uint8Array([1, 2, 3]),
    })
    const archive = await inspectLatexArchive(path)
    expect(archive.candidates).toEqual(['paper/main.tex'])
    const project = await extractLatexProject(path, root, archive, archive.candidates[0])
    expect(await readFile(join(project.root, 'paper/sections/body.tex'), 'utf8')).toBe(body)
    expect(project.references.filter((ref) => !ref.target).map((ref) => ref.reference)).toEqual([
      'missing',
    ])
    expect(project.files.map((file) => file.kind)).toEqual(
      expect.arrayContaining(['source', 'bibliography', 'image']),
    )
    expect((await findLatexProject(join(project.root, 'paper/mybib.bib')))?.mainPath).toBe(
      project.mainPath,
    )
  })
  it('never overwrites a previous import or changes the archive', async () => {
    const { root, path } = await fixture({ 'main.tex': main })
    const bytes = await readFile(path)
    const archive = await inspectLatexArchive(path)
    const first = await extractLatexProject(path, root, archive, 'main.tex')
    await writeFile(first.mainPath, 'User edits')
    const second = await extractLatexProject(path, root, archive, 'main.tex')
    expect(second.root).not.toBe(first.root)
    expect(await readFile(first.mainPath, 'utf8')).toBe('User edits')
    expect(await readFile(path)).toEqual(bytes)
  })
  it('returns every real root candidate and ignores commented-out document classes', async () => {
    const { path } = await fixture({
      'a.tex': main,
      'b.tex': main,
      'notes.tex': '% \\documentclass{article}\nfragment',
    })
    expect((await inspectLatexArchive(path)).candidates).toEqual(['a.tex', 'b.tex'])
  })
  it('indexes source headings and their line numbers without treating comments as commands', async () => {
    const { root, path } = await fixture({
      'main.tex':
        '\\documentclass{article}\n% \\section{Hidden}\n\\begin{document}\n\\section{A \\textbf{nested} title}\n\\subsection*{Details}\n\\end{document}\n',
    })
    const archive = await inspectLatexArchive(path)
    const project = await extractLatexProject(path, root, archive, 'main.tex')
    expect(project.sections.map(({ line, title }) => ({ line, title }))).toEqual([
      { line: 4, title: 'A nested title' },
      { line: 5, title: 'Details' },
    ])
  })
  it.each([
    '../escape.tex',
    '/absolute.tex',
    'C:/absolute.tex',
    'dir\\escape.tex',
    'AUX.tex',
    'dir./main.tex',
    'dir/../main.tex',
  ])('rejects unsafe portable paths: %s', (name) => {
    expect(() => safeArchivePath(name)).toThrow('invalidArchive')
  })
  it('rejects traversal before JSZip can silently sanitize the name', async () => {
    const { path, root } = await fixture({ 'main.tex': main, '../escape.tex': 'x' })
    await expect(inspectLatexArchive(path)).rejects.toMatchObject({ code: 'invalidArchive' })
    expect(await readdir(root)).toEqual(['paper.zip'])
  })
  it('rejects names that would collide on Windows or macOS', async () => {
    const { path } = await fixture({ 'main.tex': main, 'MAIN.TEX': main })
    await expect(inspectLatexArchive(path)).rejects.toMatchObject({ code: 'invalidArchive' })
  })
  it('rejects symbolic links instead of following them', async () => {
    const { path, zip } = await fixture({ 'main.tex': main })
    zip.file('linked.tex', '/private/data', { unixPermissions: 0o120777 })
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
    await expect(inspectLatexArchive(path)).rejects.toMatchObject({ code: 'invalidArchive' })
  })
  it('rejects a dishonest expanded size before materializing it', async () => {
    const { path } = await fixture({ 'main.tex': main.repeat(1000) })
    const bytes = await readFile(path)
    const center = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    bytes.writeUInt32LE(1, center + 24)
    await writeFile(path, bytes)
    await expect(inspectLatexArchive(path)).rejects.toMatchObject({ code: 'invalidArchive' })
  })
  it('does not treat a generic ZIP or invalid UTF-8 as a LaTeX document', async () => {
    const generic = await fixture({ 'readme.txt': 'Read me' })
    await expect(inspectLatexArchive(generic.path)).rejects.toMatchObject({
      code: 'noMainDocument',
    })
    const invalid = await fixture({ 'main.tex': new Uint8Array([255, 254, 1]) })
    await expect(inspectLatexArchive(invalid.path)).rejects.toMatchObject({
      code: 'invalidArchive',
    })
  })
  it('ignores imported application metadata and creates its own main-document marker', async () => {
    const { root, path } = await fixture({
      'main.tex': main,
      [LATEX_PROJECT_MARKER]: '{"version":1,"main":"../private.tex"}',
    })
    const archive = await inspectLatexArchive(path)
    const project = await extractLatexProject(path, root, archive, 'main.tex')
    expect(JSON.parse(await readFile(join(project.root, LATEX_PROJECT_MARKER), 'utf8'))).toEqual({
      version: 1,
      main: 'main.tex',
    })
  })
  it('uses an unsaved child buffer in a disposable project snapshot, leaving the working copy unchanged', async () => {
    const { root, path } = await fixture({
      'main.tex': main,
      'sections/body.tex': 'Saved body',
      'mybib.bib': 'Saved bibliography',
    })
    const archive = await inspectLatexArchive(path)
    const project = await extractLatexProject(path, root, archive, 'main.tex')
    const child = join(project.root, 'sections/body.tex')
    let snapshot = ''
    await withLatexProjectSnapshot(
      project,
      child,
      'Unsaved body',
      new AbortController().signal,
      async (mainPath, mainText) => {
        snapshot = dirname(mainPath)
        expect(mainText).toBe(main)
        expect(await readFile(join(snapshot, 'sections/body.tex'), 'utf8')).toBe('Unsaved body')
      },
    )
    expect(await readFile(child, 'utf8')).toBe('Saved body')
    await expect(readdir(snapshot)).rejects.toThrow()
  })
  it('rejects a changed marker pointing outside the project', async () => {
    const { root, path } = await fixture({ 'main.tex': main })
    const archive = await inspectLatexArchive(path)
    const project = await extractLatexProject(path, root, archive, 'main.tex')
    await writeFile(
      join(project.root, LATEX_PROJECT_MARKER),
      JSON.stringify({ version: 1, main: '../private.tex' }),
    )
    expect(await findLatexProject(project.mainPath)).toBeNull()
  })
})
