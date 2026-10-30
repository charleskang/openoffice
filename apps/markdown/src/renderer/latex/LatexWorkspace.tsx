import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LatexCompileResult, LatexProjectInfo } from '../../shared/latex'
import { useI18n } from '../i18n/locale'
import { latexText } from '../i18n/strings-latex'
import { pdfExportText } from '../i18n/pdf-export'
import { PdfPreview } from './PdfPreview'
import { LatexProjectPane } from './LatexProjectPane'
import { LatexRepairPanel } from './LatexRepairPanel'
import { LatexRepairError } from './latex-repair'
import './latex.css'

export function LatexWorkspace({
  enabled,
  path,
  source,
  onExportPdf,
  onJump,
  onApplySource,
  children,
}: {
  enabled: boolean
  path: string | null
  source: string
  onExportPdf: () => Promise<unknown>
  onJump: (line: number) => void
  onApplySource: (text: string, expected: string, expectedPath: string) => boolean
  children: ReactNode
}) {
  const { lang } = useI18n()
  const [project, setProject] = useState<LatexProjectInfo | null>(null)
  const active = enabled || project !== null
  useEffect(() => {
    let stopped = false
    setProject(null)
    if (path && /\.(tex|ltx|bib|sty|cls|bst)$/i.test(path)) {
      void window.markdownApi
        .latexProject()
        .then((info) => {
          if (!stopped) setProject(info)
        })
        .catch(() => {})
    }
    return () => {
      stopped = true
    }
  }, [path])
  const [engine, setEngine] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [automatic, setAutomatic] = useState(false)
  const [repairOpen, setRepairOpen] = useState(false)
  const [result, setResult] = useState<LatexCompileResult | null>(null)
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [compiled, setCompiled] = useState<{ path: string; source: string } | null>(null)
  const [split, setSplit] = useState(50)
  const host = useRef<HTMLDivElement>(null)
  const generation = useRef(0)
  const lastAttempt = useRef('')
  const checkEngine = useCallback(() => {
    setEngine(null)
    void window.markdownApi
      .latexEngine()
      .then((info) => setEngine(info.available))
      .catch(() => setEngine(false))
  }, [])
  useEffect(() => {
    if (!active) return
    checkEngine()
    setResult(null)
    setPdf(null)
    setCompiled(null)
    setBusy(false)
    setRepairOpen(false)
    lastAttempt.current = ''
    return () => {
      generation.current += 1
      void window.markdownApi.cancelLatex().catch(() => {})
    }
  }, [active, path, checkEngine])

  const compile = useCallback(
    async (overrideSource?: string) => {
      const text = overrideSource ?? source
      if (!active || !path || !engine) return
      const run = ++generation.current
      lastAttempt.current = text
      setBusy(true)
      setResult(null)
      try {
        const next = await window.markdownApi.compileLatex({ path, text })
        if (run !== generation.current) return
        setResult(next)
        if (next.ok) {
          setPdf(new Uint8Array(next.pdf))
          setCompiled({ path, source: text })
        } else if (next.kind === 'missing-engine') setEngine(false)
      } catch {
        if (run === generation.current)
          setResult({ ok: false, kind: 'compile-error', log: '', diagnostics: [] })
      } finally {
        if (run === generation.current) setBusy(false)
      }
    },
    [active, path, source, engine],
  )
  useEffect(() => {
    if (!automatic || busy || !engine || lastAttempt.current === source) return
    const timer = setTimeout(() => {
      void compile()
    }, 1200)
    return () => clearTimeout(timer)
  }, [automatic, busy, engine, source, compile])
  if (!active) return <>{children}</>
  const stale = compiled !== null && (compiled.source !== source || compiled.path !== path)
  const errorKey =
    result && !result.ok
      ? result.kind === 'timeout'
        ? 'timeout'
        : result.kind === 'canceled'
          ? 'canceled'
          : 'compileError'
      : null
  const resize = (clientX: number) => {
    const bounds = host.current?.getBoundingClientRect()
    if (bounds) setSplit(Math.max(25, Math.min(75, ((clientX - bounds.left) / bounds.width) * 100)))
  }
  return (
    <div className="latex-workspace" ref={host} data-testid="latex-workspace">
      <section
        className="latex-source-pane"
        style={{ flexBasis: split + '%' }}
        aria-label={latexText(lang, 'source')}
      >
        <div className="latex-pane-title">{latexText(lang, 'source')}</div>
        {project && <LatexProjectPane project={project} path={path} lang={lang} onJump={onJump} />}
        {children}
      </section>
      <div
        className="latex-divider"
        role="separator"
        tabIndex={0}
        aria-label={latexText(lang, 'resize')}
        aria-orientation="vertical"
        aria-valuenow={Math.round(split)}
        aria-valuemin={25}
        aria-valuemax={75}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            setSplit((n) => Math.max(25, Math.min(75, n + (event.key === 'ArrowLeft' ? -5 : 5))))
          }
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          resize(event.clientX)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX)
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
      />
      <section className="latex-preview-pane" aria-label={latexText(lang, 'preview')}>
        <div className="latex-preview-toolbar">
          <strong>{latexText(lang, 'preview')}</strong>
          <span className="latex-toolbar-spacer" />
          <button
            type="button"
            disabled={busy || exporting || !engine || !path}
            onClick={() => {
              setExporting(true)
              void onExportPdf().finally(() => setExporting(false))
            }}
          >
            {exporting ? 'PDF…' : pdfExportText(lang, 'exportPdf')}
          </button>
          <button
            disabled={
              busy || (!repairOpen && (!result || result.ok || result.kind !== 'compile-error'))
            }
            onClick={() => setRepairOpen((open) => !open)}
          >
            {latexText(lang, 'aiRepair')}
          </button>
          {busy ? (
            <button type="button" onClick={() => void window.markdownApi.cancelLatex()}>
              {latexText(lang, 'cancel')}
            </button>
          ) : (
            <button
              type="button"
              className="latex-compile"
              disabled={!engine || !path}
              onClick={() => void compile()}
            >
              {latexText(lang, 'compile')}
            </button>
          )}
        </div>
        {project && (
          <div className="latex-project-preview">
            {latexText(lang, 'mainPreview', {
              file:
                project.files.find((file) => file.path === project.mainPath)?.relativePath ?? '',
            })}
          </div>
        )}
        <div className="latex-build-status" role="status">
          <label>
            <input
              type="checkbox"
              checked={automatic}
              onChange={(event) => setAutomatic(event.target.checked)}
            />
            {latexText(lang, 'automatic')}
          </label>
          <span>
            {busy
              ? latexText(lang, 'compiling')
              : stale
                ? latexText(lang, 'stale')
                : pdf
                  ? latexText(lang, 'ready')
                  : 'Tectonic'}
          </span>
        </div>
        {engine === false && (
          <div className="latex-engine-missing" role="alert">
            <p>{latexText(lang, 'missingEngine')}</p>
            <button type="button" onClick={() => void window.markdownApi.openLatexInstallHelp()}>
              {latexText(lang, 'installHelp')}
            </button>
            <button type="button" onClick={checkEngine}>
              {latexText(lang, 'recheck')}
            </button>
          </div>
        )}
        {errorKey && (
          <p className="latex-error" role="alert">
            {latexText(lang, errorKey)}
          </p>
        )}
        {repairOpen && path && (
          <LatexRepairPanel
            path={path}
            source={source}
            result={result}
            evidenceCurrent={lastAttempt.current === source}
            project={project}
            onApply={(text) => {
              if (!onApplySource(text, source, path)) throw new LatexRepairError('aiStale')
              void compile(text)
            }}
          />
        )}
        {pdf ? (
          <PdfPreview bytes={pdf} />
        ) : (
          !errorKey &&
          engine !== false && (
            <div className="latex-empty">
              <p>{latexText(lang, busy ? 'firstCompile' : 'empty')}</p>
            </div>
          )
        )}
        {result && (result.log || result.diagnostics.length > 0) && (
          <details className="latex-build-log" open={!result.ok && result.kind !== 'canceled'}>
            <summary>{latexText(lang, 'buildLog')}</summary>
            {result.diagnostics.map((item, index) => (
              <div key={index} className="latex-diagnostic">
                {item.line &&
                (!project || path === project.mainPath) &&
                (!item.file || /(?:^|[\\/])texput(?:\.tex)?$/.test(item.file)) ? (
                  <button type="button" onClick={() => onJump(item.line!)}>
                    {latexText(lang, 'line', { line: item.line })}
                  </button>
                ) : (
                  item.file && (
                    <span>
                      {item.file}
                      {item.line ? ':' + item.line : ''}
                    </span>
                  )
                )}
                <span>{item.message}</span>
              </div>
            ))}
            <pre>{result.log}</pre>
          </details>
        )}
      </section>
    </div>
  )
}
