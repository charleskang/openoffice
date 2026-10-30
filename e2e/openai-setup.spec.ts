import { test, expect } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { launchShell, closeAndSaveVideo, screenshotPath } from './helpers'

test('OpenAI API is the primary setup and saving selects it without a model request', async () => {
  // Cleanly closing a fresh profile persists Chromium's Windows encryption key.
  const warm = await launchShell({
    onboardingSeen: true,
    recordVideo: false,
    videoDir: 'openai-warmup',
  })
  const userDataDir = warm.userDataDir
  await closeAndSaveVideo(warm, 'openai-warmup')
  const launched = await launchShell({
    userDataDir,
    onboardingSeen: true,
    recordVideo: false,
    lang: 'ko',
    videoDir: 'openai-setup',
  })
  try {
    const page = launched.page
    await expect(page.locator('.account-name')).toHaveText('OpenAI API')
    await page.locator('.account-btn').click()
    const form = page.getByTestId('openai-setup')
    await expect(form).toBeVisible()
    await expect(page.locator('.openai-other-settings')).not.toHaveAttribute('open')
    await mkdir(dirname(screenshotPath('officemax-openai')), { recursive: true })
    await page.screenshot({ path: screenshotPath('officemax-openai') })
    // The fake key is saved only to this launch's temporary profile; no connection test runs.
    await form.locator('#office-openai-key').fill('sk-local-test-not-a-real-key')
    await form.locator('#office-openai-model').fill('gpt-5.6-terra')
    await form.getByRole('button', { name: '저장', exact: true }).click()
    await expect(form.getByRole('status')).toContainText('저장')
    const settingsPath = join(launched.userDataDir, 'ai-settings.json')
    const stored = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(stored.provider).toBe('openai')
    expect(stored.providers.openai.model).toBe('gpt-5.6-terra')
    if (process.platform === 'win32') {
      expect(stored.providers.openai.apiKey).toMatch(/^sealed:v1:/)
    }
  } finally {
    await closeAndSaveVideo(launched, 'openai-setup')
  }
})

test('API key and model fields support typing and keyboard navigation during onboarding', async () => {
  const launched = await launchShell({ recordVideo: false, videoDir: 'openai-onboarding' })
  try {
    const page = launched.page
    await page.locator('.onb-next').click()
    const slide = page.locator('.onb-slide.active')
    await expect(slide).toHaveAttribute('data-step', 'connect')
    await expect(slide.getByTestId('openai-setup')).toBeVisible()
    const model = slide.locator('#office-openai-model')
    await model.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    await expect(slide).toHaveAttribute('data-step', 'connect')
    await slide.locator('#office-openai-key').focus()
    await page.keyboard.press('Tab')
    await expect(model).toBeFocused()
  } finally {
    await closeAndSaveVideo(launched, 'openai-onboarding')
  }
})
