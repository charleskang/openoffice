import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
const app = resolve(process.argv[2]),
  out = resolve(process.argv[3] ?? 'font-checks')
await mkdir(out, { recursive: true })
const resources = join(app, 'Contents/Resources')
const engines = [['bundled', join(resources, 'latex/tectonic')]]
if (process.argv[4]) engines.push(['previous', resolve(process.argv[4])])
const font = join(resources, 'template-fonts/NotoSerifKR-Regular.otf')
const cases = {
  default: '',
  apple: '\\usepackage{fontspec}\n\\setmainfont{Apple SD Gothic Neo}',
  appleOpenType: '\\usepackage{fontspec}\n\\setmainfont[Renderer=OpenType]{Apple SD Gothic Neo}',
  arial: '\\usepackage{fontspec}\n\\setmainfont{Arial}',
  bundled: '\\usepackage{fontspec}\n\\setmainfont{' + font + '}',
}
const results = []
for (const [engineName, engine] of engines) {
  const version = spawnSync(engine, ['--version'], { encoding: 'utf8' })
  for (const [name, preamble] of Object.entries(cases)) {
    const dir = join(out, engineName + '-' + name)
    await mkdir(dir, { recursive: true })
    const tex = join(dir, 'probe.tex')
    await writeFile(
      tex,
      '\\documentclass{article}\n' +
        preamble +
        '\n\\begin{document}\nVISIBLE LATIN OFFICE MAX.\\par\n' +
        (name === 'default' || name === 'arial' ? '' : '한글 문서 확인.\\par\n') +
        '\\[ E=mc^2 \\]\n\\end{document}',
    )
    const run = spawnSync(
      engine,
      ['-X', 'compile', '--untrusted', '--keep-logs', '--outdir', dir, tex],
      { encoding: 'utf8', timeout: 300000 },
    )
    await writeFile(join(dir, 'console.log'), (run.stdout ?? '') + (run.stderr ?? ''))
    results.push({
      engine: engineName,
      version: version.stdout?.trim(),
      font: name,
      exit: run.status,
    })
  }
}
await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
