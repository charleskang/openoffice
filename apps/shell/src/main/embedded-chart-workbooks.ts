/** Shell-owned working copies of embedded chart data, never the user's original workbook. */
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { WebContents } from 'electron'
import type { ChartWorkbookStructuralOp } from '@genoffice/pptx-engine'

export interface ChartWorkbookEditorRequest {
  owner: WebContents
  key: string
  title: string
  bytes: Uint8Array
  /** Validate and prepare without mutation; commit revalidates synchronously. */
  prepare: (
    bytes: Uint8Array,
    operations?: readonly ChartWorkbookStructuralOp[],
  ) => Promise<() => void>
  showSource: () => void
}
interface WorkingCopy {
  request: ChartWorkbookEditorRequest
  path: string
  directory: string
  editor?: WebContents
  saving: boolean
}

export class EmbeddedChartWorkbooks {
  private copies = new Map<string, WorkingCopy>()
  constructor(private open: (path: string) => WebContents | undefined) {}
  private opening = new Map<string, Promise<void>>()
  async edit(request: ChartWorkbookEditorRequest): Promise<void> {
    const key = request.owner.id + ':' + request.key
    const pending = this.opening.get(key)
    if (pending) {
      await pending
      const copy = this.copies.get(key)
      if (copy) this.open(copy.path)
      return
    }
    const task = this.create(request)
    this.opening.set(key, task)
    try {
      await task
    } finally {
      this.opening.delete(key)
    }
  }
  private async create(request: ChartWorkbookEditorRequest): Promise<void> {
    const key = request.owner.id + ':' + request.key
    const existing = this.copies.get(key)
    if (existing) {
      this.open(existing.path)
      return
    }
    const directory = await mkdtemp(join(tmpdir(), 'genoffice-chart-data-'))
    const stem =
      request.title
        .replace(/\.[^.]+$/, '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 80) || 'Presentation'
    const chartName =
      request.key
        .split('/')
        .at(-1)
        ?.replace(/\.[^.]+$/, '') || 'chart'
    const path = join(directory, stem + ' - ' + chartName + '.xlsx')
    const copy: WorkingCopy = { request, path, directory, saving: false }
    this.copies.set(key, copy)
    try {
      await writeFile(path, request.bytes)
      copy.editor = this.open(path)
      if (!copy.editor) throw new Error('Spreadsheet editor is unavailable.')
      copy.editor.once('destroyed', () => {
        if (this.copies.get(key) === copy) this.copies.delete(key)
        void rm(directory, { recursive: true, force: true }).catch(() => undefined)
      })
    } catch (error) {
      this.copies.delete(key)
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }
  private find(path: string): WorkingCopy | undefined {
    return [...this.copies.values()].find((c) => c.path === path)
  }
  title(path: string): string | undefined {
    return this.find(path)?.request.title
  }
  showSource(path: string): void {
    const copy = this.find(path)
    if (copy && !copy.request.owner.isDestroyed()) copy.request.showSource()
  }
  async save(
    source: string,
    target: string,
    staged: string,
    write: () => Promise<void>,
    operations: readonly ChartWorkbookStructuralOp[] = [],
  ): Promise<void> {
    const copy = this.find(source)
    // Save As exports an independent workbook; ordinary Save updates the presentation.
    if (!copy) {
      await write()
      return
    }
    if (source !== target) {
      await write()
      for (const [key, value] of this.copies) if (value === copy) this.copies.delete(key)
      void rm(copy.directory, { recursive: true, force: true }).catch(() => undefined)
      return
    }
    if (copy.request.owner.isDestroyed())
      throw new Error(
        '[embedded-chart] The presentation has been closed. Use Save As to keep the edited workbook.',
      )
    if (copy.saving) throw new Error('[embedded-chart] A chart data save is already in progress.')
    copy.saving = true
    let original: Buffer | undefined
    let written = false
    try {
      original = await readFile(source)
      const commit = await copy.request.prepare(await readFile(staged), operations)
      written = true
      await write()
      if (copy.request.owner.isDestroyed())
        throw new Error('The presentation was closed during the save.')
      commit()
    } catch (error) {
      if (written && original) await writeFile(source, original)
      throw new Error(
        '[embedded-chart] ' + (error instanceof Error ? error.message : String(error)),
        { cause: error },
      )
    } finally {
      copy.saving = false
    }
  }
}
