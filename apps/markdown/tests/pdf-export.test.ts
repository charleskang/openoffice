import { describe, expect, it } from 'vitest'
import { compiledPdfBytes } from '../src/main/pdf-payload'
import { pdfExportText } from '../src/renderer/i18n/pdf-export'

describe('compiled PDF export', () => {
  it('keeps compiled bytes exactly and accepts the IPC typed-array shape', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\ncompiled document')
    expect(compiledPdfBytes(bytes)).toEqual(Buffer.from(bytes))
    expect(compiledPdfBytes(Array.from(bytes))).toEqual(Buffer.from(bytes))
  })
  it('refuses HTML, invalid bytes and oversized export data', () => {
    for (const value of [
      '<script>bad</script>',
      [],
      [37, 80, 68, 70, 45, 300, 0, 0],
      { length: 9 },
      new Uint8Array(7),
    ])
      expect(compiledPdfBytes(value)).toBeNull()
    expect(compiledPdfBytes(new Uint8Array(64 * 1024 * 1024 + 1))).toBeNull()
  })
  it('provides the PDF action and failure in every supported UI language', () => {
    for (const lang of [
      'zh',
      'en',
      'ja',
      'ko',
      'fr',
      'de',
      'es',
      'th',
      'id',
      'ru',
      'ar',
      'pt',
      'it',
      'pl',
      'cs',
      'nl',
      'ms',
      'he',
      'hi',
      'vi',
      'zh-TW',
    ]) {
      expect(pdfExportText(lang, 'exportPdf')).toContain('PDF')
      expect(pdfExportText(lang, 'pdfFailed').length).toBeGreaterThan(8)
    }
  })
})
