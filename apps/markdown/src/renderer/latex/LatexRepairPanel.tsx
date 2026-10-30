import { useEffect, useRef, useState } from 'react'
import type { AiSettings } from '@genoffice/ai-provider/browser'
import { streamText } from '@genoffice/agent-core'
import { useAiSendGate } from '@genoffice/ui'
import type { LatexCompileResult, LatexProjectInfo } from '../../shared/latex'
import { useI18n } from '../i18n/locale'
import { latexText } from '../i18n/strings-latex'
import { createElectronTransport } from '../ai/transport'
import {
  applyLatexRepair,
  buildLatexRepairRequest,
  LatexRepairError,
  MAX_REPAIR_REPLY_CHARS,
  parseLatexRepair,
  type LatexRepairProposal,
} from './latex-repair'

const store = {
  getSettings: () => window.markdownApi.getAiSettings(),
  setSettings: (settings: AiSettings) => window.markdownApi.setAiSettings(settings),
}

export function LatexRepairPanel({
  path,
  source,
  result,
  evidenceCurrent,
  project,
  onApply,
}: {
  path: string
  source: string
  result: LatexCompileResult | null
  evidenceCurrent: boolean
  project: LatexProjectInfo | null
  onApply: (text: string) => void
}) {
  const { lang } = useI18n()
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{
    path: string
    base: string
    proposal: LatexRepairProposal
  } | null>(null)
  const [applied, setApplied] = useState(false)
  const active = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const requestRef = useRef<() => void>(() => {})
  const gate = useAiSendGate<void>({
    settings,
    statuses: null,
    store,
    start: () => requestRef.current(),
  })
  useEffect(() => {
    alive.current = true
    const refresh = () => {
      void store
        .getSettings()
        .then((next) => {
          if (alive.current) setSettings({ ...next, provider: 'openai' })
        })
        .catch(() => {
          if (alive.current) setSettings(null)
        })
    }
    refresh()
    const off = window.markdownApi.onAiSettingsChanged(refresh)
    return () => {
      alive.current = false
      active.current?.abort()
      off()
    }
  }, [])
  useEffect(() => {
    active.current?.abort()
    active.current = null
    setBusy(false)
    setDraft(null)
    setError(null)
    setApplied(false)
  }, [path])

  const diagnose = async () => {
    if (
      active.current ||
      !settings ||
      !result ||
      result.ok ||
      !evidenceCurrent ||
      !gate.admit(undefined)
    )
      return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError(null)
    setDraft(null)
    setApplied(false)
    let truncated = false
    try {
      const file =
        project?.files.find((item) => item.path === path)?.relativePath ??
        path.replace(/^.*[/\\]/, '')
      const request = buildLatexRepairRequest(source, result, project, file, lang, instruction)
      const transport = createElectronTransport(() => settings, {
        lang: () => lang,
        onInputTruncated: () => {
          truncated = true
        },
      })
      const outcome = await streamText({
        transport,
        ...request,
        signal: controller.signal,
        maxChars: MAX_REPAIR_REPLY_CHARS,
        extract: (raw) => ({ text: raw }),
      })
      if (controller.signal.aborted || active.current !== controller || !alive.current) return
      if (truncated || outcome.status !== 'complete')
        throw new Error(
          outcome.status === 'empty' && outcome.error ? outcome.error : latexText(lang, 'aiFailed'),
        )
      const proposal = parseLatexRepair(outcome.text)
      applyLatexRepair(source, source, proposal)
      setDraft({ path, base: source, proposal })
    } catch (cause) {
      if (!controller.signal.aborted && active.current === controller && alive.current)
        setError(
          cause instanceof LatexRepairError
            ? latexText(lang, cause.code)
            : cause instanceof Error
              ? cause.message
              : latexText(lang, 'aiFailed'),
        )
    } finally {
      if (active.current === controller) {
        active.current = null
        if (alive.current) setBusy(false)
      }
    }
  }
  requestRef.current = () => {
    void diagnose()
  }
  const stale = draft !== null && (draft.base !== source || draft.path !== path)
  return (
    <details className="latex-ai-repair" open data-testid="latex-ai-repair">
      <summary>{latexText(lang, 'aiRepair')}</summary>
      <div className="latex-ai-content">
        <p>{latexText(lang, 'aiDisclosure')}</p>
        <p className="latex-ai-model">OpenAI · {settings?.providers.openai.model ?? ''}</p>
        {gate.gate.kind !== 'run' && (
          <div role="status">
            <span>{latexText(lang, 'aiNeedsSetup')}</span>{' '}
            <button onClick={() => void window.markdownApi.openAiModelSettings()}>
              {latexText(lang, 'aiSettings')}
            </button>
          </div>
        )}
        <label>
          {latexText(lang, 'aiInstruction')}
          <textarea
            value={instruction}
            maxLength={2000}
            disabled={busy}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
        <div className="latex-ai-actions">
          <button
            disabled={busy || gate.gate.kind !== 'run' || !result || result.ok || !evidenceCurrent}
            onClick={() => void diagnose()}
          >
            {busy ? latexText(lang, 'aiWorking') : latexText(lang, 'aiDiagnose')}
          </button>
          {busy && (
            <button
              onClick={() => {
                active.current?.abort()
                active.current = null
                setBusy(false)
              }}
            >
              {latexText(lang, 'cancel')}
            </button>
          )}
        </div>
        {!evidenceCurrent && <p>{latexText(lang, 'aiCompileFirst')}</p>}
        {error && <p role="alert">{error}</p>}
        {draft && (
          <div className="latex-ai-proposal" data-testid="latex-ai-proposal">
            <p>{draft.proposal.summary}</p>
            {draft.proposal.edits.map((edit, index) => (
              <details key={index} open>
                <summary>{latexText(lang, 'aiChange', { number: index + 1 })}</summary>
                <div className="latex-ai-diff">
                  <div>
                    <strong>{latexText(lang, 'aiBefore')}</strong>
                    <pre>{edit.oldText}</pre>
                  </div>
                  <div>
                    <strong>{latexText(lang, 'aiAfter')}</strong>
                    <pre>{edit.newText}</pre>
                  </div>
                </div>
              </details>
            ))}
            {stale && <p role="alert">{latexText(lang, 'aiStale')}</p>}
            {draft.proposal.edits.length === 0 && <p>{latexText(lang, 'aiNoEdits')}</p>}
            <button
              disabled={stale || busy || draft.proposal.edits.length === 0}
              onClick={() => {
                try {
                  if (draft.path !== path) throw new LatexRepairError('aiStale')
                  const next = applyLatexRepair(source, draft.base, draft.proposal)
                  onApply(next)
                  setDraft(null)
                  setApplied(true)
                } catch (cause) {
                  setError(
                    latexText(
                      lang,
                      cause instanceof LatexRepairError ? cause.code : 'aiInvalidReply',
                    ),
                  )
                }
              }}
            >
              {latexText(lang, 'aiApply')}
            </button>{' '}
            <button onClick={() => setDraft(null)}>{latexText(lang, 'aiDismiss')}</button>
          </div>
        )}
        {applied && <p role="status">{latexText(lang, 'aiApplied')}</p>}
      </div>
    </details>
  )
}
