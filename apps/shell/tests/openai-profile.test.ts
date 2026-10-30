import { describe, expect, it } from 'vitest'
import { defaultAiSettings, normalizeAiSettings, selectAiProvider } from '@genoffice/ai-provider'
import { withOpenAiConfig } from '../src/renderer/src/settings-ai'
import { firstConnectionNoticeDue } from '../src/renderer/src/subscription-status'

const readySubscriptions = {
  'claude-code': { provider: 'claude-code', state: 'ready', meteredAccepted: false },
  codex: { provider: 'codex', state: 'ready', meteredAccepted: false },
} as const

describe('OfficeMax OpenAI preference', () => {
  it('requires an API key instead of choosing an available subscription', () => {
    for (const settings of [defaultAiSettings(), normalizeAiSettings({})]) {
      expect(selectAiProvider(settings, readySubscriptions)).toMatchObject({
        connected: false,
        provider: 'openai',
        reason: 'not-configured',
      })
      expect(firstConnectionNoticeDue(settings, readySubscriptions)).toBe(false)
    }
  })

  it('saves the explicit OpenAI selection without overwriting unrelated settings', () => {
    const before = defaultAiSettings()
    before.provider = 'claude-code'
    before.providers.gemini.apiKey = 'unrelated-test-key'
    before.providers.openai.baseUrl = 'https://example.test/v1'
    before.maxOutputTokens = 8192
    const after = withOpenAiConfig(before, ' sk-test-only ', ' gpt-5.6-terra ')
    expect(after.provider).toBe('openai')
    expect(after.providers.openai).toMatchObject({
      apiKey: 'sk-test-only',
      model: 'gpt-5.6-terra',
      baseUrl: undefined,
    })
    expect(after.providers.gemini).toEqual(before.providers.gemini)
    expect(after.maxOutputTokens).toBe(8192)
    expect(before.provider).toBe('claude-code')
    expect(selectAiProvider(after, readySubscriptions)).toMatchObject({
      connected: true,
      provider: 'openai',
    })
  })

  it('clearing the key blocks requests without falling back to Claude', () => {
    const cleared = withOpenAiConfig(defaultAiSettings(), '', 'gpt-5.6-terra')
    expect(selectAiProvider(cleared, readySubscriptions)).toMatchObject({
      connected: false,
      provider: 'openai',
      reason: 'not-configured',
    })
  })
})
