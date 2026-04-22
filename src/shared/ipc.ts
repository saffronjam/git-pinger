import type { AppConfig, NotificationTemplates } from './config'
import type { ApiErrorKind } from './errors'
import type { DetectedEvent } from './notification'
import type { AvailableProject, MonitoredProject, NotificationEventFlags } from './project'
import type { Provider } from './provider'

export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  context?: Record<string, unknown>
}

export interface ValidateTokenResult {
  valid: boolean
  username: string | null
  error: string | null
}

export interface OAuthDeviceFlowStatus {
  phase: 'requesting_code' | 'awaiting_user' | 'polling' | 'success' | 'error'
  userCode: string | null
  verificationUri: string | null
  error: string | null
}

export type ProjectPollState = 'idle' | 'polling' | 'success' | 'error'

export interface ProjectPollStatus {
  state: ProjectPollState
  recentResults: boolean[]
  lastPollAt: string | null
  lastError: string | null
}

export interface PollerStatus {
  running: boolean
  lastPollAt: string | null
  nextPollAt: string | null
  errors: PollerError[]
  projects: Record<string, ProjectPollStatus>
}

export interface PollerError {
  provider: Provider
  message: string
  timestamp: string
}

/**
 * Renderer → Main (invoke/handle pattern).
 * Maps channel name to [args tuple, return type].
 */
export interface ProviderSyncStatus {
  syncing: boolean
  lastSyncAt: string | null
  repoCount: number
  error: string | null
  errorKind: ApiErrorKind | null
}

export interface SyncStatus {
  github: ProviderSyncStatus | null
  gitlab: ProviderSyncStatus | null
}

export interface OAuthAvailability {
  github: boolean
  gitlab: boolean
}

export interface IpcInvokeChannels {
  'auth:oauth-availability': [args: [], result: OAuthAvailability]
  'auth:start-github-oauth': [args: [], result: void]
  'auth:start-gitlab-oauth': [args: [], result: void]
  'auth:save-github-pat': [args: [token: string], result: ValidateTokenResult]
  'auth:save-gitlab-pat': [args: [token: string, instanceUrl: string], result: ValidateTokenResult]
  'auth:cancel-oauth': [args: [], result: void]
  'auth:remove-provider': [args: [provider: Provider], result: void]
  'auth:get-connections': [args: [], result: AppConfig['connections']]
  'config:get': [args: [], result: AppConfig]
  'config:set-polling-interval': [args: [seconds: number], result: void]
  'config:set-lookback-minutes': [args: [minutes: number], result: void]
  'config:set-theme': [args: [theme: AppConfig['theme']], result: void]
  'config:set-notification-templates': [args: [templates: NotificationTemplates], result: void]
  'config:reset': [args: [], result: void]
  'sync:get-repos': [args: [], result: AvailableProject[]]
  'sync:get-status': [args: [], result: SyncStatus]
  'sync:trigger': [args: [], result: void]
  'projects:set-monitored': [args: [projects: MonitoredProject[]], result: void]
  'projects:update-events': [
    args: [projectId: string, events: NotificationEventFlags],
    result: void,
  ]
  'poller:start': [args: [], result: void]
  'poller:stop': [args: [], result: void]
  'poller:get-status': [args: [], result: PollerStatus]
  'notifications:test': [args: [], result: { sent: boolean; error: string | null }]
  'logs:get': [args: [], result: LogEntry[]]
  'logs:clear': [args: [], result: void]
  'window:minimize': [args: [], result: void]
  'window:maximize': [args: [], result: void]
  'window:close': [args: [], result: void]
}

/**
 * Main → Renderer (push via webContents.send).
 * Maps channel name to payload type.
 */
export interface IpcPushChannels {
  'poller:status-changed': [status: PollerStatus]
  'notification:new-events': [events: DetectedEvent[]]
  'config:updated': [config: AppConfig]
  'oauth:progress': [status: OAuthDeviceFlowStatus]
  'sync:repos-updated': [repos: AvailableProject[]]
  'sync:status-changed': [status: SyncStatus]
}
