import { normalizeLang } from '@genoffice/i18n'
const labels = {
  zh: {
    exportPdf: '导出为 PDF…',
    pdfFailed: '无法导出为 PDF。',
  },
  en: {
    exportPdf: 'Export as PDF…',
    pdfFailed: 'The document could not be exported as PDF.',
  },
  vi: {
    exportPdf: 'Xuất dưới dạng PDF…',
    pdfFailed: 'Không thể xuất tài liệu dưới dạng PDF.',
  },
  ja: {
    exportPdf: 'PDF として書き出す…',
    pdfFailed: 'PDF として書き出せませんでした。',
  },
  ko: {
    exportPdf: 'PDF로 내보내기…',
    pdfFailed: 'PDF로 내보내지 못했습니다.',
  },
  fr: {
    exportPdf: 'Exporter en PDF…',
    pdfFailed: "Le document n'a pas pu être exporté en PDF.",
  },
  de: {
    exportPdf: 'Als PDF exportieren…',
    pdfFailed: 'Das Dokument konnte nicht als PDF exportiert werden.',
  },
  es: {
    exportPdf: 'Exportar como PDF…',
    pdfFailed: 'No se pudo exportar el documento como PDF.',
  },
  th: {
    exportPdf: 'ส่งออกเป็น PDF…',
    pdfFailed: 'ไม่สามารถส่งออกเอกสารเป็น PDF ได้',
  },
  id: {
    exportPdf: 'Ekspor sebagai PDF…',
    pdfFailed: 'Dokumen tidak dapat diekspor sebagai PDF.',
  },
  ru: {
    exportPdf: 'Экспортировать в PDF…',
    pdfFailed: 'Не удалось экспортировать документ в PDF.',
  },
  ar: {
    exportPdf: 'تصدير بتنسيق PDF…',
    pdfFailed: 'تعذّر تصدير المستند بتنسيق PDF.',
  },
  pt: {
    exportPdf: 'Exportar como PDF…',
    pdfFailed: 'Não foi possível exportar o documento como PDF.',
  },
  it: {
    exportPdf: 'Esporta come PDF…',
    pdfFailed: 'Impossibile esportare il documento in PDF.',
  },
  pl: {
    exportPdf: 'Eksportuj jako PDF…',
    pdfFailed: 'Nie udało się wyeksportować dokumentu do PDF.',
  },
  cs: {
    exportPdf: 'Exportovat jako PDF…',
    pdfFailed: 'Dokument se nepodařilo exportovat do PDF.',
  },
  nl: {
    exportPdf: 'Exporteren als PDF…',
    pdfFailed: 'Het document kon niet als PDF worden geëxporteerd.',
  },
  ms: {
    exportPdf: 'Eksport sebagai PDF…',
    pdfFailed: 'Dokumen tidak dapat dieksport sebagai PDF.',
  },
  he: {
    exportPdf: 'ייצוא כ-PDF…',
    pdfFailed: 'לא ניתן היה לייצא את המסמך כ-PDF.',
  },
  hi: {
    exportPdf: 'PDF के रूप में निर्यात…',
    pdfFailed: 'दस्तावेज़ को PDF के रूप में निर्यात नहीं किया जा सका।',
  },
  'zh-TW': {
    exportPdf: '匯出為 PDF…',
    pdfFailed: '無法匯出為 PDF。',
  },
} as const
export function pdfExportText(lang: string, key: 'exportPdf' | 'pdfFailed'): string {
  return labels[normalizeLang(lang)][key]
}
