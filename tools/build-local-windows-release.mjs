import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]
const reuse = process.argv.includes('--reuse-build')
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('This local release command currently builds Windows x64')
if (!/^\d+\.\d+\.\d+$/.test(version ?? ''))
  throw new Error('Usage: npm run release:windows -- <version>')
const packagePath = join(root, 'apps/shell/package.json')
const shellPackage = JSON.parse(readFileSync(packagePath, 'utf8'))
const previous = shellPackage.version.split('.').map(Number)
const next = version.split('.').map(Number)
const difference = next.findIndex((part, index) => part !== previous[index])
if (difference >= 0 && next[difference] < previous[difference])
  throw new Error('Release versions must not decrease')
const lockPath = join(root, 'package-lock.json')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
shellPackage.version = version
lock.packages['apps/shell'].version = version
writeFileSync(packagePath, JSON.stringify(shellPackage, null, 2) + '\n')
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
const stage = resolve(root, '../work/windows-release', version)
const deliver = resolve(root, '../outputs/releases', version)
mkdirSync(stage, { recursive: true })
mkdirSync(deliver, { recursive: true })
const env = {
  ...process.env,
  BUILD_DIR: stage,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  GENOFFICE_LANG: 'ko',
}
// Local artifacts stay unsigned and are never uploaded by this command.
for (const key of [
  'CSC_LINK',
  'WIN_CSC_LINK',
  'CSC_NAME',
  'GENOFFICE_WIN_SIGN_MODE',
  'GH_TOKEN',
  'GITHUB_TOKEN',
])
  delete env[key]
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this tool through npm run release:windows')
function run(args) {
  execFileSync(process.execPath, [npm, ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  })
}
if (!reuse) run(['run', 'build:all'])
const sidecar = join(root, 'apps/sheets/native/xlsx-engine/target/release/xlsx-sidecar.exe')
if (!existsSync(sidecar)) throw new Error('Build the native Sheets sidecar first')
const sidecarTarget = join(
  root,
  'apps/sheets/native/xlsx-engine/target/x86_64-pc-windows-gnu/release',
)
mkdirSync(sidecarTarget, { recursive: true })
copyFileSync(sidecar, join(sidecarTarget, 'xlsx-sidecar.exe'))
run(['run', 'dist:win', '-w', '@genoffice/shell', '--', '--publish', 'never'])
const installer = 'OfficeMax-Setup-' + version + '.exe'
const files = [installer, 'latest.yml', installer + '.blockmap'].filter((name) =>
  existsSync(join(stage, name)),
)
if (!files.includes(installer) || !files.includes('latest.yml'))
  throw new Error('Installer or update metadata missing')
for (const name of files) copyFileSync(join(stage, name), join(deliver, name))
const hash = createHash('sha256')
  .update(readFileSync(join(deliver, installer)))
  .digest('hex')
writeFileSync(join(deliver, 'SHA256SUMS.txt'), hash + '  ' + installer + '\n')
const metadata = readFileSync(join(deliver, 'latest.yml'), 'utf8')
if (!metadata.includes('version: ' + version) || !metadata.includes(installer))
  throw new Error('Update metadata does not match the installer')
console.log('Release ready: ' + deliver)
console.log('Installer SHA-256: ' + hash)
console.log('No GitHub release was created or published.')
