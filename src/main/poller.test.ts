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
  events: { prCreated: false, prAssigned: true, prReviewRequested: true, prComment: false },
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

interface NoteOverrides {
  id?: number
  author?: string
  system?: boolean
  updated_at?: string
}

function notePayload(overrides?: NoteOverrides): Record<string, unknown> {
  return {
    id: overrides?.id ?? 9001,
    body: 'great patch',
    author: { username: overrides?.author ?? 'pierre_lefevre' },
    created_at: '2026-04-22T08:00:00Z',
    updated_at: overrides?.updated_at ?? '2026-04-22T08:00:00Z',
    system: overrides?.system ?? false,
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

function queueGitLabNotes(bodies: object[]): void {
  mockRoute({
    urlPattern: /\/merge_requests\/\d+\/notes/,
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

function gitlabConfigWithComments(): AppConfig {
  return makeConfig({
    connections: { github: null, gitlab: gitlabConnection },
    monitoredProjects: [
      {
        ...gitlabProject,
        events: { prCreated: false, prAssigned: true, prReviewRequested: true, prComment: true },
      },
    ],
  })
}

describe('Poller pr_comment events', () => {
  beforeEach(() => installFetchMock())
  afterEach(() => resetFetchMock())

  test('first poll seeds comment ids silently', async () => {
    const configRef = { current: gitlabConfigWithComments() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[mrPayload()]])
    queueGitLabReviews([[]])
    queueGitLabNotes([[notePayload()]])

    await poller.trigger()
    expect(notified).toEqual([])
  })

  test('new comment from another user fires once', async () => {
    const configRef = { current: gitlabConfigWithComments() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[mrPayload()], [mrPayload()]])
    queueGitLabReviews([[], []])
    queueGitLabNotes([[], [notePayload({ id: 9002 })]])

    await poller.trigger()
    await poller.trigger()

    expect(notified.length).toBe(1)
    expect(notified[0]!.type).toBe('pr_comment')
    expect(notified[0]!.author).toBe('pierre_lefevre')
    expect(notified[0]!.url).toContain('#note_9002')
  })

  test('comment authored by the user is ignored', async () => {
    const configRef = { current: gitlabConfigWithComments() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[mrPayload()], [mrPayload()]])
    queueGitLabReviews([[], []])
    queueGitLabNotes([[], [notePayload({ id: 9003, author: 'saffronjam' })]])

    await poller.trigger()
    await poller.trigger()

    expect(notified).toEqual([])
  })

  test('edits to an existing comment do not re-fire', async () => {
    const configRef = { current: gitlabConfigWithComments() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[mrPayload()], [mrPayload()], [mrPayload()]])
    queueGitLabReviews([[], [], []])
    queueGitLabNotes([
      [],
      [notePayload({ id: 9004 })],
      [notePayload({ id: 9004, updated_at: '2026-04-22T12:00:00Z' })],
    ])

    await poller.trigger()
    await poller.trigger()
    await poller.trigger()

    expect(notified.length).toBe(1)
  })

  test('system notes are filtered out', async () => {
    const configRef = { current: gitlabConfigWithComments() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[mrPayload()], [mrPayload()]])
    queueGitLabReviews([[], []])
    queueGitLabNotes([[], [notePayload({ id: 9005, system: true })]])

    await poller.trigger()
    await poller.trigger()

    expect(notified).toEqual([])
  })

  test('does not fetch notes when prComment flag is off', async () => {
    const configRef = { current: gitlabConfig() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[mrPayload()]])
    queueGitLabReviews([[]])

    await poller.trigger()

    expect(notified).toEqual([])
  })
})
