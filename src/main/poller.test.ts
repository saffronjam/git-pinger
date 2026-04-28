import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { AppConfig } from '../shared/config'
import { DEFAULT_TEMPLATES } from '../shared/config'
import type { DetectedEvent } from '../shared/notification'
import type { MonitoredProject } from '../shared/project'
import type { GitLabConnection } from '../shared/provider'
import { Poller } from './poller'
import { installFetchMock, mockRoute, resetFetchMock } from './test-helpers'

function makeConfig(partial?: Partial<AppConfig>): AppConfig {
  return {
    connections: { github: null, gitlab: null },
    monitoredProjects: [],
    polling: { intervalSeconds: 60, lookbackMinutes: 0 },
    notifications: DEFAULT_TEMPLATES,
    theme: 'system',
    startup: { runAtLogin: false },
    ...partial,
  }
}

function makePoller(
  configRef: { current: AppConfig },
  tokenRef: { current: string | null },
  notified: DetectedEvent[],
): Poller {
  return new Poller(
    { get: () => configRef.current },
    { getToken: () => tokenRef.current },
    { onUnauthorized: () => async () => null },
    (event) => {
      notified.push(event)
    },
  )
}

const gitlabConnection: GitLabConnection = {
  provider: 'gitlab',
  instanceUrl: 'https://gitlab.com',
  username: 'saffronjam',
  authMethod: 'oauth',
}

const gitlabProject: MonitoredProject = {
  id: 'gitlab:42',
  provider: 'gitlab',
  fullName: 'org/edge',
  name: 'edge',
  webUrl: 'https://gitlab.com/org/edge',
  events: { prCreated: false, prAssigned: true, prReviewRequested: true },
}

function gitlabConfig(): AppConfig {
  return makeConfig({
    connections: { github: null, gitlab: gitlabConnection },
    monitoredProjects: [gitlabProject],
  })
}

function mrPayload(overrides?: Partial<{ updated_at: string }>): Record<string, unknown> {
  return {
    id: 7001,
    iid: 1,
    title: 'lab: buildserver-03',
    web_url: 'https://gitlab.com/org/edge/-/merge_requests/1',
    author: { username: 'pierre_lefevre' },
    target_project_id: 42,
    updated_at: overrides?.updated_at ?? '2026-04-21T08:00:00Z',
  }
}

function queueGitLabAssigned(bodies: object[]): void {
  mockRoute({
    urlPattern: /scope=assigned_to_me/,
    responses: bodies.map((body) => ({ status: 200, body })),
  })
}

function queueGitLabReviews(bodies: object[]): void {
  mockRoute({
    urlPattern: /scope=reviews_for_me/,
    responses: bodies.map((body) => ({ status: 200, body })),
  })
}

describe('Poller timer lifecycle', () => {
  beforeEach(() => installFetchMock())
  afterEach(() => resetFetchMock())

  test('restart() starts the timer when currently stopped (regression)', () => {
    const configRef = { current: makeConfig() }
    const tokenRef = { current: null as string | null }
    const poller = makePoller(configRef, tokenRef, [])
    expect(poller.getStatus().running).toBe(false)

    poller.restart()
    try {
      expect(poller.getStatus().running).toBe(true)
    } finally {
      poller.stop()
    }
  })

  test('restart() is idempotent when already running', () => {
    const configRef = { current: makeConfig() }
    const tokenRef = { current: null as string | null }
    const poller = makePoller(configRef, tokenRef, [])
    poller.start()
    try {
      expect(poller.getStatus().running).toBe(true)
      poller.restart()
      expect(poller.getStatus().running).toBe(true)
    } finally {
      poller.stop()
    }
  })

  test('stop() leaves status reporting running=false', () => {
    const configRef = { current: makeConfig() }
    const tokenRef = { current: null as string | null }
    const poller = makePoller(configRef, tokenRef, [])
    poller.start()
    poller.stop()
    expect(poller.getStatus().running).toBe(false)
  })
})

describe('Poller notification dedup', () => {
  beforeEach(() => installFetchMock())
  afterEach(() => resetFetchMock())

  test('first poll is silent: seeds seenEvents but does not notify', async () => {
    const configRef = { current: gitlabConfig() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[mrPayload()]])
    queueGitLabReviews([[]])

    await poller.trigger()
    expect(notified).toEqual([])
  })

  test('second poll with unchanged state: still no notification (regression for user report)', async () => {
    const configRef = { current: gitlabConfig() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[mrPayload()], [mrPayload({ updated_at: '2026-04-21T10:00:00Z' })]])
    queueGitLabReviews([[], []])

    await poller.trigger()
    await poller.trigger()

    expect(notified).toEqual([])
  })

  test('new MR appearing in assigned scope after first poll fires one notification', async () => {
    const configRef = { current: gitlabConfig() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[], [mrPayload()]])
    queueGitLabReviews([[], []])

    await poller.trigger()
    await poller.trigger()

    expect(notified.length).toBe(1)
    expect(notified[0]!.type).toBe('pr_assigned')
    expect(notified[0]!.provider).toBe('gitlab')
  })

  test('unassign then reassign re-fires notification', async () => {
    const configRef = { current: gitlabConfig() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[mrPayload()], [], [mrPayload({ updated_at: '2026-04-21T12:00:00Z' })]])
    queueGitLabReviews([[], [], []])

    await poller.trigger()
    await poller.trigger()
    await poller.trigger()

    expect(notified.length).toBe(1)
    expect(notified[0]!.type).toBe('pr_assigned')
  })
})
