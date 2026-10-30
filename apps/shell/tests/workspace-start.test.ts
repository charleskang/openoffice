// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceStart } from '../src/renderer/src/WorkspaceStart'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('workspace task actions', () => {
  it('resumes the chosen file and opens connected folders without creating a document', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const onOpen = vi.fn()
    const onFolder = vi.fn()
    const onBrowse = vi.fn()
    const onCreate = vi.fn()
    try {
      await act(async () =>
        root.render(
          createElement(WorkspaceStart, {
            lang: 'en',
            resume: {
              path: '/papers/main.tex',
              name: 'main.tex',
              ext: 'tex',
              mtimeMs: 0,
              sizeBytes: 30,
              starred: false,
            },
            folders: [
              { path: '/papers', name: 'Papers', readable: true, usable: true, removable: true },
              {
                path: '/offline',
                name: 'Offline',
                readable: false,
                usable: false,
                removable: true,
              },
            ],
            openLabel: 'Open a file',
            starredLabel: 'Favorites',
            onBrowse,
            onOpen,
            onFolder,
            onStarred: vi.fn(),
            createItems: [{ title: 'New document', icon: 'document.svg', onCreate }],
          }),
        ),
      )
      const buttons = [...host.querySelectorAll('button')]
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[data-testid="workspace-resume"]')!.click(),
      )
      expect(onOpen).toHaveBeenCalledWith('/papers/main.tex')
      await act(async () => buttons.find((button) => button.textContent === 'Papers')!.click())
      expect(onFolder).toHaveBeenCalledWith('/papers')
      expect(host.textContent).not.toContain('Offline')
      expect(host.querySelectorAll('.workspace-actions button')).toHaveLength(1)
      expect(host.textContent).not.toContain('LaTeX')
      await act(async () => buttons.find((button) => button.textContent === 'Open a file')!.click())
      expect(onBrowse).toHaveBeenCalledOnce()
      expect(onCreate).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
