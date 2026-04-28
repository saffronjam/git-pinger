import type { AppConfig } from '../shared/config'
import type { ApiErrorKind } from '../shared/errors'
import type { PollerStatus, SyncStatus } from '../shared/ipc'
import type { Provider } from '../shared/provider'

export interface TrayState {
  statusText: string
  hasAnyConnection: boolean
  pollerRunning: boolean
  reconnectProviders: Provider[]
  runAtLogin: boolean
}

const ERROR_KIND_LABELS: Record<ApiErrorKind, string> = {
  unauthorized: 'auth',
  forbidden: 'forbidden',
  not_found: 'not found',
  rate_limited: 'rate-limited',
  server: 'server error',
  network: 'network',
  other: 'error',
}

/**
 * Resolves the tray's current state from app inputs. Pure function — no Electron, no IO.
 *
 * Status priority (highest first): needsReauth > sync error > paused/disconnected > idle.
 */
export function resolveTrayState(
  config: AppConfig,
  pollerStatus: PollerStatus,
  syncStatus: SyncStatus,
): TrayState {
  const githubConn = config.connections.github
  const gitlabConn = config.connections.gitlab
  const hasAnyConnection = githubConn !== null || gitlabConn !== null

  const reconnectProviders: Provider[] = []
  if (githubConn?.needsReauth) reconnectProviders.push('github')
  if (gitlabConn?.needsReauth) reconnectProviders.push('gitlab')

  const statusText = computeStatusText({
    hasAnyConnection,
    reconnectProviders,
    pollerRunning: pollerStatus.running,
    syncStatus,
  })

  return {
    statusText,
    hasAnyConnection,
    pollerRunning: pollerStatus.running,
    reconnectProviders,
    runAtLogin: config.startup.runAtLogin,
  }
}

function computeStatusText(input: {
  hasAnyConnection: boolean
  reconnectProviders: Provider[]
  pollerRunning: boolean
  syncStatus: SyncStatus
}): string {
  if (input.reconnectProviders.length > 0) {
    return 'Token expired — reconnect'
  }

  const syncErrorKind = firstSyncErrorKind(input.syncStatus)
  if (syncErrorKind) {
    return `Last sync failed (${ERROR_KIND_LABELS[syncErrorKind]})`
  }

  if (!input.hasAnyConnection) return 'Not connected'
  if (!input.pollerRunning) return 'Paused'
  return 'Polling'
}

function firstSyncErrorKind(syncStatus: SyncStatus): ApiErrorKind | null {
  if (syncStatus.github?.errorKind) return syncStatus.github.errorKind
  if (syncStatus.gitlab?.errorKind) return syncStatus.gitlab.errorKind
  return null
}
