import type { Lang } from '@genoffice/i18n'
import type { FolderRoot, RecentEntry } from '../../shared/home-api'
import { workspaceText } from './i18n/strings-workspace'

interface Props {
  lang: Lang
  resume?: RecentEntry
  folders: readonly FolderRoot[]
  openLabel: string
  starredLabel: string
  onBrowse(): void
  onOpen(path: string): void
  onFolder(path: string): void
  onStarred(): void
  createItems: readonly { title: string; icon: string; onCreate(): void }[]
}

/** Uses existing file and folder actions; no separate project database. */
export function WorkspaceStart(props: Props) {
  const text = (key: Parameters<typeof workspaceText>[1]) => workspaceText(props.lang, key)
  const folders = props.folders.filter((folder) => folder.readable).slice(0, 4)
  return (
    <header className="workspace-start" data-testid="workspace-start">
      <div className="workspace-heading">
        <div>
          <h1>{text('workspaceTitle')}</h1>
          <p>{text('workspaceSub')}</p>
        </div>
        <button className="workspace-link" onClick={props.onStarred}>
          {props.starredLabel}
        </button>
      </div>
      <div className="workspace-actions">
        <button className="workspace-primary" onClick={props.onBrowse}>
          {props.openLabel}
        </button>
      </div>
      {props.resume && (
        <button
          className="workspace-resume"
          data-testid="workspace-resume"
          onClick={() => props.onOpen(props.resume!.path)}
        >
          <span>{text('continueWork')}</span>
          <strong>{props.resume.name}</strong>
          <small title={props.resume.path}>{props.resume.path}</small>
        </button>
      )}
      {folders.length > 0 && (
        <nav className="workspace-folders" aria-label={text('workFolders')}>
          <span>{text('workFolders')}</span>
          {folders.map((folder) => (
            <button
              key={folder.path}
              title={folder.path}
              onClick={() => props.onFolder(folder.path)}
            >
              {folder.name}
            </button>
          ))}
        </nav>
      )}
      <div className="workspace-new" aria-label={text('newDocument')}>
        <span>{text('newDocument')}</span>
        {props.createItems.map((item) => (
          <button key={item.title} onClick={item.onCreate}>
            <img src={item.icon} width="18" height="18" alt="" />
            {item.title}
          </button>
        ))}
      </div>
    </header>
  )
}
