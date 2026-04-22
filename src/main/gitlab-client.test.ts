import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  fetchMergeRequests,
  fetchProjects,
  refreshOAuthToken,
  validateOAuthToken,
  validatePat,
} from './gitlab-client'
import { ApiError } from './http-client'
import { installFetchMock, mockRoute, resetFetchMock } from './test-helpers'

describe('gitlab-client', () => {
  beforeEach(() => installFetchMock())
  afterEach(() => resetFetchMock())

  test('fetchProjects throws ApiError on 401 instead of returning [] (regression)', async () => {
    mockRoute({
      urlPattern: /\/api\/v4\/projects/,
      responses: [{ status: 401, body: 'token expired' }],
    })

    try {
      await fetchProjects('stale', 'https://gitlab.com', 'oauth')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).kind).toBe('unauthorized')
    }
  })

  test('fetchProjects returns flattened AvailableProjects on success', async () => {
    mockRoute({
      urlPattern: /page=1/,
      responses: [
        {
          status: 200,
          body: [
            {
              id: 42,
              name: 'demo',
              path_with_namespace: 'u/demo',
              web_url: 'https://gitlab.com/u/demo',
            },
          ],
        },
      ],
    })
    const projects = await fetchProjects('tok', 'https://gitlab.com', 'oauth')
    expect(projects.length).toBe(1)
    expect(projects[0]!.id).toBe('gitlab:42')
    expect(projects[0]!.fullName).toBe('u/demo')
  })

  test('fetchProjects invokes onUnauthorized and retries transparently', async () => {
    const route = mockRoute({
      urlPattern: /\/api\/v4\/projects/,
      responses: [
        { status: 401, body: 'expired' },
        {
          status: 200,
          body: [
            {
              id: 1,
              name: 'a',
              path_with_namespace: 'x/a',
              web_url: 'https://gitlab.com/x/a',
            },
          ],
        },
      ],
    })

    const projects = await fetchProjects(
      'stale',
      'https://gitlab.com',
      'oauth',
      async () => 'fresh',
    )
    expect(projects.length).toBe(1)
    expect(route.calls.length).toBe(2)
    const retryAuth = (route.calls[1]!.init!.headers as Record<string, string>).Authorization
    expect(retryAuth).toBe('Bearer fresh')
  })

  test('fetchProjects retry uses PRIVATE-TOKEN header for PAT auth', async () => {
    const route = mockRoute({
      urlPattern: /\/api\/v4\/projects/,
      responses: [
        { status: 401, body: 'expired' },
        { status: 200, body: [] },
      ],
    })
    await fetchProjects('stale', 'https://gitlab.com', 'pat', async () => 'fresh')
    const retryHeaders = route.calls[1]!.init!.headers as Record<string, string>
    expect(retryHeaders['PRIVATE-TOKEN']).toBe('fresh')
  })

  test('fetchMergeRequests throws ApiError on 500', async () => {
    mockRoute({
      urlPattern: /merge_requests/,
      responses: [{ status: 500, body: 'oops' }],
    })

    try {
      await fetchMergeRequests('tok', 'https://gitlab.com', 'oauth', 'assigned_to_me', null)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).kind).toBe('server')
    }
  })

  test('validatePat returns struct on 401 without throwing', async () => {
    mockRoute({
      urlPattern: /\/api\/v4\/user/,
      responses: [{ status: 401, body: 'bad' }],
    })

    const result = await validatePat('bad', 'https://gitlab.com')
    expect(result.valid).toBe(false)
  })

  test('validateOAuthToken succeeds on 200', async () => {
    mockRoute({
      urlPattern: /\/api\/v4\/user/,
      responses: [{ status: 200, body: { username: 'saffronjam' } }],
    })

    const result = await validateOAuthToken('tok', 'https://gitlab.com')
    expect(result.valid).toBe(true)
    expect(result.username).toBe('saffronjam')
  })

  test('refreshOAuthToken parses the new access and refresh tokens', async () => {
    mockRoute({
      urlPattern: /\/oauth\/token/,
      responses: [
        {
          status: 200,
          body: {
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 7200,
          },
        },
      ],
    })
    const result = await refreshOAuthToken('client', 'old-refresh')
    expect(result.accessToken).toBe('new-access')
    expect(result.refreshToken).toBe('new-refresh')
    expect(result.expiresAt).not.toBeNull()
  })

  test('refreshOAuthToken falls back to the original refresh token when server omits it', async () => {
    mockRoute({
      urlPattern: /\/oauth\/token/,
      responses: [{ status: 200, body: { access_token: 'new-access', expires_in: 7200 } }],
    })
    const result = await refreshOAuthToken('client', 'preserved-refresh')
    expect(result.refreshToken).toBe('preserved-refresh')
  })

  test('refreshOAuthToken surfaces API failures', async () => {
    mockRoute({
      urlPattern: /\/oauth\/token/,
      responses: [{ status: 401, body: { error: 'invalid_grant' } }],
    })
    try {
      await refreshOAuthToken('client', 'expired-refresh')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
    }
  })
})
