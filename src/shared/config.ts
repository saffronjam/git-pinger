import type { GitHubConnection, GitLabConnection } from './provider'
import type { MonitoredProject } from './project'
import type { NotificationEventType } from './notification'

export interface EventTemplate {
  titleTemplate: string
  bodyTemplate: string
}

export type NotificationTemplates = Record<NotificationEventType, EventTemplate>

export const DEFAULT_TEMPLATES: NotificationTemplates = {
  pr_created: {
    titleTemplate: 'New PR - {{title}}',
    bodyTemplate: '{{author}} created a new PR "{{title}}" in {{project}} ({{provider}})',
  },
  pr_assigned: {
    titleTemplate: 'PR assigned - {{title}}',
    bodyTemplate: '{{author}} assigned "{{title}}" to you in {{project}} ({{provider}})',
  },
  pr_review_requested: {
    titleTemplate: 'Review requested - {{title}}',
    bodyTemplate: '{{author}} requested your review for "{{title}}" in {{project}} ({{provider}})',
  },
}

export interface AppConfig {
  connections: {
    github: GitHubConnection | null
    gitlab: GitLabConnection | null
  }
  monitoredProjects: MonitoredProject[]
  polling: {
    intervalSeconds: number
    lookbackMinutes: number
  }
  notifications: NotificationTemplates
  theme: 'light' | 'dark' | 'system'
  startup: {
    runAtLogin: boolean
  }
}

export const DEFAULT_CONFIG: AppConfig = {
  connections: {
    github: null,
    gitlab: null,
  },
  monitoredProjects: [],
  polling: {
    intervalSeconds: 60,
    lookbackMinutes: 0,
  },
  notifications: DEFAULT_TEMPLATES,
  theme: 'system',
  startup: {
    runAtLogin: false,
  },
}
