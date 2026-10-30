/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiSubscriptionState, SubscriptionStatusMap } from '@genoffice/ai-provider/browser'
import { LANGS } from '@genoffice/i18n'
import { aiSubscriptionText } from '@genoffice/ui'
import { openAiText } from '../src/renderer/src/i18n/strings-openai'
import { Onboarding } from '../src/renderer/src/Onboarding'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  ONBOARDING_CONNECT_STEP,
  ONBOARDING_STEPS,
  isLastOnboardingStep,
  nextOnboardingStep,
  previousOnboardingStep,
} from '../src/renderer/src/onboarding-steps'
import { strings } from '../src/renderer/src/strings'
import type { SubscriptionConnection } from '../src/renderer/src/subscription-client'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function statuses(claude: AiSubscriptionState, codex: AiSubscriptionState): SubscriptionStatusMap {
  return {
    'claude-code': { provider: 'claude-code', state: claude, meteredAccepted: false },
    codex: { provider: 'codex', state: codex, meteredAccepted: false },
  }
}

function connectionOf(
  map: SubscriptionStatusMap,
  extra: Partial<SubscriptionConnection> = {},
): SubscriptionConnection {
  return {
    statuses: map,
    busy: false,
    failed: {},
    codexImageAvailable: false,
    install: vi.fn(),
    login: vi.fn(),
    switchAccount: vi.fn(),
    logout: vi.fn(),
    recheck: vi.fn(),
    refresh: vi.fn(),
    acceptMetered: vi.fn(async () => undefined),
    openInstallHelp: vi.fn(),
    ...extra,
  }
}

interface RenderOptions {
  onDone?: () => Promise<boolean>
  connection?: SubscriptionConnection
  noticeDue?: boolean
  onNoticeAcknowledge?: () => void
}

function renderOnboarding(options: RenderOptions = {}): void {
  act(() => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(Onboarding, {
          onDone: options.onDone ?? vi.fn(async () => true),
          connection: options.connection ?? connectionOf(statuses('not-installed', 'signed-out')),
          noticeDue: options.noticeDue ?? false,
          onNoticeAcknowledge: options.onNoticeAcknowledge ?? vi.fn(),
        }),
      ),
    )
  })
}

