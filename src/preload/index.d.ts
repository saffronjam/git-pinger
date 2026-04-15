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

interface GitPingerAPI {
  auth: {
    getOAuthAvailability(): Promise<OAuthAvailability>
    startGitHubOAuth(): Promise<void>
    startGitLabOAuth(): Promise<void>
    saveGitHubPat(token: string): Promise<ValidateTokenResult>
    saveGitLabPat(token: string, instanceUrl: string): Promise<ValidateTokenResult>
    removeProvider(provider: Provider): Promise<void>
    getConnections(): Promise<AppConfig['connections']>
  }
  config: {
    get(): Promise<AppConfig>
    setPollingInterval(seconds: number): Promise<void>
    setLookbackMinutes(minutes: number): Promise<void>
    setTheme(theme: AppConfig['theme']): Promise<void>
    setNotificationTemplates(templates: NotificationTemplates): Promise<void>
  }
  sync: {
    getRepos(): Promise<AvailableProject[]>
    getStatus(): Promise<SyncStatus>
    trigger(): Promise<void>
    onReposUpdated(callback: (repos: AvailableProject[]) => void): () => void
    onStatusChanged(callback: (status: SyncStatus) => void): () => void
  }
  projects: {
    setMonitored(projects: MonitoredProject[]): Promise<void>
    updateEvents(projectId: string, events: NotificationEventFlags): Promise<void>
  }
  notifications: {
    test(): Promise<{ sent: boolean; error: string | null }>
  }
  poller: {
    start(): Promise<void>
    stop(): Promise<void>
    getStatus(): Promise<PollerStatus>
  }
  on: {
    pollerStatusChanged(callback: (status: PollerStatus) => void): () => void
    newEvents(callback: (events: DetectedEvent[]) => void): () => void
    configUpdated(callback: (config: AppConfig) => void): () => void
    oauthProgress(callback: (status: OAuthDeviceFlowStatus) => void): () => void
  }
}

declare global {
  interface Window {
    api: GitPingerAPI
  }
}
