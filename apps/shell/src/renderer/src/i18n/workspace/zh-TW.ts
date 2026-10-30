import type { zh } from './zh'

export const zhTW = {
  workspaceTitle: '我的工作空間',
  workspaceSub: '繼續最近的工作，或開始一份新文件。',
  continueWork: '繼續工作',
  newDocument: '新增',
  allFormats: '所有文件格式',
  openLatex: '開啟 LaTeX / ZIP',
  workFolders: '工作資料夾',
} satisfies Record<keyof typeof zh, string>
