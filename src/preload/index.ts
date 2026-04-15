import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppConfig, NotificationTemplates } from '../shared/config'
import type { DetectedEvent } from '../shared/notification'
import type { AvailableProject, MonitoredProject, NotificationEventFlags } from '../shared/project'
import type { Provider } from '../shared/provider'
import type {
  OAuthAvailability,
  OAuthDeviceFlowStatus,
  PollerStatus,
  SyncStatus,
  ValidateTokenResult,
} from '../shared/ipc'

const api = {
  auth: {
    getOAuthAvailability: (): Promise<OAuthAvailability> =>
      ipcRenderer.invoke('auth:oauth-availability'),
    startGitHubOAuth: (): Promise<void> => ipcRenderer.invoke('auth:start-github-oauth'),
    startGitLabOAuth: (): Promise<void> => ipcRenderer.invoke('auth:start-gitlab-oauth'),
    saveGitHubPat: (token: string): Promise<ValidateTokenResult> =>
      ipcRenderer.invoke('auth:save-github-pat', token),
    saveGitLabPat: (token: string, instanceUrl: string): Promise<ValidateTokenResult> =>
      ipcRenderer.invoke('auth:save-gitlab-pat', token, instanceUrl),
    removeProvider: (provider: Provider): Promise<void> =>
      ipcRenderer.invoke('auth:remove-provider', provider),
    getConnections: (): Promise<AppConfig['connections']> =>
      ipcRenderer.invoke('auth:get-connections'),
  },

  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    setPollingInterval: (seconds: number): Promise<void> =>
      ipcRenderer.invoke('config:set-polling-interval', seconds),
    setLookbackMinutes: (minutes: number): Promise<void> =>
      ipcRenderer.invoke('config:set-lookback-minutes', minutes),
    setTheme: (theme: AppConfig['theme']): Promise<void> =>
      ipcRenderer.invoke('config:set-theme', theme),
    setNotificationTemplates: (templates: NotificationTemplates): Promise<void> =>
      ipcRenderer.invoke('config:set-notification-templates', templates),
    reset: (): Promise<void> => ipcRenderer.invoke('config:reset'),
  },

  sync: {
    getRepos: (): Promise<AvailableProject[]> => ipcRenderer.invoke('sync:get-repos'),
    getStatus: (): Promise<SyncStatus> => ipcRenderer.invoke('sync:get-status'),
    trigger: (): Promise<void> => ipcRenderer.invoke('sync:trigger'),
    onReposUpdated: (callback: (repos: AvailableProject[]) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, repos: AvailableProject[]): void =>
        callback(repos)
      ipcRenderer.on('sync:repos-updated', listener)
      return () => ipcRenderer.removeListener('sync:repos-updated', listener)
    },
    onStatusChanged: (callback: (status: SyncStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: SyncStatus): void => callback(status)
      ipcRenderer.on('sync:status-changed', listener)
      return () => ipcRenderer.removeListener('sync:status-changed', listener)
    },
  },

  projects: {
    setMonitored: (projects: MonitoredProject[]): Promise<void> =>
      ipcRenderer.invoke('projects:set-monitored', projects),
    updateEvents: (projectId: string, events: NotificationEventFlags): Promise<void> =>
      ipcRenderer.invoke('projects:update-events', projectId, events),
  },

  notifications: {
    test: (): Promise<{ sent: boolean; error: string | null }> =>
      ipcRenderer.invoke('notifications:test'),
  },

  poller: {
    start: (): Promise<void> => ipcRenderer.invoke('poller:start'),
    stop: (): Promise<void> => ipcRenderer.invoke('poller:stop'),
    getStatus: (): Promise<PollerStatus> => ipcRenderer.invoke('poller:get-status'),
  },

  on: {
    pollerStatusChanged: (callback: (status: PollerStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: PollerStatus): void => callback(status)
      ipcRenderer.on('poller:status-changed', listener)
      return () => ipcRenderer.removeListener('poller:status-changed', listener)
    },
    newEvents: (callback: (events: DetectedEvent[]) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, events: DetectedEvent[]): void => callback(events)
      ipcRenderer.on('notification:new-events', listener)
      return () => ipcRenderer.removeListener('notification:new-events', listener)
    },
    configUpdated: (callback: (config: AppConfig) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, config: AppConfig): void => callback(config)
      ipcRenderer.on('config:updated', listener)
      return () => ipcRenderer.removeListener('config:updated', listener)
    },
    oauthProgress: (callback: (status: OAuthDeviceFlowStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: OAuthDeviceFlowStatus): void =>
        callback(status)
      ipcRenderer.on('oauth:progress', listener)
      return () => ipcRenderer.removeListener('oauth:progress', listener)
    },
  },
} as const

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  ;(globalThis as Record<string, unknown>).api = api
}
