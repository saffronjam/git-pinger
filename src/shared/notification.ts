import type { Provider } from './provider'

export type NotificationEventType =
  | 'pr_created'
  | 'pr_assigned'
  | 'pr_review_requested'
  | 'pr_comment'

export interface DetectedEvent {
  id: string
  provider: Provider
  projectFullName: string
  type: NotificationEventType
  title: string
  url: string
  /** Actor responsible for this event, or "Someone" when assignment attribution is unavailable. */
  author: string
  timestamp: string
}
