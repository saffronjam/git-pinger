import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ApiError, classifyStatus, paginate, request } from './http-client'
import { installFetchMock, mockRoute, resetFetchMock } from './test-helpers'

describe('classifyStatus', () => {
  test.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'server'],
    [502, 'server'],
    [418, 'other'],
  ] as const)('%s → %s', (status, kind) => {
    expect(classifyStatus(status)).toBe(kind)
  })
})

describe('request', () => {
  beforeEach(() => installFetchMock())
  afterEach(() => resetFetchMock())

  test('returns parsed JSON on success', async () => {
    mockRoute({
      urlPattern: 'https://api.example.com/ok',
      responses: [{ status: 200, body: { value: 42 } }],
    })

    const result = await request<{ value: number }>('https://api.example.com/ok', {
      operation: 'test.ok',
    })

    expect(result.value).toBe(42)
  })

  test('throws ApiError with kind=unauthorized on 401', async () => {
    mockRoute({
      urlPattern: 'https://api.example.com/secret',
      responses: [{ status: 401, body: 'Unauthorized' }],
    })

    try {
      await request('https://api.example.com/secret', { operation: 'test.secret' })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).kind).toBe('unauthorized')
      expect((err as ApiError).status).toBe(401)
      expect((err as ApiError).url).toBe('https://api.example.com/secret')
    }
  })

  test('throws ApiError with kind=network when fetch itself throws', async () => {
    installFetchMock()
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    try {
      await request('https://api.example.com/broken', { operation: 'test.broken' })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).kind).toBe('network')
      expect((err as ApiError).status).toBeNull()
    }
  })

  test('truncates body preview to 500 characters', async () => {
    const big = 'x'.repeat(2000)
    mockRoute({
      urlPattern: 'https://api.example.com/big-error',
      responses: [{ status: 500, body: big }],
    })

    try {
      await request('https://api.example.com/big-error', { operation: 'test.big' })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const preview = (err as ApiError).bodyPreview
      expect(preview).not.toBeNull()
      expect(preview!.length).toBeLessThanOrEqual(501)
    }
  })

  test('invokes onUnauthorized once on 401 and retries with new token', async () => {
    const route1 = mockRoute({
      urlPattern: 'https://api.example.com/resource',
      responses: [
        { status: 401, body: 'expired' },
        { status: 200, body: { ok: true } },
      ],
    })

    let refreshInvocations = 0
    const result = await request<{ ok: boolean }>('https://api.example.com/resource', {
      operation: 'test.refresh',
      headers: { Authorization: 'Bearer old' },
      onUnauthorized: async () => {
        refreshInvocations++
        return 'fresh'
      },
      rebuildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
    })

    expect(result.ok).toBe(true)
    expect(refreshInvocations).toBe(1)
    expect(route1.calls.length).toBe(2)
    expect((route1.calls[1]!.init!.headers as Record<string, string>).Authorization).toBe(
      'Bearer fresh',
    )
  })

  test('throws unauthorized if onUnauthorized returns null', async () => {
    mockRoute({
      urlPattern: 'https://api.example.com/resource',
      responses: [{ status: 401, body: 'expired' }],
    })

    try {
      await request('https://api.example.com/resource', {
        operation: 'test.no-refresh',
        onUnauthorized: async () => null,
        rebuildHeaders: () => ({}),
      })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).kind).toBe('unauthorized')
    }
  })
})

describe('paginate', () => {
  beforeEach(() => installFetchMock())
  afterEach(() => resetFetchMock())

  test('stops when a page returns fewer than perPage items', async () => {
    mockRoute({
      urlPattern: /page=1/,
      responses: [{ status: 200, body: [1, 2, 3] }],
    })
    mockRoute({
      urlPattern: /page=2/,
      responses: [{ status: 200, body: [4] }],
    })

    const items = await paginate<number>(
      (page) => `https://api.example.com/list?page=${page}&per_page=3`,
      { operation: 'test.paginate' },
      3,
      5,
    )
    expect(items).toEqual([1, 2, 3, 4])
  })

  test('throws ApiError mid-pagination instead of silently stopping', async () => {
    mockRoute({
      urlPattern: /page=1/,
      responses: [{ status: 200, body: [1, 2, 3] }],
    })
    mockRoute({
      urlPattern: /page=2/,
      responses: [{ status: 401, body: 'expired' }],
    })

    try {
      await paginate<number>(
        (page) => `https://api.example.com/list?page=${page}&per_page=3`,
        { operation: 'test.paginate-fail' },
        3,
        5,
      )
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).kind).toBe('unauthorized')
    }
  })
})
