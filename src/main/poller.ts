import type { BrowserWindow } from 'electron'
import type { AppConfig } from '../shared/config'
import type { DetectedEvent } from '../shared/notification'
import type { PollerError, PollerStatus, ProjectPollStatus } from '../shared/ipc'
import type { ConfigManager } from './config-manager'
import type { TokenStore } from './token-store'
import * as githubClient from './github-client'
import * as gitlabClient from './gitlab-client'
import { showNotification } from './notification-manager'

/** Periodically polls GitHub and GitLab APIs for new events. */
export class Poller {
  private timer: ReturnType<typeof setInterval> | null = null
  private seenEvents = new Map<string, string>()
  private lastPollAt: string | null = null
  private errors: PollerError[] = []
  private projectStatuses = new Map<string, ProjectPollStatus>()
  private mainWindow: BrowserWindow | null = null

  constructor(
    private configManager: ConfigManager,
    private tokenStore: TokenStore,
  ) {}

  /** Sets the main window reference for pushing status updates. */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /** Starts the polling timer at the configured interval. */
  start(): void {
    if (this.timer) this.stop()

    const config = this.configManager.get()
    const intervalMs = config.polling.intervalSeconds * 1000

    this.poll()
    this.timer = setInterval(() => this.poll(), intervalMs)
    this.pushStatus()
  }

  /** Stops the polling timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
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

  /** Restarts the timer with the current config interval. */
  restart(): void {
    if (this.timer) {
      this.stop()
      this.start()
    }
  }

  /** Executes one poll cycle across all connected providers. */
  private async poll(): Promise<void> {
    const config = this.configManager.get()

    if (!this.lastPollAt && config.polling.lookbackMinutes === 0) {
      this.lastPollAt = new Date().toISOString()
      this.pushStatus()
      return
    }

    const since = this.lastPollAt ?? this.getLookbackTimestamp(config)
    this.errors = []

    const newEvents: DetectedEvent[] = []

    if (config.connections.github) {
      const githubEvents = await this.pollGitHub(config, since)
      newEvents.push(...githubEvents)
    }

    if (config.connections.gitlab) {
      const gitlabEvents = await this.pollGitLab(config, since)
      newEvents.push(...gitlabEvents)
    }

    this.lastPollAt = new Date().toISOString()

    const currentEventIds = new Set(newEvents.map((e) => e.id))
    for (const seenId of this.seenEvents.keys()) {
      if (
        (seenId.endsWith(':assigned') || seenId.endsWith(':review')) &&
        !currentEventIds.has(seenId)
      ) {
        this.seenEvents.delete(seenId)
      }
    }

    const unseenEvents = newEvents.filter((e) => !this.seenEvents.has(e.id))
    for (const event of unseenEvents) {
      this.seenEvents.set(event.id, event.timestamp)
      showNotification(event, config)
    }

    if (unseenEvents.length > 0) {
      this.pushNewEvents(unseenEvents)
    }

    this.pruneSeenEvents()
    this.pushStatus()
  }

  /** Removes seen events older than 1 hour to prevent unbounded growth. */
  private pruneSeenEvents(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    for (const [id, timestamp] of this.seenEvents) {
      if (timestamp < oneHourAgo) {
        this.seenEvents.delete(id)
      }
    }
  }

  /** Polls GitHub PRs for each monitored repo. */
  private async pollGitHub(config: AppConfig, since: string): Promise<DetectedEvent[]> {
    const token = this.tokenStore.getToken('github')
    if (!token || !config.connections.github) return []

    const username = config.connections.github.username
    const sinceDate = new Date(since)
    const monitoredGithub = config.monitoredProjects.filter((p) => p.provider === 'github')
    if (monitoredGithub.length === 0) return []

    const eventsMap = new Map(monitoredGithub.map((p) => [p.fullName, p.events]))
    const events: DetectedEvent[] = []

    for (const project of monitoredGithub) {
      this.setProjectPolling(project.id)
      this.pushStatus()

      try {
        const prs = await githubClient.fetchPullRequests(token, project.fullName, since)
        const flags = eventsMap.get(project.fullName)
        if (!flags) {
          this.recordProjectResult(project.id, true)
          continue
        }

        for (const pr of prs) {
          if (flags.prAssigned && pr.assignees.includes(username)) {
            events.push({
              id: `${pr.id}:assigned`,
              provider: 'github',
              projectFullName: project.fullName,
              type: 'pr_assigned',
              title: pr.title,
              url: pr.url,
              author: pr.author,
              timestamp: pr.updatedAt,
            })
          }

          if (flags.prReviewRequested && pr.reviewers.includes(username)) {
            events.push({
              id: `${pr.id}:review`,
              provider: 'github',
              projectFullName: project.fullName,
              type: 'pr_review_requested',
              title: pr.title,
              url: pr.url,
              author: pr.author,
              timestamp: pr.updatedAt,
            })
          }

          if (flags.prCreated && new Date(pr.createdAt) > sinceDate) {
            events.push({
              id: `${pr.id}:created:${pr.createdAt}`,
              provider: 'github',
              projectFullName: project.fullName,
              type: 'pr_created',
              title: pr.title,
              url: pr.url,
              author: pr.author,
              timestamp: pr.createdAt,
            })
          }
        }

        this.recordProjectResult(project.id, true)
      } catch (err) {
        this.recordProjectResult(project.id, false, String(err))
        this.errors.push({
          provider: 'github',
          message: `${project.fullName}: ${String(err)}`,
          timestamp: new Date().toISOString(),
        })
      }
    }

    return events
  }

