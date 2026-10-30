import { afterEach, expect, it, vi } from 'vitest'
import type { Session } from '../src/main/session-state'
import { sessions, scheduleDeckBroadcast } from '../src/main/session-state'
const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
  webContents: { fromId: () => ({ send }) },
}))
vi.mock('../src/main/fonts', () => ({ createSystemFontMetrics: () => ({}) }))
afterEach(() => {
  sessions.clear()
  send.mockReset()
})
it('refreshes the original slide view for an embedded-sheet edit even after an ordinary update was coalesced', async () => {
  const session = {
    opened: { deck: { slides: [], size: { cx: 100, cy: 100 } } },
    fitWidthPx: 1280,
  } as unknown as Session
  sessions.set(1, session)
  scheduleDeckBroadcast(session)
  scheduleDeckBroadcast(session, true)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(send).toHaveBeenCalledOnce()
  expect(send.mock.calls[0]![0]).toBe('slides:deck-changed')
})
it('keeps ordinary single-view edits quiet', async () => {
  const session = {
    opened: { deck: { slides: [], size: { cx: 100, cy: 100 } } },
    fitWidthPx: 1280,
  } as unknown as Session
  sessions.set(1, session)
  scheduleDeckBroadcast(session)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(send).not.toHaveBeenCalled()
})
