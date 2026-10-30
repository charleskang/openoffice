import type { Lang } from '@genoffice/i18n'
import type { LatexProjectFile, LatexProjectInfo } from '../../shared/latex'
import { latexText } from '../i18n/strings-latex'

export function LatexProjectPane({
  project,
  path,
  lang,
  onJump,
}: {
  project: LatexProjectInfo
  path: string | null
  lang: Lang
  onJump: (line: number) => void
}) {
  const missing = project.references.filter((reference) => !reference.target)
  const groups: {
    kind: LatexProjectFile['kind']
    label: 'sources' | 'bibliography' | 'images' | 'supportFiles'
  }[] = [
    { kind: 'source', label: 'sources' },
    { kind: 'bibliography', label: 'bibliography' },
    { kind: 'image', label: 'images' },
    { kind: 'support', label: 'supportFiles' },
  ]
  return (
    <details className="latex-project" open data-testid="latex-project">
      <summary>
        {latexText(lang, 'project')} · {project.name}
      </summary>
      <div className="latex-project-content">
        <p className="latex-project-summary">
          {latexText(lang, 'projectSummary', {
            files: project.files.length,
            references: project.references.length,
          })}
        </p>
        <button
          className="latex-project-main"
          onClick={() => void window.markdownApi.openLatexProjectFile(project.mainPath)}
        >
          {latexText(lang, 'mainDocument')}:{' '}
          {project.files.find((file) => file.path === project.mainPath)?.relativePath}
        </button>
        {project.sections.length > 0 && (
          <details className="latex-project-outline">
            <summary>
              {latexText(lang, 'documentOutline')} ({project.sections.length})
            </summary>
            <ul>
              {project.sections.map((section, index) => (
                <li key={index} style={{ paddingInlineStart: Math.max(0, section.level - 2) * 10 }}>
                  <button
                    title={section.path}
                    onClick={() => {
                      if (section.path === path) onJump(section.line)
                      else void window.markdownApi.openLatexProjectFile(section.path)
                    }}
                  >
                    {section.title}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {groups.map(({ kind, label }) => {
          const files = project.files.filter((file) => file.kind === kind)
          return (
            files.length > 0 && (
              <details key={kind} open={kind === 'source' || kind === 'bibliography'}>
                <summary>
                  {latexText(lang, label)} ({files.length})
                </summary>
                <ul>
                  {files.map((file) => (
                    <li key={file.path}>
                      {file.editable ? (
                        <button
                          aria-current={file.path === path ? 'page' : undefined}
                          title={file.path}
                          onClick={() => void window.markdownApi.openLatexProjectFile(file.path)}
                        >
                          {file.relativePath}
                        </button>
                      ) : (
                        <span title={file.relativePath}>{file.relativePath}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )
          )
        })}
        {missing.length > 0 && (
          <details className="latex-project-missing" open>
            <summary>
              {latexText(lang, 'missingFiles')} ({missing.length})
            </summary>
            <ul>
              {missing.map((reference, index) => (
                <li key={index}>
                  {reference.from}: {reference.reference}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  )
}
