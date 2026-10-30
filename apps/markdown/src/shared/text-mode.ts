// plain text and JSON open as source: the block editor would reinterpret
// `---`, `*x*`, `1.` and normalise line endings, rewriting an unedited file
export type TextMode = 'markdown' | 'plain' | 'json' | 'latex'

export const LATEX_EXTENSIONS = ['tex', 'ltx']

export function isLatexPath(path: string | null | undefined): boolean {
  return !!path && /\.(tex|ltx)$/i.test(path)
}
export function isLatexSourcePath(path: string | null | undefined): boolean {
  return !!path && /\.(tex|ltx|bib|sty|cls|bst)$/i.test(path)
}

const JSON_RE = /\.json$/i
const MARKDOWN_RE = /\.(md|markdown)$/i

/** 'markdown' for an untitled path: that is what New and AI auto-naming mean by it. */
export function textModeForPath(path: string | null | undefined): TextMode {
  if (!path) return 'markdown'
  if (isLatexPath(path)) return 'latex'
  if (JSON_RE.test(path)) return 'json'
  if (MARKDOWN_RE.test(path)) return 'markdown'
  return 'plain'
}

export function isSourceMode(mode: TextMode): boolean {
  return mode !== 'markdown'
}
