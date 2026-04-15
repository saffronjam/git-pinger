export type Provider = 'github' | 'gitlab'

export type AuthMethod = 'oauth' | 'pat'

export interface GitHubConnection {
  provider: 'github'
  username: string
}

export interface GitLabConnection {
  provider: 'gitlab'
  instanceUrl: string
  username: string
  authMethod: AuthMethod
}

export type ProviderConnection = GitHubConnection | GitLabConnection
