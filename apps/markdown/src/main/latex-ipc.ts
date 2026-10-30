import { app, ipcMain, shell } from 'electron'
import { resolve } from 'node:path'
import { compileLatex, findLatexEngine } from './latex-compiler'
import { isLatexPath } from '../shared/text-mode'
import { LATEX_CHANNELS, MAX_LATEX_SOURCE_BYTES } from '../shared/latex'
import type { LatexCompileRequest, LatexCompileResult } from '../shared/latex'
import {
  findLatexProject,
  LATEX_PROJECT_SOURCE_RE,
  withLatexProjectSnapshot,
} from './latex-project'

export function registerLatexIpc(
  pathForView: (id: number) => string | undefined,
  openProjectFile?: (path: string) => void,
): void {
  const active = new Map<number, AbortController>()
  const locations = () => ({
    platform: process.platform,
    arch: process.arch,
    repoRoot: resolve(app.getAppPath(), '../..'),
    resourcesPath: process.resourcesPath,
    env: process.env,
  })
  const projectFor = async (id: number) => {
    const path = pathForView(id)
    return path ? findLatexProject(path).catch(() => null) : null
  }
  const canCompile = async (id: number) =>
    isLatexPath(pathForView(id) ?? '') || !!(await projectFor(id))
  ipcMain.handle(LATEX_CHANNELS.project, (event) => projectFor(event.sender.id))
  ipcMain.handle(LATEX_CHANNELS.openProjectFile, async (event, target: unknown) => {
    if (typeof target !== 'string' || !openProjectFile) return false
    const project = await projectFor(event.sender.id)
    if (!project?.files.some((file) => file.path === target && file.editable)) return false
    openProjectFile(target)
    return true
  })
  ipcMain.handle(LATEX_CHANNELS.engine, async (event) => ({
    available: (await canCompile(event.sender.id)) && (await findLatexEngine(locations())) !== null,
    name: 'Tectonic',
  }))
  ipcMain.handle(
    LATEX_CHANNELS.compile,
    async (event, request: LatexCompileRequest): Promise<LatexCompileResult> => {
      const id = event.sender.id
      const path = pathForView(id)
      if (
        !LATEX_PROJECT_SOURCE_RE.test(path ?? '') ||
        !request ||
        typeof request.text !== 'string' ||
        request.path !== path ||
        Buffer.byteLength(request.text, 'utf8') > MAX_LATEX_SOURCE_BYTES
      ) {
        return { ok: false, kind: 'invalid-request', log: '', diagnostics: [] }
      }
      active.get(id)?.abort()
      const controller = new AbortController()
      active.set(id, controller)
      const cancel = () => controller.abort()
      event.sender.once('destroyed', cancel)
      try {
        const project = await projectFor(id)
        if (!isLatexPath(path) && !project)
          return { ok: false, kind: 'invalid-request', log: '', diagnostics: [] }
        const engine = await findLatexEngine(locations())
        if (!engine) return { ok: false, kind: 'missing-engine', log: '', diagnostics: [] }
        if (project)
          return await withLatexProjectSnapshot(
            project,
            path!,
            request.text,
            controller.signal,
            (mainPath, mainText) =>
              compileLatex({ engine, path: mainPath, text: mainText, signal: controller.signal }),
          )
        return await compileLatex({
          engine,
          path: path!,
          text: request.text,
          signal: controller.signal,
        })
      } catch (error) {
        return {
          ok: false,
          kind: controller.signal.aborted ? 'canceled' : 'compile-error',
          log: String(error).slice(0, 4000),
          diagnostics: [],
        }
      } finally {
        event.sender.removeListener('destroyed', cancel)
        if (active.get(id) === controller) active.delete(id)
      }
    },
  )
  ipcMain.handle(LATEX_CHANNELS.cancel, (event) => {
    active.get(event.sender.id)?.abort()
  })
  ipcMain.handle(LATEX_CHANNELS.installHelp, async (event) => {
    if (await canCompile(event.sender.id)) {
      void shell.openExternal(
        'https://tectonic-typesetting.github.io/book/latest/getting-started/install.html',
      )
    }
  })
  app.once('before-quit', () => {
    for (const job of active.values()) job.abort()
  })
}
