import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFileToText } from '../src/parse'

describe('LaTeX source reading', () => {
  it('indexes TeX commands and comments as literal text without evaluating them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'latex-plain-'))
    const source = '\\input{private-file}\r\n% ![literal](image.png)\r\n한글 $x_1^2$'
    try {
      for (const ext of ['tex', 'ltx']) {
        const path = join(dir, 'main.' + ext)
        await writeFile(path, source)
        expect(await parseFileToText(path)).toEqual({ ok: true, kind: 'text', text: source })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
