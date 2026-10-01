import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { AppConfig } from '../shared/config'
import { DEFAULT_TEMPLATES } from '../shared/config'
import type { DetectedEvent } from '../shared/notification'
import type { MonitoredProject } from '../shared/project'
import type { GitLabConnection } from '../shared/provider'
import { Poller } from './poller'
import { getUnmatchedCalls, installFetchMock, mockRoute, resetFetchMock } from './test-helpers'

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
  now: () => Date = () => new Date(),
): Poller {
  return new Poller(
    { get: () => configRef.current },
    { getToken: () => tokenRef.current },
    { onUnauthorized: () => async () => null },
    (event) => {
      notified.push(event)
    },
    now,
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

function queueGitLabNotes(bodies: object[]): ReturnType<typeof mockRoute> {
  return mockRoute({
    urlPattern: /\/merge_requests\/\d+\/notes/,
    responses: bodies.map((body) => ({ status: 200, body })),
  })
}

describe('Poller timer lifecycle', () => {
  beforeEach(() => {
    installFetchMock()
    mockRoute({
      urlPattern: /\/api\/v4\/user$/,
      responses: [{ status: 200, body: { id: 7, username: 'saffronjam' } }],
    })
  })
  afterEach(() => {
    expect(getUnmatchedCalls()).toEqual([])
    resetFetchMock()
  })

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
  beforeEach(() => {
    installFetchMock()
    mockRoute({
      urlPattern: /\/api\/v4\/user$/,
      responses: [{ status: 200, body: { id: 7, username: 'saffronjam' } }],
    })
  })
  afterEach(() => {
    expect(getUnmatchedCalls()).toEqual([])
    resetFetchMock()
  })

  test('first poll is silent: seeds seenEvents but does not notify', async () => {
    const configRef = { current: gitlabConfig() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[mrPayload()]])
    queueGitLabReviews([[]])
    queueGitLabNotes([[]])

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
    queueGitLabNotes([[], []])

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
    queueGitLabNotes([[]])

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
    queueGitLabNotes([[], []])

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
  beforeEach(() => {
    installFetchMock()
    mockRoute({
      urlPattern: /\/api\/v4\/user$/,
      responses: [{ status: 200, body: { id: 7, username: 'saffronjam' } }],
    })
  })
  afterEach(() => {
    expect(getUnmatchedCalls()).toEqual([])
    resetFetchMock()
  })

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

  test('fetches attribution notes with comments disabled without delivering comment notifications', async () => {
    const configRef = { current: gitlabConfig() }
    const tokenRef = { current: 'tok' as string | null }
    const notified: DetectedEvent[] = []
    const poller = makePoller(configRef, tokenRef, notified)

    queueGitLabAssigned([[mrPayload()]])
    queueGitLabReviews([[]])
    const notes = queueGitLabNotes([[notePayload()]])

    await poller.trigger()

    expect(notes.calls).toHaveLength(1)
    expect(poller.getStatus().errors).toEqual([])
    expect(notified).toEqual([])
  })
})

const pollTimes = [
  '2026-10-01T10:00:00.000Z',
  '2026-10-01T10:01:00.000Z',
  '2026-10-01T10:02:00.000Z',
  '2026-10-01T10:03:00.000Z',
  '2026-10-01T10:04:00.000Z',
]

function systemNote(id: number, body: string, author = 'saffronjam', time = 1) {
  return {
    id,
    body,
    system: true,
    author: { id: author === 'saffronjam' ? 7 : 8, username: author },
    created_at: pollTimes[time]!,
    updated_at: pollTimes[time]!,
  }
}

function actorPoller(config = gitlabConfig()) {
  const configRef = { current: config }
  const notifications: DetectedEvent[] = []
  let cycle = 0
  const poller = makePoller(
    configRef,
    { current: 'tok' },
    notifications,
    () => new Date(pollTimes[cycle]!),
  )
  return {
    poller,
    notifications,
    configRef,
    async poll() {
      await poller.trigger()
      cycle++
    },
  }
}

function queueReviewers(states: string[]) {
  return mockRoute({
    urlPattern: /\/merge_requests\/1\/reviewers\?/,
    responses: states.map((state) => ({
      status: 200,
      body: [{ user: { id: 7, username: 'saffronjam' }, state }],
    })),
  })
}

describe('Poller actor-aware GitLab notifications', () => {
  beforeEach(() => {
    installFetchMock()
    mockRoute({
      urlPattern: /\/api\/v4\/user$/,
      responses: [{ status: 200, body: { id: 7, username: 'saffronjam' } }],
    })
  })
  afterEach(() => {
    expect(getUnmatchedCalls()).toEqual([])
    resetFetchMock()
  })

  test('reviewer removal during polling supersedes the earlier membership snapshot', async () => {
    const task = actorPoller()
    queueGitLabAssigned([[], []])
    queueGitLabReviews([[], [mrPayload()]])
    queueGitLabNotes([[systemNote(1, 'requested review from @saffronjam', 'another-user')]])
    mockRoute({ urlPattern: /\/reviewers\?/, responses: [{ status: 200, body: [] }] })
    await task.poll()
    await task.poll()
    expect(task.notifications).toEqual([])
    expect(task.poller.getStatus().errors).toEqual([])
  })

  test.each(['assigned', 'review'] as const)('self %s stays silent across polls', async (role) => {
    const task = actorPoller()
    queueGitLabAssigned(role === 'assigned' ? [[], [mrPayload()], [mrPayload()]] : [[], [], []])
    queueGitLabReviews(role === 'review' ? [[], [mrPayload()], [mrPayload()]] : [[], [], []])
    const note = systemNote(
      1,
      role === 'assigned' ? 'assigned to @saffronjam' : 'requested review from @saffronjam',
    )
    queueGitLabNotes([[note], [note]])
    if (role === 'review') queueReviewers(['unreviewed', 'unreviewed'])
    await task.poll()
    await task.poll()
    await task.poll()
    expect(task.notifications).toEqual([])
    expect(task.poller.getStatus().errors).toEqual([])
  })

  test.each(['approved', 'reviewed', 'requested_changes'])(
    'automatic reviewer membership in %s state is silent',
    async (state) => {
      const task = actorPoller()
      queueGitLabAssigned([[], [], []])
      queueGitLabReviews([[], [mrPayload()], [mrPayload()]])
      queueGitLabNotes([[], []])
      queueReviewers([state, 'unreviewed'])
      await task.poll()
      await task.poll()
      await task.poll()
      expect(task.notifications).toEqual([])
      expect(task.poller.getStatus().errors).toEqual([])
    },
  )

  test('external re-request after approval notifies once without membership or updated_at changes', async () => {
    const task = actorPoller()
    const completion = systemNote(1, 'approved this merge request')
    const request = systemNote(
      2,
      'requested review from @saffronjam and removed approval',
      'another-user',
      2,
    )
    queueGitLabAssigned([[], [], [], []])
    queueGitLabReviews([[], [mrPayload()], [mrPayload()], [mrPayload()]])
    queueGitLabNotes([[completion], [request, completion], [request, completion]])
    queueReviewers(['approved', 'unreviewed', 'review_started'])
    await task.poll()
    await task.poll()
    await task.poll()
    await task.poll()
    expect(task.notifications).toHaveLength(1)
    expect(task.notifications[0]).toMatchObject({
      type: 'pr_review_requested',
      author: 'another-user',
      timestamp: pollTimes[2],
    })
    expect(task.poller.getStatus().errors).toEqual([])
  })

  test('already completed external request is silent even when reviewer state is unavailable', async () => {
    const task = actorPoller()
    queueGitLabAssigned([[], []])
    queueGitLabReviews([[], [mrPayload()]])
    queueGitLabNotes([
      [
        systemNote(1, 'requested review from @saffronjam', 'another-user'),
        systemNote(2, 'approved this merge request'),
      ],
    ])
    mockRoute({ urlPattern: /\/reviewers\?/, responses: [{ status: 404, body: 'unsupported' }] })
    await task.poll()
    await task.poll()
    expect(task.notifications).toEqual([])
    expect(task.poller.getStatus().errors).toHaveLength(1)
  })

  test('unknown attribution notifies once and recovered evidence does not repeat it', async () => {
    const task = actorPoller()
    queueGitLabAssigned([[], [mrPayload()], [mrPayload()], [mrPayload()]])
    queueGitLabReviews([[], [], [], []])
    const note = systemNote(1, 'assigned to @saffronjam', 'another-user')
    mockRoute({
      urlPattern: /\/merge_requests\/1\/notes\?/,
      responses: [
        { status: 500, body: 'unavailable' },
        { status: 200, body: [note] },
        { status: 200, body: [note] },
      ],
    })
    await task.poll()
    await task.poll()
    await task.poll()
    await task.poll()
    expect(task.notifications).toHaveLength(1)
    expect(task.notifications[0]!.author).toBe('Someone')
    expect(task.poller.getStatus().errors).toEqual([])
  })

  test('a failed membership poll does not erase assignment history', async () => {
    const task = actorPoller()
    mockRoute({
      urlPattern: /scope=assigned_to_me/,
      responses: [
        { status: 200, body: [mrPayload()] },
        { status: 500, body: 'outage' },
        { status: 200, body: [mrPayload()] },
      ],
    })
    queueGitLabReviews([[], [], []])
    queueGitLabNotes([[], []])
    await task.poll()
    await task.poll()
    await task.poll()
    expect(task.notifications).toEqual([])
    expect(task.poller.getStatus().errors).toEqual([])
  })

  test('failed initial scope remains silent on recovery while the other scope progresses', async () => {
    const task = actorPoller()
    mockRoute({
      urlPattern: /scope=assigned_to_me/,
      responses: [
        { status: 500, body: 'outage' },
        { status: 200, body: [mrPayload()] },
      ],
    })
    queueGitLabReviews([[], [mrPayload()]])
    queueGitLabNotes([[systemNote(1, 'requested review from @saffronjam', 'another-user')]])
    queueReviewers(['unreviewed'])
    await task.poll()
    await task.poll()
    expect(task.notifications).toHaveLength(1)
    expect(task.notifications[0]!.type).toBe('pr_review_requested')
  })

  test('ordinary self-comment and similarly named reviewer do not suppress an unknown assignment', async () => {
    const task = actorPoller()
    queueGitLabAssigned([[], []])
    queueGitLabReviews([[], [mrPayload()]])
    queueGitLabNotes([
      [
        { ...systemNote(1, 'requested review from @saffronjam'), system: false },
        systemNote(2, 'requested review from @saffronjam-other'),
      ],
    ])
    queueReviewers(['unknown-future-state'])
    await task.poll()
    await task.poll()
    expect(task.notifications).toHaveLength(1)
    expect(task.notifications[0]!.author).toBe('Someone')
  })
})

function githubConfig(): AppConfig {
  return makeConfig({
    connections: { github: { provider: 'github', username: 'saffronjam' }, gitlab: null },
    monitoredProjects: [
      { ...gitlabProject, id: 'github:42', provider: 'github', fullName: 'org/edge' },
    ],
  })
}

function prPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7001,
    number: 1,
    title: 'PR title',
    html_url: 'https://github.com/org/edge/pull/1',
    user: { id: 8, login: 'creator' },
    assignees: [],
    requested_reviewers: [],
    created_at: pollTimes[0],
    updated_at: pollTimes[0],
    ...overrides,
  }
}

function githubEvent(id: number, event: string, self = false, time = 1) {
  return {
    id,
    event,
    actor: { id: self ? 7 : 9, login: self ? 'saffronjam' : 'requester' },
    assignee: { id: 7, login: 'saffronjam' },
    requested_reviewer: { id: 7, login: 'saffronjam' },
    created_at: pollTimes[time],
  }
}

function queuePulls(bodies: object[]) {
  return mockRoute({
    urlPattern: /\/repos\/org\/edge\/pulls\?/,
    responses: bodies.map((body) => ({ status: 200, body })),
  })
}

function queueTimeline(bodies: object[]) {
  return mockRoute({
    urlPattern: /\/issues\/1\/timeline\?/,
    responses: bodies.map((body) => ({ status: 200, body })),
  })
}

describe('Poller actor-aware GitHub notifications', () => {
  beforeEach(() => {
    installFetchMock()
    mockRoute({
      urlPattern: 'https://api.github.com/user',
      responses: [{ status: 200, body: { id: 7, login: 'saffronjam' } }],
    })
  })
  afterEach(() => {
    expect(getUnmatchedCalls()).toEqual([])
    resetFetchMock()
  })

  test.each(['assigned', 'review_requested'])(
    'suppresses own %s but not a later external request',
    async (event) => {
      const task = actorPoller(githubConfig())
      const pr = prPayload(
        event === 'assigned'
          ? { assignees: [{ login: 'saffronjam' }] }
          : { requested_reviewers: [{ login: 'saffronjam' }] },
      )
      queuePulls([[], [pr], [pr], [pr]])
      const self = githubEvent(1, event, true)
      const external = githubEvent(3, event, false, 2)
      const removed = githubEvent(
        2,
        event === 'assigned' ? 'unassigned' : 'review_request_removed',
        true,
        2,
      )
      queueTimeline([[self], [external, removed, self], [external, removed, self]])
      await task.poll()
      await task.poll()
      await task.poll()
      await task.poll()
      expect(task.notifications).toHaveLength(1)
      expect(task.notifications[0]!.author).toBe('requester')
      expect(task.poller.getStatus().errors).toEqual([])
    },
  )

  test('a submitted review before the poll suppresses the completed request', async () => {
    const task = actorPoller(githubConfig())
    queuePulls([[], [prPayload({ requested_reviewers: [{ login: 'saffronjam' }] })]])
    queueTimeline([
      [
        githubEvent(1, 'review_requested'),
        {
          id: 2,
          event: 'reviewed',
          state: 'approved',
          user: { id: 7, login: 'saffronjam' },
          submitted_at: pollTimes[1],
        },
      ],
    ])
    await task.poll()
    await task.poll()
    expect(task.notifications).toEqual([])
  })

  test('new PR notifications exclude own PRs by user ID', async () => {
    const config = githubConfig()
    config.monitoredProjects[0]!.events.prCreated = true
    const task = actorPoller(config)
    queuePulls([
      [],
      [
        prPayload({ user: { id: 7, login: 'renamed-user' }, created_at: pollTimes[1] }),
        prPayload({ id: 7002, number: 2, created_at: pollTimes[1] }),
      ],
    ])
    await task.poll()
    await task.poll()
    expect(task.notifications).toHaveLength(1)
    expect(task.notifications[0]).toMatchObject({ type: 'pr_created', author: 'creator' })
  })

  test('missing actor does not prevent an assignment notification', async () => {
    const task = actorPoller(githubConfig())
    queuePulls([[], [prPayload({ assignees: [{ login: 'saffronjam' }] })]])
    queueTimeline([[{ ...githubEvent(1, 'assigned'), actor: null }]])
    await task.poll()
    await task.poll()
    expect(task.notifications[0]!.author).toBe('Someone')
  })
})

describe('Poller lifecycle isolation', () => {
  beforeEach(() => installFetchMock())
  afterEach(() => {
    expect(getUnmatchedCalls()).toEqual([])
    resetFetchMock()
  })

  test('concurrent triggers share one complete poll', async () => {
    const task = actorPoller(githubConfig())
    mockRoute({
      urlPattern: 'https://api.github.com/user',
      responses: [{ status: 200, body: { id: 7, login: 'saffronjam' } }],
    })
    let release!: () => void
    const waitFor = new Promise<void>((resolve) => {
      release = resolve
    })
    const pulls = mockRoute({
      urlPattern: /\/pulls\?/,
      responses: [{ status: 200, body: [], waitFor }],
    })
    const first = task.poller.trigger()
    const second = task.poller.trigger()
    release()
    await Promise.all([first, second])
    expect(pulls.calls).toHaveLength(1)
    expect(task.poller.getStatus().errors).toEqual([])
  })

  test('stop discards a delayed response without publishing notifications or committing history', async () => {
    const task = actorPoller(githubConfig())
    mockRoute({
      urlPattern: 'https://api.github.com/user',
      responses: [{ status: 200, body: { id: 7, login: 'saffronjam' } }],
    })
    let release!: () => void
    const waitFor = new Promise<void>((resolve) => {
      release = resolve
    })
    mockRoute({
      urlPattern: /\/pulls\?/,
      responses: [
        { status: 200, body: [] },
        { status: 200, body: [prPayload({ assignees: [{ login: 'saffronjam' }] })], waitFor },
      ],
    })
    queueTimeline([[githubEvent(1, 'assigned')]])
    await task.poll()
    const pending = task.poller.trigger()
    task.poller.stop()
    release()
    await pending
    expect(task.notifications).toEqual([])
    expect(task.poller.getStatus().lastPollAt).toBe(pollTimes[0]!)
  })

  test('restart after an in-flight request establishes a new silent baseline', async () => {
    const task = actorPoller(githubConfig())
    mockRoute({
      urlPattern: 'https://api.github.com/user',
      responses: [
        { status: 200, body: { id: 7, login: 'saffronjam' } },
        { status: 200, body: { id: 7, login: 'saffronjam' } },
      ],
    })
    let release!: () => void
    const waitFor = new Promise<void>((resolve) => {
      release = resolve
    })
    const pr = prPayload({ assignees: [{ login: 'saffronjam' }] })
    mockRoute({
      urlPattern: /\/pulls\?/,
      responses: [
        { status: 200, body: [], waitFor },
        { status: 200, body: [pr] },
      ],
    })
    queueTimeline([[githubEvent(1, 'assigned')]])
    const pending = task.poller.trigger()
    await Promise.resolve()
    task.poller.restart()
    try {
      release()
      await pending
      await task.poller.trigger()
      expect(task.notifications).toEqual([])
      expect(task.poller.getStatus().errors).toEqual([])
    } finally {
      task.poller.stop()
    }
  })

  test('disconnect during a request invalidates its result', async () => {
    const task = actorPoller(githubConfig())
    mockRoute({
      urlPattern: 'https://api.github.com/user',
      responses: [{ status: 200, body: { id: 7, login: 'saffronjam' } }],
    })
    let release!: () => void
    const waitFor = new Promise<void>((resolve) => {
      release = resolve
    })
    const pulls = mockRoute({
      urlPattern: /\/pulls\?/,
      responses: [{ status: 200, body: [], waitFor }],
    })
    const pending = task.poller.trigger()
    while (pulls.calls.length === 0) await Promise.resolve()
    task.configRef.current = makeConfig()
    release()
    await pending
    expect(task.poller.getStatus().lastPollAt).toBeNull()
    expect(task.notifications).toEqual([])
  })
})

describe('Poller identity and comment compatibility', () => {
  beforeEach(() => installFetchMock())
  afterEach(() => {
    expect(getUnmatchedCalls()).toEqual([])
    resetFetchMock()
  })

  test('switching accounts establishes separate history even for overlapping source IDs', async () => {
    const task = actorPoller(githubConfig())
    mockRoute({
      urlPattern: 'https://api.github.com/user',
      responses: [
        { status: 200, body: { id: 7, login: 'saffronjam' } },
        { status: 200, body: { id: 10, login: 'second-account' } },
      ],
    })
    queuePulls([
      [prPayload({ assignees: [{ login: 'saffronjam' }] })],
      [prPayload({ assignees: [{ login: 'second-account' }] })],
      [prPayload({ assignees: [{ login: 'second-account' }] })],
    ])
    const second = { ...githubEvent(1, 'assigned'), assignee: { id: 10, login: 'second-account' } }
    queueTimeline([
      [githubEvent(1, 'assigned')],
      [second],
      [{ ...second, id: 2, created_at: pollTimes[2] }],
    ])
    await task.poll()
    task.configRef.current = {
      ...task.configRef.current,
      connections: {
        github: { provider: 'github', username: 'second-account' },
        gitlab: null,
      },
    }
    await task.poll()
    expect(task.notifications).toEqual([])
    await task.poll()
    expect(task.notifications).toHaveLength(1)
    expect(task.notifications[0]!.author).toBe('requester')
    expect(task.poller.getStatus().errors).toEqual([])
  })

  test('comment streams keep distinct IDs and suppress own comments after a rename', async () => {
    const config = githubConfig()
    config.monitoredProjects[0]!.events = {
      prCreated: false,
      prAssigned: false,
      prReviewRequested: false,
      prComment: true,
    }
    const task = actorPoller(config)
    mockRoute({
      urlPattern: 'https://api.github.com/user',
      responses: [{ status: 200, body: { id: 7, login: 'saffronjam' } }],
    })
    const pr = prPayload({ assignees: [{ login: 'saffronjam' }] })
    queuePulls([[pr], [pr]])
    const comment = {
      id: 1,
      user: { id: 9, login: 'other' },
      html_url: 'https://github.com/u/r/pull/1#comment',
      created_at: pollTimes[1],
      updated_at: pollTimes[1],
    }
    mockRoute({
      urlPattern: /\/issues\/1\/comments\?/,
      responses: [
        { status: 200, body: [] },
        {
          status: 200,
          body: [comment, { ...comment, id: 2, user: { id: 7, login: 'renamed-user' } }],
        },
      ],
    })
    mockRoute({
      urlPattern: /\/pulls\/1\/comments\?/,
      responses: [
        { status: 200, body: [] },
        { status: 200, body: [comment] },
      ],
    })
    await task.poll()
    await task.poll()
    expect(task.notifications).toHaveLength(2)
    expect(new Set(task.notifications.map((event) => event.id)).size).toBe(2)
    expect(task.notifications.every((event) => event.author === 'other')).toBe(true)
    expect(task.poller.getStatus().errors).toEqual([])
  })

  test('disabled events avoid attribution requests', async () => {
    const config = gitlabConfig()
    config.monitoredProjects[0]!.events = {
      prCreated: false,
      prAssigned: false,
      prReviewRequested: false,
      prComment: false,
    }
    const task = actorPoller(config)
    mockRoute({
      urlPattern: /\/api\/v4\/user$/,
      responses: [{ status: 200, body: { id: 7, username: 'saffronjam' } }],
    })
    queueGitLabAssigned([[mrPayload()]])
    queueGitLabReviews([[mrPayload()]])
    await task.poll()
    expect(task.notifications).toEqual([])
    expect(task.poller.getStatus().errors).toEqual([])
  })
})
