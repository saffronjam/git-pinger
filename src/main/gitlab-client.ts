import type { AvailableProject } from '../shared/project'
import type { ValidateTokenResult } from '../shared/ipc'
import { ApiError, paginate, request } from './http-client'

const GITLAB_COM = 'https://gitlab.com'

interface GitLabUser {
  username: string
}

interface GitLabProject {
  id: number
  name: string
  path_with_namespace: string
  web_url: string
}

interface GitLabDeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface GitLabTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface GitLabMergeRequest {
  id: number
  iid: number
  title: string
  web_url: string
  author: { username: string }
  updated_at: string
  target_project_id: number
}

export interface DeviceFlowResult {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export interface OAuthTokenResult {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
}

export interface GitLabMRItem {
  id: string
  title: string
  url: string
  author: string
  projectId: number
  timestamp: string
  scope: 'assigned_to_me' | 'reviews_for_me'
}

/** Normalizes the instance URL to remove trailing slashes. */
export function normalizeUrl(instanceUrl: string): string {
  return instanceUrl.replace(/\/+$/, '')
}

function authHeaders(token: string, method: 'oauth' | 'pat'): Record<string, string> {
  return method === 'oauth' ? { Authorization: `Bearer ${token}` } : { 'PRIVATE-TOKEN': token }
}

function expiresAtFromSeconds(expiresIn: number | undefined): string | null {
  if (!expiresIn || !Number.isFinite(expiresIn)) return null
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

/** Validates a GitLab PAT by fetching the authenticated user. */
export async function validatePat(
  token: string,
  instanceUrl: string,
): Promise<ValidateTokenResult> {
  try {
    const base = normalizeUrl(instanceUrl)
    const user = await request<GitLabUser>(`${base}/api/v4/user`, {
      operation: 'gitlab.validatePat',
      provider: 'gitlab',
      headers: authHeaders(token, 'pat'),
    })
    return { valid: true, username: user.username, error: null }
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        valid: false,
        username: null,
        error: `GitLab returned ${err.status ?? 'network error'}`,
      }
    }
    return { valid: false, username: null, error: String(err) }
  }
}

/** Validates an OAuth token by fetching the authenticated user. */
export async function validateOAuthToken(
  token: string,
  instanceUrl: string,
): Promise<ValidateTokenResult> {
  try {
    const base = normalizeUrl(instanceUrl)
    const user = await request<GitLabUser>(`${base}/api/v4/user`, {
      operation: 'gitlab.validateOAuthToken',
      provider: 'gitlab',
      headers: authHeaders(token, 'oauth'),
    })
    return { valid: true, username: user.username, error: null }
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        valid: false,
        username: null,
        error: `GitLab returned ${err.status ?? 'network error'}`,
      }
    }
    return { valid: false, username: null, error: String(err) }
  }
}

/** Initiates the GitLab OAuth Device Flow (gitlab.com only). */
export async function startDeviceFlow(clientId: string): Promise<DeviceFlowResult> {
  const data = await request<GitLabDeviceCodeResponse>(`${GITLAB_COM}/oauth/authorize_device`, {
    operation: 'gitlab.startDeviceFlow',
    provider: 'gitlab',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'read_api' }),
  })
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
}

/** Polls GitLab for the OAuth token. Returns access + refresh token and derived expiry. */
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  interval: number,
  signal?: AbortSignal,
): Promise<OAuthTokenResult> {
  let delay = Math.max(interval, 5) * 1000

  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>

    function schedule(): void {
      timeout = setTimeout(poll, delay)
    }

    async function poll(): Promise<void> {
      if (signal?.aborted) {
        reject(new Error('OAuth flow cancelled'))
        return
      }

      try {
        const data = await request<GitLabTokenResponse>(`${GITLAB_COM}/oauth/token`, {
          operation: 'gitlab.pollForToken',
          provider: 'gitlab',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
          signal,
        })

        if (data.access_token) {
          resolve({
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? null,
            expiresAt: expiresAtFromSeconds(data.expires_in),
          })
        } else if (data.error === 'slow_down') {
          delay += 5000
          schedule()
        } else if (data.error === 'authorization_pending') {
          schedule()
        } else {
          reject(new Error(data.error_description ?? data.error ?? 'Unknown error'))
        }
      } catch (err) {
        if (err instanceof ApiError) {
          // GitLab sometimes returns 400 with {error: 'authorization_pending'} in the body.
          const body = err.bodyPreview ?? ''
          if (body.includes('authorization_pending')) {
            schedule()
            return
          }
          if (body.includes('slow_down')) {
            delay += 5000
            schedule()
            return
          }
        }
        reject(err)
      }
    }

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout)
      reject(new Error('OAuth flow cancelled'))
    })

    schedule()
  })
}

