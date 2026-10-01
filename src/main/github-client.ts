import type { AvailableProject } from '../shared/project'
import type { ValidateTokenResult } from '../shared/ipc'
import { ApiError, paginate, paginateAll, request } from './http-client'
import type { ActivityUser, AssignmentActivity } from './notification-reconciler'

const API_BASE = 'https://api.github.com'

interface GitHubUser {
  id?: number
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
  user: GitHubUser
  requested_reviewers: { login: string }[]
  assignees: { login: string }[]
}

interface GitHubComment {
  id: number
  user: GitHubUser | null
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
  authorId?: number
  assignees: string[]
  reviewers: string[]
  createdAt: string
  updatedAt: string
}

export interface GitHubCommentItem {
  id: string
  url: string
  author: string
  authorId?: number
  createdAt: string
  updatedAt: string
}

interface GitHubTimelineEvent {
  id: number
  event: string
  actor?: GitHubUser | null
  user?: GitHubUser | null
  requested_reviewer?: GitHubUser | null
  review_requester?: GitHubUser | null
  assignee?: GitHubUser | null
  created_at?: string
  submitted_at?: string
  state?: string
}

function activityUser(user: GitHubUser): ActivityUser {
  return { username: user.login, ...(user.id === undefined ? {} : { id: user.id }) }
}

/**
 * Resolves the immutable identity of the authenticated GitHub account.
 * @param token GitHub access token.
 * @returns Account ID and current username.
 */
export async function fetchCurrentUser(token: string): Promise<ActivityUser> {
  return activityUser(
    await request<GitHubUser>(`${API_BASE}/user`, {
      operation: 'github.fetchCurrentUser',
      provider: 'github',
      headers: githubHeaders(token),
    }),
  )
}

/**
 * Reads assignment and review activity with explicit actors and targets.
 * @param token GitHub access token.
 * @param repoFullName Repository owner and name.
 * @param prNumber Pull request number.
 * @returns Complete relevant timeline activity; rejects on any failed page.
 */
export async function fetchAssignmentActivity(
  token: string,
  repoFullName: string,
  prNumber: number,
): Promise<AssignmentActivity[]> {
  const raw = await paginateAll<GitHubTimelineEvent>(
    (page) =>
      `${API_BASE}/repos/${repoFullName}/issues/${prNumber}/timeline?per_page=100&page=${page}`,
    {
      operation: 'github.fetchAssignmentActivity',
      provider: 'github',
      headers: githubHeaders(token),
    },
  )
  const result: AssignmentActivity[] = []
  for (const event of raw) {
    let kind: AssignmentActivity['kind']
    let target: GitHubUser | null | undefined
    let actor = event.actor
    let timestamp = event.created_at
    switch (event.event) {
      case 'assigned':
      case 'unassigned':
        kind = event.event
        target = event.assignee
        break
      case 'review_requested':
      case 'review_request_removed':
        kind = event.event === 'review_requested' ? 'review_requested' : 'review_removed'
        target = event.requested_reviewer
        actor = event.review_requester ?? event.actor
        break
      case 'reviewed':
        if (!['approved', 'commented', 'changes_requested'].includes(event.state ?? '')) continue
        kind = 'review_completed'
        actor = target = event.user
        timestamp = event.submitted_at
        break
      default:
        continue
    }
    if (!target?.login || !timestamp || !Number.isFinite(event.id)) continue
    result.push({
      id: `github:activity:${event.id}`,
      kind,
      actor: actor?.login ? activityUser(actor) : null,
      target: activityUser(target),
      timestamp,
    })
  }
  return result
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

/**
 * Fetches every open pull request in a repository, optionally filtered after pagination.
 * @param token GitHub access token.
 * @param repoFullName Repository owner and name.
 * @param since Optional updated-at cutoff; assignment polling leaves this unset.
 * @returns Complete matching pull request membership and metadata.
 */
export async function fetchPullRequests(
  token: string,
  repoFullName: string,
  since: string | null,
): Promise<GitHubPRItem[]> {
  const params = new URLSearchParams({
    state: 'open',
    sort: 'updated',
    direction: 'desc',
    per_page: '100',
  })

  const data = await paginateAll<GitHubPullRequest>(
    (page) => `${API_BASE}/repos/${repoFullName}/pulls?${params.toString()}&page=${page}`,
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
    ...(pr.user.id === undefined ? {} : { authorId: pr.user.id }),
    assignees: pr.assignees.map((a) => a.login),
    reviewers: pr.requested_reviewers.map((r) => r.login),
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
  }))
}

function mapComments(raw: GitHubComment[], source: 'issue' | 'review'): GitHubCommentItem[] {
  const items: GitHubCommentItem[] = []
  for (const c of raw) {
    if (!c.user) continue
    items.push({
      id: `github:${source}-comment:${c.id}`,
      url: c.html_url,
      author: c.user.login,
      ...(c.user.id === undefined ? {} : { authorId: c.user.id }),
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
  const data = await paginateAll<GitHubComment>(
    (page) =>
      `${API_BASE}/repos/${repoFullName}/issues/${prNumber}/comments?${params.toString()}&page=${page}`,
    {
      operation: 'github.fetchIssueComments',
      provider: 'github',
      headers: githubHeaders(token),
    },
  )
  return mapComments(data, 'issue')
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
  const data = await paginateAll<GitHubComment>(
    (page) =>
      `${API_BASE}/repos/${repoFullName}/pulls/${prNumber}/comments?${params.toString()}&page=${page}`,
    {
      operation: 'github.fetchReviewComments',
      provider: 'github',
      headers: githubHeaders(token),
    },
  )
  return mapComments(data, 'review')
}
