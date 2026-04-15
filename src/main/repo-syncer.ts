import type { BrowserWindow } from 'electron'
import type { AvailableProject } from '../shared/project'
import type { SyncStatus, ProviderSyncStatus } from '../shared/ipc'
import type { ConfigManager } from './config-manager'
import type { TokenStore } from './token-store'
import * as githubClient from './github-client'
import * as gitlabClient from './gitlab-client'

const SYNC_INTERVAL_MS = 60_000

/** Background syncer that periodically fetches available repos from connected providers. */
export class RepoSyncer {
  private timer: ReturnType<typeof setInterval> | null = null
  private repos: AvailableProject[] = []
  private githubStatus: ProviderSyncStatus | null = null
  private gitlabStatus: ProviderSyncStatus | null = null
  private mainWindow: BrowserWindow | null = null

  constructor(
    private configManager: ConfigManager,
    private tokenStore: TokenStore,
  ) {}

  /** Sets the main window reference for pushing updates. */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /** Starts the background sync timer. Performs an immediate sync first. */
  start(): void {
    if (this.timer) this.stop()
    this.sync()
    this.timer = setInterval(() => this.sync(), SYNC_INTERVAL_MS)
  }

  /** Stops the background sync timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Triggers an immediate sync cycle. */
  async trigger(): Promise<void> {
    await this.sync()
  }

  /** Returns the cached list of available repos. */
  getRepos(): AvailableProject[] {
    return this.repos
  }

  /** Returns the current sync status per provider. */
  getStatus(): SyncStatus {
    return {
      github: this.githubStatus,
      gitlab: this.gitlabStatus,
    }
  }

  /** Executes one sync cycle across all connected providers. */
  private async sync(): Promise<void> {
    const config = this.configManager.get()
    const all: AvailableProject[] = []

    if (config.connections.github) {
      this.githubStatus = { ...this.githubStatus!, syncing: true, error: null }
      this.pushStatus()

      const token = this.tokenStore.getToken('github')
      if (token) {
        try {
          const repos = await githubClient.fetchRepositories(token)
          all.push(...repos)
          this.githubStatus = {
            syncing: false,
            lastSyncAt: new Date().toISOString(),
            repoCount: repos.length,
            error: null,
          }
        } catch (err) {
          this.githubStatus = {
            syncing: false,
            lastSyncAt: this.githubStatus?.lastSyncAt ?? null,
            repoCount: this.githubStatus?.repoCount ?? 0,
            error: String(err),
          }
        }
      }
    } else {
      this.githubStatus = null
    }

    if (config.connections.gitlab) {
      this.gitlabStatus = { ...this.gitlabStatus!, syncing: true, error: null }
      this.pushStatus()

      const token = this.tokenStore.getToken('gitlab')
      if (token) {
        try {
          const repos = await gitlabClient.fetchProjects(
            token,
            config.connections.gitlab.instanceUrl,
            config.connections.gitlab.authMethod,
          )
          all.push(...repos)
          this.gitlabStatus = {
            syncing: false,
            lastSyncAt: new Date().toISOString(),
            repoCount: repos.length,
            error: null,
          }
        } catch (err) {
          this.gitlabStatus = {
            syncing: false,
            lastSyncAt: this.gitlabStatus?.lastSyncAt ?? null,
            repoCount: this.gitlabStatus?.repoCount ?? 0,
            error: String(err),
          }
        }
      }
    } else {
      this.gitlabStatus = null
    }

    all.sort((a, b) => a.fullName.localeCompare(b.fullName))
    this.repos = all

    this.pushRepos()
    this.pushStatus()
  }

  /** Pushes the cached repos to the renderer. */
  private pushRepos(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('sync:repos-updated', this.repos)
    }
  }

  /** Pushes the current sync status to the renderer. */
  private pushStatus(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('sync:status-changed', this.getStatus())
    }
  }
}
