import type { BrowserWindow } from 'electron'
import type { AppConfig } from '../shared/config'
import type { DetectedEvent } from '../shared/notification'
import type { PollerError, PollerStatus, ProjectPollStatus } from '../shared/ipc'
import type { AuthRefresher } from './auth-refresher'
import type { ConfigManager } from './config-manager'
import type { TokenStore } from './token-store'
import * as githubClient from './github-client'
import * as gitlabClient from './gitlab-client'
import { logger } from './logger'
import type { MonitoredProject } from '../shared/project'
import type { Provider } from '../shared/provider'
import type {
  ActivityUser,
  AssignmentActivity,
  AssignmentRole,
  AssignmentState,
} from './notification-reconciler'
import { emptyAssignmentState, reconcileAssignment, sameUser } from './notification-reconciler'

interface RoleItem {
  present?: boolean
  event: DetectedEvent
  activities: AssignmentActivity[] | null
  reviewState: 'pending' | 'completed' | 'unknown'
}

interface RoleHistory {
  observedAt: string
  items: Map<string, AssignmentState>
}

interface MessageHistory {
  since: string
  seen: Set<string>
}

interface ProjectHistory {
  roles: Partial<Record<AssignmentRole, RoleHistory>>
  messages: Map<string, MessageHistory>
}

interface MessageBatch {
  stream: string
  events: DetectedEvent[]
}

interface ProjectObservation {
  project: MonitoredProject
  user: ActivityUser
  roles: Partial<Record<AssignmentRole, RoleItem[]>>
  roleObservedAt: Partial<Record<AssignmentRole, string>>
  messages: MessageBatch[]
  errors: string[]
}

function connectionKey(config: AppConfig, provider: Provider): string {
  const connection = config.connections[provider]
  return JSON.stringify([
    provider,
    connection?.username.toLowerCase(),
    connection?.provider === 'gitlab'
      ? gitlabClient.normalizeUrl(connection.instanceUrl)
      : 'https://api.github.com',
  ])
}

function projectKey(config: AppConfig, project: MonitoredProject): string {
  return JSON.stringify([connectionKey(config, project.provider), project.id, project.events])
}

function configKey(config: AppConfig): string {
  return JSON.stringify([config.connections, config.monitoredProjects])
}

function commentUser(comment: { author: string; authorId?: number }): ActivityUser {
  return {
    username: comment.author,
    ...(comment.authorId === undefined ? {} : { id: comment.authorId }),
  }
}

export type NotificationShower = (event: DetectedEvent, config: AppConfig) => void

export type PollerConfigManager = Pick<ConfigManager, 'get'>
export type PollerTokenStore = Pick<TokenStore, 'getToken'>
export type PollerAuthRefresher = Pick<AuthRefresher, 'onUnauthorized'>

export type PollerStatusListener = (status: PollerStatus) => void

