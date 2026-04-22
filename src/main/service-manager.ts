import type { ConfigManager } from './config-manager'
import type { Poller } from './poller'
import type { RepoSyncer } from './repo-syncer'
import { logger } from './logger'

export type ServiceConfig = Pick<ConfigManager, 'get'>
export type ServicePoller = Pick<Poller, 'start' | 'stop'>
export type ServiceSyncer = Pick<RepoSyncer, 'start' | 'stop'>

/**
 * Reads the current config and puts the repo-syncer and poller in the correct state.
 * Safe to call after any config-affecting event (auth, disconnect, project changes). Replaces the
 * ad-hoc start/stop blocks that previously lived in each auth handler.
 */
export function syncServicesToConfig(
  configManager: ServiceConfig,
  poller: ServicePoller,
  repoSyncer: ServiceSyncer,
): void {
  const config = configManager.get()
  const hasConnections = config.connections.github !== null || config.connections.gitlab !== null
  const hasMonitoredProjects = config.monitoredProjects.length > 0

  logger.info('services.sync', {
    hasConnections,
    monitoredProjectCount: config.monitoredProjects.length,
  })

  if (hasConnections) {
    repoSyncer.start()
  } else {
    repoSyncer.stop()
  }

  if (hasConnections && hasMonitoredProjects) {
    poller.start()
  } else {
    poller.stop()
  }
}
