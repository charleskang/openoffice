import { describe, expect, it } from 'vitest'
import { isSourceMode, textModeForPath } from '../src/shared/text-mode'
import { decodeLatexSource, readSourceText, writeSourceText } from '../src/shared/source-text'

describe('textModeForPath', () => {
  it('keeps markdown files on the block editor', () => {
    expect(textModeForPath('/a/note.md')).toBe('markdown')
    expect(textModeForPath('/a/note.markdown')).toBe('markdown')
    expect(textModeForPath('/a/NOTE.MD')).toBe('markdown')
  })

  it('opens JSON as source with its own highlighting', () => {
    expect(textModeForPath('/a/data.json')).toBe('json')
    expect(textModeForPath('/a/DATA.JSON')).toBe('json')
  })

  it('opens LaTeX as source on Windows and Mac paths', () => {
    for (const path of ['C:\\papers\\main.tex', '/Users/me/papers/main.ltx', '/a/MAIN.TEX']) {
      expect(textModeForPath(path)).toBe('latex')
      expect(isSourceMode(textModeForPath(path))).toBe(true)
    }
    expect(textModeForPath('/a/main.tex.md')).toBe('markdown')
    expect(textModeForPath('/a/main.tex.bak')).toBe('plain')
  })

  it('opens everything else as plain source', () => {
    expect(textModeForPath('/a/notes.txt')).toBe('plain')
    expect(textModeForPath('/a/log.txt')).toBe('plain')
  })

  it('treats an untitled document as markdown — that is what New creates', () => {
    expect(textModeForPath(null)).toBe('markdown')
    expect(textModeForPath(undefined)).toBe('markdown')
    expect(textModeForPath('')).toBe('markdown')
  })

  it('only claims a markdown extension at the very end', () => {
    // data.json.md is markdown; a.json.bak is not JSON
    expect(textModeForPath('/a/data.json.md')).toBe('markdown')
    expect(textModeForPath('/a/data.json.bak')).toBe('plain')
  })
})

describe('isSourceMode', () => {
  it('is false only for markdown', () => {
    expect(isSourceMode('markdown')).toBe(false)
    expect(isSourceMode('plain')).toBe(true)
    expect(isSourceMode('json')).toBe(true)
  })
})

describe('source text round-trip', () => {
  it('decodes UTF-8 TeX without dropping its BOM and refuses malformed input', () => {
    const source = '\uFEFF\\section{한글}\r\n'
    expect(decodeLatexSource(Buffer.from(source, 'utf8'))).toBe(source)
    expect(() => decodeLatexSource(new Uint8Array([0xff, 0xfe, 0x41, 0]))).toThrow()
  })
  it('preserves TeX commands, comments, Unicode, BOM and line endings through edits', () => {
    const source =
      '\\documentclass{article}\n% ![literal](figure.png)\n\\begin{document}\n한글 $a_b^2$ \\% \\input{part}\n\\end{document}'
    for (const eol of ['\n', '\r\n']) {
      for (const bom of ['', '\uFEFF']) {
        const raw = bom + source.replace(/\n/g, eol)
        const { text, format } = readSourceText(raw)
        expect(writeSourceText(text, format)).toBe(raw)
        expect(writeSourceText(text.replace('a_b', 'x_b'), format)).toBe(raw.replace('a_b', 'x_b'))
      }
    }
  })
  it('returns an untouched file byte for byte', () => {
    for (const raw of [
      'hello\n',
      'hello',
      'a\r\nb\r\n',
      'a\r\nb',
      '\uFEFF{"a":1}\n',
      '\uFEFF{"a":1}\r\n',
      '',
      '\n',
      '   spaced   \n\n\n',
    ]) {
      const { text, format } = readSourceText(raw)
      expect(writeSourceText(text, format)).toBe(raw)
    }
  })

  it('preserves CRLF, BOM and a missing trailing newline through an edit', () => {
    const raw = '\uFEFFline one\r\nline two'
    const { text, format } = readSourceText(raw)
    expect(text).toBe('line one\nline two')
    expect(format).toEqual({ bom: true, eol: '\r\n', trailingNewline: false })
    expect(writeSourceText(text.replace('two', 'TWO'), format)).toBe('\uFEFFline one\r\nline TWO')
  })

  it('keeps LF files free of CR', () => {
    const { text, format } = readSourceText('a\nb\n')
    expect(writeSourceText(text.replace('a', 'z'), format)).toBe('z\nb\n')
    expect(writeSourceText(text.replace('a', 'z'), format)).not.toContain('\r')
  })

  it('does not append a trailing newline the file did not have', () => {
    const { text, format } = readSourceText('no newline here')
    expect(writeSourceText(text, format)).toBe('no newline here')
  })

  it('does not strip a trailing blank line', () => {
    const { text, format } = readSourceText('a\n\n\n')
    expect(writeSourceText(text, format)).toBe('a\n\n\n')
  })

  it('treats an empty file as having a trailing newline, so it stays empty', () => {
    const { text, format } = readSourceText('')
    expect(writeSourceText(text, format)).toBe('')
  })

  it('leaves a BOM on an empty file rather than dropping it', () => {
    const { text, format } = readSourceText('\uFEFF')
    expect(writeSourceText(text, format)).toBe('\uFEFF')
  })

  it('normalises a mixed-ending file to its dominant style on save', () => {
    // a lone \r is a terminator (classic Mac), not a character to preserve:
    // the file is CRLF-dominant, so everything is written back as CRLF
    const { text, format } = readSourceText('a\r\nb\rc\n')
    expect(format.eol).toBe('\r\n')
    expect(text).toBe('a\nb\nc\n')
    expect(writeSourceText(text, format)).toBe('a\r\nb\r\nc\r\n')
  })

  it('normalises a CR-only file to LF, since that is its dominant style', () => {
    const { text, format } = readSourceText('a\rb\r')
    expect(format).toEqual({ bom: false, eol: '\n', trailingNewline: true })
    expect(text).toBe('a\nb\n')
    expect(writeSourceText(text, format)).toBe('a\nb\n')
  })

  it('does not let a pasted CRLF change the file’s own line endings', () => {
    // the file is LF, so CRLF pasted into it comes back out as LF
    const { format } = readSourceText('a\nb\n')
    expect(writeSourceText('x\r\ny', format)).toBe('x\ny\n')
  })
})
