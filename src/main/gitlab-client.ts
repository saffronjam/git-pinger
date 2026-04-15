import type { AvailableProject } from '../shared/project'
import type { ValidateTokenResult } from '../shared/ipc'

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
function normalizeUrl(instanceUrl: string): string {
  return instanceUrl.replace(/\/+$/, '')
}

/** Validates a GitLab PAT by fetching the authenticated user. */
export async function validatePat(
  token: string,
  instanceUrl: string,
): Promise<ValidateTokenResult> {
  try {
    const base = normalizeUrl(instanceUrl)
    const response = await fetch(`${base}/api/v4/user`, {
      headers: { 'PRIVATE-TOKEN': token },
    })
    if (!response.ok) {
      return { valid: false, username: null, error: `GitLab returned ${response.status}` }
    }
    const user = (await response.json()) as GitLabUser
    return { valid: true, username: user.username, error: null }
  } catch (err) {
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
    const response = await fetch(`${base}/api/v4/user`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      return { valid: false, username: null, error: `GitLab returned ${response.status}` }
    }
    const user = (await response.json()) as GitLabUser
    return { valid: true, username: user.username, error: null }
  } catch (err) {
    return { valid: false, username: null, error: String(err) }
  }
}

/** Initiates the GitLab OAuth Device Flow (gitlab.com only). */
export async function startDeviceFlow(clientId: string): Promise<DeviceFlowResult> {
  const response = await fetch(`${GITLAB_COM}/oauth/authorize_device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      scope: 'read_api',
    }),
  })

  if (!response.ok) {
    throw new Error(`GitLab device flow initiation failed: ${response.status}`)
  }

  const data = (await response.json()) as GitLabDeviceCodeResponse
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
}

/** Polls GitLab for the OAuth token after user authorization. */
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  interval: number,
): Promise<string> {
  const pollInterval = Math.max(interval, 5) * 1000

  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`${GITLAB_COM}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        })

        const data = (await response.json()) as GitLabTokenResponse

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

/** Fetches projects the user is a member of. */
export async function fetchProjects(
  token: string,
  instanceUrl: string,
  authMethod: 'oauth' | 'pat',
): Promise<AvailableProject[]> {
  const base = normalizeUrl(instanceUrl)
  const projects: AvailableProject[] = []
  let page = 1
  const perPage = 100
  const headers =
    authMethod === 'oauth' ? { Authorization: `Bearer ${token}` } : { 'PRIVATE-TOKEN': token }

  while (true) {
    const response = await fetch(
      `${base}/api/v4/projects?membership=true&per_page=${perPage}&order_by=updated_at&page=${page}`,
      { headers },
    )

    if (!response.ok) break

    const data = (await response.json()) as GitLabProject[]
    for (const project of data) {
      projects.push({
        id: `gitlab:${project.id}`,
        provider: 'gitlab',
        fullName: project.path_with_namespace,
        name: project.name,
        webUrl: project.web_url,
      })
    }

    if (data.length < perPage) break
    page++
    if (page > 10) break
  }

  return projects
}

/** Fetches merge requests for a given scope (assigned or review). */
export async function fetchMergeRequests(
  token: string,
  instanceUrl: string,
  authMethod: 'oauth' | 'pat',
  scope: 'assigned_to_me' | 'reviews_for_me',
  since: string | null,
): Promise<GitLabMRItem[]> {
  const base = normalizeUrl(instanceUrl)
  const headers =
    authMethod === 'oauth' ? { Authorization: `Bearer ${token}` } : { 'PRIVATE-TOKEN': token }

  const params = new URLSearchParams({
    scope,
    state: 'opened',
    per_page: '100',
  })
  if (since) params.set('updated_after', since)

  const response = await fetch(`${base}/api/v4/merge_requests?${params.toString()}`, { headers })
  if (!response.ok) {
    throw new Error(`GitLab MR request failed: ${response.status}`)
  }

  const data = (await response.json()) as GitLabMergeRequest[]
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
