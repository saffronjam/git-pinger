import type { AvailableProject } from '../shared/project'
import type { ValidateTokenResult } from '../shared/ipc'

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

/** Validates a GitHub token by fetching the authenticated user. */
export async function validateToken(token: string): Promise<ValidateTokenResult> {
  try {
    const response = await fetch(`${API_BASE}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) {
      return { valid: false, username: null, error: `GitHub returned ${response.status}` }
    }
    const user = (await response.json()) as GitHubUser
    return { valid: true, username: user.login, error: null }
  } catch (err) {
    return { valid: false, username: null, error: String(err) }
  }
}

/** Initiates the GitHub OAuth Device Flow. */
export async function startDeviceFlow(clientId: string): Promise<DeviceFlowResult> {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      scope: 'read:user',
    }),
  })

  if (!response.ok) {
    throw new Error(`GitHub device flow initiation failed: ${response.status}`)
  }

  const data = (await response.json()) as GitHubDeviceCodeResponse
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
): Promise<string> {
  const pollInterval = Math.max(interval, 5) * 1000

  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        })

        const data = (await response.json()) as GitHubTokenResponse

        if (data.access_token) {
          clearInterval(timer)
          resolve(data.access_token)
        } else if (data.error === 'authorization_pending') {
          return
        } else if (data.error === 'slow_down') {
          return
        } else {
          clearInterval(timer)
          reject(new Error(data.error_description ?? data.error ?? 'Unknown error'))
        }
      } catch (err) {
        clearInterval(timer)
        reject(err)
      }
    }, pollInterval)
  })
}

/** Fetches repositories accessible to the authenticated user. */
export async function fetchRepositories(token: string): Promise<AvailableProject[]> {
  const repos: AvailableProject[] = []
  let page = 1
  const perPage = 100

  while (true) {
    const response = await fetch(
      `${API_BASE}/user/repos?per_page=${perPage}&sort=updated&page=${page}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      },
    )

    if (!response.ok) break

    const data = (await response.json()) as GitHubRepo[]
    for (const repo of data) {
      repos.push({
        id: `github:${repo.id}`,
        provider: 'github',
        fullName: repo.full_name,
        name: repo.name,
        webUrl: repo.html_url,
      })
    }

    if (data.length < perPage) break
    page++
    if (page > 10) break
  }

  return repos
}

/** Fetches open pull requests for a specific repository, optionally updated since a timestamp. */
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

  const response = await fetch(`${API_BASE}/repos/${repoFullName}/pulls?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })

  if (!response.ok) {
    throw new Error(`GitHub PR request for ${repoFullName} failed: ${response.status}`)
  }

  const data = (await response.json()) as GitHubPullRequest[]

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
