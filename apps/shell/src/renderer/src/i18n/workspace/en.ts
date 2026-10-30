import type { zh } from './zh'

export const en = {
  workspaceTitle: 'My workspace',
  workspaceSub: 'Pick up where you left off, or start a new document.',
  continueWork: 'Continue working',
  newDocument: 'Create new',
  allFormats: 'All document formats',
  openLatex: 'Open LaTeX / ZIP',
  workFolders: 'Working folders',
} satisfies Record<keyof typeof zh, string>
