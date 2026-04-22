export type Provider = 'github' | 'gitlab'

export type AuthMethod = 'oauth' | 'pat'

export interface GitHubConnection {
  provider: 'github'
  username: string
  needsReauth?: boolean
}

export interface GitLabConnection {
  provider: 'gitlab'
  instanceUrl: string
  username: string
  authMethod: AuthMethod
  needsReauth?: boolean
}

export type ProviderConnection = GitHubConnection | GitLabConnection
