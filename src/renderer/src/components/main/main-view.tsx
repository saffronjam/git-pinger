import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowUpDown, FolderOpen, Settings } from 'lucide-react'
import { GitPingerLogo } from '@/components/icons/gitpinger-logo'
import { AppShell } from '@/components/layout/app-shell'
import { AppHeader } from '@/components/layout/app-header'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ProviderStatusPopover } from './provider-status-popover'
import { useConfig } from '@/hooks/use-config'
import { AddProjectModal, AddProjectButton } from './add-project-modal'
import { ProjectRow } from './project-row'
import type {
  AvailableProject,
  MonitoredProject,
  NotificationEventFlags,
} from '../../../../shared/project'

interface MainViewProps {
  onOpenSettings: () => void
}

type SortKey = 'name' | 'provider'
type SortDir = 'asc' | 'desc'

interface SortState {
  key: SortKey
  dir: SortDir
}

/** Main view showing monitored projects with add-project flow and sortable table. */
export function MainView({ onOpenSettings }: MainViewProps): ReactNode {
  const { config } = useConfig()
  const [monitored, setMonitored] = useState<MonitoredProject[]>([])
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' })
  const [addModalOpen, setAddModalOpen] = useState(false)

  const configMonitoredProjects = config?.monitoredProjects

  useEffect(() => {
    if (configMonitoredProjects) {
      setMonitored(configMonitoredProjects)
    }
  }, [configMonitoredProjects])

  const sorted = useMemo(() => {
    const list = [...monitored]
    const multiplier = sort.dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      if (sort.key === 'provider') {
        const cmp = a.provider.localeCompare(b.provider)
        if (cmp !== 0) return cmp * multiplier
        return a.fullName.localeCompare(b.fullName) * multiplier
      }
      return a.fullName.localeCompare(b.fullName) * multiplier
    })
    return list
  }, [monitored, sort])

  const toggleSort = useCallback((key: SortKey) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }, [])

  const handleAdd = useCallback(
    (project: AvailableProject) => {
      const exists = monitored.some((p) => p.id === project.id)
      if (exists) return
      const added: MonitoredProject = {
        ...project,
        events: { prCreated: true, prAssigned: true, prReviewRequested: true },
      }
      const updated = [...monitored, added]
      setMonitored(updated)
      window.api.projects.setMonitored(updated)
    },
    [monitored],
  )

  const handleRemove = useCallback(
    (projectId: string) => {
      const updated = monitored.filter((p) => p.id !== projectId)
      setMonitored(updated)
      window.api.projects.setMonitored(updated)
    },
    [monitored],
  )

  const handleUpdateEvents = useCallback(
    (project: MonitoredProject, events: NotificationEventFlags) => {
      const updated = monitored.map((p) => (p.id === project.id ? { ...p, events } : p))
      setMonitored(updated)
      window.api.projects.setMonitored(updated)
    },
    [monitored],
  )

  return (
    <AppShell>
      <AppHeader
        center={
          <div className="flex items-center gap-2">
            <GitPingerLogo className="size-5 text-violet-500" />
            <span className="text-lg font-semibold">GitPinger</span>
          </div>
        }
        right={
          <div className="flex items-center gap-2">
            {config?.connections.github && (
              <ProviderStatusPopover
                provider="github"
                username={config.connections.github.username}
              />
            )}
            {config?.connections.gitlab && (
              <ProviderStatusPopover
                provider="gitlab"
                username={config.connections.gitlab.username}
              />
            )}
            <Button variant="ghost" size="icon" onClick={onOpenSettings}>
              <Settings className="size-4" />
            </Button>
          </div>
        }
      />

      <AddProjectModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        monitored={monitored}
        onAdd={handleAdd}
        onRemove={handleRemove}
      />

      {monitored.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <FolderOpen className="size-12 text-muted-foreground/50" />
          <div className="text-center">
            <p className="text-sm font-medium">No projects monitored</p>
            <p className="text-xs text-muted-foreground">
              Add projects to start receiving notifications
            </p>
          </div>
          <AddProjectButton onClick={() => setAddModalOpen(true)} />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between border-b px-3 py-1.5">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => toggleSort('name')}
              >
                Project
                <ArrowUpDown className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => toggleSort('provider')}
              >
                Provider
                <ArrowUpDown className="size-3" />
              </Button>
            </div>
            <AddProjectButton onClick={() => setAddModalOpen(true)} />
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="py-1">
              {sorted.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  onUpdateEvents={(events) => handleUpdateEvents(project, events)}
                  onRemove={() => handleRemove(project.id)}
                />
              ))}
            </div>
          </ScrollArea>
        </>
      )}
    </AppShell>
  )
}
