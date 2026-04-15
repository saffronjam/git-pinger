import type { Provider } from './provider'

export interface NotificationEventFlags {
  prCreated: boolean
  prAssigned: boolean
  prReviewRequested: boolean
}

export interface MonitoredProject {
  id: string
  provider: Provider
  fullName: string
  name: string
  webUrl: string
  events: NotificationEventFlags
}

export interface AvailableProject {
  id: string
  provider: Provider
  fullName: string
  name: string
  webUrl: string
}
