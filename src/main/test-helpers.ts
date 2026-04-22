/**
 * Test helpers for main-process unit tests.
 *
 * Bun runs its own fetch implementation (not undici), so we can't rely on undici.MockAgent
 * to intercept requests. Instead we stub `globalThis.fetch` with a route-matching mock that
 * plays back queued responses. Queue once per test; reset between tests via `resetFetchMock`.
 */

interface StubResponse {
  status: number
  body: string | object
  headers?: Record<string, string>
}

interface QueuedRoute {
  matcher: (url: string, init: RequestInit | undefined) => boolean
  responses: StubResponse[]
  calls: Array<{ url: string; init: RequestInit | undefined }>
}

let routes: QueuedRoute[] = []
let unmatchedCalls: Array<{ url: string; init: RequestInit | undefined }> = []
let originalFetch: typeof fetch | null = null

function buildResponse(stub: StubResponse): Response {
  const body = typeof stub.body === 'string' ? stub.body : JSON.stringify(stub.body)
  return new Response(body, {
    status: stub.status,
    headers: stub.headers ?? { 'content-type': 'application/json' },
  })
}

/** Installs the global fetch stub. Call in beforeEach. */
export function installFetchMock(): void {
  if (originalFetch === null) {
    originalFetch = globalThis.fetch
  }
  routes = []
  unmatchedCalls = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    for (const route of routes) {
      if (route.matcher(url, init)) {
        route.calls.push({ url, init })
        const stub = route.responses.shift()
        if (!stub) {
          throw new Error(`Fetch mock: route matched but response queue exhausted for ${url}`)
        }
        return buildResponse(stub)
      }
    }
    unmatchedCalls.push({ url, init })
    throw new Error(`Fetch mock: no route matched ${url}`)
  }) as unknown as typeof fetch
}

/** Restores the real fetch. Call in afterEach. */
export function resetFetchMock(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch
  }
  routes = []
  unmatchedCalls = []
}

interface RouteRegistration {
  urlPattern: string | RegExp
  method?: string
  responses: StubResponse[]
}

/** Registers a route matcher with a queue of responses served in order. */
export function mockRoute(reg: RouteRegistration): { calls: QueuedRoute['calls'] } {
  const route: QueuedRoute = {
    matcher: (url, init) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (reg.method && method !== reg.method.toUpperCase()) return false
      if (typeof reg.urlPattern === 'string') return url.startsWith(reg.urlPattern)
      return reg.urlPattern.test(url)
    },
    responses: [...reg.responses],
    calls: [],
  }
  routes.push(route)
  return { calls: route.calls }
}

/** Returns the list of requests that didn't match any registered route. */
export function getUnmatchedCalls(): ReadonlyArray<{ url: string; init: RequestInit | undefined }> {
  return unmatchedCalls
}