/** Periodically polls GitHub and GitLab APIs for new events. */
export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null
  private histories = new Map<string, ProjectHistory>()
  private identities = new Map<string, ActivityUser>()
  private generation = 0
  private inFlight: { generation: number; promise: Promise<void> } | null = null
  private lastPollAt: string | null = null
  private errors: PollerError[] = []
  private projectStatuses = new Map<string, ProjectPollStatus>()
  private mainWindow: BrowserWindow | null = null
  private statusListener: PollerStatusListener | null = null

  constructor(
    private configManager: PollerConfigManager,
    private tokenStore: PollerTokenStore,
    private authRefresher: PollerAuthRefresher,
    private showNotification: NotificationShower,
    private now: () => Date = () => new Date(),
  ) {}

  /** Sets the main window reference for pushing status updates. */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /** Registers a listener that fires whenever poller status changes (e.g. for the tray). */
  setStatusListener(listener: PollerStatusListener): void {
    this.statusListener = listener
  }

  /** Starts the polling timer at the configured interval. */
  start(): void {
    if (this.timer) this.stop()

    const config = this.configManager.get()
    const intervalMs = config.polling.intervalSeconds * 1000

    this.generation++
    this.histories.clear()
    this.identities.clear()
    logger.info('poller.started', { intervalSeconds: config.polling.intervalSeconds })
    void this.poll()
    this.timer = setInterval(() => {
      void this.poll()
    }, intervalMs)
    this.pushStatus()
  }

  /** Stops the polling timer. */
  stop(): void {
    this.generation++
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      logger.info('poller.stopped')
    }
    for (const [id, status] of this.projectStatuses) {
      if (status.state === 'polling') this.projectStatuses.set(id, { ...status, state: 'idle' })
    }
    this.pushStatus()
  }

  /** Returns the current poller status. */
  getStatus(): PollerStatus {
    const config = this.configManager.get()
    const nextPollAt =
      this.timer && this.lastPollAt
        ? new Date(
            new Date(this.lastPollAt).getTime() + config.polling.intervalSeconds * 1000,
          ).toISOString()
        : null

    const projects: Record<string, ProjectPollStatus> = {}
    for (const [id, status] of this.projectStatuses) {
      projects[id] = status
    }

    return {
      running: this.timer !== null,
      lastPollAt: this.lastPollAt,
      nextPollAt,
      errors: this.errors,
      projects,
    }
  }

  /**
   * Stop-and-start. Safe to call from any state — if currently stopped, this simply starts.
   * (Historically this was a no-op when stopped, which caused the poller to never wake after
   * a project was added to a freshly reconnected provider.)
   */
  restart(): void {
    logger.info('poller.restart')
    this.stop()
    this.start()
  }

  /** Runs one poll cycle immediately. Used for tests and future "Poll now" UI. */
  async trigger(): Promise<void> {
    await this.poll()
  }

  /** Serializes cycles and lets a restarted generation follow any obsolete in-flight cycle. */
  private async poll(): Promise<void> {
    const generation = this.generation
    if (this.inFlight) {
      const previous = this.inFlight
      await previous.promise
      if (previous.generation !== generation && this.generation === generation) await this.poll()
      return
    }
    const promise = this.executePoll(generation)
    this.inFlight = { generation, promise }
    try {
      await promise
    } finally {
      if (this.inFlight?.promise === promise) this.inFlight = null
    }
  }

  private async executePoll(generation: number): Promise<void> {
    const config = this.configManager.get()
    const signature = configKey(config)
    const observedAt = this.now().toISOString()
    const isCurrent = (): boolean =>
      generation === this.generation && configKey(this.configManager.get()) === signature
    const observations: ProjectObservation[] = []
    const activeKeys = new Set(
      config.monitoredProjects.map((project) => projectKey(config, project)),
    )
    for (const key of this.histories.keys()) {
      if (!activeKeys.has(key)) this.histories.delete(key)
    }
    const identityKeys = new Set(
      (['github', 'gitlab'] as const)
        .filter((provider) => config.connections[provider])
        .map((provider) => connectionKey(config, provider)),
    )
    for (const key of this.identities.keys()) {
      if (!identityKeys.has(key)) this.identities.delete(key)
    }
    const projectIds = new Set(config.monitoredProjects.map((project) => project.id))
    for (const id of this.projectStatuses.keys()) {
      if (!projectIds.has(id)) this.projectStatuses.delete(id)
    }
    for (const project of config.monitoredProjects) {
      const connection = config.connections[project.provider]
      if (connection && !connection.needsReauth && this.tokenStore.getToken(project.provider))
        this.setProjectPolling(project.id)
    }
    this.pushStatus()

    for (const provider of ['github', 'gitlab'] as const) {
      const connection = config.connections[provider]
      const projects = config.monitoredProjects.filter((project) => project.provider === provider)
      const token = this.tokenStore.getToken(provider)
      if (!connection || connection.needsReauth || !token || !projects.length) continue
      const key = connectionKey(config, provider)
      let user = this.identities.get(key)
      if (!user) {
        try {
          user =
            provider === 'github'
              ? await githubClient.fetchCurrentUser(token)
              : await gitlabClient.fetchCurrentUser(
                  token,
                  config.connections.gitlab!.instanceUrl,
                  config.connections.gitlab!.authMethod,
                  this.authRefresher.onUnauthorized('gitlab'),
                )
          if (isCurrent()) this.identities.set(key, user)
        } catch (error) {
          logger.warn('poll.identity-unavailable', { provider, error: String(error) })
          user = { username: connection.username }
        }
      }
      if (!isCurrent()) return
      if (provider === 'github') {
        for (const project of projects) {
          observations.push(await this.observeGitHub(config, project, token, user))
          if (!isCurrent()) return
        }
      } else {
        observations.push(...(await this.observeGitLab(config, projects, token, user)))
      }
      if (!isCurrent()) return
    }

    const events: DetectedEvent[] = []
    this.errors = []
    for (const observation of observations) {
      events.push(...this.reconcileProject(config, observation, observedAt))
      this.recordProjectResult(
        observation.project.id,
        observation.errors.length === 0,
        observation.errors.join('; '),
      )
      for (const message of observation.errors) {
        this.errors.push({
          provider: observation.project.provider,
          message: `${observation.project.fullName}: ${message}`,
          timestamp: observedAt,
        })
      }
    }
    this.lastPollAt = this.now().toISOString()
    for (const event of events) this.showNotification(event, this.configManager.get())
    if (events.length) this.pushNewEvents(events)
    logger.info('poll.complete', { newEvents: events.length, errors: this.errors.length })
    this.pushStatus()
  }

  private reconcileProject(
    config: AppConfig,
    observation: ProjectObservation,
    observedAt: string,
  ): DetectedEvent[] {
    const key = projectKey(config, observation.project)
    const history = this.histories.get(key) ?? {
      roles: {},
      messages: new Map<string, MessageHistory>(),
    }
    const events: DetectedEvent[] = []
    for (const role of ['assigned', 'review'] as const) {
      const items = observation.roles[role]
      if (!items) continue
      const previous = history.roles[role]
      const membershipObservedAt = observation.roleObservedAt[role] ?? observedAt
      const next: RoleHistory = {
        observedAt: membershipObservedAt,
        items: new Map(previous?.items),
      }
      const currentIds = new Set(items.map((item) => item.event.id))
      for (const id of next.items.keys()) {
        if (!currentIds.has(id)) {
          next.items.delete(id)
        }
      }
      for (const item of items) {
        const state =
          previous?.items.get(item.event.id) ??
          emptyAssignmentState(previous?.observedAt ?? observedAt)
        const decision = reconcileAssignment(
          state,
          {
            role,
            present: item.present ?? true,
            activities: item.activities,
            reviewState: item.reviewState,
            observedAt: membershipObservedAt,
          },
          observation.user,
          !previous,
        )
        next.items.set(item.event.id, decision.state)
        if (decision.reason !== 'unchanged') {
          logger.info('poll.assignment-decision', {
            provider: observation.project.provider,
            project: observation.project.fullName,
            eventId: item.event.id,
            reason: decision.reason,
            notify: decision.notify,
          })
        }
        if (decision.notify)
          events.push({
            ...item.event,
            id: `${item.event.id}:${decision.occurrenceId}`,
            author: decision.actor,
            timestamp: decision.timestamp,
          })
      }
      history.roles[role] = next
    }
    for (const batch of observation.messages) {
      const previous = history.messages.get(batch.stream)
      const seen = previous?.seen ?? new Set<string>()
      for (const event of batch.events) {
        if (previous && !seen.has(event.id)) events.push(event)
        seen.add(event.id)
      }
      history.messages.set(batch.stream, { seen, since: observedAt })
    }
    this.histories.set(key, history)
    return events
  }

  private messageSince(
    config: AppConfig,
    project: MonitoredProject,
    stream: string,
  ): string | null {
    return this.histories.get(projectKey(config, project))?.messages.get(stream)?.since ?? null
  }

  private recordObservationError(
    observation: ProjectObservation,
    operation: string,
    error: unknown,
  ): void {
    observation.errors.push(`${operation}: ${String(error)}`)
    logger.warn('poll.observation-failed', {
      provider: observation.project.provider,
      project: observation.project.fullName,
      operation,
      error: String(error),
    })
  }

  private async observeGitHub(
    config: AppConfig,
    project: MonitoredProject,
    token: string,
    user: ActivityUser,
  ): Promise<ProjectObservation> {
    const result: ProjectObservation = {
      project,
      user,
      roles: {},
      roleObservedAt: {},
      messages: [],
      errors: [],
    }
    let prs: githubClient.GitHubPRItem[]
    try {
      prs = await githubClient.fetchPullRequests(token, project.fullName, null)
      const membershipObservedAt = this.now().toISOString()
      result.roleObservedAt = { assigned: membershipObservedAt, review: membershipObservedAt }
    } catch (error) {
      this.recordObservationError(result, 'pull requests', error)
      return result
    }
    if (project.events.prAssigned) result.roles.assigned = []
    if (project.events.prReviewRequested) result.roles.review = []
    if (project.events.prCreated) {
      const since =
        this.messageSince(config, project, 'created') ?? this.getLookbackTimestamp(config)
      result.messages.push({
        stream: 'created',
        events: prs
          .filter(
            (pr) =>
              Date.parse(pr.createdAt) > Date.parse(since) &&
              !sameUser(
                { username: pr.author, ...(pr.authorId === undefined ? {} : { id: pr.authorId }) },
                user,
              ),
          )
          .map((pr) => ({
            id: `${pr.id}:created:${pr.createdAt}`,
            provider: 'github',
            projectFullName: project.fullName,
            type: 'pr_created',
            title: pr.title,
            url: pr.url,
            author: pr.author,
            timestamp: pr.createdAt,
          })),
      })
    }
    for (const pr of prs) {
      const assigned = pr.assignees.some((username) => sameUser({ username }, user))
      const reviewing = pr.reviewers.some((username) => sameUser({ username }, user))
      let activities: AssignmentActivity[] | null = null
      if ((assigned && result.roles.assigned) || (reviewing && result.roles.review)) {
        try {
          activities = await githubClient.fetchAssignmentActivity(
            token,
            project.fullName,
            pr.number,
          )
        } catch (error) {
          this.recordObservationError(result, `PR #${pr.number} activity`, error)
        }
      }
      const base = {
        provider: 'github' as const,
        projectFullName: project.fullName,
        title: pr.title,
        url: pr.url,
        author: pr.author,
        timestamp: pr.updatedAt,
      }
      if (assigned)
        result.roles.assigned?.push({
          activities,
          reviewState: 'unknown',
          event: { ...base, id: `${pr.id}:assigned`, type: 'pr_assigned' },
        })
      if (reviewing)
        result.roles.review?.push({
          activities,
          reviewState: 'pending',
          event: { ...base, id: `${pr.id}:review`, type: 'pr_review_requested' },
        })
      if (project.events.prComment && (assigned || reviewing)) {
        const stream = `${pr.id}:comments`
        try {
          const [issueComments, reviewComments] = await Promise.all([
            githubClient.fetchIssueComments(
              token,
              project.fullName,
              pr.number,
              this.messageSince(config, project, stream),
            ),
            githubClient.fetchReviewComments(
              token,
              project.fullName,
              pr.number,
              this.messageSince(config, project, stream),
            ),
          ])
          result.messages.push({
            stream,
            events: [...issueComments, ...reviewComments]
              .filter((comment) => !sameUser(commentUser(comment), user))
              .map((comment) => ({
                ...base,
                id: `${pr.id}:comment:${comment.id}`,
                type: 'pr_comment',
                url: comment.url,
                author: comment.author,
                timestamp: comment.updatedAt,
              })),
          })
        } catch (error) {
          this.recordObservationError(result, `PR #${pr.number} comments`, error)
        }
      }
    }
    return result
  }

  private async observeGitLab(
    config: AppConfig,
    projects: MonitoredProject[],
    token: string,
    user: ActivityUser,
  ): Promise<ProjectObservation[]> {
    const { instanceUrl, authMethod } = config.connections.gitlab!
    const onUnauthorized = this.authRefresher.onUnauthorized('gitlab')
    const results = projects.map(
      (project): ProjectObservation => ({
        project,
        user,
        roles: {},
        roleObservedAt: {},
        messages: [],
        errors: [],
      }),
    )
    const scoped = await Promise.allSettled(
      (['assigned_to_me', 'reviews_for_me'] as const).map((scope) =>
        gitlabClient
          .fetchMergeRequests(token, instanceUrl, authMethod, scope, null, onUnauthorized)
          .then((items) => ({ items, observedAt: this.now().toISOString() })),
      ),
    )
    const assigned = scoped[0]!
    const reviews = scoped[1]!
    for (const result of results) {
      if (assigned.status === 'rejected')
        this.recordObservationError(result, 'assigned MRs', assigned.reason)
      else if (result.project.events.prAssigned) {
        result.roles.assigned = []
        result.roleObservedAt.assigned = assigned.value.observedAt
      }
      if (reviews.status === 'rejected')
        this.recordObservationError(result, 'review MRs', reviews.reason)
      else if (result.project.events.prReviewRequested) {
        result.roles.review = []
        result.roleObservedAt.review = reviews.value.observedAt
      }
    }
    const assignedMRs = assigned.status === 'fulfilled' ? assigned.value.items : []
    const reviewMRs = reviews.status === 'fulfilled' ? reviews.value.items : []
    const assignedIds = new Set(assignedMRs.map((mr) => mr.id))
    const reviewIds = new Set(reviewMRs.map((mr) => mr.id))
    const involved = new Map([...assignedMRs, ...reviewMRs].map((mr) => [mr.id, mr]))
    for (const mr of involved.values()) {
      const result = results.find((entry) => entry.project.id === `gitlab:${mr.projectId}`)
      if (!result) continue
      const { project } = result
      let activities: AssignmentActivity[] | null = null
      if (
        project.events.prComment ||
        (assignedIds.has(mr.id) && result.roles.assigned) ||
        (reviewIds.has(mr.id) && result.roles.review)
      ) {
        try {
          const notes = await gitlabClient.fetchMergeRequestActivity(
            token,
            instanceUrl,
            authMethod,
            mr.projectId,
            mr.iid,
            mr.url,
            onUnauthorized,
          )
          activities = notes.activities
          if (project.events.prComment)
            result.messages.push({
              stream: `${mr.id}:comments`,
              events: notes.comments
                .filter((note) => !sameUser(commentUser(note), user))
                .map((note) => ({
                  id: `${mr.id}:comment:${note.id}`,
                  provider: 'gitlab',
                  projectFullName: project.fullName,
                  type: 'pr_comment',
                  title: mr.title,
                  url: note.url,
                  author: note.author,
                  timestamp: note.updatedAt,
                })),
            })
        } catch (error) {
          this.recordObservationError(result, `MR !${mr.iid} notes`, error)
        }
      }
      const base = {
        provider: 'gitlab' as const,
        projectFullName: project.fullName,
        title: mr.title,
        url: mr.url,
        author: mr.author,
        timestamp: mr.timestamp,
      }
      if (assignedIds.has(mr.id))
        result.roles.assigned?.push({
          activities,
          reviewState: 'unknown',
          event: { ...base, id: `${mr.id}:assigned`, type: 'pr_assigned' },
        })
      if (reviewIds.has(mr.id) && result.roles.review) {
        let reviewState: RoleItem['reviewState'] = 'unknown'
        let present = true
        try {
          const reviewers = await gitlabClient.fetchMergeRequestReviewers(
            token,
            instanceUrl,
            authMethod,
            mr.projectId,
            mr.iid,
            onUnauthorized,
          )
          const reviewer = reviewers.find((entry) => sameUser(entry.user, user))
          present = reviewer !== undefined
          if (reviewer && ['approved', 'reviewed', 'requested_changes'].includes(reviewer.state))
            reviewState = 'completed'
          else if (
            reviewer &&
            ['unreviewed', 'review_started', 'unapproved'].includes(reviewer.state)
          )
            reviewState = 'pending'
        } catch (error) {
          this.recordObservationError(result, `MR !${mr.iid} reviewers`, error)
        }
        result.roles.review.push({
          present,
          activities,
          reviewState,
          event: { ...base, id: `${mr.id}:review`, type: 'pr_review_requested' },
        })
      }
    }
    return results
  }

  /** Marks a project as currently polling. */
  private setProjectPolling(projectId: string): void {
    const existing = this.projectStatuses.get(projectId)
    this.projectStatuses.set(projectId, {
      state: 'polling',
      recentResults: existing?.recentResults ?? [],
      lastPollAt: existing?.lastPollAt ?? null,
      lastError: existing?.lastError ?? null,
    })
  }

  /** Records a poll result (success or failure) for a project. */
  private recordProjectResult(projectId: string, success: boolean, error?: string): void {
    const existing = this.projectStatuses.get(projectId)
    const recent = existing?.recentResults ?? []
    const updated = [...recent, success].slice(-10)
    this.projectStatuses.set(projectId, {
      state: success ? 'success' : 'error',
      recentResults: updated,
      lastPollAt: this.now().toISOString(),
      lastError: success ? null : (error ?? 'Unknown error'),
    })
  }

  /** Calculates the lookback timestamp based on config. */
  private getLookbackTimestamp(config: AppConfig): string {
    const now = new Date(this.now())
    now.setMinutes(now.getMinutes() - config.polling.lookbackMinutes)
    return now.toISOString()
  }

  /** Pushes current poller status to the renderer and any registered status listener. */
  private pushStatus(): void {
    const status = this.getStatus()
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('poller:status-changed', status)
    }
    this.statusListener?.(status)
  }

  /** Pushes new detected events to the renderer. */
  private pushNewEvents(events: DetectedEvent[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('notification:new-events', events)
    }
  }
}
