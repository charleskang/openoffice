import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, chmod, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const TECTONIC_VERSION = '0.17.0'
const releases = {
  'win32-x64': [
    'x86_64-pc-windows-msvc.zip',
    'f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f',
  ],
  'darwin-arm64': [
    'aarch64-apple-darwin.tar.gz',
    'a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667',
  ],
  'darwin-x64': [
    'x86_64-apple-darwin.tar.gz',
    '7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80',
  ],
}
const args = process.argv.slice(2)
const targets = args.length
  ? args
  : [process.platform + '-' + (process.platform === 'win32' ? 'x64' : process.arch)]
for (const target of targets) {
  const release = releases[target]
  if (!release) throw new Error('Supported engine targets: ' + Object.keys(releases).join(', '))
  const destination = join(root, '.local/latex', target)
  const executable = join(destination, target.startsWith('win32-') ? 'tectonic.exe' : 'tectonic')
  const record = join(destination, 'installed.json')
  try {
    const installed = JSON.parse(await readFile(record, 'utf8'))
    const bytes = await readFile(executable)
    if (
      installed.version === TECTONIC_VERSION &&
      createHash('sha256').update(bytes).digest('hex') === installed.executableHash
    ) {
      console.log('Tectonic already installed: ' + target)
      continue
    }
  } catch {}
  await mkdir(destination, { recursive: true })
  const asset = 'tectonic-' + TECTONIC_VERSION + '-' + release[0]
  const url =
    'https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40' +
    TECTONIC_VERSION +
    '/' +
    asset
  console.log('Downloading official Tectonic ' + TECTONIC_VERSION + ': ' + target)
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error('Download failed: HTTP ' + response.status)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== release[1])
    throw new Error('Tectonic archive checksum mismatch')
  const archive = join(destination, asset)
  await writeFile(archive, bytes)
  // Extract only the executable, never arbitrary archive paths.
  const names = execFileSync('tar', ['-tf', archive], { encoding: 'utf8', windowsHide: true })
    .trim()
    .split(/\r?\n/)
  const entry = names.find(
    (name) =>
      name === 'tectonic' ||
      name === './tectonic' ||
      name === 'tectonic.exe' ||
      name === './tectonic.exe',
  )
  if (!entry) throw new Error('Official archive does not contain the engine executable')
  execFileSync('tar', ['-xf', archive, '-C', destination, entry], { windowsHide: true })
  if (!target.startsWith('win32-')) await chmod(executable, 0o755)
  if (!(await stat(executable)).isFile()) throw new Error('Engine executable missing')
  await writeFile(
    record,
    JSON.stringify(
      {
        version: TECTONIC_VERSION,
        archiveHash: release[1],
        executableHash: createHash('sha256')
          .update(await readFile(executable))
          .digest('hex'),
      },
      null,
      2,
    ) + '\n',
  )
  console.log('Installed: ' + executable)
}
