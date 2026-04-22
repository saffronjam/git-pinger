import { useCallback, useState, type ReactNode } from 'react'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { GitHubIcon } from '@/components/icons/github-icon'
import { GitLabIcon } from '@/components/icons/gitlab-icon'
import { useSync } from '@/hooks/use-sync'
import type { AvailableProject, MonitoredProject } from '../../../../shared/project'

interface AddProjectModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  monitored: MonitoredProject[]
  onAdd: (project: AvailableProject) => void
  onRemove: (projectId: string) => void
}

interface AddProjectButtonProps {
  onClick: () => void
}

/** Splits a full name like "owner/repo" into path prefix and repo name. */
function splitName(fullName: string): { path: string; name: string } {
  const lastSlash = fullName.lastIndexOf('/')
  if (lastSlash === -1) return { path: '', name: fullName }
  return { path: fullName.slice(0, lastSlash + 1), name: fullName.slice(lastSlash + 1) }
}

/** Button that opens the add-project modal. */
export function AddProjectButton({ onClick }: AddProjectButtonProps): ReactNode {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Plus className="size-3.5" />
      Add project
    </Button>
  )
}

/** Modal dialog for browsing and adding projects to monitor. */
export function AddProjectModal({
  open,
  onOpenChange,
  monitored,
  onAdd,
  onRemove,
}: AddProjectModalProps): ReactNode {
  const [search, setSearch] = useState('')
  const { repos } = useSync()

  const monitoredIds = new Set(monitored.map((p) => p.id))

  const filtered = search.trim()
    ? repos.filter((p) => p.fullName.toLowerCase().includes(search.toLowerCase()))
    : repos

  const handleToggle = useCallback(
    (project: AvailableProject, checked: boolean) => {
      if (checked) {
        onAdd(project)
      } else {
        onRemove(project.id)
      }
    },
    [onAdd, onRemove],
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (v) setSearch('')
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add projects</DialogTitle>
          <DialogDescription>Select repositories to monitor for notifications.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
        </div>
        <ScrollArea className="h-[320px]">
          {filtered.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              {search
                ? 'No projects match your search'
                : repos.length === 0
                  ? 'Syncing repositories...'
                  : 'No projects found'}
            </div>
          ) : (
            <div className="space-y-0.5 p-1">
              {filtered.map((project) => {
                const { path, name } = splitName(project.fullName)
                const Icon = project.provider === 'github' ? GitHubIcon : GitLabIcon
                const isMonitored = monitoredIds.has(project.id)

                return (
                  <div
                    key={project.id}
                    className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 hover:bg-accent/50"
                    onClick={() => handleToggle(project, !isMonitored)}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm">
                        <span className="text-muted-foreground">{path}</span>
                        <span className="font-medium">{name}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={isMonitored}
                        onCheckedChange={(checked) => handleToggle(project, checked)}
                      />
                    </div>
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
