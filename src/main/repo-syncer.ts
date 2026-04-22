import type { BrowserWindow } from 'electron'
import type { AvailableProject } from '../shared/project'
import type { SyncStatus, ProviderSyncStatus } from '../shared/ipc'
import type { AuthRefresher } from './auth-refresher'
import type { ConfigManager } from './config-manager'
import type { TokenStore } from './token-store'
import * as githubClient from './github-client'
import * as gitlabClient from './gitlab-client'
import { ApiError } from './http-client'
import { logger } from './logger'

const SYNC_INTERVAL_MS = 60_000

export type SyncerConfigManager = Pick<ConfigManager, 'get'>
export type SyncerTokenStore = Pick<TokenStore, 'getToken'>
export type SyncerAuthRefresher = Pick<AuthRefresher, 'onUnauthorized'>

function blankStatus(): ProviderSyncStatus {
  return {
    syncing: false,
    lastSyncAt: null,
    repoCount: 0,
    error: null,
    errorKind: null,
  }
}

/** Background syncer that periodically fetches available repos from connected providers. */
export class RepoSyncer {
  private timer: ReturnType<typeof setInterval> | null = null
  private repos: AvailableProject[] = []
  private githubStatus: ProviderSyncStatus | null = null
  private gitlabStatus: ProviderSyncStatus | null = null
  private mainWindow: BrowserWindow | null = null

  constructor(
    private configManager: SyncerConfigManager,
    private tokenStore: SyncerTokenStore,
    private authRefresher: SyncerAuthRefresher,
  ) {}

  /** Sets the main window reference for pushing updates. */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /** Starts the background sync timer. Performs an immediate sync first. */
  start(): void {
    if (this.timer) this.stop()
    logger.info('syncer.started')
    void this.sync()
    this.timer = setInterval(() => {
      void this.sync()
    }, SYNC_INTERVAL_MS)
  }

  /** Stops the background sync timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      logger.info('syncer.stopped')
    }
  }

  /** Triggers an immediate sync cycle. */
  async trigger(): Promise<void> {
    logger.info('syncer.triggered')
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
      const base = this.githubStatus ?? blankStatus()
      this.githubStatus = { ...base, syncing: true, error: null, errorKind: null }
      this.pushStatus()

      const token = this.tokenStore.getToken('github')
      if (token && !config.connections.github.needsReauth) {
        try {
          const repos = await githubClient.fetchRepositories(token)
          all.push(...repos)
          logger.info('syncer.github.complete', { repoCount: repos.length })
          this.githubStatus = {
            syncing: false,
            lastSyncAt: new Date().toISOString(),
            repoCount: repos.length,
            error: null,
            errorKind: null,
          }
        } catch (err) {
          this.githubStatus = this.buildErrorStatus(this.githubStatus, err, 'github')
        }
      } else {
        this.githubStatus = {
          ...base,
          syncing: false,
          error: base.error ?? 'Reconnect required',
          errorKind: base.errorKind ?? 'unauthorized',
        }
      }
    } else {
      this.githubStatus = null
    }

    if (config.connections.gitlab) {
      const base = this.gitlabStatus ?? blankStatus()
      this.gitlabStatus = { ...base, syncing: true, error: null, errorKind: null }
      this.pushStatus()

      const token = this.tokenStore.getToken('gitlab')
      if (token && !config.connections.gitlab.needsReauth) {
        try {
          const repos = await gitlabClient.fetchProjects(
            token,
            config.connections.gitlab.instanceUrl,
            config.connections.gitlab.authMethod,
            this.authRefresher.onUnauthorized('gitlab'),
          )
          all.push(...repos)
          logger.info('syncer.gitlab.complete', { repoCount: repos.length })
          this.gitlabStatus = {
            syncing: false,
            lastSyncAt: new Date().toISOString(),
            repoCount: repos.length,
            error: null,
            errorKind: null,
          }
        } catch (err) {
          this.gitlabStatus = this.buildErrorStatus(this.gitlabStatus, err, 'gitlab')
        }
      } else {
        this.gitlabStatus = {
          ...base,
          syncing: false,
          error: base.error ?? 'Reconnect required',
          errorKind: base.errorKind ?? 'unauthorized',
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

  /** Preserves last-successful metadata and annotates the new failure. */
  private buildErrorStatus(
    previous: ProviderSyncStatus | null,
    err: unknown,
    provider: 'github' | 'gitlab',
  ): ProviderSyncStatus {
    const message = err instanceof ApiError ? err.message : String(err)
    const errorKind = err instanceof ApiError ? err.kind : null
    logger.error(`syncer.${provider}.failed`, { error: message, kind: errorKind })
    return {
      syncing: false,
      lastSyncAt: previous?.lastSyncAt ?? null,
      repoCount: previous?.repoCount ?? 0,
      error: message,
      errorKind,
    }
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
