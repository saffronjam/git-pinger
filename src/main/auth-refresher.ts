import type { Provider } from '../shared/provider'
import type { OAuthTokenResult } from './gitlab-client'
import type { TokenStore } from './token-store'
import type { ConfigManager } from './config-manager'
import { logger } from './logger'

export type ProviderRefresher = (refreshToken: string) => Promise<OAuthTokenResult>

export interface AuthRefresherConfig {
  getRefresher(provider: Provider): ProviderRefresher | null
}

export interface AuthRefresherDeps {
  configManager: Pick<ConfigManager, 'setNeedsReauth'>
  tokenStore: Pick<TokenStore, 'getEntry' | 'saveOAuthToken'>
  refreshers: AuthRefresherConfig
}

/**
 * Handles the HTTP-client's onUnauthorized callback. Attempts an OAuth refresh when a refresh token
 * is available; otherwise flips the connection's needsReauth flag so the UI can surface a
 * Reconnect CTA.
 */
export class AuthRefresher {
  constructor(private deps: AuthRefresherDeps) {}

  /** Creates a bound callback suitable for passing as http-client's onUnauthorized option. */
  onUnauthorized(provider: Provider): () => Promise<string | null> {
    return () => this.refresh(provider)
  }

  /** Attempts to refresh the given provider's token. Returns the new access token or null. */
  async refresh(provider: Provider): Promise<string | null> {
    const entry = this.deps.tokenStore.getEntry(provider)
    const refresher = this.deps.refreshers.getRefresher(provider)
    if (entry?.kind === 'oauth' && entry.refreshToken && refresher) {
      try {
        logger.info('auth.refresh.start', { provider })
        const fresh = await refresher(entry.refreshToken)
        this.deps.tokenStore.saveOAuthToken(provider, {
          accessToken: fresh.accessToken,
          refreshToken: fresh.refreshToken,
          expiresAt: fresh.expiresAt,
        })
        this.deps.configManager.setNeedsReauth(provider, false)
        logger.info('auth.refresh.success', { provider })
        return fresh.accessToken
      } catch (err) {
        logger.warn('auth.refresh.failed', { provider, error: String(err) })
        this.deps.configManager.setNeedsReauth(provider, true)
        return null
      }
    }
    logger.info('auth.refresh.unavailable', { provider })
    this.deps.configManager.setNeedsReauth(provider, true)
    return null
  }
}
