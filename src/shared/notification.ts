import type { Provider } from './provider'

export type NotificationEventType = 'pr_created' | 'pr_assigned' | 'pr_review_requested'

export interface DetectedEvent {
  id: string
  provider: Provider
  projectFullName: string
  type: NotificationEventType
  title: string
  url: string
  author: string
  timestamp: string
}