/**
 * Exchanges a refresh token for a new access token pair.
 *
 * GitLab.com always rotates the refresh token on a successful refresh — the old one is invalidated
 * the moment the new one is issued. We treat a 200 response without `refresh_token` as a hard
 * failure rather than papering over it by re-persisting the (now-invalid) original. Doing
 * otherwise locks the user out at the next refresh and is impossible to debug from logs.
 */
export async function refreshOAuthToken(
  clientId: string,
  refreshToken: string,
): Promise<OAuthTokenResult> {
  const data = await request<GitLabTokenResponse>(`${GITLAB_COM}/oauth/token`, {
    operation: 'gitlab.refreshOAuthToken',
    provider: 'gitlab',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'Refresh failed: no access_token')
  }
  if (!data.refresh_token) {
    throw new Error(
      'Refresh failed: GitLab response omitted refresh_token; original token is invalid post-rotation',
    )
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: expiresAtFromSeconds(data.expires_in),
  }
}

/** Fetches projects the user is a member of. Throws ApiError on any non-OK page. */
export async function fetchProjects(
  token: string,
  instanceUrl: string,
  authMethod: 'oauth' | 'pat',
  onUnauthorized?: () => Promise<string | null>,
): Promise<AvailableProject[]> {
  const base = normalizeUrl(instanceUrl)
  const perPage = 100

  const raw = await paginate<GitLabProject>(
    (page) =>
      `${base}/api/v4/projects?membership=true&per_page=${perPage}&order_by=updated_at&page=${page}`,
    {
      operation: 'gitlab.fetchProjects',
      provider: 'gitlab',
      headers: authHeaders(token, authMethod),
      onUnauthorized,
      rebuildHeaders: (newToken) => authHeaders(newToken, authMethod),
    },
    perPage,
    10,
  )

  return raw.map((project) => ({
    id: `gitlab:${project.id}`,
    provider: 'gitlab',
    fullName: project.path_with_namespace,
    name: project.name,
    webUrl: project.web_url,
  }))
}

/** Fetches merge requests for a given scope (assigned or review). */
export async function fetchMergeRequests(
  token: string,
  instanceUrl: string,
  authMethod: 'oauth' | 'pat',
  scope: 'assigned_to_me' | 'reviews_for_me',
  since: string | null,
  onUnauthorized?: () => Promise<string | null>,
): Promise<GitLabMRItem[]> {
  const base = normalizeUrl(instanceUrl)

  const params = new URLSearchParams({
    scope,
    state: 'opened',
    per_page: '100',
  })
  if (since) params.set('updated_after', since)

  const data = await request<GitLabMergeRequest[]>(
    `${base}/api/v4/merge_requests?${params.toString()}`,
    {
      operation: `gitlab.fetchMergeRequests.${scope}`,
      provider: 'gitlab',
      headers: authHeaders(token, authMethod),
      onUnauthorized,
      rebuildHeaders: (newToken) => authHeaders(newToken, authMethod),
    },
  )

  return data.map((mr) => ({
    id: `gitlab:mr:${mr.id}`,
    title: mr.title,
    url: mr.web_url,
    author: mr.author.username,
    projectId: mr.target_project_id,
    timestamp: mr.updated_at,
    scope,
  }))
}
