// @vitest-environment node
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LATEX_CHANNELS, MAX_LATEX_SOURCE_BYTES } from '../src/shared/latex'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  lifecycle: new Map<string, () => void>(),
  compile: vi.fn(),
  find: vi.fn(),
  open: vi.fn(),
  project: vi.fn(),
  snapshot: vi.fn(),
}))
vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/repo/apps/shell',
    once: (event: string, fn: () => void) => mocks.lifecycle.set(event, fn),
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => mocks.handlers.set(channel, fn),
  },
  shell: { openExternal: mocks.open },
}))
vi.mock('../src/main/latex-compiler', () => ({
  compileLatex: mocks.compile,
  findLatexEngine: mocks.find,
}))
vi.mock('../src/main/latex-project', () => ({
  LATEX_PROJECT_SOURCE_RE: /\.(tex|ltx|bib|sty|cls|bst)$/i,
  findLatexProject: mocks.project,
  withLatexProjectSnapshot: mocks.snapshot,
}))
import { registerLatexIpc } from '../src/main/latex-ipc'

const path = '/project/main.tex'
const canceled = { ok: false, kind: 'canceled', log: '', diagnostics: [] }
const view = (id: number) => ({ sender: Object.assign(new EventEmitter(), { id }) })
const invoke = (channel: string, ...args: any[]) => mocks.handlers.get(channel)!(...args)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.lifecycle.clear()
  mocks.find.mockResolvedValue('/installed/tectonic')
  mocks.project.mockResolvedValue(null)
  mocks.compile.mockResolvedValue({ ok: true, pdf: new Uint8Array([1]), log: '', diagnostics: [] })
  registerLatexIpc((id) => (id === 1 ? path : id === 2 ? '/project/readme.md' : undefined))
})

describe('LaTeX view authorization and process lifecycle', () => {
  it('opens only editable files inside the current views project', async () => {
    const open = vi.fn()
    mocks.project.mockResolvedValue({
      files: [
        { path: '/project/refs.bib', editable: true },
        { path: '/project/figure.png', editable: false },
      ],
    })
    registerLatexIpc((id) => (id === 1 ? path : undefined), open)
    expect(await invoke(LATEX_CHANNELS.openProjectFile, view(3), '/project/refs.bib')).toBe(false)
    expect(await invoke(LATEX_CHANNELS.openProjectFile, view(1), '/private/other.tex')).toBe(false)
    expect(await invoke(LATEX_CHANNELS.openProjectFile, view(1), '/project/figure.png')).toBe(false)
    expect(await invoke(LATEX_CHANNELS.openProjectFile, view(1), '/project/refs.bib')).toBe(true)
    expect(open).toHaveBeenCalledExactlyOnceWith('/project/refs.bib')
  })
  it('compiles the main document from a project snapshot', async () => {
    mocks.project.mockResolvedValue({ mainPath: path, files: [] })
    mocks.snapshot.mockImplementation(async (_project, _path, _text, _signal, action) =>
      action('/snapshot/main.tex', 'Snapshot main'),
    )
    await invoke(LATEX_CHANNELS.compile, view(1), { path, text: 'Live buffer' })
    expect(mocks.snapshot).toHaveBeenCalled()
    expect(mocks.compile).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/snapshot/main.tex', text: 'Snapshot main' }),
    )
  })
  it('never compiles for another tab or a path the source view does not own', async () => {
    for (const [event, request] of [
      [view(3), { path, text: 'x' }],
      [view(2), { path: '/project/readme.md', text: 'x' }],
      [view(1), { path: '/private/other.tex', text: 'x' }],
      [view(1), { path, text: 'x'.repeat(MAX_LATEX_SOURCE_BYTES + 1) }],
    ] as const) {
      expect(await invoke(LATEX_CHANNELS.compile, event, request)).toMatchObject({
        ok: false,
        kind: 'invalid-request',
      })
    }
    expect(mocks.compile).not.toHaveBeenCalled()
  })
  it('compiles the live buffer only for the authorized document', async () => {
    await invoke(LATEX_CHANNELS.compile, view(1), { path, text: 'unsaved buffer' })
    expect(mocks.compile).toHaveBeenCalledWith(
      expect.objectContaining({ path, text: 'unsaved buffer', engine: '/installed/tectonic' }),
    )
  })
  it('returns a missing-engine result instead of executing an arbitrary fallback', async () => {
    mocks.find.mockResolvedValue(null)
    expect(await invoke(LATEX_CHANNELS.compile, view(1), { path, text: 'x' })).toMatchObject({
      kind: 'missing-engine',
    })
    expect(mocks.compile).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'close', 'quit'])('aborts an active compiler on %s', async (action) => {
    mocks.compile.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve(canceled), { once: true })
        }),
    )
    const event = view(1)
    const pending = invoke(LATEX_CHANNELS.compile, event, { path, text: 'x' })
    await vi.waitFor(() => expect(mocks.compile).toHaveBeenCalledTimes(1))
    if (action === 'cancel') invoke(LATEX_CHANNELS.cancel, event)
    if (action === 'close') event.sender.emit('destroyed')
    if (action === 'quit') mocks.lifecycle.get('before-quit')!()
    expect(await pending).toEqual(canceled)
  })
  it('restricts engine status and installation help to LaTeX views', async () => {
    expect(await invoke(LATEX_CHANNELS.engine, view(3))).toMatchObject({ available: false })
    await invoke(LATEX_CHANNELS.installHelp, view(3))
    expect(mocks.open).not.toHaveBeenCalled()
    await invoke(LATEX_CHANNELS.installHelp, view(1))
    expect(mocks.open).toHaveBeenCalledWith(
      'https://tectonic-typesetting.github.io/book/latest/getting-started/install.html',
    )
  })
})
