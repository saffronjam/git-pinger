import log from 'electron-log/main'
import type { LogEntry } from '../shared/ipc'

type LogLevel = 'info' | 'warn' | 'error'

const MAX_ENTRIES = 500
const entries: LogEntry[] = []

log.transports.file.level = 'info'
log.transports.console.level = 'info'

/** Appends a log entry to the in-memory buffer for the UI viewer. */
function push(level: LogLevel, message: string): void {
  entries.push({ timestamp: new Date().toISOString(), level, message })
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
}

export const logger = {
  info(message: string): void {
    log.info(message)
    push('info', message)
  },
  warn(message: string): void {
    log.warn(message)
    push('warn', message)
  },
  error(message: string): void {
    log.error(message)
    push('error', message)
  },
  /** Returns all log entries from the in-memory buffer. */
  getEntries(): LogEntry[] {
    return [...entries]
  },
  /** Clears the in-memory buffer. */
  clear(): void {
    entries.length = 0
  },
}
