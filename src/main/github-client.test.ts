import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fetchRepositories, validateToken } from './github-client'
import { ApiError } from './http-client'
import { installFetchMock, mockRoute, resetFetchMock } from './test-helpers'

describe('github-client', () => {
  beforeEach(() => installFetchMock())
  afterEach(() => resetFetchMock())

  test('fetchRepositories returns a flat list across pages', async () => {
    mockRoute({
      urlPattern: /&page=1$/,
      responses: [
        {
          status: 200,
          body: Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            full_name: `u/r${i + 1}`,
            name: `r${i + 1}`,
            html_url: `https://gh.example.com/u/r${i + 1}`,
          })),
        },
      ],
    })
    mockRoute({
      urlPattern: /&page=2$/,
      responses: [
        {
          status: 200,
          body: [
            {
              id: 101,
              full_name: 'u/r101',
              name: 'r101',
              html_url: 'https://gh.example.com/u/r101',
            },
          ],
        },
      ],
    })

    const repos = await fetchRepositories('tok')
    expect(repos.length).toBe(101)
    expect(repos[0]!.id).toBe('github:1')
    expect(repos[100]!.fullName).toBe('u/r101')
  })

  test('fetchRepositories throws ApiError instead of silently stopping on 401 (regression)', async () => {
    mockRoute({
      urlPattern: /\/user\/repos/,
      responses: [{ status: 401, body: 'token expired' }],
    })

    try {
      await fetchRepositories('stale')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).kind).toBe('unauthorized')
    }
  })

  test('validateToken returns struct form on 401 without throwing', async () => {
    mockRoute({
      urlPattern: /\/user/,
      responses: [{ status: 401, body: 'bad creds' }],
    })

    const result = await validateToken('nope')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('401')
  })

  test('validateToken returns username on 200', async () => {
    mockRoute({
      urlPattern: /\/user/,
      responses: [{ status: 200, body: { login: 'saffronjam' } }],
    })

    const result = await validateToken('ok')
    expect(result.valid).toBe(true)
    expect(result.username).toBe('saffronjam')
  })
})
