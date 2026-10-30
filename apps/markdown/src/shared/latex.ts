export const LATEX_CHANNELS = {
  engine: 'markdown:latex-engine',
  compile: 'markdown:latex-compile',
  cancel: 'markdown:latex-cancel',
  installHelp: 'markdown:latex-install-help',
  project: 'markdown:latex-project',
  openProjectFile: 'markdown:latex-open-project-file',
} as const

export const MAX_LATEX_SOURCE_BYTES = 8 * 1024 * 1024
export interface LatexDiagnostic {
  message: string
  line?: number
  file?: string
}
export type LatexCompileResult =
  | { ok: true; pdf: Uint8Array; log: string; diagnostics: LatexDiagnostic[] }
  | {
      ok: false
      kind: 'missing-engine' | 'compile-error' | 'timeout' | 'canceled' | 'invalid-request'
      log: string
      diagnostics: LatexDiagnostic[]
    }
export interface LatexCompileRequest {
  path: string
  text: string
}
export interface LatexProjectFile {
  path: string
  relativePath: string
  kind: 'source' | 'bibliography' | 'image' | 'support'
  editable: boolean
}
export interface LatexProjectReference {
  from: string
  reference: string
  target: string | null
  kind: 'source' | 'bibliography' | 'image'
}
export interface LatexProjectInfo {
  root: string
  name: string
  mainPath: string
  files: LatexProjectFile[]
  references: LatexProjectReference[]
  sections: { path: string; line: number; level: number; title: string }[]
}
export interface LatexApi {
  latexProject(): Promise<LatexProjectInfo | null>
  openLatexProjectFile(path: string): Promise<boolean>
  latexEngine(): Promise<{ available: boolean; name: string }>
  compileLatex(request: LatexCompileRequest): Promise<LatexCompileResult>
  cancelLatex(): Promise<void>
  openLatexInstallHelp(): Promise<void>
}
