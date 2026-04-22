import { Conf } from 'electron-conf/main'
import type { BrowserWindow } from 'electron'
import type { AppConfig, NotificationTemplates } from '../shared/config'
import { DEFAULT_CONFIG } from '../shared/config'
import type { MonitoredProject, NotificationEventFlags } from '../shared/project'
import type { GitHubConnection, GitLabConnection, Provider } from '../shared/provider'

/** Manages application configuration with typed access and renderer sync. */
export class ConfigManager {
  private conf: Conf<AppConfig>
  private mainWindow: BrowserWindow | null = null

  constructor() {
    this.conf = new Conf<AppConfig>({
      defaults: DEFAULT_CONFIG,
    })
  }

  /** Sets the main window reference for pushing config updates to the renderer. */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /** Returns the full application config. */
  get(): AppConfig {
    return this.conf.store
  }

  /** Replaces the full application config. */
  set(config: AppConfig): void {
    this.conf.store = config
    this.pushUpdate()
  }

  /** Resets all settings to factory defaults. */
  reset(): void {
    this.conf.store = DEFAULT_CONFIG
    this.pushUpdate()
  }

  /** Sets the GitHub connection info (not the token — that's in token-store). */
  setGitHubConnection(connection: GitHubConnection | null): void {
    this.conf.set('connections', {
      ...this.conf.get('connections'),
      github: connection,
    })
    this.pushUpdate()
  }

  /** Sets the GitLab connection info (not the token — that's in token-store). */
  setGitLabConnection(connection: GitLabConnection | null): void {
    this.conf.set('connections', {
      ...this.conf.get('connections'),
      gitlab: connection,
    })
    this.pushUpdate()
  }

  /** Removes a provider connection. */
  removeConnection(provider: Provider): void {
    if (provider === 'github') {
      this.setGitHubConnection(null)
    } else {
      this.setGitLabConnection(null)
    }
  }

  /** Flips the needsReauth flag on an existing provider connection. No-op if disconnected. */
  setNeedsReauth(provider: Provider, needsReauth: boolean): void {
    const connections = this.conf.get('connections')
    if (provider === 'github' && connections.github) {
      this.conf.set('connections', {
        ...connections,
        github: { ...connections.github, needsReauth },
      })
      this.pushUpdate()
    } else if (provider === 'gitlab' && connections.gitlab) {
      this.conf.set('connections', {
        ...connections,
        gitlab: { ...connections.gitlab, needsReauth },
      })
      this.pushUpdate()
    }
  }

  /** Sets the list of monitored projects. */
  setMonitoredProjects(projects: MonitoredProject[]): void {
    this.conf.set('monitoredProjects', projects)
    this.pushUpdate()
  }

  /** Updates notification event flags for a specific project. */
  updateProjectEvents(projectId: string, events: NotificationEventFlags): void {
    const projects = this.conf.get('monitoredProjects')
    const updated = projects.map((p) => (p.id === projectId ? { ...p, events } : p))
    this.conf.set('monitoredProjects', updated)
    this.pushUpdate()
  }

  /** Sets the polling interval in seconds. */
  setPollingInterval(seconds: number): void {
    this.conf.set('polling', {
      ...this.conf.get('polling'),
      intervalSeconds: seconds,
    })
    this.pushUpdate()
  }

  /** Sets the lookback window in minutes for startup event fetching. */
  setLookbackMinutes(minutes: number): void {
    this.conf.set('polling', {
      ...this.conf.get('polling'),
      lookbackMinutes: minutes,
    })
    this.pushUpdate()
  }

  /** Sets the notification templates. */
  setNotificationTemplates(templates: NotificationTemplates): void {
    this.conf.set('notifications', templates)
    this.pushUpdate()
  }

  /** Sets the theme preference. */
  setTheme(theme: AppConfig['theme']): void {
    this.conf.set('theme', theme)
    this.pushUpdate()
  }

  /** Pushes the current config to the renderer via IPC. */
  private pushUpdate(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('config:updated', this.get())
    }
  }
}
