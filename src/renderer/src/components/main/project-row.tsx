import { useCallback, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronRight, ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { GitHubIcon } from '@/components/icons/github-icon'
import { GitLabIcon } from '@/components/icons/gitlab-icon'
import { usePollerStatus } from '@/hooks/use-poller-status'
import type { MonitoredProject, NotificationEventFlags } from '../../../../shared/project'
import type { ProjectPollStatus } from '../../../../shared/ipc'
import { ProjectEventConfig, EVENT_CHIP_LABELS } from './project-event-config'

interface ProjectRowProps {
  project: MonitoredProject
  onUpdateEvents: (events: NotificationEventFlags) => void
  onRemove: () => void
}

const ALL_ON: NotificationEventFlags = {
  prCreated: true,
  prAssigned: true,
  prReviewRequested: true,
}

const ALL_OFF: NotificationEventFlags = {
  prCreated: false,
  prAssigned: false,
  prReviewRequested: false,
}

/** Returns the active event keys from a flags object. */
function activeEvents(flags: NotificationEventFlags): (keyof NotificationEventFlags)[] {
  return (Object.keys(flags) as (keyof NotificationEventFlags)[]).filter((k) => flags[k])
}

/** Splits "owner/repo" into dimmed path prefix and white repo name. */
function splitName(fullName: string): { path: string; name: string } {
  const lastSlash = fullName.lastIndexOf('/')
  if (lastSlash === -1) return { path: '', name: fullName }
  return { path: fullName.slice(0, lastSlash + 1), name: fullName.slice(lastSlash + 1) }
}

/** Renders a fixed-size dot with the given color class. */
function StatusDot({ color }: { color: string }): ReactNode {
  return (
    <div className="flex size-3 shrink-0 items-center justify-center">
      <div className={`size-2 rounded-full ${color}`} />
    </div>
  )
}

/** Formats a timestamp as a relative time string. */
/** Formats a timestamp as a readable relative time. */
function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes === 1) return '1 minute ago'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours === 1) return '1 hour ago'
  return `${hours} hours ago`
}

/** Renders a colored status dot with tooltip based on poll history. */
function PollStatusDot({ status }: { status: ProjectPollStatus | null }): ReactNode {
  if (!status) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <StatusDot color="bg-muted" />
          </div>
        </TooltipTrigger>
        <TooltipContent>Not polled yet</TooltipContent>
      </Tooltip>
    )
  }

  if (status.state === 'polling') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex size-3 shrink-0 items-center justify-center">
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          </div>
        </TooltipTrigger>
        <TooltipContent>Polling now...</TooltipContent>
      </Tooltip>
    )
  }

  const hasAnyFailure = status.recentResults.some((r) => !r)
  const lastResult = status.recentResults[status.recentResults.length - 1]
  const lastPollLabel = status.lastPollAt ? timeAgo(status.lastPollAt) : 'never'

  let color: string
  let tooltipText: string

  if (lastResult === false) {
    color = 'bg-red-500'
    tooltipText = `Last poll failed — ${lastPollLabel}`
    if (status.lastError) tooltipText += `\n${status.lastError}`
  } else if (hasAnyFailure) {
    color = 'bg-yellow-500'
    tooltipText = `Last polled ${lastPollLabel}\nSome recent polls failed`
    if (status.lastError) tooltipText += `\nLast error: ${status.lastError}`
  } else {
    color = 'bg-emerald-500'
    tooltipText = `Last polled ${lastPollLabel}`
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <StatusDot color={color} />
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 whitespace-pre-wrap">{tooltipText}</TooltipContent>
    </Tooltip>
  )
}

/** A monitored project row with provider icon, event chips, and collapsible config. */
export function ProjectRow({ project, onUpdateEvents, onRemove }: ProjectRowProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const pollerStatus = usePollerStatus()

  const isEnabled = activeEvents(project.events).length > 0
  const chips = activeEvents(project.events)
  const { path, name } = splitName(project.fullName)
  const Icon = project.provider === 'github' ? GitHubIcon : GitLabIcon
  const projectPollStatus = pollerStatus?.projects[project.id] ?? null

  const handleMainToggle = useCallback(
    (checked: boolean) => {
      onUpdateEvents(checked ? ALL_ON : ALL_OFF)
    },
    [onUpdateEvents],
  )

  const handleEventUpdate = useCallback(
    (events: NotificationEventFlags) => {
      onUpdateEvents(events)
    },
    [onUpdateEvents],
  )

  const handleRowClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button[role="switch"]') || target.closest('button')) return
    setOpen((prev) => !prev)
  }, [])

  const handleConfirmRemove = useCallback(() => {
    setConfirmOpen(false)
    onRemove()
  }, [onRemove])

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-accent/50"
        onClick={handleRowClick}
      >
        <PollStatusDot status={projectPollStatus} />
        <ChevronRight
          className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm">
            <span className="text-muted-foreground">{path}</span>
            <span className="font-medium">{name}</span>
          </span>
          {chips.length > 0 && (
            <div className="flex shrink-0 gap-1">
              {chips.map((key) => (
                <Badge key={key} variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {EVENT_CHIP_LABELS[key]}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => window.open(project.webUrl, '_blank')}
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open project in browser</TooltipContent>
          </Tooltip>
          <div className="flex items-center">
            <Switch checked={isEnabled} onCheckedChange={handleMainToggle} />
          </div>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:border-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove {project.fullName}?</DialogTitle>
                <DialogDescription>
                  This will stop monitoring this project. You can add it again later.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleConfirmRemove}>
                  Remove
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <CollapsibleContent>
        <div className="ml-10">
          <ProjectEventConfig events={project.events} onUpdate={handleEventUpdate} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
