import type { LogEntry } from '../shared/ipc'

type LogLevel = 'info' | 'warn' | 'error'

const MAX_ENTRIES = 500
const entries: LogEntry[] = []

/** Appends a log entry and keeps the buffer capped. */
function push(level: LogLevel, message: string): void {
  entries.push({ timestamp: new Date().toISOString(), level, message })
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
}

export const logger = {
  info(message: string): void {
    console.log(`[info] ${message}`)
    push('info', message)
  },
  warn(message: string): void {
    console.warn(`[warn] ${message}`)
    push('warn', message)
  },
  error(message: string): void {
    console.error(`[error] ${message}`)
    push('error', message)
  },
  /** Returns all log entries. */
  getEntries(): LogEntry[] {
    return [...entries]
  },
  /** Clears all log entries. */
  clear(): void {
    entries.length = 0
  },
}
