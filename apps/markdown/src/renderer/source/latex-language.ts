import { StreamLanguage } from '@codemirror/language'

/** Highlight source only; no TeX commands are evaluated or rewritten. */
export const latex = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match(/\\(?:[a-zA-Z@]+\*?|.)/)) return 'keyword'
    if (stream.eat('%')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/[{}[\]]/)) return 'bracket'
    if (stream.match(/[$^_&#]/)) return 'operator'
    stream.next()
    return null
  },
  languageData: {
    commentTokens: { line: '%' },
    closeBrackets: { brackets: ['(', '[', '{'] },
  },
})
