import { useEffect, useRef, useState } from 'react'
import { AI_PROVIDERS, isKeyProviderConfigured } from '@genoffice/ai-provider/browser'
import type { AiSettings } from '@genoffice/ai-provider/browser'
import { useI18n } from './locale'
import { changeAiSettings, readAiSettings, withOpenAiConfig } from './settings-ai'
import { openAiText } from './i18n/strings-openai'
import './openai-setup.css'

/** Uses the existing guarded IPC and OS secret storage; never calls a model while saving. */
export function OpenAiSetup() {
  const { t, lang } = useI18n()
  const meta = AI_PROVIDERS.find((entry) => entry.id === 'openai')!
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [key, setKey] = useState('')
  const [model, setModel] = useState(meta.defaultModel)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<'saved' | 'error' | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => {
      void readAiSettings().then((next) => {
        if (!alive || !next) return
        setSettings(next)
        if (!dirtyRef.current) {
          setKey(next.providers.openai?.apiKey ?? '')
          setModel(next.providers.openai?.model || meta.defaultModel)
        }
      })
    }
    load()
    const off = window.aiOffice?.onAiSettingsChanged?.(load)
    return () => {
      alive = false
      off?.()
    }
  }, [meta.defaultModel])

  const touch = () => {
    dirtyRef.current = true
    setDirty(true)
    setFeedback(null)
  }
  const save = async () => {
    setSaving(true)
    setFeedback(null)
    const written = await changeAiSettings((latest) => withOpenAiConfig(latest, key, model))
    setSaving(false)
    if (!written) {
      setFeedback('error')
      return
    }
    setSettings(written)
    setKey(written.providers.openai.apiKey)
    setModel(written.providers.openai.model)
    dirtyRef.current = false
    setDirty(false)
    setFeedback('saved')
  }
  const ready =
    settings && settings.provider === 'openai' && isKeyProviderConfigured(settings, 'openai')
  return (
    <section className="openai-setup" aria-label="OpenAI API" data-testid="openai-setup">
      <div className="set-pane-head">
        <h3 className="set-pane-title">OpenAI API</h3>
        <button
          className="set-btn primary"
          disabled={!settings || saving || !dirty || !model.trim()}
          onClick={() => void save()}
        >
          {t('setAiSave')}
        </button>
      </div>
      <p className="set-field-desc set-ai-note">{openAiText(lang, 'setupHint')}</p>
      <div className="set-field">
        <label className="set-field-label" htmlFor="office-openai-key">
          {t('setAiApiKey')}
        </label>
        <input
          id="office-openai-key"
          className="set-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          placeholder="sk-…"
          disabled={!settings || saving}
          onChange={(event) => {
            setKey(event.target.value)
            touch()
          }}
        />
      </div>
      <div className="set-field">
        <label className="set-field-label" htmlFor="office-openai-model">
          {t('setAiModelId')}
        </label>
        <input
          id="office-openai-model"
          className="set-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={model}
          list="office-openai-models"
          disabled={!settings || saving}
          onChange={(event) => {
            setModel(event.target.value)
            touch()
          }}
        />
        <datalist id="office-openai-models">
          {meta.models.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </div>
      <p className="set-field-desc" role="status">
        {feedback === 'error'
          ? t('setAiTestFail')
          : feedback === 'saved'
            ? t('setAiSaved')
            : openAiText(lang, ready ? 'ready' : 'missing')}
      </p>
    </section>
  )
}
