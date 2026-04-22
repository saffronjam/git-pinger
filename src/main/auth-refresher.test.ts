import { describe, expect, test } from 'bun:test'
import type { Provider } from '../shared/provider'
import { AuthRefresher, type ProviderRefresher } from './auth-refresher'
import type { StoredToken } from './token-store'

function buildDeps(params: { entry: StoredToken | null; refresher: ProviderRefresher | null }): {
  refresher: AuthRefresher
  setNeedsReauthCalls: Array<{ provider: Provider; value: boolean }>
  savedOauth: Array<{ provider: Provider; accessToken: string; refreshToken: string | null }>
} {
  const setNeedsReauthCalls: Array<{ provider: Provider; value: boolean }> = []
  const savedOauth: Array<{
    provider: Provider
    accessToken: string
    refreshToken: string | null
  }> = []
  const refresher = new AuthRefresher({
    configManager: {
      setNeedsReauth: (provider, value) => setNeedsReauthCalls.push({ provider, value }),
    },
    tokenStore: {
      getEntry: () => params.entry,
      saveOAuthToken: (provider, entry) =>
        savedOauth.push({
          provider,
          accessToken: entry.accessToken,
          refreshToken: entry.refreshToken,
        }),
    },
    refreshers: {
      getRefresher: () => params.refresher,
    },
  })
  return { refresher, setNeedsReauthCalls, savedOauth }
}

describe('AuthRefresher', () => {
  test('refreshes and saves new tokens when refresher is available', async () => {
    const { refresher, setNeedsReauthCalls, savedOauth } = buildDeps({
      entry: {
        kind: 'oauth',
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: null,
      },
      refresher: async () => ({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: null,
      }),
    })

    const token = await refresher.refresh('gitlab')
    expect(token).toBe('new-access')
    expect(savedOauth.length).toBe(1)
    expect(savedOauth[0]!.accessToken).toBe('new-access')
    expect(setNeedsReauthCalls.some((c) => c.value === false)).toBe(true)
  })

  test('marks needsReauth when there is no refresh token', async () => {
    const { refresher, setNeedsReauthCalls } = buildDeps({
      entry: { kind: 'raw', value: 'pat' },
      refresher: async () => ({ accessToken: 'x', refreshToken: null, expiresAt: null }),
    })

    const token = await refresher.refresh('github')
    expect(token).toBeNull()
    expect(setNeedsReauthCalls).toEqual([{ provider: 'github', value: true }])
  })

  test('marks needsReauth when refresher function is not configured', async () => {
    const { refresher, setNeedsReauthCalls } = buildDeps({
      entry: {
        kind: 'oauth',
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: null,
      },
      refresher: null,
    })

    const token = await refresher.refresh('gitlab')
    expect(token).toBeNull()
    expect(setNeedsReauthCalls).toEqual([{ provider: 'gitlab', value: true }])
  })

  test('marks needsReauth when refresher itself throws', async () => {
    const { refresher, setNeedsReauthCalls, savedOauth } = buildDeps({
      entry: {
        kind: 'oauth',
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: null,
      },
      refresher: async () => {
        throw new Error('invalid_grant')
      },
    })

    const token = await refresher.refresh('gitlab')
    expect(token).toBeNull()
    expect(savedOauth.length).toBe(0)
    expect(setNeedsReauthCalls).toEqual([{ provider: 'gitlab', value: true }])
  })
})
