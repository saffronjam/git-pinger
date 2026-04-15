import { ipcMain, Notification, shell, type BrowserWindow } from 'electron'
import type { Provider } from '../shared/provider'
import type { MonitoredProject, NotificationEventFlags } from '../shared/project'
import type { AppConfig, NotificationTemplates } from '../shared/config'
import type { ConfigManager } from './config-manager'
import type { TokenStore } from './token-store'
import type { Poller } from './poller'
import type { RepoSyncer } from './repo-syncer'
import * as githubClient from './github-client'
import * as gitlabClient from './gitlab-client'
import { showNotification } from './notification-manager'
import { logger } from './logger'

/**
 * Registers all IPC handlers for communication with the renderer.
 * Must be called after app.whenReady().
 */
export function registerIpcHandlers(
  configManager: ConfigManager,
  tokenStore: TokenStore,
  poller: Poller,
  repoSyncer: RepoSyncer,
  mainWindow: BrowserWindow,
): void {
  let oauthAbort: AbortController | null = null

  ipcMain.handle('auth:oauth-availability', () => {
    return {
      github: !!import.meta.env.MAIN_VITE_GITHUB_CLIENT_ID,
      gitlab: !!import.meta.env.MAIN_VITE_GITLAB_CLIENT_ID,
    }
  })

  ipcMain.handle('auth:start-github-oauth', async () => {
    const clientId = import.meta.env.MAIN_VITE_GITHUB_CLIENT_ID as string | undefined
    if (!clientId) {
      throw new Error('MAIN_VITE_GITHUB_CLIENT_ID is not configured')
    }

    oauthAbort?.abort()
    oauthAbort = new AbortController()
    const { signal } = oauthAbort

    mainWindow.webContents.send('oauth:progress', {
      phase: 'requesting_code',
      userCode: null,
      verificationUri: null,
      error: null,
    })

    try {
      logger.info('GitHub OAuth: starting device flow')
      const flow = await githubClient.startDeviceFlow(clientId)

      mainWindow.webContents.send('oauth:progress', {
        phase: 'awaiting_user',
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        error: null,
      })

      shell.openExternal(flow.verificationUri)

      mainWindow.webContents.send('oauth:progress', {
        phase: 'polling',
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        error: null,
      })

      logger.info('GitHub OAuth: polling for token')
      const token = await githubClient.pollForToken(
        clientId,
        flow.deviceCode,
        flow.interval,
        signal,
      )
      const validation = await githubClient.validateToken(token)

      if (!validation.valid || !validation.username) {
        throw new Error(validation.error ?? 'Token validation failed')
      }

      tokenStore.saveToken('github', token)
      configManager.setGitHubConnection({ provider: 'github', username: validation.username })
      repoSyncer.start()
      logger.info(`GitHub OAuth: connected as ${validation.username}`)

      mainWindow.webContents.send('oauth:progress', {
        phase: 'success',
        userCode: null,
        verificationUri: null,
        error: null,
      })
    } catch (err) {
      if (signal.aborted) return
      logger.error(`GitHub OAuth: ${String(err)}`)
      mainWindow.webContents.send('oauth:progress', {
        phase: 'error',
        userCode: null,
        verificationUri: null,
        error: String(err),
      })
      throw err
    }
  })

  ipcMain.handle('auth:start-gitlab-oauth', async () => {
    const clientId = import.meta.env.MAIN_VITE_GITLAB_CLIENT_ID as string | undefined
    if (!clientId) {
      throw new Error('MAIN_VITE_GITLAB_CLIENT_ID is not configured')
    }

    oauthAbort?.abort()
    oauthAbort = new AbortController()
    const { signal } = oauthAbort

    mainWindow.webContents.send('oauth:progress', {
      phase: 'requesting_code',
      userCode: null,
      verificationUri: null,
      error: null,
    })

    try {
      logger.info('GitLab OAuth: starting device flow')
      const flow = await gitlabClient.startDeviceFlow(clientId)

      mainWindow.webContents.send('oauth:progress', {
        phase: 'awaiting_user',
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        error: null,
      })

      shell.openExternal(flow.verificationUri)

      mainWindow.webContents.send('oauth:progress', {
        phase: 'polling',
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        error: null,
      })

      logger.info('GitLab OAuth: polling for token')
      const token = await gitlabClient.pollForToken(
        clientId,
        flow.deviceCode,
        flow.interval,
        signal,
      )
      const validation = await gitlabClient.validateOAuthToken(token, 'https://gitlab.com')

      if (!validation.valid || !validation.username) {
        throw new Error(validation.error ?? 'Token validation failed')
      }

      tokenStore.saveToken('gitlab', token)
      configManager.setGitLabConnection({
        provider: 'gitlab',
        instanceUrl: 'https://gitlab.com',
        username: validation.username,
        authMethod: 'oauth',
      })
      repoSyncer.start()
      logger.info(`GitLab OAuth: connected as ${validation.username}`)

      mainWindow.webContents.send('oauth:progress', {
        phase: 'success',
        userCode: null,
        verificationUri: null,
        error: null,
      })
    } catch (err) {
      if (signal.aborted) return
      logger.error(`GitLab OAuth: ${String(err)}`)
      mainWindow.webContents.send('oauth:progress', {
        phase: 'error',
        userCode: null,
        verificationUri: null,
        error: String(err),
      })
      throw err
    }
  })

  ipcMain.handle('auth:cancel-oauth', () => {
    logger.info('OAuth flow cancelled by user')
    oauthAbort?.abort()
    oauthAbort = null
  })

  ipcMain.handle('auth:save-github-pat', async (_event, token: string) => {
    logger.info('GitHub PAT: validating token')
    const validation = await githubClient.validateToken(token)
    if (!validation.valid || !validation.username) {
      logger.warn(`GitHub PAT: validation failed — ${validation.error}`)
      return validation
    }

    tokenStore.saveToken('github', token)
    configManager.setGitHubConnection({ provider: 'github', username: validation.username })
    repoSyncer.start()
    logger.info(`GitHub PAT: connected as ${validation.username}`)

    return validation
  })

  ipcMain.handle('auth:save-gitlab-pat', async (_event, token: string, instanceUrl: string) => {
    logger.info(`GitLab PAT: validating token for ${instanceUrl}`)
    const validation = await gitlabClient.validatePat(token, instanceUrl)
    if (!validation.valid || !validation.username) {
      logger.warn(`GitLab PAT: validation failed — ${validation.error}`)
      return validation
    }

    tokenStore.saveToken('gitlab', token)
    configManager.setGitLabConnection({
      provider: 'gitlab',
      instanceUrl,
      username: validation.username,
      authMethod: 'pat',
    })
    repoSyncer.start()
    logger.info(`GitLab PAT: connected as ${validation.username}`)

    return validation
  })

  ipcMain.handle('auth:remove-provider', (_event, provider: Provider) => {
    logger.info(`Removing provider: ${provider}`)
    tokenStore.deleteToken(provider)
    configManager.removeConnection(provider)

    const config = configManager.get()
    const remaining = config.monitoredProjects.filter((p) => p.provider !== provider)
    configManager.setMonitoredProjects(remaining)

    if (!config.connections.github && !config.connections.gitlab) {
      poller.stop()
      repoSyncer.stop()
    } else {
      repoSyncer.start()
    }
  })

  ipcMain.handle('auth:get-connections', () => {
    return configManager.get().connections
  })

  ipcMain.handle('config:get', () => {
    return configManager.get()
  })

  ipcMain.handle('config:set-polling-interval', (_event, seconds: number) => {
    logger.info(`Config: polling interval changed to ${seconds}s`)
    configManager.setPollingInterval(seconds)
    poller.restart()
  })

  ipcMain.handle('config:set-lookback-minutes', (_event, minutes: number) => {
    logger.info(`Config: lookback changed to ${minutes}m`)
    configManager.setLookbackMinutes(minutes)
  })

  ipcMain.handle('config:set-theme', (_event, theme: AppConfig['theme']) => {
    logger.info(`Config: theme changed to ${theme}`)
    configManager.setTheme(theme)
  })

  ipcMain.handle(
    'config:set-notification-templates',
    (_event, templates: NotificationTemplates) => {
      logger.info('Config: notification templates updated')
      configManager.setNotificationTemplates(templates)
    },
  )

  ipcMain.handle('config:reset', () => {
    logger.warn('Factory reset initiated')
    poller.stop()
    repoSyncer.stop()
    tokenStore.deleteToken('github')
    tokenStore.deleteToken('gitlab')
    configManager.reset()
  })

  ipcMain.handle('sync:get-repos', () => {
    return repoSyncer.getRepos()
  })

  ipcMain.handle('sync:get-status', () => {
    return repoSyncer.getStatus()
  })

  ipcMain.handle('sync:trigger', async () => {
    await repoSyncer.trigger()
  })

  ipcMain.handle('projects:set-monitored', (_event, projects: MonitoredProject[]) => {
    logger.info(`Monitored projects updated: ${projects.length} projects`)
    configManager.setMonitoredProjects(projects)

    const config = configManager.get()
    const hasConnections = config.connections.github || config.connections.gitlab
    if (hasConnections && projects.length > 0) {
      poller.restart()
    } else {
      poller.stop()
    }
  })

  ipcMain.handle(
    'projects:update-events',
    (_event, projectId: string, events: NotificationEventFlags) => {
      configManager.updateProjectEvents(projectId, events)
    },
  )

  ipcMain.handle('poller:start', () => {
    poller.start()
  })

  ipcMain.handle('poller:stop', () => {
    poller.stop()
  })

  ipcMain.handle('poller:get-status', () => {
    return poller.getStatus()
  })

  ipcMain.handle('notifications:test', () => {
    if (!Notification.isSupported()) {
      return { sent: false, error: 'Notifications are not supported on this system' }
    }

    showNotification(
      {
        id: `test:${Date.now()}`,
        provider: 'github',
        projectFullName: 'test/example-repo',
        type: 'pr_review_requested',
        title: 'Test notification — GitPinger is working!',
        url: 'https://github.com',
        author: 'gitpinger',
        timestamp: new Date().toISOString(),
      },
      configManager.get(),
    )

    return {
      sent: true,
      error:
        process.platform === 'darwin'
          ? 'If nothing appeared, enable notifications for "Electron" in System Settings > Notifications'
          : null,
    }
  })

  ipcMain.handle('window:minimize', () => {
    mainWindow.minimize()
  })

  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.handle('window:close', () => {
    mainWindow.close()
  })

  ipcMain.handle('logs:get', () => {
    return logger.getEntries()
  })

  ipcMain.handle('logs:clear', () => {
    logger.clear()
  })
}
