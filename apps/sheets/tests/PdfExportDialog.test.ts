// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PdfExportDialog } from '../src/renderer/PdfExportDialog'
import { LocaleProvider } from '../src/renderer/i18n/locale'
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('desktopApi', { onLanguageChanged: () => () => {} })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
it('defaults to the active sheet, offers the entire workbook and submits that choice', async () => {
  const save = vi.fn(async () => true),
    close = vi.fn()
  await act(async () =>
    root.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(PdfExportDialog, { onExport: save, onClose: close, message: '' }),
      }),
    ),
  )
  const radios = host.querySelectorAll<HTMLInputElement>('input[type="radio"]')
  expect(radios[0]!.checked).toBe(true)
  await act(async () => radios[1]!.click())
  await act(async () => host.querySelector<HTMLButtonElement>('.primary-action')!.click())
  expect(save).toHaveBeenCalledWith('workbook')
  expect(close).toHaveBeenCalledOnce()
})
it('canceling the scope dialog does not start an export', async () => {
  const save = vi.fn(),
    close = vi.fn()
  await act(async () =>
    root.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(PdfExportDialog, { onExport: save, onClose: close, message: '' }),
      }),
    ),
  )
  await act(async () => host.querySelector<HTMLButtonElement>('.secondary')!.click())
  expect(close).toHaveBeenCalledOnce()
  expect(save).not.toHaveBeenCalled()
})
