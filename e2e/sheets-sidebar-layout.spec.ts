import { test, expect, type Page, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl, screenshotPath } from './helpers'

async function shellPage(app: ElectronApplication): Promise<Page> {
  let page: Page | undefined
  await expect
    .poll(() => {
      page = app.windows().find((p) => p.url().includes('/shell/out/renderer/index.html'))
      return Boolean(page)
    })
    .toBe(true)
  await page!.waitForFunction(() => Boolean(window.aiOffice))
  return page!
}

async function expectFullSheet(page: Page) {
  await expect(page.locator('.copilot')).toHaveCount(0)
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const body = document.querySelector('.sheet-body')!.getBoundingClientRect()
          const main = document.querySelector('.sheet-main')!.getBoundingClientRect()
          return Math.max(Math.abs(main.width - body.width), Math.abs(main.x - body.x))
        }),
      { timeout: 5000 },
    )
    .toBeLessThanOrEqual(2)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const grid = [...document.querySelectorAll('canvas')].find(
          (c) => c.width > 500 && c.height > 300,
        )
        return grid?.getBoundingClientRect().width ?? 0
      }),
    )
    .toBeGreaterThan(500)
}

for (const side of ['left', 'right'] as const) {
  test(`sheets: hidden ${side} AI sidebar keeps the sheet full-width after a fresh launch`, async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'officemax-sidebar-layout-'))
    const fixture = join(scratch, 'sidebar.xlsx')
    const zip = await JSZip.loadAsync(
      await readFile(resolve(__dirname, '../apps/shell/build/shell-new/blank.xlsx')),
    )
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    zip.file(
      'xl/worksheets/sheet1.xml',
      xml.replace(
        /<sheetData(?:\s*\/\s*>|>[\s\S]*?<\/sheetData>)/,
        '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>OfficeMax sidebar check</t></is></c><c r="B1"><v>42</v></c></row></sheetData>',
      ),
    )
    await writeFile(fixture, await zip.generateAsync({ type: 'nodebuffer' }))
    const launched = await launchShell({
      onboardingSeen: true,
      settings: {
        theme: 'dark',
        aiPanelShowSidebar: false,
        aiPanelOpenInNewDocs: false,
        aiPanelSide: side,
      },
      videoDir: `sheets-sidebar-${side}`,
      recordVideo: false,
      openFile: fixture,
    })
    try {
      const { app } = launched
      const home = await shellPage(app)
      const sheets = await waitForPageWithUrl(app, '://sheets/')
      await sheets.waitForFunction(() => document.body.innerText.includes('Sheet1'))
      await expectFullSheet(sheets)
      await sheets.getByRole('button', { name: 'AI Assistant', exact: true }).first().click()
      await expect(sheets.locator('.copilot')).toBeVisible()
      await sheets.locator('.ai-panel-collapse').click()
      await expectFullSheet(sheets)
      await home.evaluate(() => window.aiOffice.setAiPanelPrefs({ showAiSidebar: true }))
      await expect(sheets.locator('.copilot.collapsed')).toBeVisible()
      await home.evaluate(() => window.aiOffice.setAiPanelPrefs({ showAiSidebar: false }))
      await expectFullSheet(sheets)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 740))
      await expectFullSheet(sheets)
      await sheets.screenshot({ path: screenshotPath(`sheets-sidebar-${side}-hidden`) })
      const point = await sheets.evaluate(() => {
        const canvas = [...document.querySelectorAll('canvas')].find(
          (c) => c.width > 500 && c.height > 300,
        )!
        const r = canvas.getBoundingClientRect()
        return { x: r.x + 46 + 43, y: r.y + 24 + 12 }
      })
      await sheets.mouse.click(point.x, point.y)
      await sheets.keyboard.type('Sidebar verified')
      await sheets.keyboard.press('Enter')
      await app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL().includes('://sheets/'))
          ?.send('menu:action', 'save'),
      )
      await expect
        .poll(
          async () => {
            const saved = await JSZip.loadAsync(await readFile(fixture))
            const strings = await Promise.all(
              Object.values(saved.files)
                .filter((f) => /xl\/(worksheets\/sheet\d+|sharedStrings)\.xml$/.test(f.name))
                .map((f) => f.async('string')),
            )
            return (
              strings.some((s) => s.includes('Sidebar verified')) &&
              strings.some((s) => s.includes('<v>42</v>'))
            )
          },
          { timeout: 15000 },
        )
        .toBe(true)
    } finally {
      await closeAndSaveVideo(launched, `sheets-sidebar-${side}`)
    }
    // Reuse the saved preferences in a completely new process, reproducing
    // the startup condition the real user reaches after reboot.
    const reopened = await launchShell({
      userDataDir: launched.userDataDir,
      videoDir: `sheets-sidebar-${side}-restart`,
      recordVideo: false,
      openFile: fixture,
    })
    try {
      const sheets = await waitForPageWithUrl(reopened.app, '://sheets/')
      await sheets.waitForFunction(() => document.body.innerText.includes('Sheet1'))
      await expectFullSheet(sheets)
      expect(
        (await (await shellPage(reopened.app)).evaluate(() => window.aiOffice.getAiPanelPrefs()))
          .showAiSidebar,
      ).toBe(false)
    } finally {
      await closeAndSaveVideo(reopened, `sheets-sidebar-${side}-restart`)
    }
  })
}
