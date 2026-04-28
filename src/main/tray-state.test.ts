import { describe, expect, test } from 'bun:test'
import type { AppConfig } from '../shared/config'
import { DEFAULT_CONFIG } from '../shared/config'
import type { PollerStatus, SyncStatus, ProviderSyncStatus } from '../shared/ipc'
import type { GitHubConnection, GitLabConnection } from '../shared/provider'
import { resolveTrayState } from './tray-state'

const baseGitHub: GitHubConnection = {
  provider: 'github',
  username: 'octocat',
  needsReauth: false,
}

const baseGitLab: GitLabConnection = {
  provider: 'gitlab',
  instanceUrl: 'https://gitlab.com',
  username: 'octocat',
  authMethod: 'oauth',
  needsReauth: false,
}

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

function buildPollerStatus(running: boolean): PollerStatus {
  return { running, lastPollAt: null, nextPollAt: null, errors: [], projects: {} }
}

function buildSyncStatus(
  github: ProviderSyncStatus | null = null,
  gitlab: ProviderSyncStatus | null = null,
): SyncStatus {
  return { github, gitlab }
}

const cleanSync: SyncStatus = buildSyncStatus()

describe('resolveTrayState', () => {
  test('reports Not connected when there are no connections', () => {
    const state = resolveTrayState(buildConfig(), buildPollerStatus(false), cleanSync)
    expect(state.statusText).toBe('Not connected')
    expect(state.hasAnyConnection).toBe(false)
    expect(state.reconnectProviders).toEqual([])
  })

  test('reports Polling when connected, running, no errors', () => {
    const state = resolveTrayState(
      buildConfig({ connections: { github: baseGitHub, gitlab: null } }),
      buildPollerStatus(true),
      cleanSync,
    )
    expect(state.statusText).toBe('Polling')
    expect(state.hasAnyConnection).toBe(true)
  })

  test('reports Paused when connected but poller is stopped', () => {
    const state = resolveTrayState(
      buildConfig({ connections: { github: baseGitHub, gitlab: null } }),
      buildPollerStatus(false),
      cleanSync,
    )
    expect(state.statusText).toBe('Paused')
  })

  test('reauth wins over running poller (priority order)', () => {
    const state = resolveTrayState(
      buildConfig({
        connections: { github: null, gitlab: { ...baseGitLab, needsReauth: true } },
      }),
      buildPollerStatus(true),
      cleanSync,
    )
    expect(state.statusText).toBe('Token expired — reconnect')
    expect(state.reconnectProviders).toEqual(['gitlab'])
  })

  test('reauth wins over sync error', () => {
    const state = resolveTrayState(
      buildConfig({
        connections: { github: null, gitlab: { ...baseGitLab, needsReauth: true } },
      }),
      buildPollerStatus(true),
      buildSyncStatus(null, {
        syncing: false,
        lastSyncAt: null,
        repoCount: 0,
        error: 'oops',
        errorKind: 'network',
      }),
    )
    expect(state.statusText).toBe('Token expired — reconnect')
  })

  test('sync error reported when no reauth pending', () => {
    const state = resolveTrayState(
      buildConfig({ connections: { github: baseGitHub, gitlab: null } }),
      buildPollerStatus(true),
      buildSyncStatus(
        {
          syncing: false,
          lastSyncAt: null,
          repoCount: 0,
          error: 'oops',
          errorKind: 'network',
        },
        null,
      ),
    )
    expect(state.statusText).toBe('Last sync failed (network)')
  })

  test('PAT-only connection without needsReauth never falls into reauth branch', () => {
    const patConn: GitLabConnection = { ...baseGitLab, authMethod: 'pat', needsReauth: false }
    const state = resolveTrayState(
      buildConfig({ connections: { github: null, gitlab: patConn } }),
      buildPollerStatus(true),
      cleanSync,
    )
    expect(state.statusText).toBe('Polling')
    expect(state.reconnectProviders).toEqual([])
  })

  test('runAtLogin is reflected from config', () => {
    const state = resolveTrayState(
      buildConfig({ startup: { runAtLogin: true } }),
      buildPollerStatus(false),
      cleanSync,
    )
    expect(state.runAtLogin).toBe(true)
  })

  test('reconnectProviders lists every provider needing reauth', () => {
    const state = resolveTrayState(
      buildConfig({
        connections: {
          github: { ...baseGitHub, needsReauth: true },
          gitlab: { ...baseGitLab, needsReauth: true },
        },
      }),
      buildPollerStatus(true),
      cleanSync,
    )
    expect(state.reconnectProviders).toEqual(['github', 'gitlab'])
  })
})
