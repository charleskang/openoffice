import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpError } from 'builder-util-runtime'
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider'
import { PRODUCT_REPO_SLUG } from '@genoffice/i18n'
// @ts-expect-error The release helper is a directly executable Node module.
import { digest, validateMacUpdate } from '../../../tools/mac-update-release.mjs'

const require = createRequire(import.meta.url)
const semver = require('semver')
const yaml = require('js-yaml')
const VERSION = '0.13.5-beta.1'
const PREVIOUS = '0.13.4-mac-preview.2'
const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'officemax-mac-update-test-'))
  folders.push(folder)
  const files = []
  for (const suffix of ['arm64-mac.zip', 'arm64.dmg']) {
    const url = `OfficeMax-${VERSION}-${suffix}`
    await writeFile(join(folder, url), 'fixture')
    files.push({ url, size: 7, sha512: await digest(join(folder, url), 'sha512', 'base64') })
  }
  await writeFile(
    join(folder, 'beta-mac.yml'),
    yaml.dump({ version: VERSION, files, path: files[0].url, sha512: files[0].sha512 }),
  )
  await writeFile(
    join(folder, 'SMOKE-RESULT.json'),
    JSON.stringify({
      os: 'darwin',
      architecture: 'arm64',
      wholeWorkbookPdf: true,
      latexZipPreview: true,
      sourceUnchanged: true,
      latexBodyVisible: true,
    }),
  )
  await writeFile(join(folder, 'SOURCE-COMMIT.txt'), 'a'.repeat(40))
  return folder
}

describe('Mac update package validation', () => {
  it('accepts the feed only with its matching packages and passed Mac checks', async () => {
    expect(await validateMacUpdate(await fixture(), VERSION)).toMatchObject({
      version: VERSION,
      tag: `v${VERSION}`,
    })
  })
  it('rejects a package corrupted after the feed was generated', async () => {
    const folder = await fixture()
    await writeFile(join(folder, `OfficeMax-${VERSION}-arm64.dmg`), 'changed')
    await expect(validateMacUpdate(folder, VERSION)).rejects.toThrow('SHA-512')
  })
  it('rejects a feed from a different build version', async () => {
    await expect(validateMacUpdate(await fixture(), '0.13.5-beta.2')).rejects.toThrow(
      'Feed version',
    )
  })
  it('rejects the custom preview channel and downgrade versions', async () => {
    await expect(validateMacUpdate(await fixture(), PREVIOUS)).rejects.toThrow(
      'newer standard beta',
    )
  })
  it('rejects an update whose Korean PDF preview test failed', async () => {
    const folder = await fixture()
    const path = join(folder, 'SMOKE-RESULT.json')
    await writeFile(
      path,
      JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), latexBodyVisible: false }),
    )
    await expect(validateMacUpdate(folder, VERSION)).rejects.toThrow('runtime checks')
  })
})

function providerFor(version: string, beta: boolean) {
  const root = `/${PRODUCT_REPO_SLUG}/releases`
  const tag = `v${version}`
  const requests: string[] = []
  const provider = new GitHubProvider(
    {
      provider: 'github',
      owner: PRODUCT_REPO_SLUG.split('/')[0],
      repo: PRODUCT_REPO_SLUG.split('/')[1],
    },
    {
      currentVersion: new semver.SemVer(PREVIOUS),
      channel: beta ? 'beta' : 'latest',
      allowPrerelease: beta,
      fullChangelog: true,
    } as never,
    {
      platform: 'darwin',
      isUseMultipleRangeRequest: false,
      executor: {
        request: async (options: { path: string }) => {
          requests.push(options.path)
          if (options.path === `${root}.atom`)
            return `<feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title><entry><title>${tag}</title><link href="https://github.com${root}/tag/${tag}"/><content type="html">Mac beta update</content></entry></feed>`
          if (options.path === `${root}/latest`) throw new HttpError(404)
          if (options.path === `${root}/download/${tag}/beta-mac.yml`)
            return yaml.dump({
              version,
              files: [{ url: `OfficeMax-${version}-arm64-mac.zip`, size: 7, sha512: 'c2hhNTEy' }],
            })
          throw new HttpError(404)
        },
      },
    } as never,
  )
  return { provider, requests }
}

describe('the installed preview can find the next standard Mac beta', () => {
  it('resolves the Mac feed and correct release file without a GitHub token', async () => {
    const { provider, requests } = providerFor(VERSION, true)
    const info = await provider.getLatestVersion()
    expect(info.version).toBe(VERSION)
    expect(semver.gt(info.version, PREVIOUS)).toBe(true)
    expect(provider.resolveFiles(info)[0].url.href).toBe(
      `https://github.com/${PRODUCT_REPO_SLUG}/releases/download/v${VERSION}/OfficeMax-${VERSION}-arm64-mac.zip`,
    )
    expect(requests.at(-1)).toContain('/beta-mac.yml')
    expect(requests.some((path) => /\/latest\.yml$/.test(path))).toBe(false)
  })
  it('demonstrates why the previous mac-preview naming was skipped', async () => {
    await expect(providerFor(PREVIOUS, true).provider.getLatestVersion()).rejects.toThrow(
      'No published versions',
    )
  })
  it('does not offer the Mac-only prerelease on the stable channel', async () => {
    await expect(providerFor(VERSION, false).provider.getLatestVersion()).rejects.toThrow(
      'latest version',
    )
  })
})
