import { describe, expect, test } from 'bun:test'
import type { AppConfig } from '../shared/config'
import { DEFAULT_TEMPLATES } from '../shared/config'
import type { GitHubConnection } from '../shared/provider'
import { syncServicesToConfig } from './service-manager'

function baseConfig(partial?: Partial<AppConfig>): AppConfig {
  return {
    connections: { github: null, gitlab: null },
    monitoredProjects: [],
    polling: { intervalSeconds: 60, lookbackMinutes: 0 },
    notifications: DEFAULT_TEMPLATES,
    theme: 'system',
    ...partial,
  }
}

function makeSpies(): {
  poller: { start: () => void; stop: () => void }
  syncer: { start: () => void; stop: () => void }
  calls: string[]
} {
  const calls: string[] = []
  const poller = {
    start: () => {
      calls.push('poller.start')
    },
    stop: () => {
      calls.push('poller.stop')
    },
  }
  const syncer = {
    start: () => {
      calls.push('syncer.start')
    },
    stop: () => {
      calls.push('syncer.stop')
    },
  }
  return { poller, syncer, calls }
}

const githubConnection: GitHubConnection = { provider: 'github', username: 'saffronjam' }

describe('syncServicesToConfig', () => {
  test('starts poller when connection + monitored projects exist (regression: adjacent gap)', () => {
    const config = baseConfig({
      connections: { github: githubConnection, gitlab: null },
      monitoredProjects: [
        {
          id: 'github:1',
          provider: 'github',
          fullName: 'u/r',
          name: 'r',
          webUrl: 'https://gh',
          events: { prCreated: true, prAssigned: true, prReviewRequested: true },
        },
      ],
    })
    const { poller, syncer, calls } = makeSpies()

    syncServicesToConfig({ get: () => config }, poller, syncer)
    expect(calls).toContain('syncer.start')
    expect(calls).toContain('poller.start')
  })

  test('stops poller when connected but no monitored projects', () => {
    const config = baseConfig({ connections: { github: githubConnection, gitlab: null } })
    const { poller, syncer, calls } = makeSpies()

    syncServicesToConfig({ get: () => config }, poller, syncer)
    expect(calls).toContain('syncer.start')
    expect(calls).toContain('poller.stop')
    expect(calls).not.toContain('poller.start')
  })

  test('stops both when no connections', () => {
    const config = baseConfig()
    const { poller, syncer, calls } = makeSpies()

    syncServicesToConfig({ get: () => config }, poller, syncer)
    expect(calls).toEqual(['syncer.stop', 'poller.stop'])
  })
})
