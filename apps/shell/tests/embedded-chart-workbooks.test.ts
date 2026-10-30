import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmbeddedChartWorkbooks } from '../src/main/embedded-chart-workbooks'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function fixture() {
  const owner = Object.assign(new EventEmitter(), { id: 23, isDestroyed: () => false })
  const editor = Object.assign(new EventEmitter(), { id: 24, isDestroyed: () => false })
  let path = ''
  const host = new EmbeddedChartWorkbooks((p) => {
    path = p
    return editor as unknown as WebContents
  })
  const commit = vi.fn(),
    prepare = vi.fn(async () => commit),
    showSource = vi.fn()
  await host.edit({
    owner: owner as unknown as WebContents,
    key: 'chart1',
    title: 'Talk',
    bytes: Buffer.from('before'),
    prepare,
    showSource,
  })
  cleanups.push(async () => {
    editor.emit('destroyed')
    await new Promise((r) => setTimeout(r, 20))
  })
  const temp = await mkdtemp(join(tmpdir(), 'chart-host-test-'))
  cleanups.push(() => rm(temp, { recursive: true, force: true }))
  const staged = join(temp, 'staged.xlsx')
  await writeFile(staged, 'after')
  return { host, path, staged, owner, editor, prepare, commit, showSource, temp }
}
describe('embedded chart workbook host', () => {
  it('prepares before writing, commits after writing, and returns to the owning presentation', async () => {
    const f = await fixture(),
      order: string[] = []
    f.prepare.mockImplementation(async () => {
      order.push('prepare')
      return () => order.push('commit')
    })
    await f.host.save(f.path, f.path, f.staged, async () => {
      order.push('write')
      await writeFile(f.path, 'after')
    })
    expect(order).toEqual(['prepare', 'write', 'commit'])
    expect(await readFile(f.path, 'utf8')).toBe('after')
    expect(f.host.title(f.path)).toBe('Talk')
    f.host.showSource(f.path)
    expect(f.showSource).toHaveBeenCalledOnce()
  })
  it('leaves both sides untouched when validation fails', async () => {
    const f = await fixture(),
      write = vi.fn()
    f.prepare.mockRejectedValueOnce(new Error('stale chart'))
    await expect(f.host.save(f.path, f.path, f.staged, write)).rejects.toThrow('[embedded-chart]')
    expect(write).not.toHaveBeenCalled()
    expect(f.commit).not.toHaveBeenCalled()
    expect(await readFile(f.path, 'utf8')).toBe('before')
  })
  it('restores the working copy if the presentation changes during a write; a retry still works', async () => {
    const f = await fixture()
    f.commit.mockImplementationOnce(() => {
      throw new Error('changed during write')
    })
    await expect(
      f.host.save(f.path, f.path, f.staged, () => writeFile(f.path, 'after')),
    ).rejects.toThrow('changed during write')
    expect(await readFile(f.path, 'utf8')).toBe('before')
    await f.host.save(f.path, f.path, f.staged, () => writeFile(f.path, 'after'))
    expect(await readFile(f.path, 'utf8')).toBe('after')
  })
  it('rejects saves after closing the presentation but allows exporting a separate workbook', async () => {
    const f = await fixture(),
      write = vi.fn()
    f.owner.isDestroyed = () => true
    await expect(f.host.save(f.path, f.path, f.staged, write)).rejects.toThrow('closed')
    expect(write).not.toHaveBeenCalled()
    await f.host.save(f.path, join(f.temp, 'export.xlsx'), f.staged, write)
    expect(write).toHaveBeenCalledOnce()
    expect(f.prepare).not.toHaveBeenCalled()
  })
})
