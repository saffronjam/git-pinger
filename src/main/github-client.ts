import type { AvailableProject } from '../shared/project'
import type { ValidateTokenResult } from '../shared/ipc'
import { ApiError, paginate, request } from './http-client'

const API_BASE = 'https://api.github.com'

interface GitHubUser {
  login: string
}

interface GitHubRepo {
  id: number
  full_name: string
  name: string
  html_url: string
}

interface GitHubDeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface GitHubTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

interface GitHubPullRequest {
  id: number
  number: number
  title: string
  html_url: string
  state: string
  created_at: string
  updated_at: string
  user: { login: string }
  requested_reviewers: { login: string }[]
  assignees: { login: string }[]
}

interface GitHubComment {
  id: number
  user: { login: string } | null
  html_url: string
  created_at: string
  updated_at: string
}

export interface DeviceFlowResult {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export interface GitHubPRItem {
  id: string
  number: number
  title: string
  url: string
  repoFullName: string
  author: string
  assignees: string[]
  reviewers: string[]
  createdAt: string
  updatedAt: string
}

export interface GitHubCommentItem {
  id: string
  url: string
  author: string
  createdAt: string
  updatedAt: string
}

function githubHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
}

/** Validates a GitHub token by fetching the authenticated user. */
export async function validateToken(token: string): Promise<ValidateTokenResult> {
  try {
    const user = await request<GitHubUser>(`${API_BASE}/user`, {
      operation: 'github.validateToken',
      provider: 'github',
      headers: githubHeaders(token),
    })
    return { valid: true, username: user.login, error: null }
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        valid: false,
        username: null,
        error: `GitHub returned ${err.status ?? 'network error'}`,
      }
    }
    return { valid: false, username: null, error: String(err) }
  }
}

/** Initiates the GitHub OAuth Device Flow. */
export async function startDeviceFlow(clientId: string): Promise<DeviceFlowResult> {
  const data = await request<GitHubDeviceCodeResponse>('https://github.com/login/device/code', {
    operation: 'github.startDeviceFlow',
    provider: 'github',
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
  })
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
}

/** Polls GitHub for the OAuth token after user authorization. */
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  interval: number,
  signal?: AbortSignal,
): Promise<string> {
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
        const data = await request<GitHubTokenResponse>(
          'https://github.com/login/oauth/access_token',
          {
            operation: 'github.pollForToken',
            provider: 'github',
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: clientId,
              device_code: deviceCode,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            }),
            signal,
          },
        )

        if (data.access_token) {
          resolve(data.access_token)
        } else if (data.error === 'slow_down') {
          delay += 5000
          schedule()
        } else if (data.error === 'authorization_pending') {
          schedule()
        } else {
          reject(new Error(data.error_description ?? data.error ?? 'Unknown error'))
        }
      } catch (err) {
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

/** Fetches repositories accessible to the authenticated user. */
export async function fetchRepositories(token: string): Promise<AvailableProject[]> {
  const perPage = 100
  const raw = await paginate<GitHubRepo>(
    (page) => `${API_BASE}/user/repos?per_page=${perPage}&sort=updated&page=${page}`,
    {
      operation: 'github.fetchRepositories',
      provider: 'github',
      headers: githubHeaders(token),
    },
    perPage,
    10,
  )
  return raw.map((repo) => ({
    id: `github:${repo.id}`,
    provider: 'github',
    fullName: repo.full_name,
    name: repo.name,
    webUrl: repo.html_url,
  }))
}

/** Fetches open pull requests for a specific repository, optionally filtered by a `since` timestamp. */
export async function fetchPullRequests(
  token: string,
  repoFullName: string,
  since: string | null,
): Promise<GitHubPRItem[]> {
  const params = new URLSearchParams({
    state: 'open',
    sort: 'updated',
    direction: 'desc',
    per_page: '50',
  })

  const data = await request<GitHubPullRequest[]>(
    `${API_BASE}/repos/${repoFullName}/pulls?${params.toString()}`,
    {
      operation: 'github.fetchPullRequests',
      provider: 'github',
      headers: githubHeaders(token),
    },
  )

  let filtered = data
  if (since) {
    const sinceDate = new Date(since)
    filtered = data.filter((pr) => new Date(pr.updated_at) > sinceDate)
  }

  return filtered.map((pr) => ({
    id: `github:pr:${pr.id}`,
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    repoFullName,
    author: pr.user.login,
    assignees: pr.assignees.map((a) => a.login),
    reviewers: pr.requested_reviewers.map((r) => r.login),
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
  }))
}

function mapComments(raw: GitHubComment[]): GitHubCommentItem[] {
  const items: GitHubCommentItem[] = []
  for (const c of raw) {
    if (!c.user) continue
    items.push({
      id: `github:comment:${c.id}`,
      url: c.html_url,
      author: c.user.login,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })
  }
  return items
}

/**
 * Fetches conversation (issue-style) comments on a PR, optionally filtered by an updated-at `since` timestamp.
 * @param token GitHub access token
 * @param repoFullName e.g. "owner/repo"
 * @param prNumber PR number (the same value used in the PR URL)
 * @param since ISO timestamp; if set, only comments with updated_at > since are returned
 * @returns mapped comment items with stable ids
 */
export async function fetchIssueComments(
  token: string,
  repoFullName: string,
  prNumber: number,
  since: string | null,
): Promise<GitHubCommentItem[]> {
  const params = new URLSearchParams({ per_page: '100' })
  if (since) params.set('since', since)
  const data = await request<GitHubComment[]>(
    `${API_BASE}/repos/${repoFullName}/issues/${prNumber}/comments?${params.toString()}`,
    {
      operation: 'github.fetchIssueComments',
      provider: 'github',
      headers: githubHeaders(token),
    },
  )
  return mapComments(data)
}

/**
 * Fetches inline review comments on a PR, optionally filtered by an updated-at `since` timestamp.
 * @param token GitHub access token
 * @param repoFullName e.g. "owner/repo"
 * @param prNumber PR number
 * @param since ISO timestamp; if set, only comments with updated_at > since are returned
 * @returns mapped comment items with stable ids
 */
export async function fetchReviewComments(
  token: string,
  repoFullName: string,
  prNumber: number,
  since: string | null,
): Promise<GitHubCommentItem[]> {
  const params = new URLSearchParams({ per_page: '100' })
  if (since) params.set('since', since)
  const data = await request<GitHubComment[]>(
    `${API_BASE}/repos/${repoFullName}/pulls/${prNumber}/comments?${params.toString()}`,
    {
      operation: 'github.fetchReviewComments',
      provider: 'github',
      headers: githubHeaders(token),
    },
  )
  return mapComments(data)
}
