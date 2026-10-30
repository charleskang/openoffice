import type { zh } from './zh'

export const ja = {
  workspaceTitle: 'マイワークスペース',
  workspaceSub: '最近の作業を再開するか、新しい文書を作成します。',
  continueWork: '作業を再開',
  newDocument: '新規作成',
  allFormats: 'すべての文書形式',
  openLatex: 'LaTeX・ZIP を開く',
  workFolders: '作業フォルダー',
} satisfies Record<keyof typeof zh, string>
