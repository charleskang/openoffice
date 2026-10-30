import { describe, expect, it } from 'vitest'
import {
  applyLatexRepair,
  buildLatexRepairRequest,
  MAX_REPAIR_SOURCE_CHARS,
  parseLatexRepair,
} from '../src/renderer/latex/latex-repair'

const source = '\\begin{document}\n\\\\\nHello.\n\\end{document}'
const proposal = {
  summary: 'Remove the invalid standalone line break.',
  edits: [{ oldText: '\\begin{document}\n\\\\\n', newText: '\\begin{document}\n' }],
}
describe('LaTeX AI repair proposals', () => {
  it('applies an exact small replacement without changing unrelated source', () => {
    expect(applyLatexRepair(source, source, parseLatexRepair(JSON.stringify(proposal)))).toBe(
      '\\begin{document}\nHello.\n\\end{document}',
    )
  })
  it('accepts a JSON fence and a diagnosis without edits', () => {
    expect(parseLatexRepair('```json\n' + JSON.stringify(proposal) + '\n```')).toEqual(proposal)
    expect(parseLatexRepair('{"summary":"Fix the main document first.","edits":[]}').edits).toEqual(
      [],
    )
  })
  it.each([
    'not JSON',
    '[]',
    'null',
    '{"summary":"x"}',
    '{"summary":"","edits":[]}',
    '{"summary":"x","edits":[],"path":"../private.tex"}',
    '{"summary":"x","edits":[],"command":"run"}',
    '{"summary":"x","edits":[{"oldText":"","newText":"x"}]}',
    '{"summary":"x","edits":[{"oldText":"a","newText":null}]}',
    '{"summary":"x","edits":[{"oldText":"a","newText":"a"}]}',
    '{"summary":"x","edits":[{"oldText":"a","newText":"b","file":"other.tex"}]}',
  ])('rejects malformed or out-of-scope replies: %s', (raw) => {
    expect(() => parseLatexRepair(raw)).toThrow('aiInvalidReply')
  })
  it('rejects an incomplete stream or oversized reply', () => {
    expect(() => parseLatexRepair(JSON.stringify(proposal).slice(0, -3))).toThrow('aiInvalidReply')
    expect(() => parseLatexRepair(' '.repeat(80_001))).toThrow('aiInvalidReply')
  })
  it('rejects ambiguous, absent and overlapping source fragments', () => {
    for (const edits of [
      [{ oldText: 'a', newText: 'x' }],
      [{ oldText: 'absent', newText: 'x' }],
      [
        { oldText: 'abc', newText: 'x' },
        { oldText: 'bcd', newText: 'y' },
      ],
    ]) {
      expect(() => applyLatexRepair('abcd a', 'abcd a', { summary: 'x', edits })).toThrow(
        'aiInvalidReply',
      )
    }
  })
  it('anchors all replacements in the original instead of matching newly inserted text', () => {
    expect(
      applyLatexRepair('abc def', 'abc def', {
        summary: 'x',
        edits: [
          { oldText: 'abc', newText: 'def' },
          { oldText: 'def', newText: 'xyz' },
        ],
      }),
    ).toBe('def xyz')
  })
  it('refuses a stale source even when the proposed fragments still match', () => {
    expect(() => applyLatexRepair(source + '\n', source, proposal)).toThrow('aiStale')
  })
  it('bounds the source and preserves redaction safeguards before any network request', () => {
    const result = {
      ok: false as const,
      kind: 'compile-error' as const,
      log: 'error',
      diagnostics: [],
    }
    expect(() =>
      buildLatexRepairRequest(
        'x'.repeat(MAX_REPAIR_SOURCE_CHARS + 1),
        result,
        null,
        'main.tex',
        'en',
        '',
      ),
    ).toThrow('aiSourceTooLarge')
    expect(() =>
      buildLatexRepairRequest(
        '<span data-redaction="x">private</span>',
        result,
        null,
        'main.tex',
        'en',
        '',
      ),
    ).toThrow('aiProtectedSource')
  })
  it('sends current source and diagnostic data with no filesystem instructions or absolute project paths', () => {
    const root = 'C:\\Users\\Private\\project'
    const request = buildLatexRepairRequest(
      source,
      {
        ok: false,
        kind: 'compile-error',
        log: root + '\\main.tex\nerror',
        diagnostics: [{ line: 2, message: 'Invalid line break' }],
      },
      {
        root,
        name: 'project',
        mainPath: root + '\\main.tex',
        files: [
          { path: root + '\\main.tex', relativePath: 'main.tex', kind: 'source', editable: true },
        ],
        references: [],
        sections: [],
      },
      'main.tex',
      'ko',
      'Fix the compiler error',
    )
    const payload = JSON.parse(request.user)
    expect(payload.source).toBe(source)
    expect(payload.projectFiles).toEqual(['main.tex'])
    expect(request.user).not.toContain('Private')
    expect(request.system).toContain('UNTRUSTED DOCUMENT DATA')
    expect(request.system).toContain('CURRENT FILE only')
  })
})
