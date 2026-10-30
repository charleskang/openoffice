import { useEffect, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { useI18n } from '../i18n/locale'
import { latexText } from '../i18n/strings-latex'

GlobalWorkerOptions.workerSrc = workerUrl

export function PdfPreview({ bytes }: { bytes: Uint8Array }) {
  const { lang } = useI18n()
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [zoom, setZoom] = useState(100)
  const [error, setError] = useState(false)
  const [width, setWidth] = useState(500)
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [rendered, setRendered] = useState(false)
  useEffect(() => {
    let alive = true
    setPdf(null)
    setError(false)
    setPageNumber(1)
    const assets = new URL('pdfjs/', window.location.href).href
    const task = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      cMapUrl: assets + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: assets + 'standard_fonts/',
      wasmUrl: assets + 'wasm/',
      iccUrl: assets + 'iccs/',
    })
    void task.promise
      .then((document) => {
        if (alive) setPdf(document)
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
      void task.destroy().catch(() => {})
    }
  }, [bytes])
  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!pdf || !canvas.current) return
    let alive = true
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    setRendered(false)
    void pdf
      .getPage(pageNumber)
      .then(async (page) => {
        if (!alive || !canvas.current) return
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(4, Math.max(0.15, (((width - 32) / base.width) * zoom) / 100))
        const viewport = page.getViewport({ scale })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const element = canvas.current
        element.width = Math.ceil(viewport.width * ratio)
        element.height = Math.ceil(viewport.height * ratio)
        element.style.width = viewport.width + 'px'
        element.style.height = viewport.height + 'px'
        render = page.render({
          canvas: element,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        })
        await render.promise
        if (alive) setRendered(true)
      })
      .catch((failure) => {
        if (alive && failure?.name !== 'RenderingCancelledException') setError(true)
      })
    return () => {
      alive = false
      render?.cancel()
    }
  }, [pdf, pageNumber, width, zoom])

  return (
    <div className="latex-pdf-view">
      <div className="latex-pdf-controls">
        <button
          type="button"
          disabled={!pdf || pageNumber <= 1}
          aria-label={latexText(lang, 'previous')}
          onClick={() => setPageNumber((n) => n - 1)}
        >
          ‹
        </button>
        <span aria-live="polite">
          {pageNumber} / {pdf?.numPages ?? '—'}
        </span>
        <button
          type="button"
          disabled={!pdf || pageNumber >= pdf.numPages}
          aria-label={latexText(lang, 'next')}
          onClick={() => setPageNumber((n) => n + 1)}
        >
          ›
        </button>
        <span className="latex-toolbar-spacer" />
        <button
          type="button"
          aria-label={latexText(lang, 'zoomOut')}
          disabled={zoom <= 50}
          onClick={() => setZoom((n) => n - 10)}
        >
          −
        </button>
        <span>{zoom}%</span>
        <button
          type="button"
          aria-label={latexText(lang, 'zoomIn')}
          disabled={zoom >= 200}
          onClick={() => setZoom((n) => n + 10)}
        >
          +
        </button>
      </div>
      <div className="latex-pdf-scroll" ref={host}>
        {error ? (
          <p role="alert">{latexText(lang, 'pdfError')}</p>
        ) : (
          <canvas
            ref={canvas}
            data-testid="latex-pdf-canvas"
            data-rendered={rendered}
            aria-label={latexText(lang, 'preview')}
          />
        )}
      </div>
    </div>
  )
}
