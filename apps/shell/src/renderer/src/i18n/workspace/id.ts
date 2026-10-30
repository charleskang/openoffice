import type { zh } from './zh'

export const id = {
  workspaceTitle: 'Ruang kerja saya',
  workspaceSub: 'Lanjutkan pekerjaan terakhir atau mulai dokumen baru.',
  continueWork: 'Lanjutkan pekerjaan',
  newDocument: 'Buat baru',
  allFormats: 'Semua format dokumen',
  openLatex: 'Buka LaTeX / ZIP',
  workFolders: 'Folder kerja',
} satisfies Record<keyof typeof zh, string>
