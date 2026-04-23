import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ScrollText, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { LogEntry } from '../../../../shared/ipc'

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-muted-foreground',
  warn: 'text-yellow-500',
  error: 'text-red-500',
}

/** Formats an ISO timestamp as HH:MM:SS. */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString()
}

/** Renders a single context value compactly (JSON for objects, bare for primitives). */
function renderValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return ''
  if (typeof value === 'string') return value.includes(' ') ? JSON.stringify(value) : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** Flattens a context object to `key=value key=value` for inline display. */
function formatContext(context: Record<string, unknown> | undefined): string {
  if (!context) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue
    parts.push(`${key}=${renderValue(value)}`)
  }
  return parts.join(' ')
}

/** Modal dialog showing application logs from the main process. */
export function LogViewer(): ReactNode {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<LogEntry[]>([])

  const refresh = useCallback(() => {
    window.api.logs.get().then(setEntries)
  }, [])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const handleClear = useCallback(async () => {
    await window.api.logs.clear()
    setEntries([])
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ScrollText className="size-3.5" />
          View logs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Application Logs</DialogTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={refresh}>
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleClear}>
                <Trash2 className="size-3.5" />
                Clear
              </Button>
            </div>
          </div>
        </DialogHeader>
        <ScrollArea className="h-80">
          {entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No logs yet</p>
          ) : (
            <div className="space-y-0.5 font-mono text-xs">
              {entries.map((entry, i) => {
                const context = formatContext(entry.context)
                return (
                  <div key={i} className="flex gap-2 px-1 py-0.5">
                    <span className="shrink-0 text-muted-foreground">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span className={`w-10 shrink-0 ${LEVEL_COLORS[entry.level]}`}>
                      {entry.level}
                    </span>
                    <span className="min-w-0 break-all">
                      <span>{entry.message}</span>
                      {context && <span className="ml-2 text-muted-foreground">{context}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
