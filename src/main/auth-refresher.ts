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
 *
 * Refresh is single-flighted per provider — concurrent callers share a single in-flight HTTP POST
 * to the provider's token endpoint. This is load-bearing: GitLab's doorkeeper rotates refresh
 * tokens and treats a second presentation of an already-rotated token as reuse (potential theft),
 * revoking the entire token family. Two concurrent 401s hitting two concurrent refresh calls is
 * enough to force the user to re-login.
 */
export class AuthRefresher {
  private inflight = new Map<Provider, Promise<string | null>>()

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

  /**
   * Attempts to refresh the given provider's token. Returns the new access token or null.
   * Concurrent calls for the same provider are coalesced into a single refresher invocation.
   */
  async refresh(provider: Provider): Promise<string | null> {
    const existing = this.inflight.get(provider)
    if (existing) {
      logger.info('auth.refresh.coalesced', { provider })
      return existing
    }
    const promise = this.doRefresh(provider).finally(() => {
      this.inflight.delete(provider)
    })
    this.inflight.set(provider, promise)
    return promise
  }

  private async doRefresh(provider: Provider): Promise<string | null> {
    const entry = this.deps.tokenStore.getEntry(provider)
    const refresher = this.deps.refreshers.getRefresher(provider)
    const entryKind = entry?.kind ?? 'missing'
    const hasRefreshToken = entry?.kind === 'oauth' && entry.refreshToken !== null
    const hasRefresher = refresher !== null
    const expiresAt = entry?.kind === 'oauth' ? entry.expiresAt : null

    if (entry?.kind === 'oauth' && entry.refreshToken && refresher) {
      logger.info('auth.refresh.start', { provider, expiresAt })

      let fresh: OAuthTokenResult
      try {
        fresh = await refresher(entry.refreshToken)
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

      const rotated = fresh.refreshToken !== null && fresh.refreshToken !== entry.refreshToken
      if (!rotated) {
        logger.warn('auth.refresh.token-not-rotated', {
          provider,
          receivedNewRefreshToken: fresh.refreshToken !== null,
        })
      }

      try {
        this.deps.tokenStore.saveOAuthToken(provider, {
          accessToken: fresh.accessToken,
          refreshToken: fresh.refreshToken,
          expiresAt: fresh.expiresAt,
        })
      } catch (err) {
        // GitLab has already rotated entry.refreshToken on its side; the new token only exists in
        // memory now. Surface it loudly and flip needsReauth so the user reconnects rather than
        // hitting invalid_grant on the next process start. The current caller still gets the new
        // access token so the in-flight request can complete.
        logger.error('auth.refresh.persist-failed', {
          provider,
          error: String(err),
          newExpiresAt: fresh.expiresAt,
        })
        this.deps.configManager.setNeedsReauth(provider, true)
        return fresh.accessToken
      }

      this.deps.configManager.setNeedsReauth(provider, false)
      logger.info('auth.refresh.success', {
        provider,
        newExpiresAt: fresh.expiresAt,
        receivedNewRefreshToken: fresh.refreshToken !== null,
        refreshTokenRotated: rotated,
      })
      return fresh.accessToken
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