  /** Polls GitLab for MRs relevant to monitored projects. */
  private async pollGitLab(config: AppConfig, since: string): Promise<DetectedEvent[]> {
    const token = this.tokenStore.getToken('gitlab')
    if (!token || !config.connections.gitlab) return []

    const { instanceUrl, authMethod } = config.connections.gitlab
    const monitoredGitlab = config.monitoredProjects.filter((p) => p.provider === 'gitlab')
    if (monitoredGitlab.length === 0) return []

    const monitoredIds = new Set(monitoredGitlab.map((p) => p.id))
    const eventsMap = new Map(monitoredGitlab.map((p) => [p.id, p.events]))
    const namesMap = new Map(monitoredGitlab.map((p) => [p.id, p.fullName]))

    const events: DetectedEvent[] = []

    for (const project of monitoredGitlab) {
      this.setProjectPolling(project.id)
    }
    this.pushStatus()

    try {
      const assignedMRs = await gitlabClient.fetchMergeRequests(
        token,
        instanceUrl,
        authMethod,
        'assigned_to_me',
        since,
      )
      for (const mr of assignedMRs) {
        const projectId = `gitlab:${mr.projectId}`
        if (!monitoredIds.has(projectId)) continue
        const projectEvents = eventsMap.get(projectId)
        if (!projectEvents?.prAssigned) continue

        events.push({
          id: `${mr.id}:assigned`,
          provider: 'gitlab',
          projectFullName: namesMap.get(projectId) ?? projectId,
          type: 'pr_assigned',
          title: mr.title,
          url: mr.url,
          author: mr.author,
          timestamp: mr.timestamp,
        })
      }

      const reviewMRs = await gitlabClient.fetchMergeRequests(
        token,
        instanceUrl,
        authMethod,
        'reviews_for_me',
        since,
      )
      for (const mr of reviewMRs) {
        const projectId = `gitlab:${mr.projectId}`
        if (!monitoredIds.has(projectId)) continue
        const projectEvents = eventsMap.get(projectId)
        if (!projectEvents?.prReviewRequested) continue

        events.push({
          id: `${mr.id}:review`,
          provider: 'gitlab',
          projectFullName: namesMap.get(projectId) ?? projectId,
          type: 'pr_review_requested',
          title: mr.title,
          url: mr.url,
          author: mr.author,
          timestamp: mr.timestamp,
        })
      }
      for (const project of monitoredGitlab) {
        this.recordProjectResult(project.id, true)
      }
    } catch (err) {
      for (const project of monitoredGitlab) {
        this.recordProjectResult(project.id, false, String(err))
      }
      this.errors.push({
        provider: 'gitlab',
        message: String(err),
        timestamp: new Date().toISOString(),
      })
    }

    return events
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
      lastPollAt: new Date().toISOString(),
      lastError: success ? null : (error ?? 'Unknown error'),
    })
  }

  /** Calculates the lookback timestamp based on config. */
  private getLookbackTimestamp(config: AppConfig): string {
    const now = new Date()
    now.setMinutes(now.getMinutes() - config.polling.lookbackMinutes)
    return now.toISOString()
  }

  /** Pushes current poller status to the renderer. */
  private pushStatus(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('poller:status-changed', this.getStatus())
    }
  }

  /** Pushes new detected events to the renderer. */
  private pushNewEvents(events: DetectedEvent[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('notification:new-events', events)
    }
  }
}
