import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  fetchCurrentUser,
  fetchMergeRequestActivity,
  fetchMergeRequestNotes,
  fetchMergeRequestReviewers,
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

  test('activity paginates past comments to find assignment evidence and refreshes on 401', async () => {
    const comment = {
      id: 1,
      body: 'comment',
      author: { id: 8, username: 'other' },
      system: false,
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
    }
    const route = mockRoute({
      urlPattern: /\/notes\?/,
      responses: [
        { status: 200, body: Array.from({ length: 100 }, (_, id) => ({ ...comment, id })) },
        { status: 401, body: 'expired' },
        {
          status: 200,
          body: [{ ...comment, id: 101, system: true, body: 'requested review from @me' }],
        },
      ],
    })
    const result = await fetchMergeRequestActivity(
      'stale',
      'https://gitlab.com',
      'oauth',
      42,
      7,
      'https://gitlab.com/u/r/-/merge_requests/7',
      async () => 'fresh',
    )
    expect(result.comments).toHaveLength(100)
    expect(result.activities[0]).toMatchObject({
      id: 'gitlab:note:101',
      actor: { id: 8, username: 'other' },
      kind: 'review_requested',
      target: { username: 'me' },
    })
    expect(route.calls[1]!.url).toContain('page=2')
    expect((route.calls[2]!.init!.headers as Record<string, string>).Authorization).toBe(
      'Bearer fresh',
    )
  })

  test('partial notes failure discards incomplete actor evidence', async () => {
    mockRoute({
      urlPattern: /\/notes\?/,
      responses: [
        {
          status: 200,
          body: Array.from({ length: 100 }, (_, id) => ({
            id,
            body: 'assigned to @me',
            author: { username: 'me' },
            system: true,
            created_at: '2026-10-01T10:00:00Z',
            updated_at: '2026-10-01T10:00:00Z',
          })),
        },
        { status: 500, body: 'server failure' },
      ],
    })
    await expect(
      fetchMergeRequestActivity(
        'tok',
        'https://gitlab.com',
        'pat',
        42,
        7,
        'https://gitlab.com/mr/7',
      ),
    ).rejects.toBeInstanceOf(ApiError)
  })

  test('MR membership fully paginates and rejects a failed later page', async () => {
    const mr = {
      id: 1,
      iid: 1,
      title: 'MR',
      web_url: 'https://gitlab.com/u/r/-/merge_requests/1',
      author: { username: 'author' },
      target_project_id: 42,
      updated_at: '2026-10-01T10:00:00Z',
    }
    mockRoute({
      urlPattern: /\/merge_requests\?/,
      responses: [
        { status: 200, body: Array.from({ length: 100 }, (_, id) => ({ ...mr, id })) },
        { status: 200, body: [{ ...mr, id: 101 }] },
        { status: 200, body: Array.from({ length: 100 }, (_, id) => ({ ...mr, id })) },
        { status: 500, body: 'outage' },
      ],
    })
    expect(
      await fetchMergeRequests('tok', 'https://gitlab.com', 'pat', 'reviews_for_me', null),
    ).toHaveLength(101)
    await expect(
      fetchMergeRequests('tok', 'https://gitlab.com', 'pat', 'reviews_for_me', null),
    ).rejects.toBeInstanceOf(ApiError)
  })

  test('reviewer states and identity use PAT authentication and paginate', async () => {
    mockRoute({
      urlPattern: /\/user$/,
      responses: [{ status: 200, body: { id: 7, username: 'me' } }],
    })
    expect(await fetchCurrentUser('pat', 'https://gitlab.example/', 'pat')).toEqual({
      id: 7,
      username: 'me',
    })
    const route = mockRoute({
      urlPattern: /\/reviewers\?/,
      responses: [
        {
          status: 200,
          body: Array.from({ length: 100 }, (_, id) => ({
            user: { id, username: `user${id}` },
            state: 'unreviewed',
          })),
        },
        { status: 200, body: [{ user: { id: 101, username: 'me' }, state: 'approved' }] },
      ],
    })
    const reviewers = await fetchMergeRequestReviewers(
      'pat',
      'https://gitlab.example/',
      'pat',
      42,
      7,
    )
    expect(reviewers).toHaveLength(101)
    expect(reviewers[100]!.state).toBe('approved')
    expect((route.calls[0]!.init!.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('pat')
  })

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

  test('refreshOAuthToken throws when server omits refresh_token (rotation invariant)', async () => {
    mockRoute({
      urlPattern: /\/oauth\/token/,
      responses: [{ status: 200, body: { access_token: 'new-access', expires_in: 7200 } }],
    })
    try {
      await refreshOAuthToken('client', 'preserved-refresh')
      throw new Error('expected throw')
    } catch (err) {
      expect((err as Error).message).toContain('refresh_token')
    }
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

  test('fetchMergeRequestNotes filters system notes and builds #note_id deep link', async () => {
    const route = mockRoute({
      urlPattern: /\/projects\/42\/merge_requests\/7\/notes/,
      responses: [
        {
          status: 200,
          body: [
            {
              id: 999,
              body: 'lgtm',
              author: { username: 'pierre' },
              created_at: '2026-05-04T10:00:00Z',
              updated_at: '2026-05-04T10:00:00Z',
              system: false,
            },
            {
              id: 1000,
              body: 'marked as ready',
              author: { username: 'pierre' },
              created_at: '2026-05-04T10:01:00Z',
              updated_at: '2026-05-04T10:01:00Z',
              system: true,
            },
          ],
        },
      ],
    })

    const notes = await fetchMergeRequestNotes(
      'tok',
      'https://gitlab.com',
      'oauth',
      42,
      7,
      'https://gitlab.com/u/r/-/merge_requests/7',
    )
    expect(notes.length).toBe(1)
    expect(notes[0]!.id).toBe('gitlab:note:999')
    expect(notes[0]!.url).toBe('https://gitlab.com/u/r/-/merge_requests/7#note_999')
    expect(route.calls[0]!.url).toContain('sort=desc')
    expect(route.calls[0]!.url).toContain('order_by=created_at')
  })
})
