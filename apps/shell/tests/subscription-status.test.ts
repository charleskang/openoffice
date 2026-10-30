import { describe, expect, it } from 'vitest'
import { defaultAiSettings } from '@genoffice/ai-provider'
import type {
  AiSettings,
  AiSubscriptionProviderId,
  AiSubscriptionStatus,
  SubscriptionStatusMap,
} from '@genoffice/ai-provider/browser'
import {
  aiConnectHint,
  firstConnectionNoticeDue,
  subscriptionSummary,
  usableSubscriptionProviders,
} from '../src/renderer/src/subscription-status'

function status(
  provider: AiSubscriptionProviderId,
  state: AiSubscriptionStatus['state'],
  extra: Partial<AiSubscriptionStatus> = {},
): AiSubscriptionStatus {
  return { provider, state, meteredAccepted: false, ...extra }
}

function statusMap(
  claude: AiSubscriptionStatus['state'],
  codex: AiSubscriptionStatus['state'],
): SubscriptionStatusMap {
  return { 'claude-code': status('claude-code', claude), codex: status('codex', codex) }
}

const settings = (patch: Partial<AiSettings> = {}): AiSettings => ({
  ...defaultAiSettings(),
  provider: 'auto',
  ...patch,
})

describe('usableSubscriptionProviders', () => {
  it('lists the ready subscriptions in catalog order', () => {
    expect(usableSubscriptionProviders(statusMap('ready', 'ready'))).toEqual([
      'claude-code',
      'codex',
    ])
    expect(usableSubscriptionProviders(statusMap('signed-out', 'ready'))).toEqual(['codex'])
    expect(usableSubscriptionProviders(statusMap('checking', 'not-installed'))).toEqual([])
    expect(usableSubscriptionProviders({})).toEqual([])
  })

  it('counts a metered login only once it was accepted', () => {
    const metered = statusMap('metered', 'signed-out')
    expect(usableSubscriptionProviders(metered)).toEqual([])
    expect(
      usableSubscriptionProviders({
        ...metered,
        'claude-code': status('claude-code', 'metered', { meteredAccepted: true }),
      }),
    ).toEqual(['claude-code'])
  })
})

describe('subscriptionSummary', () => {
  it('is connected as soon as one provider can run, even while the other is still checked', () => {
    expect(subscriptionSummary(statusMap('checking', 'ready'))).toEqual({
      state: 'connected',
      connected: ['codex'],
    })
  })

  it('is checking while nothing is connected and an answer is still out', () => {
    expect(subscriptionSummary(statusMap('checking', 'signed-out')).state).toBe('checking')
    expect(subscriptionSummary({}).state).toBe('checking')
  })

  it('is disconnected once every answer is in and none can run', () => {
    expect(subscriptionSummary(statusMap('not-installed', 'signed-out'))).toEqual({
      state: 'disconnected',
      connected: [],
    })
    expect(subscriptionSummary(statusMap('error', 'metered')).state).toBe('disconnected')
  })
})

describe('firstConnectionNoticeDue', () => {
  it('is due the moment a subscription can be used and the notice was not seen', () => {
    expect(firstConnectionNoticeDue(settings(), statusMap('ready', 'signed-out'))).toBe(true)
    expect(firstConnectionNoticeDue(settings(), statusMap('not-installed', 'ready'))).toBe(true)
  })

  it('is not due before any subscription can be used', () => {
    expect(firstConnectionNoticeDue(settings(), statusMap('checking', 'checking'))).toBe(false)
    expect(firstConnectionNoticeDue(settings(), statusMap('signed-out', 'metered'))).toBe(false)
  })

  it('never comes back once it was acknowledged', () => {
    expect(
      firstConnectionNoticeDue(
        settings({ subscriptionNoticeSeen: true }),
        statusMap('ready', 'ready'),
      ),
    ).toBe(false)
  })

  it('waits for readable settings: an acknowledgement that cannot be stored would not stay away', () => {
    expect(firstConnectionNoticeDue(null, statusMap('ready', 'ready'))).toBe(false)
  })
})

describe('aiConnectHint', () => {
  it('is silent while the selected AI can run', () => {
    expect(aiConnectHint(settings(), statusMap('ready', 'signed-out'))).toBeNull()
  })

  it('is silent while a check that could still connect it is out', () => {
    expect(aiConnectHint(settings(), statusMap('checking', 'signed-out'))).toBeNull()
    expect(aiConnectHint(null, statusMap('signed-out', 'signed-out'))).toBeNull()
  })

  it('asks to connect a subscription when none can run', () => {
    expect(aiConnectHint(settings(), statusMap('not-installed', 'signed-out'))?.titleKey).toBe(
      'connectTitle',
    )
  })

  it('names a selected subscription that cannot run', () => {
    const hint = aiConnectHint(settings({ provider: 'codex' }), statusMap('ready', 'signed-out'))
    expect(hint?.titleKey).toBe('connectProviderTitle')
    expect(hint?.providerName).toBe('Codex')
  })
})
