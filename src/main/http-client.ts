import type { Provider } from '../shared/provider'
import type { ApiErrorKind, SerializedApiError } from '../shared/errors'
import { logger } from './logger'

const BODY_PREVIEW_MAX = 500

/** Classifies an HTTP status code into an ApiErrorKind. */
export function classifyStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server'
  return 'other'
}

/** Typed error thrown by the http-client on non-2xx responses or fetch failures. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly url: string
  readonly bodyPreview: string | null

  constructor(params: {
    kind: ApiErrorKind
    status: number | null
    url: string
    message: string
    bodyPreview: string | null
  }) {
    super(params.message)
    this.name = 'ApiError'
    this.kind = params.kind
    this.status = params.status
    this.url = params.url
    this.bodyPreview = params.bodyPreview
  }

  /** Returns a plain-object form safe to send over IPC. */
  serialize(): SerializedApiError {
    return {
      kind: this.kind,
      status: this.status,
      url: this.url,
      message: this.message,
      bodyPreview: this.bodyPreview,
    }
  }
}

export interface RequestOptions {
  method?: string | undefined
  headers?: Record<string, string> | undefined
  body?: string | undefined
  signal?: AbortSignal | undefined
  operation: string
  provider?: Provider | undefined
  /**
   * Invoked once on 401. Returns a new access token (to retry) or null to surface the 401 as ApiError.
   * The implementation is responsible for persisting the new token; this callback only returns it
   * so the retry can inject the new Authorization/PRIVATE-TOKEN header via `rebuildHeaders`.
   */
  onUnauthorized?: (() => Promise<string | null>) | undefined
  /**
   * Given a freshly obtained token, returns the header map for the retry. Required when
   * `onUnauthorized` is supplied so the retry carries the new token.
   */
  rebuildHeaders?: ((newToken: string) => Record<string, string>) | undefined
}

/** Clips response body text to BODY_PREVIEW_MAX characters for log/error enrichment. */
async function readBodyPreview(response: Response): Promise<string | null> {
  try {
    const text = await response.text()
    if (text.length === 0) return null
    return text.length > BODY_PREVIEW_MAX ? `${text.slice(0, BODY_PREVIEW_MAX)}…` : text
  } catch {
    return null
  }
}

/** Executes one fetch and either returns the parsed JSON or throws an ApiError. */
async function executeOnce<T>(
  url: string,
  init: RequestInit,
  operation: string,
  provider: Provider | undefined,
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const start = Date.now()
  logger.info('http.request.start', { operation, provider, method, url })

  let response: Response
  try {
    response = await fetch(url, init)
  } catch (err) {
    const durationMs = Date.now() - start
    logger.error('http.request.error', {
      operation,
      provider,
      method,
      url,
      durationMs,
      error: String(err),
    })
    throw new ApiError({
      kind: 'network',
      status: null,
      url,
      message: `${operation}: ${String(err)}`,
      bodyPreview: null,
    })
  }

  const durationMs = Date.now() - start

  if (!response.ok) {
    const bodyPreview = await readBodyPreview(response)
    const kind = classifyStatus(response.status)
    logger.warn('http.request.end', {
      operation,
      provider,
      method,
      url,
      status: response.status,
      durationMs,
      kind,
    })
    throw new ApiError({
      kind,
      status: response.status,
      url,
      message: `${operation} failed: HTTP ${response.status}`,
      bodyPreview,
    })
  }

  logger.info('http.request.end', {
    operation,
    provider,
    method,
    url,
    status: response.status,
    durationMs,
  })

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

/**
 * Executes an HTTP request with structured logging and typed error classification.
 * If `onUnauthorized` is supplied and a 401 occurs, invokes it once to obtain a fresh token,
 * then retries the request via `rebuildHeaders`.
 */
export async function request<T>(url: string, opts: RequestOptions): Promise<T> {
  const init: RequestInit = { method: opts.method ?? 'GET' }
  if (opts.headers) init.headers = opts.headers
  if (opts.body !== undefined) init.body = opts.body
  if (opts.signal) init.signal = opts.signal

  try {
    return await executeOnce<T>(url, init, opts.operation, opts.provider)
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.kind === 'unauthorized' &&
      opts.onUnauthorized &&
      opts.rebuildHeaders
    ) {
      logger.info('http.request.refresh-attempt', {
        operation: opts.operation,
        provider: opts.provider,
        url,
      })
      const newToken = await opts.onUnauthorized()
      if (!newToken) {
        logger.warn('http.request.refresh-declined', {
          operation: opts.operation,
          provider: opts.provider,
          url,
        })
        throw err
      }
      const retryInit: RequestInit = { ...init, headers: opts.rebuildHeaders(newToken) }
      return await executeOnce<T>(url, retryInit, `${opts.operation}.retry`, opts.provider)
    }
    throw err
  }
}

/**
 * Walks a pagination loop until fewer than `perPage` items come back or `maxPages` is reached.
 * Each page is a full request() call, so refresh-on-401 works transparently.
 */
export async function paginate<T>(
  buildUrl: (page: number) => string,
  baseOpts: Omit<RequestOptions, 'method' | 'body'>,
  perPage: number,
  maxPages: number,
): Promise<T[]> {
  const all: T[] = []
  for (let page = 1; page <= maxPages; page++) {
    const url = buildUrl(page)
    const items = await request<T[]>(url, baseOpts)
    all.push(...items)
    if (items.length < perPage) break
  }
  return all
}
