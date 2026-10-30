import type { zh } from './zh'

export const hi = {
  workspaceTitle: 'मेरा कार्यक्षेत्र',
  workspaceSub: 'पिछला काम जारी रखें या नया दस्तावेज़ शुरू करें।',
  continueWork: 'काम जारी रखें',
  newDocument: 'नया बनाएँ',
  allFormats: 'सभी दस्तावेज़ प्रारूप',
  openLatex: 'LaTeX / ZIP खोलें',
  workFolders: 'कार्य फ़ोल्डर',
} satisfies Record<keyof typeof zh, string>
