import { useCallback, type ReactNode } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { GitHubIcon } from '@/components/icons/github-icon'
import { GitLabIcon } from '@/components/icons/gitlab-icon'
import { useSync } from '@/hooks/use-sync'
import { usePollerStatus } from '@/hooks/use-poller-status'
import type { ProviderSyncStatus } from '../../../../shared/ipc'
import type { Provider } from '../../../../shared/provider'

interface ProviderStatusPopoverProps {
  provider: Provider
  username: string
}

/** Formats a timestamp as a relative time string. */
function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

/** Renders the sync status details for one provider. */
function SyncDetail({ status }: { status: ProviderSyncStatus | null }): ReactNode {
  if (!status) return <p className="text-xs text-muted-foreground">Not connected</p>

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Repos</span>
        <span className="text-xs font-medium">{status.repoCount}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Last sync</span>
        <span className="text-xs font-medium">
          {status.syncing ? (
            <span className="flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              Syncing...
            </span>
          ) : status.lastSyncAt ? (
            timeAgo(status.lastSyncAt)
          ) : (
            'Never'
          )}
        </span>
      </div>
      {status.error && <p className="text-xs text-destructive">{status.error}</p>}
    </div>
  )
}

/** Clickable provider badge that shows sync/poller status in a popover. */
export function ProviderStatusPopover({
  provider,
  username,
}: ProviderStatusPopoverProps): ReactNode {
  const { status: syncStatus } = useSync()
  const pollerStatus = usePollerStatus()

  const providerSync = provider === 'github' ? syncStatus?.github : syncStatus?.gitlab
  const Icon = provider === 'github' ? GitHubIcon : GitLabIcon
  const isSyncing = providerSync?.syncing === true

  const handleSyncNow = useCallback(() => {
    window.api.sync.trigger()
  }, [])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors hover:bg-accent">
          <Icon className="size-3" />
          {username}
          {isSyncing && <Loader2 className="size-2.5 animate-spin" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {provider === 'github' ? 'GitHub' : 'GitLab'}
            </span>
            <Button variant="ghost" size="icon-xs" onClick={handleSyncNow} disabled={isSyncing}>
              <RefreshCw className={`size-3 ${isSyncing ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          <SyncDetail status={providerSync ?? null} />

          <Separator />

          <div className="space-y-1.5">
            <span className="text-xs font-medium">Poller</span>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Status</span>
              <Badge
                variant="secondary"
                className={`px-1.5 py-0 text-[10px] ${pollerStatus?.running ? 'bg-emerald-500/15 text-emerald-500' : ''}`}
              >
                {pollerStatus?.running ? 'Running' : 'Stopped'}
              </Badge>
            </div>
            {pollerStatus?.lastPollAt && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Last poll</span>
                <span className="text-xs font-medium">{timeAgo(pollerStatus.lastPollAt)}</span>
              </div>
            )}
            {pollerStatus?.errors
              .filter((e) => e.provider === provider)
              .map((e, i) => (
                <p key={i} className="text-xs text-destructive">
                  {e.message}
                </p>
              ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
