import { useRef, useState } from 'react'
import { useI18n } from './i18n/locale'
import { useModalDialog } from './modal-dialog'
import type { PdfExportRange } from './page-layout-actions'

/** A PDF destination is picked after the user chooses the workbook scope. */
export function PdfExportDialog({
  onExport,
  onClose,
  message,
}: {
  onExport: (range: PdfExportRange) => Promise<boolean>
  onClose: () => void
  message: string
}) {
  const { t } = useI18n()
  const [range, setRange] = useState<PdfExportRange>('active')
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  const close = () => {
    if (!running.current) onClose()
  }
  const modal = useModalDialog(close)
  const save = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setAttempted(true)
    setError(null)
    try {
      if (await onExport(range)) onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('appPdfExportFailed'))
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div
        className="format-cells-dialog"
        role="dialog"
        {...modal}
        data-testid="pdf-export-dialog"
        aria-label={t('dlgPrintToPdf')}
        onClick={(e) => e.stopPropagation()}
      >
        <header>{t('dlgPrintToPdf')}</header>
        <div className="dialog-body dialog-grid">
          <label className="dialog-check dialog-span">
            <input
              type="radio"
              name="pdf-scope"
              value="active"
              checked={range === 'active'}
              disabled={busy}
              onChange={() => setRange('active')}
            />
            {t('dlgPrintActiveSheets')}
          </label>
          <label className="dialog-check dialog-span">
            <input
              type="radio"
              name="pdf-scope"
              value="workbook"
              checked={range === 'workbook'}
              disabled={busy}
              onChange={() => setRange('workbook')}
            />
            {t('dlgPrintEntireWorkbook')}
          </label>
        </div>
        {(busy || attempted) && (
          <p className="dialog-note" role="status">
            {busy ? t('appPdfRendering') : message}
          </p>
        )}
        {error && (
          <p className="dialog-note" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="secondary" disabled={busy} onClick={close}>
            {t('dlgCancel')}
          </button>
          <button className="primary-action" disabled={busy} onClick={() => void save()}>
            {t('dlgPrintToPdf')}
          </button>
        </div>
      </div>
    </div>
  )
}