async function click(selector: string): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(selector)
  expect(button, selector).not.toBeNull()
  await act(async () => {
    button!.click()
    // let a finish (persist, then re-enable the buttons) settle
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const activeStep = (): string | null =>
  host.querySelector<HTMLElement>('.onb-slide.active')?.dataset.step ?? null

describe('onboarding steps', () => {
  it('are exactly welcome, connect, done', () => {
    expect(ONBOARDING_STEPS).toEqual(['welcome', 'connect', 'done'])
    expect(ONBOARDING_CONNECT_STEP).toBe(1)
  })

  it('advance one by one and finish after the last, whatever the connection', () => {
    expect(nextOnboardingStep(0)).toBe(1)
    expect(nextOnboardingStep(1)).toBe(2)
    expect(nextOnboardingStep(2)).toBeNull()
    expect(isLastOnboardingStep(1)).toBe(false)
    expect(isLastOnboardingStep(2)).toBe(true)
  })

  it('go back one by one and stop at the first', () => {
    expect(previousOnboardingStep(2)).toBe(1)
    expect(previousOnboardingStep(1)).toBe(0)
    expect(previousOnboardingStep(0)).toBe(0)
  })
})

describe('Onboarding', () => {
  it('shows three steps: welcome first, one dot each', () => {
    renderOnboarding()
    expect(
      Array.from(host.querySelectorAll<HTMLElement>('.onb-slide')).map((el) => el.dataset.step),
    ).toEqual(['welcome', 'connect', 'done'])
    expect(host.querySelectorAll('.onb-dot')).toHaveLength(3)
    expect(activeStep()).toBe('welcome')
  })

  it('describes the product plainly on the welcome step', () => {
    renderOnboarding()
    const step = host.querySelector<HTMLElement>('.onb-slide[data-step="welcome"]')!
    expect(step.querySelector('.onb-subtitle')!.textContent).toBe(strings.en.onbWelcomeSubtitle)
    expect(step.querySelector('.onb-body')!.textContent).toBe(openAiText('en', 'setupHint'))
    // no superlative of its own
    expect(step.textContent).not.toMatch(/\b(first|best|leading|most|only)\b|AI-native/i)
    expect(strings.en.onbWelcomeSubtitle).toBe('An open-source office suite')
  })

  it('can be completed without connecting a subscription', async () => {
    const onDone = vi.fn(async () => true)
    const connection = connectionOf(statuses('not-installed', 'not-installed'))
    renderOnboarding({ onDone, connection })

    await click('.onb-next')
    expect(activeStep()).toBe('connect')
    expect(host.querySelector<HTMLButtonElement>('.onb-next')!.disabled).toBe(false)
    expect(host.textContent).toContain(strings.en.onbConnectSkipNote)

    await click('.onb-next')
    expect(activeStep()).toBe('done')
    expect(host.textContent).toContain(strings.en.onbDoneNotConnected)
    expect(onDone).not.toHaveBeenCalled()

    await click('.onb-next')
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(connection.install).not.toHaveBeenCalled()
    expect(connection.login).not.toHaveBeenCalled()
  })

  it('lets Skip and Escape finish from any step', async () => {
    const onDone = vi.fn(async () => true)
    renderOnboarding({ onDone })

    await click('.onb-skip')
    expect(onDone).toHaveBeenCalledTimes(1)

    await click('.onb-next')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })
    expect(onDone).toHaveBeenCalledTimes(2)
  })

  it('offers the GPT API form without requiring a subscription program', async () => {
    const connection = connectionOf(statuses('not-installed', 'not-installed'))
    renderOnboarding({ connection })
    await click('.onb-next')
    const step = host.querySelector<HTMLElement>('.onb-slide[data-step="connect"]')!
    expect(step.querySelector('[data-testid="openai-setup"]')).not.toBeNull()
    expect(step.querySelector('input[type="password"]')).not.toBeNull()
    expect(step.querySelector('.ai-sub-card')).toBeNull()
    expect(connection.install).not.toHaveBeenCalled()
    expect(connection.login).not.toHaveBeenCalled()
  })

  it('keeps the first-connection notice for the connect step and reports its acknowledgement', async () => {
    const onNoticeAcknowledge = vi.fn()
    const onDone = vi.fn(async () => true)
    renderOnboarding({
      onDone,
      noticeDue: true,
      onNoticeAcknowledge,
      connection: connectionOf(statuses('ready', 'signed-out')),
    })
    expect(host.querySelector('.first-notice')).toBeNull()

    await click('.onb-next')
    const notice = host.querySelector<HTMLElement>('.first-notice')!
    expect(notice.textContent).toContain(aiSubscriptionText('en', 'noticeSend'))
    expect(notice.textContent).toContain(aiSubscriptionText('en', 'noticeTraining'))
    expect(notice.textContent).toContain(aiSubscriptionText('en', 'noticeCodexHistory'))

    // the notice owns the keyboard: the onboarding behind it neither skips nor advances
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
      await Promise.resolve()
    })
    expect(activeStep()).toBe('connect')
    expect(onDone).not.toHaveBeenCalled()

    await click('.first-notice .ai-sub-btn')
    expect(onNoticeAcknowledge).toHaveBeenCalledTimes(1)
  })

  it('carries no credits offer, community call, star hint or statistics notice', async () => {
    renderOnboarding({ connection: connectionOf(statuses('ready', 'ready')) })
    const text = () => host.textContent ?? ''
    for (let step = 0; step < ONBOARDING_STEPS.length; step++) {
      expect(text()).not.toMatch(/credit|github|\bstars?\b|statistic|analytics/i)
      if (step < ONBOARDING_STEPS.length - 1) await click('.onb-next')
    }
    expect(host.querySelector('[role="switch"]')).toBeNull()
    expect(host.querySelector('.onb-offer, .onb-star, .onb-consent, .onb-join')).toBeNull()
  })
})

describe('welcome copy', () => {
  it('exists in every UI language, as a translation', () => {
    expect(LANGS).toHaveLength(21)
    for (const lang of LANGS) {
      const { onbWelcomeSubtitle, onbWelcomeBody } = strings[lang]
      expect(onbWelcomeSubtitle.trim(), lang).not.toBe('')
      expect(onbWelcomeBody.trim(), lang).not.toBe('')
      if (lang === 'en') continue
      expect(onbWelcomeSubtitle, lang).not.toBe(strings.en.onbWelcomeSubtitle)
      expect(onbWelcomeBody, lang).not.toBe(openAiText('en', 'setupHint'))
    }
    expect(new Set(LANGS.map((lang) => strings[lang].onbWelcomeBody)).size).toBe(LANGS.length)
  })

  it.each(LANGS)('names every document kind and both subscriptions in %s', (lang) => {
    const body = strings[lang].onbWelcomeBody
    for (const name of ['Word', 'Excel', 'PowerPoint', 'PDF', 'Markdown', 'HTML']) {
      expect(body, name).toContain(name)
    }
    expect(body).toContain('Claude')
    expect(body).toContain('Codex')
    // the product is named by the title above, and no vendor of the suite is named at all
    expect(`${strings[lang].onbWelcomeSubtitle} ${body}`).not.toMatch(/genoffice/i)
  })
})
