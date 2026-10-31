import { createReadStream } from 'node:fs'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const semver = require('semver')

export async function digest(file, algorithm, encoding) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest(encoding)
}

export async function createMacUpdateFeed(folder, version) {
  if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(version) || !semver.gt(version, '0.13.4-mac-preview.2'))
    throw Error('Use a newer standard beta version')
  // --publish never may omit electron-builder's channel files. Derive one
  // explicitly from this build's exact packages, never from a previous feed.
  const files = []
  for (const suffix of ['arm64-mac.zip', 'arm64.dmg']) {
    const url = `OfficeMax-${version}-${suffix}`
    const file = join(folder, url)
    files.push({
      url,
      size: (await stat(file)).size,
      sha512: await digest(file, 'sha512', 'base64'),
    })
  }
  await writeFile(
    join(folder, 'beta-mac.yml'),
    yaml.dump({
      version,
      files,
      path: files[0].url,
      sha512: files[0].sha512,
      releaseDate: new Date().toISOString(),
    }),
  )
}

export async function validateMacUpdate(folder, version) {
  if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(version) || !semver.gt(version, '0.13.4-mac-preview.2'))
    throw Error('Use a newer standard beta version')
  const feed = yaml.load(await readFile(join(folder, 'beta-mac.yml'), 'utf8'))
  if (feed?.version !== version) throw Error('Feed version does not match the release')
  const zip = `OfficeMax-${version}-arm64-mac.zip`
  const dmg = `OfficeMax-${version}-arm64.dmg`
  const allowed = new Set([zip, dmg])
  if (
    !Array.isArray(feed.files) ||
    feed.files.length !== 2 ||
    new Set(feed.files.map((file) => file.url)).size !== 2
  )
    throw Error('Expected exactly the arm64 ZIP and DMG')
  for (const file of feed.files) {
    if (!allowed.has(file.url) || basename(file.url) !== file.url)
      throw Error('Unexpected release filename')
    const target = join(folder, file.url)
    if (
      (await stat(target)).size !== file.size ||
      file.size <= 0 ||
      (await digest(target, 'sha512', 'base64')) !== file.sha512
    )
      throw Error('Release file size or SHA-512 mismatch: ' + file.url)
  }
  const zipEntry = feed.files.find((file) => file.url === zip)
  if (feed.path !== zip || feed.sha512 !== zipEntry.sha512)
    throw Error('Legacy ZIP checksum does not match')
  const smoke = JSON.parse(await readFile(join(folder, 'SMOKE-RESULT.json'), 'utf8'))
  if (
    smoke.os !== 'darwin' ||
    smoke.architecture !== 'arm64' ||
    !['wholeWorkbookPdf', 'latexZipPreview', 'sourceUnchanged', 'latexBodyVisible'].every(
      (key) => smoke[key] === true,
    )
  )
    throw Error('Mac runtime checks did not pass')
  const source = (await readFile(join(folder, 'SOURCE-COMMIT.txt'), 'utf8')).trim()
  if (!/^[a-f0-9]{40}$/.test(source)) throw Error('Missing source commit')
  return { version, tag: `v${version}`, source, files: [zip, dmg], smoke }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const folder = resolve(process.argv[2])
  const verifyOnly = process.argv.includes('--verify-only')
  if (!verifyOnly) await createMacUpdateFeed(folder, process.argv[3])
  const receipt = await validateMacUpdate(folder, process.argv[3])
  if (!verifyOnly) {
    // Older GitHubProvider versions fall back to this name after a missing beta feed.
    await writeFile(join(folder, 'latest-mac.yml'), await readFile(join(folder, 'beta-mac.yml')))
    const assets = [
      ...receipt.files,
      'beta-mac.yml',
      'latest-mac.yml',
      'INSTALL-MAC.ko.md',
      'RELEASE-NOTES.ko.md',
      'SMOKE-RESULT.json',
      'SOURCE-COMMIT.txt',
    ]
    const sums = await Promise.all(
      assets.map(async (file) => `${await digest(join(folder, file), 'sha256', 'hex')}  ${file}`),
    )
    await writeFile(join(folder, 'SHA256SUMS.txt'), sums.join('\n') + '\n')
    await writeFile(join(folder, 'RELEASE-VERIFIED.json'), JSON.stringify(receipt, null, 2) + '\n')
  }
  console.log(JSON.stringify(receipt))
}
