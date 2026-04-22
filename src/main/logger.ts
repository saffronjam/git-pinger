import log from 'electron-log/main'
import type { LogEntry } from '../shared/ipc'

type LogLevel = 'info' | 'warn' | 'error'

type LogContext = Record<string, unknown>

const MAX_ENTRIES = 500
const entries: LogEntry[] = []

log.transports.file.level = 'info'
log.transports.console.level = 'info'

/** Renders a context object as `key=value key=value` for console/file sinks. */
function formatContext(context: LogContext): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue
    let rendered: string
    if (value === null) rendered = 'null'
    else if (typeof value === 'string')
      rendered = value.includes(' ') ? JSON.stringify(value) : value
    else if (typeof value === 'number' || typeof value === 'boolean') rendered = String(value)
    else rendered = JSON.stringify(value)
    parts.push(`${key}=${rendered}`)
  }
  return parts.join(' ')
}

/** Appends a log entry to the in-memory buffer for the UI viewer. */
function push(level: LogLevel, message: string, context?: LogContext): void {
  const entry: LogEntry = { timestamp: new Date().toISOString(), level, message }
  if (context && Object.keys(context).length > 0) entry.context = context
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
}

/** Emits a log line to the electron-log sinks with structured context appended. */
function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (context && Object.keys(context).length > 0) {
    const rendered = formatContext(context)
    const line = rendered.length > 0 ? `${message} ${rendered}` : message
    log[level](line)
  } else {
    log[level](message)
  }
}

export const logger = {
  info(message: string, context?: LogContext): void {
    emit('info', message, context)
    push('info', message, context)
  },
  warn(message: string, context?: LogContext): void {
    emit('warn', message, context)
    push('warn', message, context)
  },
  error(message: string, context?: LogContext): void {
    emit('error', message, context)
    push('error', message, context)
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
