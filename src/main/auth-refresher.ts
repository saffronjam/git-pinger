import type { Provider } from '../shared/provider'
import type { OAuthTokenResult } from './gitlab-client'
import type { TokenStore } from './token-store'
import type { ConfigManager } from './config-manager'
import { ApiError } from './http-client'
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

const EXPIRY_GRACE_MS = 5 * 60 * 1000

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

  /**
   * Proactively refreshes tokens that have expired or are within 5 minutes of expiring.
   * Intended to be called on app boot and from a scheduled timer, so the app self-heals from
   * a persisted `needsReauth` state without user intervention whenever refresh is still possible.
   */
  async refreshIfExpired(
    provider: Provider,
  ): Promise<'refreshed' | 'still-valid' | 'failed' | 'unavailable'> {
    const entry = this.deps.tokenStore.getEntry(provider)
    if (!entry || entry.kind !== 'oauth' || !entry.refreshToken) {
      logger.info('auth.proactive-refresh.skipped', {
        provider,
        reason: 'no-oauth-refresh-token',
      })
      return 'unavailable'
    }

    const refresher = this.deps.refreshers.getRefresher(provider)
    if (!refresher) {
      logger.info('auth.proactive-refresh.skipped', {
        provider,
        reason: 'no-refresher-configured',
      })
      return 'unavailable'
    }

    if (entry.expiresAt) {
      const msUntilExpiry = new Date(entry.expiresAt).getTime() - Date.now()
      if (msUntilExpiry > EXPIRY_GRACE_MS) {
        logger.info('auth.proactive-refresh.skipped', {
          provider,
          reason: 'access-token-still-fresh',
          msUntilExpiry,
        })
        return 'still-valid'
      }
      logger.info('auth.proactive-refresh.due', {
        provider,
        expiresAt: entry.expiresAt,
        msUntilExpiry,
      })
    } else {
      logger.info('auth.proactive-refresh.due', {
        provider,
        expiresAt: null,
        reason: 'no-expiry-on-record',
      })
    }

    const result = await this.refresh(provider)
    return result ? 'refreshed' : 'failed'
  }

  /** Attempts to refresh the given provider's token. Returns the new access token or null. */
  async refresh(provider: Provider): Promise<string | null> {
    const entry = this.deps.tokenStore.getEntry(provider)
    const refresher = this.deps.refreshers.getRefresher(provider)
    const entryKind = entry?.kind ?? 'missing'
    const hasRefreshToken = entry?.kind === 'oauth' && entry.refreshToken !== null
    const hasRefresher = refresher !== null
    const expiresAt = entry?.kind === 'oauth' ? entry.expiresAt : null

    if (entry?.kind === 'oauth' && entry.refreshToken && refresher) {
      try {
        logger.info('auth.refresh.start', { provider, expiresAt })
        const fresh = await refresher(entry.refreshToken)
        this.deps.tokenStore.saveOAuthToken(provider, {
          accessToken: fresh.accessToken,
          refreshToken: fresh.refreshToken,
          expiresAt: fresh.expiresAt,
        })
        this.deps.configManager.setNeedsReauth(provider, false)
        logger.info('auth.refresh.success', {
          provider,
          newExpiresAt: fresh.expiresAt,
          receivedNewRefreshToken: fresh.refreshToken !== null,
          refreshTokenRotated:
            fresh.refreshToken !== null && fresh.refreshToken !== entry.refreshToken,
        })
        return fresh.accessToken
      } catch (err) {
        if (err instanceof ApiError) {
          logger.warn('auth.refresh.failed', {
            provider,
            kind: err.kind,
            status: err.status,
            message: err.message,
            bodyPreview: err.bodyPreview,
          })
        } else {
          logger.warn('auth.refresh.failed', { provider, error: String(err) })
        }
        this.deps.configManager.setNeedsReauth(provider, true)
        return null
      }
    }
    logger.info('auth.refresh.unavailable', {
      provider,
      entryKind,
      hasRefreshToken,
      hasRefresher,
      reason: !hasRefresher
        ? 'no-refresher-configured'
        : entryKind !== 'oauth'
          ? 'token-not-oauth-kind'
          : !hasRefreshToken
            ? 'oauth-entry-missing-refresh-token'
            : 'unknown',
    })
    this.deps.configManager.setNeedsReauth(provider, true)
    return null
  }
}
