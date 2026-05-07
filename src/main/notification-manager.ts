import { Notification, shell } from 'electron'
import type { AppConfig } from '../shared/config'
import type { DetectedEvent } from '../shared/notification'
import iconPath from '../../resources/icon.png?asset'
import { logger } from './logger'

const activeNotifications = new Set<Notification>()

const EVENT_LABELS: Record<string, string> = {
  pr_created: 'New PR',
  pr_assigned: 'PR Assigned',
  pr_review_requested: 'Review Requested',
  pr_comment: 'PR Comment',
}

/** Replaces {{key}} placeholders in a template string with values. */
function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`)
}

/** Builds the template variable map from a detected event. */
function buildVariables(event: DetectedEvent): Record<string, string> {
  return {
    provider: event.provider === 'github' ? 'GitHub' : 'GitLab',
    project: event.projectFullName,
    title: event.title,
    author: event.author,
    event: EVENT_LABELS[event.type] ?? event.type,
    url: event.url,
    type: event.type,
  }
}

/**
 * Shows a native OS notification for a detected event using config templates.
 * Holds a reference to prevent macOS GC from collecting the handler.
 */
export function showNotification(event: DetectedEvent, config: AppConfig): void {
  if (!Notification.isSupported()) {
    logger.warn('Notifications are not supported on this system')
    return
  }

  const variables = buildVariables(event)
  const template = config.notifications[event.type]
  const title = renderTemplate(template.titleTemplate, variables)
  const body = renderTemplate(template.bodyTemplate, variables)

  const notification = new Notification(
    process.platform === 'darwin' ? { title, body } : { title, body, icon: iconPath },
  )

  activeNotifications.add(notification)

  notification.on('click', () => {
    logger.info(`Notification clicked: ${event.projectFullName} — ${event.type}`)
    activeNotifications.delete(notification)
    setImmediate(() => {
      shell.openExternal(event.url).catch(() => {})
    })
  })

  notification.on('close', () => {
    activeNotifications.delete(notification)
  })

  notification.on('failed', (_, error) => {
    logger.error(`Notification failed: ${String(error)}`)
    activeNotifications.delete(notification)
  })

  logger.info(`Notification shown: ${event.type} — ${event.projectFullName} — ${event.title}`)
  notification.show()
}
